const { test, expect } = require('./fixtures.cjs');
async function login(page, app) {
    await page.goto('/pages/admin.html');
    await page.locator('#token').fill(app.token);
    await page.locator('#btn-load').click();
    await expect(page.locator('#panel')).toBeVisible();
    await expect(page.locator('#admin-identity')).toContainText('默认');
}
test('clearing a credential disables both open admin pages and removes in-memory authorization', async ({ page, context, app }) => {
    await login(page, app);
    const editor = await context.newPage();
    await editor.goto(app.url + '/pages/admin-content.html');
    await expect(editor.locator('#page')).toBeEnabled();
    await page.locator('#btn-forget').click();
    await expect(page.locator('#panel')).toBeHidden();
    await expect(page.locator('#btn-snapshot')).toBeDisabled();
    await expect(editor.locator('#page')).toBeDisabled();
    await expect(editor.locator('#btn-save')).toBeDisabled();
    await expect(editor.locator('#token')).toHaveValue('');
    for (const tab of [page, editor]) {
        const response = await tab.evaluate(() => window.MFAdmin.post('/api/admin/snapshot', {}));
        expect(response.status).toBe(401);
        expect(await tab.evaluate(() => localStorage.getItem('mf_admin_token'))).toBeNull();
    }
});
test('delayed login response cannot restore a cleared credential or panel', async ({ page, app }) => {
    let release, seen;
    const started = new Promise(resolve => { seen = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/admin/all', async route => {
        const response = await route.fetch();
        seen(); await gate;
        await route.fulfill({ response }).catch(() => {});
    });
    await page.goto('/pages/admin.html');
    await page.locator('#token').fill(app.token);
    await page.locator('#btn-load').click();
    await started;
    await page.locator('#btn-forget').click();
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(page.locator('#panel')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('mf_admin_token'))).toBeNull();
    expect(await page.evaluate(() => window.MFAdmin.token())).toBe('');
});
test('administrator UI creates, renames, rotates, disables and re-enables a stable identity', async ({ page, request, app }) => {
    await login(page, app);
    await page.locator('#tk-name').fill('测试同学');
    await page.locator('#btn-add-token').click();
    await expect(page.locator('#tk-new')).toContainText('测试同学');
    const getRows = async () => (await (await request.get('/api/admin/tokens', { headers: { 'x-admin-token': app.token } })).json()).tokens;
    const person = (await getRows()).find(a => a.name === '测试同学');
    const row = page.locator('[data-admin-id="' + person.id + '"]');
    page.once('dialog', dialog => dialog.accept('新名字'));
    await row.getByRole('button', { name: '改名', exact: true }).click();
    await expect(row).toContainText('新名字');
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: '换令牌', exact: true }).click();
    await expect(page.locator('#tk-new')).toContainText('新名字');
    await expect(page.locator('#tb-audit')).toContainText('更换管理员令牌');
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: '停用', exact: true }).click();
    await expect(row).toContainText('已停用');
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: '启用', exact: true }).click();
    await expect(row).toContainText('有效');
    expect((await getRows()).find(a => a.name === '新名字').id).toBe(person.id);
    await page.locator('#audit-admin').selectOption(person.id);
    await expect(page.locator('#tb-audit')).toContainText('还没有操作记录');
});
test('rotating the current administrator keeps both tabs usable; old token is rejected', async ({ page, context, request, app }) => {
    await login(page, app);
    const editor = await context.newPage();
    await editor.goto(app.url + '/pages/admin-content.html');
    await expect(editor.locator('#page')).toBeEnabled();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#tb-tokens').getByRole('button', { name: '换令牌', exact: true }).click();
    await expect(page.locator('#tk-new')).toContainText('默认');
    await expect(page.locator('#panel')).toBeVisible();
    const fresh = await page.evaluate(() => window.MFAdmin.token());
    expect(fresh).not.toBe(app.token);
    await expect(editor.locator('#token')).toHaveValue(fresh);
    await expect(editor.locator('#page')).toBeEnabled();
    expect((await request.get('/api/admin/tokens', { headers: { 'x-admin-token': app.token } })).status()).toBe(401);
    expect((await request.get('/api/admin/tokens', { headers: { 'x-admin-token': fresh } })).status()).toBe(200);
});
test('revoked credentials clear the UI on the next request; private modules are not served', async ({ page, request, app }) => {
    const headers = { 'x-admin-token': app.token };
    const created = await (await request.post('/api/admin/tokens', { headers, data: { name: '将停用' } })).json();
    await page.goto('/pages/admin.html');
    await page.locator('#token').fill(created.token);
    await page.locator('#btn-load').click();
    await expect(page.locator('#panel')).toBeVisible();
    await request.post('/api/admin/tokens/revoke', { headers, data: { id: created.id } });
    await page.locator('#btn-audit-refresh').click();
    await expect(page.locator('#panel')).toBeHidden();
    await expect(page.locator('#token')).toHaveValue('');
    await expect(page.locator('#status')).toContainText('失效');
    expect((await request.get('/lib/admin-store.js')).status()).toBe(404);
});
