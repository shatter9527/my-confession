/* Shared navigation, theme and small progressive enhancements. No build step. */
(function () {
    'use strict';
    var root = document.documentElement;
    var storedTheme;
    try { storedTheme = localStorage.getItem('mf_theme'); } catch (_) { /* private browsing */ }
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    root.dataset.theme = storedTheme === 'night' || (!storedTheme && scheme.matches) ? 'night' : 'day';

    function init() {
        var theme = document.querySelector('.theme-toggle');
        function themeLabel() {
            if (!theme) return;
            var night = root.dataset.theme === 'night';
            theme.setAttribute('aria-pressed', String(night));
            theme.setAttribute('aria-label', night ? '切换日间模式' : '切换夜间模式');
            theme.title = theme.getAttribute('aria-label');
        }
        themeLabel();
        if (theme) theme.addEventListener('click', function () {
            root.dataset.theme = root.dataset.theme === 'night' ? 'day' : 'night';
            storedTheme = root.dataset.theme;
            try { localStorage.setItem('mf_theme', storedTheme); } catch (_) { /* optional persistence */ }
            themeLabel();
        });
        scheme.addEventListener('change', function (event) {
            if (!storedTheme) { root.dataset.theme = event.matches ? 'night' : 'day'; themeLabel(); }
        });

        var menuButton = document.querySelector('.menu-toggle');
        var nav = document.querySelector('.site-nav');
        var searchButton = document.querySelector('.search-toggle');
        var drawer = document.querySelector('.search-drawer');
        function closeMenu() {
            if (nav) nav.classList.remove('is-open');
            if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
        }
        function closeSearch(restoreFocus) {
            if (!drawer) return;
            drawer.hidden = true;
            searchButton.setAttribute('aria-expanded', 'false');
            if (restoreFocus) searchButton.focus();
        }
        if (menuButton && nav) {
            menuButton.addEventListener('click', function () {
                var open = !nav.classList.contains('is-open');
                nav.classList.toggle('is-open', open);
                menuButton.setAttribute('aria-expanded', String(open));
                if (open) closeSearch(false);
            });
            nav.addEventListener('click', function (event) {
                if (event.target.closest('a')) closeMenu();
            });
        }
        if (searchButton && drawer) {
            // The search form stays available if scripting is disabled.
            drawer.hidden = true;
            searchButton.addEventListener('click', function () {
                if (!drawer.hidden) { closeSearch(true); return; }
                closeMenu();
                drawer.hidden = false;
                searchButton.setAttribute('aria-expanded', 'true');
                drawer.querySelector('input').focus();
            });
        }
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                if (drawer && !drawer.hidden) closeSearch(true);
                if (nav && nav.classList.contains('is-open')) { closeMenu(); menuButton.focus(); }
            }
            if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input, textarea, select, [contenteditable="true"]') && searchButton) {
                event.preventDefault();
                if (drawer.hidden) searchButton.click();
                else drawer.querySelector('input').focus();
            }
        });
        document.addEventListener('click', function (event) {
            if (!event.target.closest('.site-header')) { closeMenu(); closeSearch(false); }
        });

        var sidebar = document.querySelector('.content-right');
        if (sidebar && sidebar.querySelector('.sidebar-nav')) {
            sidebar.classList.add('is-collapsible');
            var toggle = document.createElement('button');
            toggle.className = 'sidebar-toggle';
            toggle.type = 'button';
            toggle.textContent = '浏览其他章节 ＋';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.addEventListener('click', function () {
                var open = sidebar.classList.toggle('is-open');
                toggle.setAttribute('aria-expanded', String(open));
                toggle.textContent = open ? '收起章节目录 −' : '浏览其他章节 ＋';
            });
            sidebar.prepend(toggle);
        }
        document.querySelectorAll('.directory-link.current').forEach(function (link) { link.setAttribute('aria-current', 'page'); });

        var topButton = document.querySelector('.back-to-top');
        if (topButton) {
            function updateTop() { topButton.hidden = window.scrollY < 550; }
            window.addEventListener('scroll', updateTop, { passive: true });
            topButton.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: root.style.scrollBehavior || 'auto' }); });
            updateTop();
        }
        Promise.resolve(window.MFContentReady).then(enhanceContent);
    }

    function enhanceContent() {
        var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        var opening = document.querySelector('.opening');
        if (opening && window.matchMedia('(hover: hover)').matches) {
            opening.addEventListener('pointermove', function (event) {
                if (reduced.matches) return;
                var bounds = opening.getBoundingClientRect();
                opening.style.setProperty('--px', ((event.clientX - bounds.left) / bounds.width - .5) * 2);
                opening.style.setProperty('--py', ((event.clientY - bounds.top) / bounds.height - .5) * 2);
            });
            opening.addEventListener('pointerleave', function () {
                opening.style.setProperty('--px', 0); opening.style.setProperty('--py', 0);
            });
        }
        if ('IntersectionObserver' in window && !reduced.matches) {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
                });
            }, { threshold: .12 });
            document.querySelectorAll('.reveal').forEach(function (el) { observer.observe(el); });
        }

        var tabs = Array.from(document.querySelectorAll('.news-tab'));
        function selectTab(tab, focus) {
            tabs.forEach(function (item) {
                var current = item === tab;
                item.classList.toggle('active', current);
                item.setAttribute('aria-selected', String(current));
                item.tabIndex = current ? 0 : -1;
            });
            document.querySelectorAll('.news-item').forEach(function (item) { item.hidden = item.dataset.tab !== tab.dataset.tab; });
            var panel = document.getElementById('news-content');
            if (panel) panel.setAttribute('aria-labelledby', tab.id);
            if (focus) tab.focus();
        }
        tabs.forEach(function (tab, index) {
            tab.addEventListener('click', function () { selectTab(tab, false); });
            tab.addEventListener('keydown', function (event) {
                var next;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                if (event.key === 'Home') next = 0;
                if (event.key === 'End') next = tabs.length - 1;
                if (next !== undefined) { event.preventDefault(); selectTab(tabs[next], true); }
            });
        });
        if (tabs.length) selectTab(tabs[0], false);

        var tracks = Array.from(document.querySelectorAll('audio'));
        tracks.forEach(function (track) {
            track.addEventListener('play', function () {
                tracks.forEach(function (other) { if (other !== track) other.pause(); });
                document.querySelector('.sound-section')?.classList.add('is-playing');
            });
            ['pause', 'ended'].forEach(function (event) {
                track.addEventListener(event, function () {
                    document.querySelector('.sound-section')?.classList.toggle('is-playing', tracks.some(function (audio) { return !audio.paused; }));
                });
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
