// ==UserScript==
// @name         pixiv fanbox resource saver
// @namespace    https://pixiv.fanbox.net/
// @version      20191201
// @description  pixiv fanbox article downloader
// @downloadURL  https://raw.githubusercontent.com/rayfill/userscripts/master/pixiv_fanbox_downloader.user.js
// @updateURL    https://raw.githubusercontent.com/rayfill/userscripts/master/pixiv_fanbox_downloader.user.js
// @author       rayfill
// @match        https://www.pixiv.net/fanbox
// @match        https://www.pixiv.net/fanbox/*
// @require      https://raw.githubusercontent.com/rayfill/GM_fetch/master/GM_fetch.js
// @require      https://raw.githubusercontent.com/rayfill/gm-goodies/master/xhr-hook.js
// @require      https://raw.githubusercontent.com/Stuk/jszip/master/dist/jszip.js
// @require      https://raw.githubusercontent.com/eligrey/FileSaver.js/master/dist/FileSaver.js
// @connect      pixiv.net
// @connect      pximg.net
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// ==/UserScript==
const indexURL = new RegExp("^https://www.pixiv.net/ajax/fanbox/index$");
const postListHomeURL = new RegExp("^https://fanbox.pixiv.net/api/post[.]listHome.*$");
const postURL = new RegExp("^https://fanbox.pixiv.net/api/post.info[?]postId=([0-9]+)$");
const creatorURL = new RegExp("^https://www.pixiv.net/ajax/fanbox/creator[?]userId=([0-9]+)$");


const itemMap = new Map();

function collectItems(items) {
  for (let item of items) {
    let id = item.id;
    itemMap.set(id, item);
  }

  console.log(Array.from(itemMap.keys()));
}

function main() {
  xhrHook2((url, resType, content) => {

    console.log("url:", url);
    let match = null;
    let json = null;
    if (match = indexURL.exec(url)) {
      if (resType !== "json") {
        json = JSON.parse(content);
      } else {
        json = content;
      }
      let items = json.body.postListForHome.items.concat(json.body.postListOfSupporting.items);
      collectItems(items);

    } else if (match = postListHomeURL.exec(url)) {
      if (resType !== "json") {
        json = JSON.parse(content);
      } else {
        json = content;
      }
      let items = json.body.items;
      collectItems(items);

    } else if (match = postURL.exec(url)) {
      if (resType !== "json") {
        json = JSON.parse(content);
      } else {
        json = content;
      }
      let items = [json.body];
      collectItems(items);

    } else if (match = creatorURL.exec(url)) {
      if (resType !== "json") {
        json = JSON.parse(content);
      } else {
        json = content;
      }
      let items = json.body.post.items;
      collectItems(items);
    }
  });

  let observer = new MutationObserver((records, observer) => {
    window.postMessage({ type: "mutation" }, "*");
  });

  window.addEventListener("message", mutationHandler);

  observer.observe(document, { childList: true, subtree: true });
}

const postIdPattern = new RegExp('^https://www.pixiv.net/fanbox/creator/([0-9]+)/post/([0-9]+)$');
function getArticleId(article) {
  let match = postIdPattern.exec(window.location.href);
  if (match === null)
    throw new TypeError("invalid url");

  return match[2];

}

function handleImage(body) {
  return body.images.map((elm, idx) => {
    return {
      filename: `${idx}.${elm.extension}`,
      url: elm.originalUrl
    }
  });
}

function handleFile(body) {
  return body.files.map((elm, idx) => {
    return {
      filename: `${elm.name}.${elm.extension}`,
      url: elm.url
    }
  });
}

function fetchResources(resources) {
  return resources.map((elm) => {
    return {
      filename: elm.filename,
      blob: GM_fetch(elm.url).then((res) => {
        if (!res.ok)
          throw new TypeError("resource fetch failed", res);
        return res.blob();
      })
    };
  });
}

function download(id, btn) {
  let info = itemMap.get(id);
  console.log("info", info);

  let {
    title: title,
    coverImageUrl: cover,
    updateDateTime: lastModified,
    type: type,
    body: body,
    user: user
  } = info;
  let text = body.text;
  console.log({ title: title, cover: cover, lastModified: lastModified, type: type, body: body, user: user });

  let resources = [];
  switch (type) {
    case "image":
      resources = handleImage(body);
      break;

    case "file":
      resources = handleFile(body);
      break;

    default:
      throw new TypeError("unhandled type: " + type);
  }

  console.log("resources:", resources);
  let res = fetchResources(resources);
  let zip = new JSZip();
  zip.file("message.txt", text);
  zip.file("cover.jpg", GM_fetch(cover).then((res) => {
    if (!res.ok)
      throw new TypeError("cover fetch failed:", res);
    return res.blob();
  }));
  res.forEach((elm) => {
    zip.file(type + "/" + elm.filename, elm.blob);
  });
  zip.generateAsync({ type: "blob" }).then((blob) => {
    saveAs(blob, title + ".zip");
    localStorage.setItem(id, true);
  });
}

const proceedColor = "rgb(0, 150, 250)";
const unproceedColor = "rgb(180, 180, 180)";
function mutationHandler(evt) {
  let { type: type } = evt.target;
  if (type !== "mutation") {
    return;
  }
  console.log("mutation");

  let article = document.querySelector('article');
  if (article !== null) {
    if (article.dataset.proceed) {
      return;
    }

    let id = getArticleId(article);
    if (!itemMap.get(id)) {
      return;
    }

    let button = document.createElement('button');
    button.style.backgroundColor = localStorage.getItem(id) ? proceedColor : unproceedColor;
    button.addEventListener('click', (evt) => {
      download(id, button);
    });
    button.innerText = "click to save";

    article.appendChild(button);
    article.dataset.proceed = true;
  }
}

main();
console.log("pixiv fanbox downloader loaded");
