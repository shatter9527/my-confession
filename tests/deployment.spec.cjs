const { test, expect } = require('./fixtures.cjs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The historical client hides built-in entries when the online list is empty.
// Emulate a browser/proxy retaining that response under the pre-upgrade asset URL.
const stalePeople = `document.addEventListener('DOMContentLoaded', function () {
    fetch('/api/people').then(function (r) { return r.json(); }).then(function () {
        document.getElementById('people-static').style.display = 'none';
    });
});`;
test('upgrading a cached people client preserves remaining built-in entries', async ({ page }) => {
    await page.route('**/js/people.js', route => route.fulfill({ contentType: 'application/javascript', body: stalePeople }));
    let release, seen;
    const gate = new Promise(resolve => { release = resolve; });
    const reached = new Promise(resolve => { seen = resolve; });
    await page.route('**/api/people', async route => {
        seen(); await gate;
        await route.fulfill({ json: { ok: true, items: [] } });
    });
    await page.goto('/pages/people/people-god.html');
    await reached;
    await expect(page.locator('#people-static')).toBeVisible();
    release();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#people-static')).toBeVisible();
    await expect(page.locator('#people-static > p')).toHaveCount(1);
});

test('container-side token lookup reads persisted credentials without exposing it over HTTP', async ({ app, request }) => {
    const result = execFileSync(process.execPath, [path.join(app.dir, 'admin.js'), 'token'], { cwd: app.dir, encoding: 'utf8' });
    expect(result).toContain(app.token);
    expect((await request.get('/admin.js')).status()).toBe(404);
});

test('served version and cache policy identify the deployed upgrade', async ({ request }) => {
    const version = await (await request.get('/api/version')).json();
    expect(version.version).toBe('2026.10.18-admin4');
    expect(version.build).toMatch(/^[0-9a-f]{12}$/);
    for (const file of ['/pages/people/people-normal.html', '/js/people.js', '/css/style.css']) {
        expect((await request.get(file)).headers()['cache-control']).toBe('no-store');
    }
});

test('original people stay in place when online entries arrive after first paint', async ({ page }) => {
    let release, seen;
    const gate = new Promise(resolve => { release = resolve; });
    const reached = new Promise(resolve => { seen = resolve; });
    await page.route('**/api/people', async route => {
        seen(); await gate;
        await route.fulfill({ json: { ok: true, items: Array.from({ length: 6 }, (_, i) => ({
            id: i + 1, name: '在线人物' + i, category: '神人', note: '在线新增的内容。'.repeat(15), created_at: 1, comments: 0
        })) } });
    });
    await page.goto('/pages/people/people-god.html');
    await reached;
    const original = page.locator('#people-static > p').first();
    const before = await original.boundingBox();
    expect(before).not.toBeNull();
    release();
    await expect(page.locator('#people-list .people-card')).toHaveCount(6);
    const after = await original.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
});
