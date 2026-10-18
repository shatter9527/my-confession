const { test, expect, root } = require('./fixtures.cjs');
const fs = require('node:fs');
const path = require('node:path');
const admin = app => ({ 'x-admin-token': app.token });
async function post(request, app, route, data) {
    const response = await request.post(route, { headers: admin(app), data });
    expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
    return response.json();
}

test('homepage navigation, keyboard search, tabs and persistent theme', async ({ page, isMobile }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /把青春，\s*写成我们。/ })).toBeVisible();
    const heroPhoto = page.getByRole('img', { name: '一班同学与老师的毕业合影' });
    await expect(heroPhoto).toBeVisible();
    await expect.poll(() => heroPhoto.evaluate(el => el.naturalWidth)).toBe(1448);
    if (isMobile) await page.getByRole('button', { name: '展开导航' }).click();
    await page.getByRole('navigation', { name: '主导航' }).getByText('翻开目录').click();
    await expect(page).toHaveURL(/#chapters$/);
    await page.getByRole('button', { name: '切换夜间模式' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    await page.getByRole('button', { name: '搜索全站' }).click();
    const search = page.getByRole('combobox');
    await search.fill('食堂');
    await expect(page.locator('.search-result').first()).toContainText('食堂');
    await search.press('Enter');
    await expect(page).toHaveURL(/rules-daily.html#e14$/);
    await expect(page.locator('#e14')).toBeInViewport();
    await page.goto('/');
    await page.getByRole('tab', { name: '趣闻', exact: true }).click();
    await expect(page.locator('.news-item:visible')).toHaveCount(3);
    await expect(page.locator('.news-item:visible').first()).toContainText('开学视频事件');
    await page.getByRole('tab', { name: '趣闻', exact: true }).press('ArrowRight');
    await expect(page.locator('.news-item:visible').first()).toContainText('郑玉哲');
    await page.getByRole('button', { name: '搜索全站' }).click();
    await search.fill('完全不存在的关键词');
    await expect(page.locator('.search-empty')).toBeVisible();
    await search.press('Escape');
    await expect(page.locator('.search-drawer')).toBeHidden();
    expect(errors).toEqual([]);
});

test('all public pages render with valid landmarks and no horizontal overflow', async ({ page, isMobile }) => {
    test.setTimeout(90000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    const pages = fs.readdirSync(path.join(root, 'pages'), { recursive: true }).filter(file => file.endsWith('.html') && !file.startsWith('admin'));
    for (const file of ['index.html', ...pages.map(file => 'pages/' + file)]) {
        await page.goto('/' + file);
        await page.evaluate(() => window.MFContentReady);
        await expect(page.locator('main')).toHaveCount(1);
        await expect(page.locator('h1')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), file).toBeTruthy();
        const hasMissingImages = await page.locator('img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth === 0));
        expect(hasMissingImages, file).toBeFalsy();
    }
    if (isMobile) {
        await page.goto('/pages/rules/rules-daily.html');
        await page.getByRole('button', { name: '浏览其他章节' }).click();
        await expect(page.locator('.sidebar-nav').first()).toBeVisible();
    }
    expect(errors).toEqual([]);
});

test('guestbook submits, persists, and reports moderated submissions', async ({ page, request, app }) => {
    await page.goto('/#guestbook');
    await page.getByLabel('怎么称呼').fill('老同学');
    await page.getByLabel('想说的话').fill('多年以后，再翻一页。');
    await page.getByRole('button', { name: '留下这句话' }).click();
    await expect(page.locator('#msg-tip')).toHaveText('已发送');
    await page.reload();
    await expect(page.locator('#msg-list')).toContainText('多年以后，再翻一页。');
    await post(request, app, '/api/admin/settings', { messagesModerated: true });
    // An independent visitor avoids the deliberate per-IP posting interval.
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.22' });
    await page.getByLabel('想说的话').fill('等审核的回忆');
    await page.getByRole('button', { name: '留下这句话' }).click();
    await expect(page.locator('#msg-tip')).toContainText('审核');
    await expect(page.locator('#msg-list')).not.toContainText('等审核的回忆');
});

test('people submissions and per-person comments keep their API behavior', async ({ page }) => {
    await page.goto('/pages/people/people-normal.html');
    await page.getByLabel('名字', { exact: true }).fill('一班同学');
    await page.getByLabel('关于这个人').fill('记得每个人的故事。');
    await page.locator('#people-form button[type=submit]').click();
    await expect(page.locator('.people-card')).toContainText('一班同学');
    await page.locator('.people-card .cmt-toggle').click();
    await page.getByLabel('留言署名').fill('朋友');
    await page.getByLabel('留言内容').fill('好久不见');
    await page.locator('.cmt-form button').click();
    await expect(page.locator('.cmt-list')).toContainText('好久不见');
    await page.reload();
    await expect(page.locator('.people-card .cmt-toggle')).toContainText('留言 1');
});

test('page overrides, entry edits/hiding/extras, and entry comments compose correctly', async ({ page, request, app }) => {
    await post(request, app, '/api/admin/content/rules-daily.html', { html: '<h1 class="page-title">日常 · 修订</h1><p class="entry" id="e14"><strong>食堂：</strong>在线修改后的回忆。</p>' });
    // Make the page-body request slower than the entry request: this caught the original race.
    await page.route('**/api/content/rules-daily.html', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue(); });
    await page.goto('/pages/rules/rules-daily.html');
    await expect(page.locator('#e14')).toContainText('在线修改后的回忆。');
    await expect(page.locator('#e14 .cmt-toggle')).toHaveCount(1);
    await page.locator('#e14 .cmt-toggle').click();
    await page.getByLabel('留言内容').fill('这段我也记得');
    await page.locator('#e14 .cmt-form button').click();
    await expect(page.locator('#e14 .cmt-list')).toContainText('这段我也记得');
    await post(request, app, '/api/admin/entries/rules-daily.html', { eid: 'e14', body: '<strong>食堂：</strong>管理员逐条修订。' });
    await page.reload();
    await expect(page.locator('#e14')).toContainText('管理员逐条修订。');
    await post(request, app, '/api/admin/entries/rules-daily.html/hide', { eid: 'e14' });
    const added = await post(request, app, '/api/admin/entries/rules-daily.html', { body: '新补充的一页', kind: 'entry' });
    await page.reload();
    await expect(page.locator('#e14')).toHaveCount(0);
    await expect(page.locator('.content-left')).toContainText('新补充的一页');
    await post(request, app, '/api/admin/entries/rules-daily.html/restore', { eid: 'e14' });
    await post(request, app, '/api/admin/entries/rules-daily.html/delete', { id: added.id });
    await page.reload();
    await expect(page.locator('#e14')).toBeVisible();
    await expect(page.locator('.content-left')).not.toContainText('新补充的一页');
});

test('admin loads on phones and editor saves clean HTML with history/reset', async ({ page, request, app }) => {
    await page.goto('/pages/admin.html');
    await page.locator('#token').fill(app.token);
    await page.getByRole('button', { name: '载入', exact: true }).click();
    await expect(page.locator('#panel')).toBeVisible();
    await expect(page.locator('#ep-page option')).not.toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByRole('link', { name: '正文编辑' }).click();
    await expect(page.locator('#page option')).not.toHaveCount(1);
    await page.locator('#page').selectOption('rules-daily.html');
    const editor = page.frameLocator('#frame').locator('.content-left');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor.locator('.cmt-bar')).toHaveCount(0);
    await editor.locator('#e14').click();
    await editor.locator('#e14').fill('编辑器写入的回忆');
    await expect(editor.locator('#e14')).toHaveText('编辑器写入的回忆');
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('#msg')).toContainText('已保存');
    const stored = await (await request.get('/api/admin/content/rules-daily.html', { headers: admin(app) })).json();
    expect(stored.html).toContain('编辑器写入的回忆');
    expect(stored.html).not.toContain('cmt-bar');
    await page.getByRole('button', { name: '恢复默认', exact: true }).click();
    await expect(editor.locator('#e14')).toContainText('关于食堂带书');
    const history = await (await request.get('/api/admin/content/rules-daily.html', { headers: admin(app) })).json();
    expect(history.history).toHaveLength(1);
    await post(request, app, '/api/admin/content-history', { id: history.history[0].id });
    await page.goto('/pages/rules/rules-daily.html');
    await expect(page.locator('#e14')).toContainText('编辑器写入的回忆');
    await expect(page.locator('#e14 .cmt-toggle')).toHaveCount(1);
});

