/* Shared credential/request state for both administration pages. */
(function () {
    'use strict';
    var key = 'mf_admin_token';
    var token = localStorage.getItem(key) || '';
    var generation = 0;
    var listeners = [];
    var pending = new Set();
    function emit(reason) { listeners.forEach(function (fn) { fn({ token: token, reason: reason }); }); }
    function setToken(value, reason) {
        generation++;
        pending.forEach(function (controller) { controller.abort(); });
        pending.clear();
        token = String(value || '').trim();
        emit(reason || 'change');
    }
    function clear(reason) {
        localStorage.removeItem(key);
        setToken('', reason || 'clear');
    }
    function result(status, message) { return { status: status, body: { ok: false, error: message } }; }
    async function request(path, opt) {
        if (!token) return result(401, '请先载入管理令牌');
        var version = generation;
        var controller = new AbortController();
        pending.add(controller);
        opt = Object.assign({}, opt || {});
        opt.signal = controller.signal;
        opt.headers = Object.assign({}, opt.headers || {}, { 'x-admin-token': token });
        try {
            var response = await fetch(path, opt);
            var body = await response.json();
            if (version !== generation) return result(0, '登录状态已改变，请重试');
            if (response.status === 401) clear('unauthorized');
            return { status: response.status, body: body };
        } catch (error) {
            if (version !== generation) return result(0, '登录状态已改变，请重试');
            emit('network-error');
            return result(0, '请求失败，请检查连接后重试');
        } finally { pending.delete(controller); }
    }
    window.addEventListener('storage', function (event) {
        if (event.key === key || event.key === null) setToken(localStorage.getItem(key) || '', 'storage');
    });
    window.MFAdmin = {
        token: function () { return token; },
        use: function (value) { setToken(value); },
        remember: function () { if (token) localStorage.setItem(key, token); },
        replace: function (value) { setToken(value, 'rotation'); localStorage.setItem(key, token); },
        clear: clear,
        subscribe: function (fn) { listeners.push(fn); },
        request: request,
        post: function (path, payload) { return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) }); }
    };
})();
