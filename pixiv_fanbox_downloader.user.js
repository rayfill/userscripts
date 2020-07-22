// ==UserScript==
// @name         pixiv fanbox resource saver
// @namespace    https://pixiv.fanbox.net/
// @version      20200722
// @description  pixiv fanbox article downloader
// @downloadURL  https://raw.githubusercontent.com/rayfill/userscripts/master/pixiv_fanbox_downloader.user.js
// @updateURL    https://raw.githubusercontent.com/rayfill/userscripts/master/pixiv_fanbox_downloader.user.js
// @author       rayfill
// @match        https://*.fanbox.cc/*
// @require      https://raw.githubusercontent.com/rayfill/GM_fetch/master/GM_fetch.js
// @require      https://raw.githubusercontent.com/rayfill/gm-goodies/master/xhr-hook.js
// @require      https://raw.githubusercontent.com/Stuk/jszip/master/dist/jszip.js
// @require      https://raw.githubusercontent.com/eligrey/FileSaver.js/b95a82a3ecb208fef5931e8931b2a8e67a834c02/dist/FileSaver.js
// @connect      pixiv.net
// @connect      pximg.net
// @connect      fanbox.cc
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// ==/UserScript==
const indexURL = new RegExp("^https://www.pixiv.net/ajax/fanbox/index$");
const postListHomeURL = new RegExp("^https://api[.]fanbox[.]cc/post[.]listCreator.*$");
const postURL = new RegExp("^https://api[.]fanbox[.]cc/post[.]info[?]postId=([0-9]+)$");
const creatorURL = new RegExp("^https://api[.]fanbox[.]cc/creator[.]get?creatorId=(.+)$");
const postIdPattern = new RegExp('^https://www.fanbox.cc/@([^/]+)/posts/([0-9]+)$');
const postIdPattern2 = new RegExp('^https://([^.]+).fanbox.cc/posts/([0-9]+)$');
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
    if (match = postListHomeURL.exec(url)) {
      console.log("postlist");
      if (resType !== "json") {
        json = JSON.parse(content);
      } else {
        json = content;
      }
      let items = json.body.items;
      collectItems(items);

    } else if (match = postURL.exec(url)) {
      console.log("post");
      if (resType !== "json") {
        json = JSON.parse(content);
      } else {
        json = content;
      }
      let items = [json.body];
      collectItems(items);

    }
    /*else if (match = creatorURL.exec(url)) {
      console.log("creator");
      if (resType !== "json") {
        json = JSON.parse(content);
      } else {
        json = content;
      }
      let items = json.body.post.items;
      collectItems(items);
    }*/
  });

  let observer = new MutationObserver((records, observer) => {
    window.postMessage({ type: "mutation" }, "*");
  });

  window.addEventListener("message", mutationHandler);

  observer.observe(document, { childList: true, subtree: true });
}

function getArticleId(article) {
  let url = new URL(window.location.href);
  url.search = "";
  let match = postIdPattern.exec(url.toString());
  if (match === null) {
    match = postIdPattern2.exec(url.toString());
    if (match === null)
      throw new TypeError("invalid url: "+ url.toString());
  }
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

function handleText(body) {
  return [];
}

function handleArticle(body) {
  console.log("body", body);
  let result = [];
  for (let imageId in body.imageMap) {
    let { id: id, extension: extension, originalUrl: originalUrl } = body.imageMap[imageId];
    result.push({
      filename: `${id}.${extension}`,
      url: originalUrl
    });
  }
  return result;
}

function makeProgressHandler() {
  let loaded = 0;
  return (evt) => {
    let currentLoaded = evt.loaded;
    let amount = currentLoaded - loaded;
    loaded = currentLoaded;
    window.postMessage({ type: "progress", amount: amount }, "*");
  };
}

function fetchResources(resources) {
  return resources.map((elm) => {
    return {
      filename: elm.filename,
      blob: GM_fetch(elm.url, { onprogress: makeProgressHandler()}).then((res) => {
        if (!res.ok)
          throw new TypeError("resource fetch failed", res);
        return res.blob();
      })
    };
  });
}

function parseText(body) {
  return body.text;
}

function parseArticle(body) {
  let imageMap = body.imageMap;
  let blocks = body.blocks.map((block) => {
    switch (block.type) {
      case "p":
        return `<p>${block.text}</p>`;
        break;

      case "image":
        return `<img src="article/${block.imageId}.${imageMap[block.imageId].extension}"></img>`;
        break;

      default:
        alert("unknown block type:", block.type);
        debugger;
    }
  });

  return '<!DOCTYPE html><head><meta charset="UTF-8"/></head><body>' + blocks.join('') + "</body></html>";
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

    case "text":
      resources = handleText(body);
      break;

    case "article":
      resources = handleArticle(body);
      break;

    default:
      throw new TypeError("unhandled type: " + type);
  }

  console.log("resources:", resources);
  let res = fetchResources(resources);
  let zip = new JSZip();
  if (type === "article") {
    let html = parseArticle(body);
    zip.file("message.html", html);
  } else if (type === "text") {
    let text = parseText(body);
    zip.file("message.txt", text);
  } else {
    zip.file("message.txt", text);
  }
  if (cover != null) {
    zip.file("cover.jpg", GM_fetch(cover).then((res) => {
      if (!res.ok) {
        throw new TypeError("cover fetch failed:", res);
      }
      return res.blob();
    }));
  }
  res.forEach((elm) => {
    zip.file(type + "/" + elm.filename, elm.blob);
  });
  zip.generateAsync({ type: "blob" }, (metadata) => {
    if (metadata.currentFile) {
      window.postMessage({
        type: "compress",
        filename: metadata.currentFile,
        percent: Math.round(metadata.percent * 100) / 100
      }, "*");
    }
  }).then((blob) => {
    saveAs(blob, title + ".zip");
    localStorage.setItem(id, true);
  });
}

const proceedColor = "rgb(0, 150, 250)";
const unproceedColor = "rgb(180, 180, 180)";
function mutationHandler(evt) {
  let { type: type } = evt.data;
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
    console.log("id:", id);
    if (!itemMap.get(id)) {
      console.log("can not find from itemmap");
      return;
    }

    let button = document.createElement('button');
    button.style.backgroundColor = localStorage.getItem(id) ? proceedColor : unproceedColor;
    button.addEventListener('click', (evt) => {
      download(id, button);
    });
    button.innerText = "click to save";

    progressReceiver(button);

    article.appendChild(button);
    article.dataset.proceed = true;
  }
}

function progressReceiver(btn) {
  let totalReceived = 0;
  window.addEventListener("message", (evt) => {
    let {type: type} = evt.data;

    switch (type) {
      case "progress": {
        let { amount: amount } = evt.data;
        totalReceived += amount;
        btn.innerText = `${totalReceived} bytes received`;
        break;
      }

      case "compress": {
        let { filename: filename, percent: percent } = evt.data;
        btn.innerText = `compressing file: ${filename} (${percent}%)`;
        break;
      }
    }
  });
}

main();
console.log("pixiv fanbox downloader loaded");
