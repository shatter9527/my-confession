/**
 * 数据库备份 —— node backup.js
 * 用 SQLite 的 VACUUM INTO 生成一致性快照（WAL 模式下也安全）
 * 含管理员、令牌、审核设置和日志（旧版未迁移数据库除外）。
 * 备份放在 data/backup/，默认保留最近 30 份
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DIR = path.join(__dirname, 'data');
const DB = path.join(DIR, 'app.db');
const OUT_DIR = path.join(DIR, 'backup');
const KEEP = 30;

if (!fs.existsSync(DB)) {
  console.error('[X] 找不到数据库：' + DB);
  process.exit(1);
}
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
const out = path.join(OUT_DIR, 'app-' + stamp + '.db');

const db = new DatabaseSync(DB);
// VACUUM INTO 的路径用正斜杠，避免 Windows 反斜杠在 SQL 字符串里要转义
db.exec("VACUUM INTO '" + out.replace(/\\/g, '/') + "'");

const stat = fs.statSync(out);
console.log('[OK] 备份完成：' + out + '  (' + (stat.size / 1024).toFixed(1) + ' KB)');

try {
  const row = db.prepare("SELECT COUNT(*) c FROM people WHERE status='published'").get();
  const row2 = db.prepare("SELECT COUNT(*) c FROM messages WHERE status='published'").get();
  console.log('     当前在线：人物 ' + row.c + ' 条 / 留言 ' + row2.c + ' 条');
} catch (e) { /* 表可能还不存在 */ }
db.close();

// 只保留最近 KEEP 份
const files = fs.readdirSync(OUT_DIR)
    .filter((f) => /^app-\d{8}-\d{6}\.db$/.test(f))
    .sort();
while (files.length > KEEP) {
  const old = files.shift();
  try { fs.unlinkSync(path.join(OUT_DIR, old)); console.log('     已清理旧备份 ' + old); } catch (e) { }
}
console.log('[OK] 现有备份 ' + Math.min(files.length + 1, KEEP) + ' 份（最多保留 ' + KEEP + ' 份）');
