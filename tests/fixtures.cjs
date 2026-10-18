const base = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const token = 'isolated-browser-test-token';
const test = base.test.extend({
    app: async ({}, use) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-confession-test-'));
        for (const file of ['server.js', 'index.html', '1.5.html', 'pages', 'css', 'js']) fs.cpSync(path.join(root, file), path.join(dir, file), { recursive: true });
        fs.symlinkSync(path.join(root, 'assets'), path.join(dir, 'assets'), 'dir');
        fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ adminToken: token }));
        const reservation = net.createServer();
        reservation.listen(0, '127.0.0.1');
        await once(reservation, 'listening');
        const port = reservation.address().port;
        await new Promise(resolve => reservation.close(resolve));
        const child = spawn(process.execPath, [path.join(dir, 'server.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
        const url = `http://127.0.0.1:${port}`;
        try {
            await base.expect.poll(async () => {
                if (child.exitCode !== null) throw new Error(`Isolated server exited: ${child.exitCode}`);
                try { return (await fetch(url + '/api/settings')).status; } catch { return 0; }
            }).toBe(200);
            await use({ url, dir, token });
        } finally {
            if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    },
    baseURL: async ({ app }, use) => use(app.url)
});
module.exports = { test, expect: base.expect, root };
