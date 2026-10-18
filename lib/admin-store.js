'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const SETTING_KEYS = ['peopleModerated', 'messagesModerated', 'commentsModerated'];
const newToken = () => crypto.randomBytes(18).toString('hex');
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function nameOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 20) fail(400, '管理员名字应为 1–20 个字符');
  return value.trim();
}

/** Owns administrator identity, credentials, settings and their durable changes.
 * No mutable credential cache: SQLite is the source of truth, including after failed writes.
 * Legacy config is input only; the database migration marker prevents re-import on restart.
 */
function createAdminStore(db, configFile) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS administrators (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, token TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS admin_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id TEXT NOT NULL DEFAULT '',
      admin_name TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit ON audit_log(created_at DESC);
  `);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const meta = db.prepare('SELECT value FROM admin_meta WHERE key=?');
  const putMeta = db.prepare('INSERT OR REPLACE INTO admin_meta(key,value) VALUES (?,?)');
  const insert = db.prepare('INSERT INTO administrators(id,name,token,created_at,last_used_at) VALUES (?,?,?,?,?)');
  let initialToken;
  transaction(() => {
    if (meta.get('imported-v1')) return;
    let cfg = {}, hasLegacyConfig = true;
    try { cfg = JSON.parse(fs.readFileSync(configFile, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('无法读取旧 config.json；原文件未改动，请修复后重启。');
      hasLegacyConfig = false;
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('旧 config.json 必须为对象；原文件未改动。');
    let entries;
    if (Object.hasOwn(cfg, 'adminTokens')) {
      if (!Array.isArray(cfg.adminTokens) || !cfg.adminTokens.length) throw new Error('旧 adminTokens 必须为非空数组；原文件未改动。');
      entries = cfg.adminTokens;
    } else if (Object.hasOwn(cfg, 'adminToken')) {
      entries = [{ id: 'a1', name: '默认', token: cfg.adminToken, createdAt: Date.now() }];
    } else {
      if (hasLegacyConfig) throw new Error('旧 config.json 缺少管理员令牌；原文件未改动。');
      initialToken = newToken();
      entries = [{ id: crypto.randomUUID(), name: '默认', token: initialToken, createdAt: Date.now() }];
    }
    for (const a of entries) {
      if (!a || typeof a.id !== 'string' || !a.id || typeof a.token !== 'string' || !a.token.trim()) {
        throw new Error('旧管理员记录缺少有效 id/token；原文件未改动。');
      }
      const timestamp = (v, fallback) => v === undefined ? fallback :
        Number.isSafeInteger(v) && v >= 0 ? v : fail(400, '旧管理员时间字段无效');
      insert.run(a.id, nameOf(a.name), a.token, timestamp(a.createdAt, Date.now()), timestamp(a.lastUsedAt, 0));
    }
    for (const key of SETTING_KEYS) {
      if (Object.hasOwn(cfg, key) && typeof cfg[key] !== 'boolean') throw new Error('旧审核设置必须为布尔值：' + key);
      putMeta.run(key, JSON.stringify(cfg[key] || false));
    }
    putMeta.run('imported-v1', 'true');
  });

  const get = db.prepare('SELECT * FROM administrators WHERE id=?');
  const all = db.prepare('SELECT * FROM administrators ORDER BY created_at,id');
  const insertAudit = db.prepare('INSERT INTO audit_log(admin_id,admin_name,action,target,detail,created_at) VALUES (?,?,?,?,?,?)');
  function record(actor, action, target = '', detail = '') {
    insertAudit.run(actor?.id || '', actor?.name || '未知', action, String(target), String(detail).slice(0, 300), Date.now());
    db.exec('DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - 2000');
  }
  function requireActor(actor) {
    const current = actor && get.get(actor.id);
    if (!current?.active) fail(401, '管理员已停用，请重新载入令牌');
    return current;
  }
  function change(actor, work) { return transaction(() => work(requireActor(actor))); }
  function target(id) { const row = get.get(id); if (!row) fail(404, '没有这个管理员'); return row; }
  function uniqueName(name, id) {
    if (db.prepare('SELECT id FROM administrators WHERE name=? AND id<>?').get(name, id || '')) fail(409, '已经有同名管理员，请在原记录上改名、换令牌或启用');
  }
  function identity(row) { return { id: row.id, name: row.name }; }
  function settings() { return Object.fromEntries(SETTING_KEYS.map(key => [key, JSON.parse(meta.get(key).value)])); }
  return {
    initialToken,
    authenticate(raw) {
      if (typeof raw !== 'string' || !raw) return null;
      const given = Buffer.from(raw);
      for (const row of all.all()) {
        if (!row.active) continue;
        const want = Buffer.from(row.token);
        if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) continue;
        if (Date.now() - row.last_used_at > 60000) {
          try { db.prepare('UPDATE administrators SET last_used_at=? WHERE id=?').run(Date.now(), row.id); }
          catch (error) { console.error('[admin last-used]', error.code || 'write failed'); }
        }
        return identity(row);
      }
      return null;
    },
    list(actor) {
      requireActor(actor);
      return { ok: true, me: actor.id, tokens: all.all().map(row => ({
        ...identity(row), hint: row.token.slice(0, 6) + '…' + row.token.slice(-4),
        active: Boolean(row.active), createdAt: row.created_at, lastUsedAt: row.last_used_at,
        self: row.id === actor.id,
      })) };
    },
    create(actor, value) {
      return change(actor, current => {
        const name = nameOf(value); uniqueName(name);
        const id = crypto.randomUUID(), token = newToken();
        insert.run(id, name, token, Date.now(), 0);
        record(current, '新增管理员', id, name);
        return { ok: true, id, name, token };
      });
    },
    rename(actor, id, value) {
      return change(actor, current => {
        const row = target(id), name = nameOf(value); uniqueName(name, id);
        db.prepare('UPDATE administrators SET name=? WHERE id=?').run(name, id);
        record(current, '管理员改名', id, row.name + ' → ' + name);
        return { ok: true, id, name };
      });
    },
    rotate(actor, id) {
      return change(actor, current => {
        const row = target(id);
        if (!row.active) fail(400, '请先启用该管理员');
        const token = newToken();
        db.prepare('UPDATE administrators SET token=?, last_used_at=0 WHERE id=?').run(token, id);
        record(current, '更换管理员令牌', id, row.name);
        return { ok: true, id, name: row.name, token, self: id === current.id };
      });
    },
    setActive(actor, id, active) {
      return change(actor, current => {
        const row = target(id);
        if (typeof active !== 'boolean') fail(400, 'active 必须为布尔值');
        if (!active && id === current.id) fail(400, '不能停用自己正在使用的管理员');
        // Re-enable with a fresh credential: a previously revoked token stays revoked.
        const token = active && !row.active ? newToken() : row.token;
        db.prepare('UPDATE administrators SET active=?,token=? WHERE id=?').run(Number(active), token, id);
        if (Boolean(row.active) !== active) record(current, active ? '启用管理员' : '吊销管理员', id, row.name);
        return { ok: true, id, name: row.name, ...(active && !row.active ? { token } : {}) };
      });
    },
    settings,
    updateSettings(actor, values) {
      return change(actor, current => {
        const old = settings(), changed = [];
        for (const key of SETTING_KEYS) {
          if (!Object.hasOwn(values, key)) continue;
          if (typeof values[key] !== 'boolean') fail(400, key + ' 必须为布尔值');
          if (values[key] !== old[key]) { putMeta.run(key, JSON.stringify(values[key])); changed.push(key); }
        }
        if (changed.length) record(current, '保存审核开关', '', changed.join(', '));
        return { ok: true, settings: settings(), changed };
      });
    },
    record,
    audit(actor, { adminId = '', before = 0, limit = 50 } = {}) {
      requireActor(actor);
      limit = Math.max(1, Math.min(200, Number(limit) || 50));
      before = Number(before) || 0;
      if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(before) || before < 0) fail(400, '分页参数无效');
      const rows = db.prepare(`SELECT * FROM audit_log WHERE (?='' OR admin_id=?) AND (?=0 OR id<?) ORDER BY id DESC LIMIT ?`).all(adminId, adminId, before, before, limit + 1);
      const more = rows.length > limit, items = rows.slice(0, limit);
      return { ok: true, items, nextBefore: more ? items.at(-1).id : null };
    },
  };
}
module.exports = { createAdminStore };
