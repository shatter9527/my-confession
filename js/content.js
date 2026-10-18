/* 正文覆盖：管理员在后台在线编辑过的内容，在这里替换掉页面里的默认正文。
 * 没有覆盖时什么都不做（页面保持 HTML 里的原文）。
 * 只在有 .content-left 的静态内容页生效；people-* 是动态页，服务端已排除。
 */
(function () {
    'use strict';

    function pageKey() {
        var p = location.pathname.split('/').pop() || 'index.html';
        return p || 'index.html';
    }

    function apply() {
        var box = document.querySelector('.content-left');
        if (!box || location.protocol === 'file:' || /^people-/.test(pageKey())) { return Promise.resolve(); }
        return fetch('/api/content/' + encodeURIComponent(pageKey()), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.ok && typeof j.html === 'string' && j.html !== '') {
                    box.innerHTML = j.html;
                    document.documentElement.setAttribute('data-content-edited', '1');
                }
            })
            .catch(function () { /* 离线或直开文件时静默 */ });
    }

    // Entry comments and page interactions must attach after an edited body is in place.
    window.MFContentReady = document.readyState === 'loading'
        ? new Promise(function (resolve) {
            document.addEventListener('DOMContentLoaded', function () { resolve(apply()); }, { once: true });
        })
        : apply();
})();
