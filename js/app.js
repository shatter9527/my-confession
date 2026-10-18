/* 全站共用：词条搜索（按钮/回车有实际动作）+ 目录悬停 + 跳转高亮 */
(function () {
    'use strict';

    function init() {
        var box = document.querySelector('.search-box');
        if (!box) { return; }

        var input = box.querySelector('input');
        var btn = box.querySelector('button');
        if (!input) { return; }

        var panel = document.createElement('div');
        panel.className = 'search-results';
        panel.id = 'search-results';
        panel.setAttribute('role', 'listbox');
        panel.setAttribute('aria-label', '搜索结果');
        box.appendChild(panel);
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', panel.id);
        input.setAttribute('aria-expanded', 'false');

        function projectPageUrl(path) {
            var marker = location.pathname.indexOf('/pages/');
            var depth = marker === -1 ? 0 : location.pathname.slice(marker + 1).split('/').filter(Boolean).length - 1;
            return '../'.repeat(Math.max(0, depth)) + path;
        }

        var data = (typeof window.SEARCH_INDEX !== 'undefined') ? window.SEARCH_INDEX : [];
        var hits = [];
        var active = -1;

        function esc(s) {
            return String(s).replace(/[&<>"]/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        }

        function search(q) {
            return data.filter(function (it) {
                if (it.secret) { return q.indexOf(it.key) !== -1; }
                return it.x.indexOf(q) !== -1 || it.t.indexOf(q) !== -1;
            });
        }

        function snip(text, q) {
            var i = text.indexOf(q);
            if (i < 0) { return esc(text.length > 76 ? text.slice(0, 76) + '…' : text); }
            var s = Math.max(0, i - 22);
            var e = Math.min(text.length, i + q.length + 34);
            return (s > 0 ? '…' : '') + esc(text.slice(s, i)) +
                '<mark>' + esc(q) + '</mark>' +
                esc(text.slice(i + q.length, e)) + (e < text.length ? '…' : '');
        }

        function close() {
            panel.classList.remove('show'); panel.innerHTML = ''; active = -1;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
        }

        function render(q) {
            if (!q) { close(); return; }
            input.setAttribute('aria-expanded', 'true');
            input.removeAttribute('aria-activedescendant');

            if (!hits.length) {
                panel.innerHTML = '<div class="search-empty">没有找到与「' + esc(q) + '」相关的词条</div>';
                panel.classList.add('show');
                return;
            }

            var rows = hits.slice(0, 60).map(function (it, i) {
                return '<a id="search-option-' + i + '" role="option" aria-selected="' + (i === active) + '" class="search-result' + (i === active ? ' active' : '') + '" href="' + projectPageUrl(it.p) + '#' + it.a + '" data-i="' + i + '">' +
                    '<div class="sr-head"><span class="sr-topic">' + esc(it.t) + '</span>' +
                    '<span class="sr-page">' + esc(it.d) + '</span></div>' +
                    '<div class="sr-snip">' + snip(it.x, q) + '</div></a>';
            }).join('');

            var foot = '<div class="search-hint">共 ' + hits.length + ' 条 · ↑↓ 选择 · 回车打开 · Esc 关闭</div>';
            if (hits.length > 60) { foot = '<div class="search-hint">共 ' + hits.length + ' 条，仅显示前 60 条</div>'; }

            panel.innerHTML = rows + foot;
            panel.classList.add('show');
            if (active >= 0) input.setAttribute('aria-activedescendant', 'search-option-' + active);

            var cur = panel.querySelector('.search-result.active');
            if (cur && cur.scrollIntoView) { cur.scrollIntoView({ block: 'nearest' }); }
        }

        function go(i) {
            if (i < 0 || i >= hits.length) { return; }
            location.href = projectPageUrl(hits[i].p) + '#' + hits[i].a;
        }

        // 输入即搜（只出列表，不跳转）
        function live() {
            var q = input.value.trim();
            hits = q ? search(q) : [];
            active = hits.length ? 0 : -1;
            render(q);
        }

        // 按钮 / 回车：唯一结果直接跳；多条则开列表让你选，再回车才打开
        function submit() {
            var q = input.value.trim();
            if (!q) { input.focus(); return; }
            hits = search(q);
            if (!hits.length) { active = -1; render(q); return; }
            if (hits.length === 1) { go(0); return; }
            if (panel.classList.contains('show') && active >= 0) { go(active); return; }
            active = 0;
            render(q);
        }

        if (btn) { btn.addEventListener('click', function (e) { e.preventDefault(); submit(); }); }
        input.addEventListener('input', live);

        input.addEventListener('keydown', function (e) {
            var open = panel.classList.contains('show');
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            } else if (e.key === 'ArrowDown' && open) {
                e.preventDefault();
                active = Math.min(active + 1, Math.min(hits.length, 60) - 1);
                render(input.value.trim());
            } else if (e.key === 'ArrowUp' && open) {
                e.preventDefault();
                active = Math.max(active - 1, 0);
                render(input.value.trim());
            } else if (e.key === 'Escape') {
                close();
            }
        });

        input.addEventListener('focus', function () { if (input.value.trim()) { live(); } });

        document.addEventListener('click', function (e) {
            if (!box.contains(e.target)) { close(); }
        });

        // :target highlighting is theme-aware and also works after hash navigation.
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
