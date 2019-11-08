// ==UserScript==
// @name         pixiv fanbox resource saver
// @namespace    https://pixiv.fanbox.net/
// @version      20191108
// @description  pixiv fanbox article downloader
// @downloadURL  https://raw.githubusercontent.com/rayfill/userscripts/pixiv_fanbox_downloader.user.js
// @updateURL    https://raw.githubusercontent.com/rayfill/userscripts/pixiv_fanbox_downloader.user.js
// @author       rayfill
// @match        https://www.pixiv.net/fanbox/creator/*/post/*
// @require      https://raw.githubusercontent.com/rayfill/GM_fetch/master/GM_fetch.js
// @require      https://raw.githubusercontent.com/Stuk/jszip/master/dist/jszip.js
// @require      https://raw.githubusercontent.com/eligrey/FileSaver.js/master/dist/FileSaver.js
// @connect      pixiv.net
// @connect      pximg.net
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// ==/UserScript==
let button = null;

function ensureLoadingLazy(next) {
    let currentY = window.scrollY;
    let lazyElements = Array.from(document.querySelectorAll('.lazyload')).map((elm) => currentY + elm.getBoundingClientRect().y);

    let positions = [currentY].concat(lazyElements);
    console.log("positions:", positions);

    let handler = () => {
        console.log("called handler");
        let y = positions.pop();
        if (y !== undefined) {
            window.scrollTo(window.scrollX, y);
        } else {
            window.removeEventListener("scroll", handler);
            next();
        }
    };
    if (positions.length > 1) {
        window.addEventListener("scroll", handler);
        window.scrollTo(window.scrollX, positions.pop());
    }
}

async function main() {
    try {

        let article = document.querySelector('article');
        let title = article.querySelector('h1').innerText;
        let coverImg = article.querySelector('div[style^=background-image]').style.getPropertyValue("background-image").replace(new RegExp("^url\\(\\\"(.*)\\\"\\)$"), (_, url) => url);
        let thumbs = article.querySelectorAll('a img');
        let dlLinks = article.querySelectorAll('a[download] > button');
        let message = button.previousElementSibling.innerText;

        let imgs = [];
        for (let node of thumbs) {
            while (node.tagName != "A") {
                node = node.parentNode;
            }
            imgs.push(node.href);
        }

        let downloads = [];
        for (let node of dlLinks) {
            downloads.push(node.parentNode.href);
        }

        console.log("title:", title);
        console.log("cover:", coverImg);
        console.log("imgs:", imgs);
        console.log("downloads:", downloads);

        let results = [GM_fetch(coverImg).then(async (response) => {
            if (response.ok) {
                return {
                    path: "cover",
                    name: "cover",
                    type: response.headers.get("content-type"),
                    content: await response.arrayBuffer()
                };
            }
            throw new Error("faled to save cover");
        })];

        imgs.forEach((url, index) => {
            results.push(GM_fetch(url).then(async (response) => {
                if (response.ok) {
                    return {
                        path: "img",
                        name: `${index}`,
                        type: response.headers.get("content-type"),
                        content: await response.arrayBuffer()
                    };
                }
                throw new Error(`faild to save image: ${url}`);
            }));
        });

        downloads.forEach((url, index) => {
            results.push(GM_fetch(url).then(async (response) => {
                if (response.ok) {
                    return {
                        path: "attachment",
                        name: `${index}`,
                        type: response.headers.get("content-type"),
                        content: await response.arrayBuffer()
                    };
                }
                throw new Error(`faild to save attachment: ${url}`);
            }));
        });

        let zip = new JSZip();
        let contents = await Promise.all(results);
        const pattern = new RegExp("^[^/]+/([^;]*)(?:;.*)?$");
        function ext(type) {
            let match = pattern.exec(type);
            return match !== null ? match[1] : "unknown";
        }
        console.log("contents count:", contents.length);
        contents.forEach((cont) => {
            let content = cont.content;
            let name = cont.path + "/" + cont.name + "." + ext(cont.type);
            console.log("name:", name, typeof content, content.byteLength, content);
            zip.file(name, content, { compression: "STORE" });
        });
        zip.file("message.txt", message, { compression: "STORE" });
        let blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, title + ".zip");

    } catch (e) {
        console.log(e);
    }
}

function trapPushState(trapCode) {
    const origPushState = history.pushState.bind(history);
    history.pushState = (data, title, url) => {
        trapCode(data, title, url);
        origPushState(data, title, url);
    }
    trapPushState = () => {};
}

trapPushState(() => { button = null; });

let observer = new MutationObserver((records) => {
    for (let record of records) {
        let article = (record.target.tagName == "ARTICLE") ? record.target : record.target.querySelector('article');
        if (article !== null) {
            if (!button) {
                button = document.createElement('button');
                button.innerText = "click to save";
                button.onclick = () => { ensureLoadingLazy(main); };
                article.appendChild(button);
            }
        }
    }
});
observer.observe(document.querySelector('#root'), { childList: true, subtree: true });
