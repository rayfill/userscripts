// ==UserScript==
// @name         Patreon downloader
// @namespace    https://patreon.com/
// @require      https://raw.githubusercontent.com/Stuk/jszip/master/dist/jszip.js
// @require      https://raw.githubusercontent.com/eligrey/FileSaver.js/master/dist/FileSaver.js
// @require      https://raw.githubusercontent.com/axios/axios/master/dist/axios.js
// @version      20191108.1
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
  }
  const progress = (func) => {
    let prev = 0;
    return (e) => {
      let cur = e.loaded - prev;
      prev = e.loaded;
      func(cur);
    };
  };
  const gmAdapter = (config) => {
    console.log("call gmAdapter");
    const method = config.method;
    const url = config.url;
    var request;
    var details = {
      url: url,
      method: method,
      onload: function (resp) {
        var responseData = {};
        var responseHeaders = {};
        responseHeaders = parseHeaders(resp.responseHeaders);
        responseData = resp.response;

        var response = {
          data: responseData,
          status: resp.status,
          statusText: resp.statusText,
          headers: responseHeaders,
          config: config,
          request: request
        };

        Promise.resolve(response);
      }
    };
    if (config.headers !== undefined) {
      details.headers = config.headers;
    }

    return new Promise((resolve, reject) => {
      request = GM_xmlhttpRequest(details);
    });
  };

  let saveContent = (z, url, name, adapter) => {
    console.log("call saveConent");

    var config = { responseType: 'arraybuffer', onDownloadProgress: progress(progressIndicator) };
    if (adapter !== undefined) {
      config.adapter = adapter;
      var cookie = unsafeWindow.document.cookie;
      config.headers = { 'Cookie': cookie };
    }
    console.log("config:", config);
    return axios.get(url, config).then((response) => {
      console.log("save content:", response.request);
      if (typeof name == "function") {
        name = name(response);
      }

      z.file(name, response.data, { compression: "STORE" });
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
    var content = document.querySelector('div[data-tag=post-content]').cloneNode(true);
    var imgs = content.querySelectorAll('img');

    var counter = 0;
    var zip = new JSZip();
    var jobs = [];

    const ext = (ct) => {
      const m = new RegExp("^image/(.*)$").exec(ct);
      return m !== null && m[1];
    };

    for (let medium of media) {
      const url = medium.attributes.download_url;
      jobs.push(saveContent(zip, url, (res) => {
        const ct = res.headers["content-type"];
        const path = `media/${counter++}.` + ext(ct);
        mediapath.push(path);
        return path;
      }));
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
        const ct = res.headers["content-type"];
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

      let btn = content.querySelector("#" + runtimeId);
      btn.parentNode.removeChild(btn);

      zip.file("index.html", htmlPrefix + embedImg(mediapath) +
               content.innerHTML + embedAttach(attachmentspath) + htmlPostfix);
      zip.generateAsync({type: "blob"}, (metadata) => {
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
  }
  document.addEventListener('DOMContentLoaded', (ev) => {
    const buttonCaption = "save with linked object";
    let isSaved = localStorage.getItem(window.location.href) === "true";
    btn.id = runtimeId;
    btn.type = 'button';
    btn.name = "save";
    btn.onclick = clicked;
    btn.style.backgroundColor = isSaved ? savedColor : nonsavedColor;
    var content = document.querySelector('div[data-tag="post-content"]');
    rewriteText("save with linked object");
    content.appendChild(btn);
  });
})();
