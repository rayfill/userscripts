// ==UserScript==
// @name         Patreon downloader
// @namespace    https://patreon.com/
// @require      https://raw.githubusercontent.com/Stuk/jszip/v3.7.1/dist/jszip.js
// @require      https://raw.githubusercontent.com/eligrey/FileSaver.js/b95a82a3ecb208fef5931e8931b2a8e67a834c02/dist/FileSaver.js
// @require      https://raw.githubusercontent.com/rayfill/gm-goodies/master/gm-fetch.js
// @version      20240902.1
// @description  patreon downloader
// @downloadURL  https://raw.githubusercontent.com/rayfill/userscripts/master/patreon_downloader.user.js
// @updateURL    https://raw.githubusercontent.com/rayfill/userscripts/master/patreon_downloader.user.js
// @author       rayfill
// @match        https://www.patreon.com/posts/*
// @connect      patreonusercontent.com
// @connect      patreon.com
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// ==/UserScript==

(function() {
  'use strict';

  const localStorage = window.localStorage;
  const savedColor = "rgb(232, 91, 70)";
  const nonsavedColor = "lightgray";
  var btn = document.createElement('button');
  function rewriteText(str) {
    btn.textContent = str;
  }

  function getContent() {
      const tag = document.querySelector('span[data-tag=post-title');
      if (tag !== null) {
          return tag.parentElement.parentElement.parentElement;
      }
      return null;
  }
  function getButtonPlaceAppender() {
    const comment = document.querySelector('div[data-tag="content-card-comment-thread-container"]');
    const content = comment.parentElement;
    return (btn) => {
      content.insertBefore(btn, comment);
    };
  }

  console.log('patreon downloader script 1');

  const runtimeId = "PatreonImageDownloader_" + new Date().getTime().toString();

  const ignoreDuplicateOf = [
    'age', 'authorization', 'content-length', 'content-type', 'etag',
    'expires', 'from', 'host', 'if-modified-since', 'if-unmodified-since',
    'last-modified', 'location', 'max-forwards', 'proxy-authorization',
    'referer', 'retry-after', 'user-agent'
  ];
  const parseHeaders = (headers) => {
    var parsed = {};
    var key;
    var val;
    var i;

    if (!headers) { return parsed; }

    const forEach = (obj, fn) => {
      // Don't bother if no value provided
      if (obj === null || typeof obj === 'undefined') {
        return;
      }

      // Force an array if not already something iterable
      if (typeof obj !== 'object') {
        /*eslint no-param-reassign:0*/
        obj = [obj];
      }

      const isArray = (val) => {
        return toString.call(val) === '[object Array]';
      };
      if (isArray(obj)) {
        // Iterate over array values
        for (var i = 0, l = obj.length; i < l; i++) {
          fn.call(null, obj[i], i, obj);
        }
      } else {
        // Iterate over object keys
        for (var key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            fn.call(null, obj[key], key, obj);
          }
        }
      }
    };

    const trim = (str) => {
      return str.replace(/^\s*/, '').replace(/\s*$/, '');
    };

    forEach(headers.split('\n'), function parser(line) {
      i = line.indexOf(':');
      key = trim(line.substr(0, i)).toLowerCase();
      val = trim(line.substr(i + 1));

      if (key) {
        if (parsed[key] && ignoreDuplicateOf.indexOf(key) >= 0) {
          return;
        }
        if (key === 'set-cookie') {
          parsed[key] = (parsed[key] ? parsed[key] : []).concat([val]);
        } else {
          parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
        }
      }
    });

    return parsed;
  };
  let total = 0;
  const progressIndicator = (val) => {
    total += val;
    rewriteText(total.toLocaleString() + " bytes downloaded");
  };
  const progress = (func) => {
    let prev = 0;
    return (e) => {
      let cur = e.loaded - prev;
      prev = e.loaded;
      func(cur);
    };
  };

  let saveContent = (z, url, name) => {
    console.log("call saveConent");

    var config = {
//        responseType: 'arraybuffer'//,
        onDownloadProgress: progress(progressIndicator)
    };
    console.log("config:", config);
    return GM_fetch(url, config).then((response) => {
      console.log("save content:", response.ok);
      if (!response.ok || response.status < 200 || response.status >= 400) {
        throw new NetworkError();
      }
      if (typeof name == "function") {
        name = name(response);
      }

      z.file(name, response.blob(), { compression: "STORE" });
    });
  };

  let save = () => {
    total = 0;

    let articleId = unsafeWindow.patreon.bootstrap.post.data.id;
    let included = unsafeWindow.patreon.bootstrap.post.included;
    const extract = (included, type) => {
      let result = [];
      for (let include of included) {
        if (include.type === type) {
          result.push(include);
        }
      }
      return result;
    };
    var media = extract(included, "media");
    var mediapath = [];
    var attachments = extract(included, "attachment");
    var attachmentspath = [];
    var content = getContent().cloneNode(true); //(document.querySelector('div[data-tag=post-tags]') ?? document.querySelector('div[data-tag=post-details]')).previousElementSibling.cloneNode(true);
    var imgs = content.querySelectorAll('img');

    var counter = 0;
    var zip = new JSZip();
    var jobs = [];

    const ext = (ct) => {
      const m = new RegExp("^image/(.*)$").exec(ct);
      console.log(`ct: ${ct}, m: ${m}`);
      return m !== null && m[1];
    };

    for (let medium of media) {
      const url = medium.attributes.download_url;
      jobs.push(saveContent(zip, url, ((counter) => {
        return (res) => {
          const ct = res.headers.get("content-type");
          const path = `media/${counter}.` + ext(ct);
          mediapath.push(path);
          return path;
        };})(counter++)));
    }

    for (let attachment of attachments) {
      const url = attachment.attributes.url;
      const name = "attachment/" + attachment.attributes.name;
      attachmentspath.push(name);
      jobs.push(saveContent(zip, url, name));
    }

    for (let idx = 0; idx < imgs.length; idx++) {
      const url = imgs[idx].src;
      jobs.push(saveContent(zip, url, (res) => {
        const ct = res.headers.get("content-type");
        const imgpath = `content/${idx}.` + ext(ct);
        imgs[idx].dataset.src = imgpath;
        imgs[idx].src = "javascript:false";
        return imgpath;
      }));
    }

    const embScr = () => {
      window.addEventListener('DOMContentLoaded', () => {
        for (let img of document.querySelectorAll('img')) {
          if (img.dataset.src !== undefined) {
            img.src = img.dataset.src;
          }
        }
      });
    };

    const htmlPrefix = "<!doctype html><html><head><script language='javascript'>(" +
          embScr.toString() + ")();</script></head><body>";
    const htmlPostfix = "</body></html>";

    var title = unsafeWindow.patreon.bootstrap.post.data.attributes.title.replace(new RegExp("[.]$"), "");
    var created = new Date(unsafeWindow.patreon.bootstrap.post.data.attributes.created_at);

    const embedImg = (path) => {
      path.sort();
      let result = "";
      path.forEach((p) => {
        let img = document.createElement('img');
        img.dataset.src = p;
        img.style = "width: 95%";
        result += img.outerHTML + "\n";
      });
      return result;
    };
    const embedAttach = (path) => {
      path.sort();
      let result = "";
      path.forEach((p) => {
        let anch = document.createElement('a');
        anch.href = p;
        anch.innerText = p;
        result += anch.outerHTML + "<br>\n";
      });
      return result;
    };
    Promise.all(jobs)
      .then(() => {
        console.log("save zip file");

        //let btn = content.querySelector("#" + runtimeId);
        //btn.parentNode.removeChild(btn);

        zip.file("index.html", htmlPrefix + embedImg(mediapath) +
          content.innerHTML + embedAttach(attachmentspath) + htmlPostfix);
        console.log('generateAsync');
        zip.generateAsync({ type: "blob" }, (metadata) => {
          let message = metadata.percent.toFixed(2) + "%";
          if (metadata.currentFile) {
            message = message + " file: " + metadata.currentFile;
          }
          rewriteText(message);
        }).then((content) => {
          console.log("save as");
          let yyyymm = (created.getYear() + 1900).toString().padStart(4, "0")
            + (created.getMonth() + 1).toString().padStart(2, "0");
          saveAs(content, yyyymm + "_" + articleId + "_" + title + ".zip");
          localStorage.setItem(window.location.href, true);
          btn.style.backgroundColor = savedColor;
        }).catch((err) => {
          console.log("error:", err);
        });
      })
      .catch((rej) => {
      console.log("one or more jobs failed.", rej);
      window.alert("one or more jobs failed.", rej);
    });
  };

  const clicked = () => {
    const text = btn.textContent;
    try {
      btn.disabled = true;
      save();
    } finally {
      btn.disabled = false;
      rewriteText(text);
    }
  };
  document.addEventListener('DOMContentLoaded', (ev) => {
    window.setTimeout(() => {
      const buttonCaption = "save with linked object";
      let isSaved = localStorage.getItem(window.location.href) === "true";
      btn.id = runtimeId;
      btn.type = 'button';
      btn.name = "save";
      btn.onclick = clicked;
      btn.style.backgroundColor = isSaved ? savedColor : nonsavedColor;
      var appender = getButtonPlaceAppender();
      rewriteText(buttonCaption);
      appender(btn);
    }, 3000);
  });
})();
