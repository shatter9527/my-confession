'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createAdminStore } = require('../lib/admin-store');
function fixture(t, config) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-store-'));
    const configFile = path.join(dir, 'config.json');
    if (config !== undefined) fs.writeFileSync(configFile, typeof config === 'string' ? config : JSON.stringify(config));
    let db;
    t.after(() => { if (db) db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    return {
        configFile,
        open() { if (db) db.close(); db = new DatabaseSync(path.join(dir, 'app.db')); return createAdminStore(db, configFile); },
        sql(sql) { db.exec(sql); }
    };
}
const legacy = { adminToken: 'legacy-admin-token', peopleModerated: true };
test('single-token migration preserves credentials/settings; restart never reimports disabled tokens', t => {
    const f = fixture(t, legacy);
    let store = f.open(), actor = store.authenticate(legacy.adminToken);
    assert.equal(actor.id, 'a1');
    assert.deepEqual(Object.keys(actor).sort(), ['id', 'name']);
    assert.equal(store.settings().peopleModerated, true);
    assert.equal(fs.readFileSync(f.configFile, 'utf8'), JSON.stringify(legacy));
    const other = store.create(actor, '第二人');
    store.setActive(store.authenticate(other.token), actor.id, false);
    store = f.open();
    assert.equal(store.authenticate(legacy.adminToken), null);
    assert.equal(store.authenticate(other.token).id, other.id);
    assert.equal(store.list(store.authenticate(other.token)).tokens.length, 2);
});
test('multi-token import preserves IDs, names and last-use metadata', t => {
    const cfg = { adminTokens: [
        { id: 'old-a', name: '甲', token: 'token-a', createdAt: 123, lastUsedAt: 456 },
        { id: 'old-b', name: '乙', token: 'token-b', createdAt: 234 }
    ] };
    const store = fixture(t, cfg).open();
    const rows = store.list(store.authenticate('token-b')).tokens;
    assert.equal(rows.find(r => r.id === 'old-a').lastUsedAt, 456);
    assert.equal(rows.find(r => r.id === 'old-b').createdAt, 234);
    assert.equal(store.authenticate('token-a').name, '甲');
});
test('fresh initialization announces one initial token only, including after restart', t => {
    const f = fixture(t);
    const first = f.open(), token = first.initialToken;
    assert.match(token, /^[0-9a-f]{36}$/);
    const second = f.open();
    assert.equal(second.initialToken, undefined);
    assert.ok(second.authenticate(token));
});
test('invalid configuration is preserved and import is retryable', t => {
    const f = fixture(t, '{broken-json');
    assert.throws(() => f.open(), /原文件未改动/);
    assert.equal(fs.readFileSync(f.configFile, 'utf8'), '{broken-json');
    fs.writeFileSync(f.configFile, JSON.stringify(legacy));
    assert.ok(f.open().authenticate(legacy.adminToken));
});
test('invalid administrator entries fail the entire migration without partial import', t => {
    const cfg = { adminTokens: [{ id: 'x', name: '甲', token: 'a' }, { id: 'x', name: '乙', token: 'b' }] };
    const f = fixture(t, cfg);
    assert.throws(() => f.open());
    cfg.adminTokens[1].id = 'y';
    fs.writeFileSync(f.configFile, JSON.stringify(cfg));
    const store = f.open();
    assert.equal(store.list(store.authenticate('a')).tokens.length, 2);
});
test('failed persistence leaves revocation, creation, rotation, settings and audit unchanged across restart', t => {
    const f = fixture(t, legacy);
    let store = f.open(), actor = store.authenticate(legacy.adminToken);
    const other = store.create(actor, '乙');
    const before = store.audit(actor).items.length;
    // Failure after the administrator write but before transaction completion.
    f.sql("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'simulated write failure'); END;");
    assert.throws(() => store.setActive(actor, other.id, false), /simulated/);
    assert.throws(() => store.create(actor, '丙'), /simulated/);
    assert.throws(() => store.rotate(actor, other.id), /simulated/);
    assert.throws(() => store.rename(actor, other.id, '新名字'), /simulated/);
    assert.throws(() => store.updateSettings(actor, { peopleModerated: false }), /simulated/);
    assert.ok(store.authenticate(other.token));
    assert.equal(store.settings().peopleModerated, true);
    assert.equal(store.audit(actor).items.length, before);
    f.sql('DROP TRIGGER fail_audit;');
    store = f.open(); actor = store.authenticate(legacy.adminToken);
    assert.equal(store.authenticate(other.token).name, '乙');
    assert.equal(store.list(actor).tokens.length, 2);
    f.sql('PRAGMA query_only=ON;');
    assert.throws(() => store.setActive(actor, other.id, false));
    assert.ok(store.authenticate(other.token));
});
test('rename/rotation retain identity and historical names; re-enable never revives revoked credentials', t => {
    const store = fixture(t, legacy).open(), actor = store.authenticate(legacy.adminToken);
    const other = store.create(actor, '乙');
    const person = store.authenticate(other.token);
    store.rename(person, person.id, '乙改名');
    const rotated = store.rotate(person, person.id);
    assert.equal(rotated.id, person.id);
    assert.equal(store.authenticate(other.token), null);
    assert.equal(store.authenticate(rotated.token).name, '乙改名');
    assert.throws(() => store.setActive(actor, actor.id, false), /不能停用/);
    store.setActive(actor, other.id, false);
    assert.equal(store.authenticate(rotated.token), null);
    const enabled = store.setActive(actor, other.id, true);
    assert.ok(store.authenticate(enabled.token));
    assert.equal(store.authenticate(rotated.token), null);
    const log = store.audit(actor, { adminId: person.id }).items;
    assert.equal(log.find(r => r.action === '管理员改名').admin_name, '乙');
    assert.equal(log.find(r => r.action === '更换管理员令牌').admin_name, '乙改名');
});
test('audit filters and cursor pagination visit each retained event once', t => {
    const store = fixture(t, legacy).open(), actor = store.authenticate(legacy.adminToken);
    const second = store.create(actor, '乙');
    const person = store.authenticate(second.token);
    for (let i = 0; i < 7; i++) store.rename(person, person.id, '乙' + i);
    const ids = [];
    let before = 0;
    do {
        const page = store.audit(actor, { adminId: person.id, before, limit: 3 });
        ids.push(...page.items.map(row => row.id));
        assert.ok(page.items.every(row => row.admin_id === person.id));
        before = page.nextBefore;
    } while (before);
    assert.equal(ids.length, 7); assert.equal(new Set(ids).size, 7);
});

test('existing empty credential configuration is not mistaken for a fresh install', t => {
    const f = fixture(t, { peopleModerated: true });
    assert.throws(() => f.open(), /缺少管理员令牌/);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.configFile, 'utf8')), { peopleModerated: true });
});

