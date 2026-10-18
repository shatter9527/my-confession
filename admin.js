#!/usr/bin/env node
'use strict';
// Local-only recovery/readout: never served by the HTTP application.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const root = __dirname;
const command = process.argv[2] || 'list';
if (!['list', 'token'].includes(command)) {
  console.error('用法：node admin.js list（管理员名单） | node admin.js token（有效令牌）');
  process.exit(1);
}
let db;
try {
  const dbFile = path.join(root, 'data', 'app.db');
  let rows;
  if (fs.existsSync(dbFile)) {
    db = new DatabaseSync(dbFile, { readOnly: true });
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='administrators'").get()) {
      rows = db.prepare('SELECT id,name,token,active FROM administrators ORDER BY created_at,id').all();
    }
  }
  if (!rows) {
    // Older releases keep credentials in config.json, including the Docker symlink.
    const candidates = [path.join(root, 'config.json'), path.join(root, 'data', 'config.json')];
    const configFile = candidates.find(file => fs.existsSync(file));
    if (!configFile) throw new Error('旧数据库不包含令牌，且未找到 config.json。请从原容器 /app/config.json 恢复配置后重启；仅凭 app.db 无法还原旧令牌。');
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const entries = cfg.adminTokens || (cfg.adminToken ? [{ id: 'a1', name: '默认', token: cfg.adminToken }] : []);
    if (!Array.isArray(entries) || !entries.length || entries.some(a => !a || typeof a.token !== 'string' || !a.token)) {
      throw new Error('旧配置中没有有效管理员令牌。原文件未改动。');
    }
    rows = entries.map(a => ({ ...a, active: 1 }));
  }
  if (command === 'token') {
    const active = rows.filter(row => row.active);
    if (!active.length) throw new Error('没有有效管理员，请恢复可用的数据库备份。');
    console.table(active.map(({ id, name, token }) => ({ id, name, token })));
  } else {
    console.table(rows.map(({ id, name, active }) => ({ id, name, status: active ? '有效' : '已停用' })));
  }
} catch (error) {
  console.error('[管理员查询] ' + error.message);
  process.exitCode = 1;
} finally { if (db) db.close(); }
