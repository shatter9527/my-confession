'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createAdminStore } = require('../lib/admin-store');
function setup(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-cli-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.copyFileSync(path.join(__dirname, '../admin.js'), path.join(dir, 'admin.js'));
    fs.mkdirSync(path.join(dir, 'data'));
    return { dir, run: command => execFileSync(process.execPath, [path.join(dir, 'admin.js'), command], { encoding: 'utf8' }) };
}
test('CLI reads old Docker config symlink without migrating or changing it', t => {
    const { dir, run } = setup(t);
    const config = JSON.stringify({ adminTokens: [{ id: 'a1', name: '旧管理员', token: 'old-docker-token' }] });
    fs.writeFileSync(path.join(dir, 'data/config.json'), config);
    fs.symlinkSync(path.join(dir, 'data/config.json'), path.join(dir, 'config.json'));
    assert.match(run('token'), /old-docker-token/);
    assert.doesNotMatch(run('list'), /old-docker-token/);
    assert.equal(fs.readFileSync(path.join(dir, 'data/config.json'), 'utf8'), config);
    assert.equal(fs.existsSync(path.join(dir, 'data/app.db')), false);
});
test('CLI reads SQLite after migration instead of a stale config token', t => {
    const { dir, run } = setup(t);
    const configFile = path.join(dir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ adminToken: 'old-token' }));
    const db = new DatabaseSync(path.join(dir, 'data/app.db'));
    let token;
    try {
        const admins = createAdminStore(db, configFile);
        const actor = admins.authenticate('old-token');
        token = admins.rotate(actor, actor.id).token;
    } finally { db.close(); }
    const output = run('token');
    assert.ok(output.includes(token));
    assert.ok(!output.includes('old-token'));
});
test('CLI explains absent legacy credentials without generating new tokens or data', t => {
    const { dir } = setup(t);
    const result = spawnSync(process.execPath, [path.join(dir, 'admin.js'), 'token'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /仅凭 app.db 无法还原旧令牌/);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'data')), []);
});