test('legacy links, audio ranges, admin authorization and token revocation', async ({ request, app }) => {
    const redirect = await request.get('/rules-daily.html', { maxRedirects: 0 });
    expect(redirect.status()).toBe(301);
    expect(redirect.headers().location).toBe('/pages/rules/rules-daily.html');
    const audio = await request.get('/assets/media/nanchenglu-54-15.m4a', { headers: { Range: 'bytes=0-1023' } });
    expect(audio.status()).toBe(206);
    expect((await audio.body()).length).toBe(1024);
    expect(audio.headers()['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
    expect((await request.head('/assets/media/nanchenglu-54-15.m4a')).headers()['accept-ranges']).toBe('bytes');
    expect((await request.get('/assets/media/nanchenglu-54-15.m4a', { headers: { Range: 'bytes=999999999-' } })).status()).toBe(416);
    expect((await request.get('/api/admin/all')).status()).toBe(401);
    const created = await post(request, app, '/api/admin/tokens', { name: '测试管理员' });
    expect((await request.get('/api/admin/all', { headers: { 'x-admin-token': created.token } })).ok()).toBeTruthy();
    await post(request, app, '/api/admin/tokens/revoke', { id: created.id });
    expect((await request.get('/api/admin/all', { headers: { 'x-admin-token': created.token } })).status()).toBe(401);
    const audit = await (await request.get('/api/admin/audit', { headers: admin(app) })).json();
    expect(audit.items.length).toBeGreaterThan(0);
});

test('reduced motion and direct file browsing preserve readable content', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    expect(await page.locator('.opening-copy').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await page.goto('file://' + path.join(root, 'pages/rules/rules-daily.html'));
    await expect(page.locator('#e14')).toContainText('关于食堂带书');
    await page.getByRole('button', { name: '搜索全站' }).click();
    await page.getByRole('combobox').fill('食堂');
    await expect(page.locator('.search-result').first()).toHaveAttribute('href', /pages\/rules\/rules-daily.html#e14$/);
});

test('native recordings play, seek, and pause each other', async ({ page }) => {
    await page.goto('/#voices');
    const first = page.locator('audio').nth(0);
    const second = page.locator('audio').nth(1);
    await first.evaluate(async audio => { audio.muted = true; await audio.play(); });
    await expect.poll(() => first.evaluate(audio => audio.duration)).toBeGreaterThan(0);
    await expect(page.locator('.sound-section')).toHaveClass(/is-playing/);
    await first.evaluate(audio => { audio.currentTime = Math.min(30, audio.duration / 2); });
    await expect.poll(() => first.evaluate(audio => audio.currentTime)).toBeGreaterThan(1);
    await second.evaluate(async audio => { audio.muted = true; await audio.play(); });
    await expect(first).toHaveJSProperty('paused', true);
    await expect(second).toHaveJSProperty('paused', false);
    await second.evaluate(audio => audio.pause());
    await expect(page.locator('.sound-section')).not.toHaveClass(/is-playing/);
});