test('backup.js snapshot restores administrators, settings and audit without legacy configuration', t => {
    const { execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-backup-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'data'));
    fs.copyFileSync(path.join(__dirname, '../backup.js'), path.join(dir, 'backup.js'));
    let db = new DatabaseSync(path.join(dir, 'data/app.db'));
    const configFile = path.join(dir, 'config.json');
    const store = createAdminStore(db, configFile);
    const actor = store.authenticate(store.initialToken);
    const person = store.create(actor, '备份管理员');
    store.updateSettings(actor, { peopleModerated: true, messagesModerated: true });
    db.close();
    execFileSync(process.execPath, [path.join(dir, 'backup.js')], { stdio: 'pipe' });
    const backupDir = path.join(dir, 'data/backup');
    const snapshot = fs.readdirSync(backupDir).find(name => name.endsWith('.db'));
    assert.ok(snapshot);
    db = new DatabaseSync(path.join(backupDir, snapshot));
    try {
        const restored = createAdminStore(db, configFile);
        assert.equal(restored.initialToken, undefined);
        const restoredActor = restored.authenticate(person.token);
        assert.equal(restoredActor.id, person.id);
        assert.equal(restored.settings().peopleModerated, true);
        assert.equal(restored.settings().messagesModerated, true);
        assert.equal(restored.audit(restoredActor).items.length, 2);
    } finally { db.close(); }
});
