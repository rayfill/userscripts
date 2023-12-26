// ==UserScript==
// @name         pixiv fanbox resource saver
// @namespace    https://pixiv.fanbox.net/
// @version      20231225.0
// @description  pixiv fanbox article downloader
// @downloadURL  https://raw.githubusercontent.com/rayfill/userscripts/master/pixiv_fanbox_downloader.user.js
// @updateURL    https://raw.githubusercontent.com/rayfill/userscripts/master/pixiv_fanbox_downloader.user.js
// @author       rayfill
// @match        https://*.fanbox.cc/*
// @require      https://raw.githubusercontent.com/rayfill/GM_fetch/master/GM_fetch.js
// @require      https://raw.githubusercontent.com/rayfill/gm-goodies/master/xhr-hook.js
// @require      https://raw.githubusercontent.com/Stuk/jszip/v3.2.2/dist/jszip.js
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
  // eslint-disable-next-line no-undef
  xhrHook2((url, resType, content) => {

    console.log("url:", url);
    let json = null;
    if (postListHomeURL.exec(url)) {
      console.log("postlist");
      if (resType !== "json") {
        json = JSON.parse(content);
      } else {
        json = content;
      }
      let items = json.body.items;
      collectItems(items);

    } else if (postURL.exec(url)) {
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

  let observer = new MutationObserver((_records, _observer) => {
    window.postMessage({ type: "mutation" }, "*");
  });

  window.addEventListener("message", mutationHandler);

  observer.observe(document, { childList: true, subtree: true });
}

function getArticleId(_article) {
  let url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  let match = postIdPattern.exec(url.toString());
  if (match === null) {
    match = postIdPattern2.exec(url.toString());
    if (match === null) {
      throw new TypeError("invalid url: " + url.toString());
    }
  }
  return match[2];

}

function handleImage(body) {
  return body.images.map((elm, idx) => {
    return {
      filename: `${idx}.${elm.extension}`,
      url: elm.originalUrl
    };
  });
}

function handleFile(body) {
  return body.files.map((elm) => {
    return {
      filename: `${elm.name}.${elm.extension}`,
      url: elm.url
    };
  });
}

function handleText(_body) {
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
  for (let fileId in body.fileMap) {
    let { id: id, extension: extension, url: url } = body.fileMap[fileId];
    result.push({
      filename: `${id}.${extension}`,
      url: url
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

class Waiter {
  waiter = [];

  async wait() {
    await new Promise((resolve) => {
      this.waiter.push(resolve);
    });
  }

  wakeup() {
    this.waiter.forEach((resolver) => resolver());
    this.waiter.length = 0;
  }
}

class Semaphore {
  current = 0;
  limit;
  waiter = new Waiter();

  constructor(limit = 1) {
    this.limit = limit;
  }

  raise() {
    this.waiter.wakeup();
  }

  wait() {
    return this.waiter.wait();
  }

  async acquire() {
    if (this.current < this.limit) {
      ++this.current;
      return this.limit - this.current;
    }
    await this.wait();
    return await this.acquire();
  }

  release() {
    if (this.current === 0) {
      throw new Error('semaphore does not acquired');
    }
    const current = --this.current;
    this.raise();
    return current;
  }
}

const semaphore = new Semaphore(4);

async function fetchResources(resources) {
  return Promise.allSettled(resources.map(async (elm) => {
    try {
      await semaphore.acquire();
      const res = await GM_fetch(elm.url, { onprogress: makeProgressHandler() });
      if (!res.ok) {
        console.log('error', elm.url);
        throw new TypeError("resource fetch failed", res);
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      const filename = contentDisposition !== null ? getContentDispositionName(contentDisposition) : elm.filename;

      return {
        filename: filename,
        // eslint-disable-next-line no-undef
        blob: blob,
      };
    } catch (e) {
      return {
        error: e,
        url: elm.url,
      };
    } finally {
      semaphore.release();
    }
  }));
}

function parseText(body) {
  return body.text;
}

function parseArticle(body) {
  let imageMap = body.imageMap;
  let fileMap = body.fileMap;
  let urlEmbedMap = body.urlEmbedMap;
  let embedMap = body.embedMap;

  let blocks = body.blocks.map((block) => {
    switch (block.type) {
      case "p":
        return `<p>${block.text}</p>`;

      case "header":
        return `<h2>${block.text}</h2>`;

      case "image":
        return `<img src="article/${block.imageId}.${imageMap[block.imageId].extension}"></img>`;

      case "file":
        return `<video src="article/${block.fileId}.${fileMap[block.fileId].extension}"></video>`;

      case "url_embed":
        return `<a href="${urlEmbedMap[block.urlEmbedId].url}">${urlEmbedMap[block.urlEmbedId].host}</a>`;

      case "embed": {
        const embedItem = embedMap[block.embedId];
        const contentId = embedItem.contentId;
        const serviceProvider = embedItem.serviceProvider;
        return `<div style='border: solid; border-color: black; border-radius: 5px;'>embed block: ${serviceProvider}:${contentId}</div>`;
      }

      default:
        alert(`unknown block type: ${block.type}`);
        debugger;
        return "";
    }
  });

  return '<!DOCTYPE html><head><meta charset="UTF-8"/></head><body>' + blocks.join('') + "</body></html>";
}

async function download(id) {
  let info = itemMap.get(id);
  let lastupdate = new Date(info.updatedDatetime).getTime();
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
  let res = await fetchResources(resources);
  // eslint-disable-next-line no-undef
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
    // eslint-disable-next-line no-undef
    const coverRes = await GM_fetch(cover);
    if (!coverRes.ok) {
      throw new TypeError("cover fetch failed:", res);
    }
    const blob = await coverRes.blob();

    zip.file("cover.jpg", blob);
  }
  res.forEach((elm) => {
    if ('filename' in elm) {
      zip.file(type + "/" + elm.filename, elm.blob);
    } else {
      console.log(elm);
    }
  });
  const blob = await zip.generateAsync({ type: "blob" }, (metadata) => {
    if (metadata.currentFile) {
      window.postMessage({
        type: "compress",
        filename: metadata.currentFile,
        percent: Math.round(metadata.percent * 100) / 100
      }, "*");
    }
  });
  // eslint-disable-next-line no-undef
  saveAs(blob, `${user.userId}_${id}_${lastupdate}_${user.name}_${title}.zip`);
  localStorage.setItem(id, true);
}

const proceedColor = "rgb(0, 150, 250)";
const unproceedColor = "rgb(180, 180, 180)";
function mutationHandler(evt) {
  let { type: type } = evt.data;
  if (type !== "mutation") {
    return;
  }
  //console.log("mutation");

  let article = document.querySelector('article');
  //console.log('article', article);
  if (article !== null) {
    if (article.dataset.proceed) {
      return;
    }

    let id = getArticleId(article);
    if (!itemMap.get(id)) {
      console.log(`id: ${id}, can not find from itemmap`);
      return;
    }

    let button = document.createElement('button');
    button.style.backgroundColor = localStorage.getItem(id) ? proceedColor : unproceedColor;
    button.addEventListener('click', async () => {
      try {
        await download(id);
      } catch (e) {
        console.error(e);
      }
    });
    button.innerText = "click to save";
    button.id = 'pixiv_fanbox_downloader';

    progressReceiver(button);

    article.appendChild(button);
    article.dataset.proceed = true;
  }
}

function progressReceiver(btn) {
  let totalReceived = 0;
  window.addEventListener("message", (evt) => {
    let { type: type } = evt.data;

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

function decodeRFC5987(decodeTarget) {
  if (decodeTarget.startsWith("UTF-8''")) {
    return decodeURIComponent(decodeTarget.substring("UTF-8''".length));
  }
  return decodeTarget;
}

function getContentDispositionName(headerLine) {
  const dispositionMap = new Map();
  const dispositions = headerLine.split(';').map((line) => line.trim()).forEach((line) => {
    const splitPos = line.search('=');
    const key = splitPos === -1 ? line : line.substring(0, splitPos);
    const value = splitPos === -1 ? undefined : line.substring(splitPos + 1);
    dispositionMap.set(key, value);
  });

  const filenameStar = dispositionMap.get('filename*');
  const filename = dispositionMap.get('filename');
  return (filenameStar !== undefined && decodeRFC5987(filenameStar)) ?? filename;
}

