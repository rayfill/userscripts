// ==UserScript==
// @name         save tweet with media contents
// @namespace    http://twitter.com/
// @version      20201015
// @description  save tweet with media contents
// @downloadURL  https://raw.githubusercontent.com/rayfill/userscripts/master/save_tweet.user.js
// @updateURL    https://raw.githubusercontent.com/rayfill/userscripts/master/save_tweet.user.js
// @author       rayfill
// @match        https://twitter.com/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @require      https://raw.githubusercontent.com/rayfill/gm-goodies/master/xhr-hook.js
// @require      https://raw.githubusercontent.com/rayfill/gm-goodies/master/gm-fetch.js
// @require      https://raw.githubusercontent.com/eligrey/FileSaver.js/b95a82a3ecb208fef5931e8931b2a8e67a834c02/dist/FileSaver.js
// @require      https://raw.githubusercontent.com/Stuk/jszip/master/dist/jszip.js
// @connect      twimg.com
// @run-at       document-start
// ==/UserScript==

'use strict';

const tweetMap = new Map();
const userMap = new Map();

const pattern = new RegExp('^.*/([0-9]+)(?:[?].*)?$');
let getId = (link) => {
  let match = pattern.exec(link);
  if (match !== null) {
    return match[1];
  }
  return undefined;
}

const save = (article) => {
  let time = article.querySelector('a > time');
  let source = null;
  if (time !== null) {
    source = time.parentNode.href;
  } else {
    source = window.location.href;
  }
  let id = getId(source);
  if (id === undefined) {
    console.log("undecided tweet identifier");
    return;
  }

  let info = tweetMap.get(id);
  console.log(id, info);
  //alert(JSON.stringify(info, null, "  "));

  let zip = new JSZip();
  let tweetId = info.id_str;
  let userId = info.user_id_str;
  let userInfo = userMap.get(userId);
  let tweet = info.full_text;
  let media = [];
  if ("extended_entities" in info) {
    for (let medium of info.extended_entities.media) {
      media.push(getMedium(medium));
    }
  }

  let filename = `${userId}_${tweetId}_${userInfo.name}.zip`;
  console.log("filename:", filename);
  console.log("tweet:", tweet);
  console.log("media:", media);

  zip.file("tweet.txt", tweet);
  let jobs = [];
  let fetchs = media.map((medium) => {
    return GM_fetch(medium.url).then((response) => {
      if (response.ok) {
        return { medium: medium, blob: response.blob() };
      }
      throw new Error(response);
    });
  });
  Promise.all(fetchs).then((results) => {
    console.log("results:", results);

    results.forEach((result, index) => {
      let { medium: medium, blob: blob } = result;
      console.log("result:", result);
      console.log("medium:", medium);
      zip.file(`media/${index}.${medium.ext}`, blob);
    });

    return;
  }).then(() => {

    zip.generateAsync({ type: "blob" }).then((blob) => {
      saveAs(blob, filename);
    });
  }).catch((err) => {
    alert(err);
  });
}

const extPattern = new RegExp("^(.*)\\.([^.]+)$");

let getMedium = (mediumInfo) => {
  let { type: type, media_url_https: url, video_info: vinfo } = mediumInfo;

  console.log(type, url);
  if (type === "photo") {
    let match = extPattern.exec(url);
    if (match === null) {
      throw new Error("invalid photo media url:", url);
    }
    let base = match[1];
    let format = match[2];
    let name = "orig";

    return { ext: format, url: `${base}?format=${format}&name=${name}` };

  } else if (type === "video" || type === "animated_gif") {
    let bestTarget = null;
    let bitrate = -1;
    for (let key in vinfo.variants) {
      let medium = vinfo.variants[key];
      if (medium.content_type === "video/mp4") {
        if (bitrate < medium.bitrate) {
          bitrate = medium.bitrate;
          bestTarget = medium;
        }
      } else {
        console.log("unselected variant:", vinfo.variants[key]);
      }
    }
    if (bestTarget === null) {
      throw new Error("unmatched video media target:", vinfo);
    }
    return { ext: "mp4", url: bestTarget.url };
  }

  throw new Error("non supported type:", type);
}

let origCreateElement = unsafeWindow.document.createElement;
const createElement = (name) => {
  return origCreateElement.call(unsafeWindow.document, name);
}

let storage = window.localStorage;
let getState = (id) => {
  return storage.getItem(id);
}
let setState = (id, value) => {
  storage.setItem(id, value);
}

const alreadySavedColor = "#87cefa";
const yetNotSavedColor = "#ffffff";

unsafeWindow.document.createElement = (name) => {

  let elm = createElement(name);
  let tagName = name.toLowerCase();

  if (tagName === "article") {
    elm.style.display = "block";
    let handler = () => {
      let id = undefined;
      let time = elm.querySelector('a time');
      if (time !== null) {
        id = getId(time.parentNode.href);
      } else {
        id = getId(window.location.href);
      }
      if (id !== undefined) {
        let button = createElement('button');
        button.innerText = "click to save";
        button.style.width = "100%";
        let alreadySaved = getState(id);

        if (alreadySaved === "true") {
          button.innerText = "already saved";
          button.style.backgroundColor = alreadySavedColor;
        } else {
          button.style.backgroundColor = yetNotSavedColor;
        }

        button.addEventListener('click', () => {
          save(elm);
          button.style.backgroundColor = alreadySavedColor;
          setState(id, "true");
        });

        elm.appendChild(button);
        elm.addEventListener('mouseover', () => {
          button.style.display = "block";
        });
        elm.addEventListener('mouseleave', () => {
          button.style.display = "none";
        });
      }
      elm.removeEventListener('mouseover', handler);
    };
    elm.addEventListener('mouseover', handler);
  }
  return elm;
}

xhrHook((xhr, ...args) => {
  let url = xhr.responseURL;
  //https://twitter.com/i/api/2/timeline/home.json
  if (url.startsWith("https://twitter.com/i/api/2/timeline/") ||
      // https://twitter.com/i/api/2/rux.json?
      url.startsWith("https://twitter.com/i/api/2/rux.json") ||
      url.startsWith("https://twitter.com/i/api/2/notifications/")) {

    console.log("url:", url);
    let jsonText = xhr.responseText;
    let json = JSON.parse(jsonText);
    let tweets = json.globalObjects.tweets;
    let users = json.globalObjects.users;

    for (let tweet in tweets) {
      tweetMap.set(tweet, tweets[tweet]);
    }
    for (let user in users) {
      userMap.set(user, users[user]);
    }
  }
});

