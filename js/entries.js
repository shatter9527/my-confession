/* 正文条目：留言 + 管理员改动（覆盖 / 新增 / 隐藏）的运行时渲染
 * 只在有 .entry 或 .quote 的页面上做事；其它页面直接跳过。
 * 用户内容一律 textContent 写入，不拼 innerHTML。
 */
(function () {
    'use strict';

    function pageKey() {
        var p = location.pathname.split('/').pop() || 'index.html';
        return p || 'index.html';
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) { n.className = cls; }
        if (text != null) { n.textContent = text; }
        return n;
    }

    function fmtTime(ms) {
        var d = new Date(ms);
        var p = function (x) { return (x < 10 ? '0' : '') + x; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
            ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function api(path, opt) {
        return fetch(path, opt).then(function (r) {
            return r.json().then(function (j) { return { status: r.status, body: j }; });
        });
    }

    /* ---------- 每条下面的留言 ---------- */
    function attachComments(host, key, count) {
        var bar = el('div', 'cmt-bar');
        var toggle = el('button', 'cmt-toggle');
        toggle.type = 'button';
        var box = el('div', 'cmt-box');
        box.style.display = 'none';
        var list = el('div', 'cmt-list');
        var form = document.createElement('form');
        form.className = 'cmt-form';

        var nameIn = document.createElement('input');
        nameIn.type = 'text';
        nameIn.placeholder = '署名（可留空）';
        nameIn.setAttribute('aria-label', '留言署名（可留空）');
        nameIn.maxLength = 20;
        var textIn = document.createElement('textarea');
        textIn.placeholder = '说点什么…';
        textIn.setAttribute('aria-label', '留言内容');
        textIn.required = true;
        textIn.maxLength = 400;
        textIn.rows = 2;
        var sendBtn = document.createElement('button');
        sendBtn.type = 'submit';
        sendBtn.textContent = '发送';
        var tip = el('span', 'cmt-tip');
        tip.setAttribute('role', 'status');

        var row = el('div', 'cmt-form-row');
        row.appendChild(nameIn);
        row.appendChild(textIn);
        row.appendChild(sendBtn);

        var n = count || 0;
        var opened = false;
        var loaded = false;

        function label() {
            toggle.textContent = (n > 0 ? '留言 ' + n : '写留言') + (opened ? ' ▲' : ' ▼');
            toggle.setAttribute('aria-expanded', String(opened));
        }

        function renderList(items) {
            list.textContent = '';
            n = items.length;
            if (!items.length) { list.appendChild(el('p', 'cmt-empty', '还没有人留言。')); return; }
            items.forEach(function (c) {
                var item = el('div', 'cmt-item');
                var head = el('div', 'cmt-head');
                head.appendChild(el('strong', null, c.name));
                head.appendChild(el('span', 'cmt-time', fmtTime(c.created_at)));
                item.appendChild(head);
                item.appendChild(el('p', 'cmt-text', c.text));
                list.appendChild(item);
            });
        }

        function load() {
            api('/api/entry-comments?page=' + encodeURIComponent(pageKey()) + '&eid=' + encodeURIComponent(key))
                .then(function (r) { renderList((r.body && r.body.items) || []); loaded = true; label(); })
                .catch(function () {
                    list.textContent = '';
                    list.appendChild(el('p', 'cmt-empty', '连不上服务'));
                });
        }

        toggle.addEventListener('click', function () {
            opened = !opened;
            label();
            box.style.display = opened ? 'block' : 'none';
            if (opened && !loaded) { load(); }
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var text = textIn.value.trim();
            if (!text) { return; }
            sendBtn.disabled = true;
            api('/api/entry-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pageKey(), eid: key, name: nameIn.value.trim(), text: text })
            }).then(function (r) {
                sendBtn.disabled = false;
                if (r.body && r.body.ok) {
                    textIn.value = '';
                    tip.textContent = r.body.pending ? (r.body.message || '已提交，等管理员审核') : '已发送';
                    tip.className = 'cmt-tip ok';
                    if (!r.body.pending) { load(); }
                } else {
                    tip.textContent = (r.body && r.body.error) || '发送失败';
                    tip.className = 'cmt-tip err';
                }
            }).catch(function () {
                sendBtn.disabled = false;
                tip.textContent = '连不上服务';
                tip.className = 'cmt-tip err';
            });
        });

        form.appendChild(row);
        form.appendChild(tip);
        box.appendChild(list);
        box.appendChild(form);
        bar.appendChild(toggle);
        host.appendChild(bar);
        host.appendChild(box);
        label();
    }

    /* ---------- 主流程 ---------- */
    function apply() {
        if (location.protocol === 'file:') { return; }
        // The editor saves the base HTML; comment controls and extra entries are runtime UI.
        if (window.self !== window.top && new URLSearchParams(location.search).has('edit')) { return; }
        var scope = document.querySelector('.content-left');
        if (!scope) { return; }
        var hasEntries = scope.querySelector('.entry, .quote');
        if (!hasEntries) { return; }

        api('/api/entries/' + encodeURIComponent(pageKey())).then(function (r) {
            if (!r.body || !r.body.ok) { return; }
            var byId = {};
            (r.body.entries || []).forEach(function (e) { byId[e.eid] = e; });

            // 1) HTML 里已有的条目：套用覆盖 / 隐藏
            var existing = scope.querySelectorAll('p.entry[id], p.quote[id]');
            for (var i = existing.length - 1; i >= 0; i--) {
                var node = existing[i];
                var e = byId[node.id];
                if (!e) { node.parentNode.removeChild(node); continue; }   // 被隐藏
                if (e.kind === 'quote') {
                    var qt = node.querySelector('.qt');
                    if (qt) { qt.textContent = e.body; } else { node.textContent = e.body; }
                } else {
                    node.innerHTML = e.body;   // 条目正文由管理员维护，允许 HTML
                }
                attachComments(node, node.id, e.comments || 0);
            }

            // 2) 额外条目：追加到容器末尾（引文放 .quote-grid，其余放正文区）
            (r.body.extras || []).forEach(function (e) {
                var p;
                var host = scope;
                if (e.kind === 'quote') {
                    var grid = scope.querySelector('.quote-grid');
                    if (grid) { host = grid; }
                    p = el('p', 'quote');
                    var qn = el('span', 'qn', '＋');
                    var qt = el('span', 'qt', e.body);
                    p.appendChild(qn);
                    p.appendChild(qt);
                } else {
                    p = el('p', 'entry');
                    p.innerHTML = e.body;
                }
                host.appendChild(p);
                attachComments(p, e.key, e.comments || 0);
            });
        }).catch(function () { /* 离线时保持静态内容 */ });
    }

    function boot() { Promise.resolve(window.MFContentReady).then(apply); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
