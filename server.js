/**
 * My Confession 后端 —— 零依赖单文件：node server.js
 * 存储：SQLite（Node 24 内置 node:sqlite，不需要 npm install）
 *
 * 权限模型
 *   · 静态文件（正文 / 岁月史书 / 鸣谢栏 …）永远只读，任何人都改不到
 *   · 访客可写：人物册、留言板、词条留言
 *   · 三个独立审核开关（config.json）：peopleModerated / messagesModerated / commentsModerated
 *   · 管理员可在后台直接编辑各页正文（存覆盖层，随时可恢复默认）
 *   · 删除一律软删除（status 变化），数据不会真没，管理口令可恢复
 *
 * 人物状态机
 *   published 在线 / pending 待审批 / hidden 已下架 / rejected 已驳回 / deleted 已删除
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const CATEGORIES = ['正常人', '神人', '全唐', '半唐', '**'];

/**
 * 允许在线编辑正文的页面：启动时扫盘自动发现（不写死路径，页面怎么挪都不会漏）。
 * 判据 = 文件里含 `content-left`，且不是后台页 / 备份 / 老版单页。
 */
const SKIP_DIRS = new Set(['data', 'node_modules', 'docs', 'deploy', '.git', 'js', 'css', '历史记录', '剩余文本', '人物册', '班规']);
function scanContentPages() {
  const out = [];
  (function walk(dir, rel) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const relPath = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, relPath); continue; }
      if (!e.name.endsWith('.html')) continue;
      if (/^admin/i.test(e.name) || /^people-/i.test(e.name) || /bak/i.test(e.name) || /^1\.5/.test(e.name)) continue;
      let txt;
      try { txt = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (txt.indexOf('content-left') < 0) continue;
      out.push({ page: e.name, path: relPath });
    }
  })(ROOT, '');
  return out;
}
const PAGES = scanContentPages();
const PAGE_MAP = new Map(PAGES.map((p) => [p.page, p.path]));

/** 找某个文件名在树里的相对路径（后台页位置会随重构变，不写死）。 */
function findFile(name) {
  let found = name;
  (function walk(dir, rel) {
    if (found !== name) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), r); continue; }
      if (e.name === name) { found = r; return; }
    }
  })(ROOT, '');
  return found;
}
const ADMIN_PAGE = findFile('admin.html');
const EDITOR_PAGE = findFile('admin-content.html');

// ---------------------------------------------------------------- 配置
function newToken() {
  return crypto.randomBytes(18).toString('hex');
}

function loadConfig() {
  let cfg = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { cfg = {}; }
  }
  let dirty = false;

  // 多管理员：每个令牌一条记录。旧的单 adminToken 自动迁移成「默认」。
  if (!Array.isArray(cfg.adminTokens)) { cfg.adminTokens = []; dirty = true; }
  if (cfg.adminTokens.length === 0) {
    cfg.adminTokens.push({
      id: 'a1',
      name: '默认',
      token: cfg.adminToken || newToken(),
      createdAt: Date.now(),
      lastUsedAt: 0,
    });
    dirty = true;
  }
  delete cfg.adminToken;   // 只保留 adminTokens，避免同一个口令存两处

  if (typeof cfg.messagesModerated !== 'boolean') { cfg.messagesModerated = false; dirty = true; }
  if (typeof cfg.peopleModerated !== 'boolean') { cfg.peopleModerated = false; dirty = true; }
  if (typeof cfg.commentsModerated !== 'boolean') { cfg.commentsModerated = false; dirty = true; }
  if (dirty) fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}
const CONFIG = loadConfig();
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf8');
const publicSettings = () => ({
  peopleModerated: CONFIG.peopleModerated,
  messagesModerated: CONFIG.messagesModerated,
  commentsModerated: CONFIG.commentsModerated,
});

// ---------------------------------------------------------------- 数据库
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS people (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    note        TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'published',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER,
    from_hash   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_people ON people(status, category);

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL DEFAULT '匿名',
    text       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'published',
    created_at INTEGER NOT NULL,
    from_hash  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages ON messages(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS people_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT    NOT NULL DEFAULT 'delete',
    target_id   INTEGER NOT NULL,
    reason      TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending',
    created_at  INTEGER NOT NULL,
    decided_at  INTEGER,
    from_hash   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_requests ON people_requests(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id  INTEGER NOT NULL,
    name       TEXT NOT NULL DEFAULT '匿名',
    text       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'published',
    created_at INTEGER NOT NULL,
    from_hash  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_comments ON comments(person_id, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS content_pages (
    page       TEXT PRIMARY KEY,
    html       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS content_history (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    page     TEXT NOT NULL,
    html     TEXT NOT NULL,
    saved_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_content_history ON content_history(page, saved_at DESC);

  -- 管理员操作日志：谁、做了什么、对象是谁、什么时候
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id   TEXT NOT NULL DEFAULT '',
    admin_name TEXT NOT NULL DEFAULT '',
    action     TEXT NOT NULL,
    target     TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit ON audit_log(created_at DESC);
`);

const q = {
  listPublished: db.prepare(
    `SELECT id,name,category,note,created_at FROM people
     WHERE status='published' ORDER BY category, id`),
  insert: db.prepare(
    `INSERT INTO people (name,category,note,status,created_at,from_hash)
     VALUES (?,?,?,?,?,?)`),
  updatePerson: db.prepare(
    `UPDATE people SET name=?, category=?, note=?, updated_at=? WHERE id=?`),
  softDelete: db.prepare(`UPDATE people SET status='deleted', updated_at=? WHERE id=? AND status='published'`),
  setStatus: db.prepare(`UPDATE people SET status=?, updated_at=? WHERE id=?`),
  restore: db.prepare(`UPDATE people SET status='published', updated_at=? WHERE id=?`),
  purge: db.prepare(`DELETE FROM people WHERE id=?`),
  getPerson: db.prepare(`SELECT id,name,category,note,status,created_at FROM people WHERE id=?`),
  allPeople: db.prepare(`SELECT id,name,category,note,status,created_at FROM people ORDER BY id DESC`),
  countCommentsOf: db.prepare(
    `SELECT person_id, COUNT(*) c FROM comments WHERE status='published' GROUP BY person_id`),

  listMsgs: db.prepare(
    `SELECT id,name,text,created_at FROM messages
     WHERE status='published' ORDER BY created_at DESC LIMIT 200`),
  insertMsg: db.prepare(
    `INSERT INTO messages (name,text,status,created_at,from_hash) VALUES (?,?,?,?,?)`),
  delMsg: db.prepare(`UPDATE messages SET status='deleted' WHERE id=?`),
  purgeMsg: db.prepare(`DELETE FROM messages WHERE id=?`),
  allMsgs: db.prepare(`SELECT id,name,text,status,created_at FROM messages ORDER BY id DESC LIMIT 500`),

  addRequest: db.prepare(
    `INSERT INTO people_requests (kind,target_id,reason,status,created_at,from_hash)
     VALUES (?,?,?,'pending',?,?)`),
  findRequest: db.prepare(
    `SELECT id FROM people_requests WHERE kind='delete' AND target_id=? AND status='pending' LIMIT 1`),
  listRequests: db.prepare(
    `SELECT r.id, r.kind, r.target_id, r.reason, r.status, r.created_at,
            p.name AS target_name, p.category AS target_category
     FROM people_requests r LEFT JOIN people p ON p.id = r.target_id
     ORDER BY r.status='pending' DESC, r.id DESC LIMIT 300`),
  getRequest: db.prepare(`SELECT * FROM people_requests WHERE id=?`),
  decideRequest: db.prepare(
    `UPDATE people_requests SET status=?, decided_at=? WHERE id=? AND status='pending'`),

  // 词条留言
  listComments: db.prepare(
    `SELECT id,person_id,name,text,created_at FROM comments
     WHERE person_id=? AND status='published' ORDER BY created_at ASC LIMIT 300`),
  insertComment: db.prepare(
    `INSERT INTO comments (person_id,name,text,status,created_at,from_hash) VALUES (?,?,?,?,?,?)`),
  allComments: db.prepare(
    `SELECT c.id,c.person_id,c.name,c.text,c.status,c.created_at,p.name AS person_name
     FROM comments c LEFT JOIN people p ON p.id = c.person_id
     ORDER BY c.id DESC LIMIT 800`),
  setCommentStatus: db.prepare(`UPDATE comments SET status=? WHERE id=?`),
  purgeComment: db.prepare(`DELETE FROM comments WHERE id=?`),
  countPendingComments: db.prepare(`SELECT COUNT(*) c FROM comments WHERE status='pending'`),
  countComments: db.prepare(`SELECT COUNT(*) c FROM comments WHERE status='published'`),

  // 正文覆盖
  getContent: db.prepare(`SELECT html,updated_at FROM content_pages WHERE page=?`),
  putContent: db.prepare(
    `INSERT INTO content_pages (page,html,updated_at) VALUES (?,?,?)
     ON CONFLICT(page) DO UPDATE SET html=excluded.html, updated_at=excluded.updated_at`),
  delContent: db.prepare(`DELETE FROM content_pages WHERE page=?`),
  allContent: db.prepare(`SELECT page,updated_at FROM content_pages ORDER BY page`),
  pushHistory: db.prepare(`INSERT INTO content_history (page,html,saved_at) VALUES (?,?,?)`),
  listHistory: db.prepare(
    `SELECT id,page,saved_at FROM content_history WHERE page=? ORDER BY saved_at DESC LIMIT 20`),
  getHistory: db.prepare(`SELECT id,page,html,saved_at FROM content_history WHERE id=?`),
  trimHistory: db.prepare(
    `DELETE FROM content_history WHERE page=? AND id NOT IN
     (SELECT id FROM content_history WHERE page=? ORDER BY saved_at DESC LIMIT 20)`),

  countPeople: db.prepare(`SELECT COUNT(*) c FROM people WHERE status='published'`),
  countMsgs: db.prepare(`SELECT COUNT(*) c FROM messages WHERE status='published'`),
  countPendingPeople: db.prepare(`SELECT COUNT(*) c FROM people WHERE status='pending'`),
  countPendingRequests: db.prepare(`SELECT COUNT(*) c FROM people_requests WHERE status='pending'`),

  // 操作日志
  insertAudit: db.prepare(
    `INSERT INTO audit_log (admin_id,admin_name,action,target,detail,created_at)
     VALUES (?,?,?,?,?,?)`),
  listAudit: db.prepare(
    `SELECT id,admin_id,admin_name,action,target,detail,created_at
     FROM audit_log ORDER BY id DESC LIMIT 200`),
  trimAudit: db.prepare(`DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - 2000`),
};

// ---------------------------------------------------------------- 工具
function clientHash(req) {
  const xf = req.headers['x-forwarded-for'];
  const ip = xf ? String(xf).split(',')[0].trim() : ((req.socket && req.socket.remoteAddress) || '');
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12);
}

const buckets = new Map();
function rateLimit(key, minGapMs = 8000, hourlyMax = 120) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < 3600e3);
  if (arr.length && now - arr[arr.length - 1] < minGapMs) return '操作太频繁，请稍等几秒';
  if (arr.length >= hourlyMax) return '这一小时操作太多了，请稍后再试';
  arr.push(now);
  buckets.set(key, arr);
  return null;
}

function send(res, code, body) {
  const isObj = body !== null && typeof body === 'object';
  res.writeHead(code, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(isObj ? JSON.stringify(body) : String(body));
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('内容太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

const clip = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);

/**
 * 认出请求来自哪个管理员。命中返回 {id,name,token,...}，否则 null。
 * 顺手更新 lastUsedAt（节流 60 秒，避免每个请求都写盘）。
 */
function adminOf(req) {
  const raw = req.headers['x-admin-token'];
  if (!raw) return null;
  const given = Buffer.from(String(raw));
  for (const a of CONFIG.adminTokens) {
    const want = Buffer.from(String(a.token || ''));
    if (given.length !== want.length) continue;
    if (!crypto.timingSafeEqual(given, want)) continue;
    const now = Date.now();
    if (!a.lastUsedAt || now - a.lastUsedAt > 60000) {
      a.lastUsedAt = now;
      try { saveConfig(); } catch { /* 写盘失败不影响鉴权 */ }
    }
    return a;
  }
  return null;
}

/** 记一条管理员操作。失败不抛（日志不该拖垮业务）。 */
function audit(admin, action, target, detail) {
  try {
    q.insertAudit.run(
      admin ? String(admin.id) : '',
      admin ? String(admin.name) : '未知',
      String(action),
      String(target == null ? '' : target),
      String(detail == null ? '' : detail).slice(0, 300),
      Date.now(),
    );
    q.trimAudit.run();
  } catch (e) {
    console.error('[audit]', e && e.message);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};
const DENY = [/^\/data\//i, /^\/materials\//i, /^\/config\.json$/i, /^\/server\.js$/i, /^\/\./, /\.bak/i, /\.bak-\d/i];

const LEGACY_STATIC_REDIRECTS = {
  '/Screenshot_2025-05-14-10-20-03-636_com.tencent.mm-edit.jpg': '/assets/media/Screenshot_2025-05-14-10-20-03-636_com.tencent.mm-edit.jpg',
  '/about.html': '/pages/info/about.html',
  '/admin-content.html': '/pages/admin-content.html',
  '/admin.html': '/pages/admin.html',
  '/anec-clumsy.html': '/pages/anecdotes/anec-clumsy.html',
  '/anec-custom.html': '/pages/anecdotes/anec-custom.html',
  '/anec-legend.html': '/pages/anecdotes/anec-legend.html',
  '/anec-lucky.html': '/pages/anecdotes/anec-lucky.html',
  '/anec-wisdom.html': '/pages/anecdotes/anec-wisdom.html',
  '/contact.html': '/pages/info/contact.html',
  '/copyright.html': '/pages/info/copyright.html',
  '/help.html': '/pages/info/help.html',
  '/nanchenglu-54-15-2.m4a': '/assets/media/nanchenglu-54-15-2.m4a',
  '/nanchenglu-54-15.m4a': '/assets/media/nanchenglu-54-15.m4a',
  '/people-full.html': '/pages/people/people-full.html',
  '/people-god.html': '/pages/people/people-god.html',
  '/people-half.html': '/pages/people/people-half.html',
  '/people-normal.html': '/pages/people/people-normal.html',
  '/people-xx.html': '/pages/people/people-xx.html',
  '/rules-daily.html': '/pages/rules/rules-daily.html',
  '/rules-face.html': '/pages/rules/rules-face.html',
  '/rules-misc.html': '/pages/rules/rules-misc.html',
  '/rules-punish.html': '/pages/rules/rules-punish.html',
  '/rules-study.html': '/pages/rules/rules-study.html',
  '/suishu.html': '/pages/memories/suishu.html',
  '/x-tutu.html': '/pages/anecdotes/x-tutu.html',
  '/youth-combo.html': '/pages/memories/youth-combo.html',
  '/youth-credits.html': '/pages/memories/youth-credits.html',
  '/youth-end.html': '/pages/memories/youth-end.html',
  '/youth-epilogue.html': '/pages/memories/youth-epilogue.html',
  '/youth-fun.html': '/pages/memories/youth-fun.html'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  if (DENY.some((re) => re.test(rel))) return send(res, 404, 'Not Found');
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not Found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------- API
async function api(req, res, pathname) {
  const m = req.method;
  const h = clientHash(req);

  // ---- 公开：当前开关
  if (pathname === '/api/settings' && m === 'GET') {
    return send(res, 200, { ok: true, settings: publicSettings() });
  }

  // ---- 公开：正文覆盖（没有覆盖时 html 为空串）
  let cm = pathname.match(/^\/api\/content\/([\w.-]+)$/);
  if (cm && m === 'GET') {
    const page = cm[1];
    if (!PAGE_MAP.has(page)) return send(res, 404, { ok: false, error: '不是可编辑页面' });
    const row = q.getContent.get(page);
    return send(res, 200, { ok: true, page, html: row ? row.html : '', updatedAt: row ? row.updated_at : 0 });
  }

  // ---- 公开：人物册
  if (pathname === '/api/people' && m === 'GET') {
    const items = q.listPublished.all();
    const counts = new Map(q.countCommentsOf.all().map((r) => [r.person_id, r.c]));
    return send(res, 200, { ok: true, items: items.map((it) => ({ ...it, comments: counts.get(it.id) || 0 })) });
  }

  if (pathname === '/api/people' && m === 'POST') {
    const limited = rateLimit('p' + h);
    if (limited) return send(res, 429, { ok: false, error: limited });
    const b = await readBody(req);
    const name = clip(b.name, 40);
    const note = clip(b.note, 1200);
    const category = clip(b.category, 10);
    if (!name) return send(res, 400, { ok: false, error: '名字不能空' });
    if (!note) return send(res, 400, { ok: false, error: '内容不能空' });
    if (!CATEGORIES.includes(category)) return send(res, 400, { ok: false, error: '分类不合法' });
    const now = Date.now();
    const moderated = CONFIG.peopleModerated;
    const status = moderated ? 'pending' : 'published';
    const r = q.insert.run(name, category, note, status, now, h);
    if (moderated) {
      return send(res, 202, {
        ok: true, pending: true,
        message: '已提交，等管理员审核通过后才会出现在人物册里',
        item: { id: Number(r.lastInsertRowid), name, category, note, status, created_at: now },
      });
    }
    return send(res, 200, {
      ok: true, pending: false,
      item: { id: Number(r.lastInsertRowid), name, category, note, status, created_at: now },
    });
  }

  // ---- 词条留言
  let pm = pathname.match(/^\/api\/people\/(\d+)\/comments$/);
  if (pm) {
    const pid = Number(pm[1]);
    if (m === 'GET') {
      return send(res, 200, { ok: true, items: q.listComments.all(pid) });
    }
    if (m === 'POST') {
      const limited = rateLimit('c' + h, 5000, 200);
      if (limited) return send(res, 429, { ok: false, error: limited });
      const target = q.getPerson.get(pid);
      if (!target || target.status !== 'published') return send(res, 404, { ok: false, error: '这个词条不存在' });
      const b = await readBody(req);
      const name = clip(b.name, 20) || '匿名';
      const text = clip(b.text, 400);
      if (!text) return send(res, 400, { ok: false, error: '内容不能空' });
      const moderated = CONFIG.commentsModerated;
      const status = moderated ? 'pending' : 'published';
      const now = Date.now();
      const r = q.insertComment.run(pid, name, text, status, now, h);
      return send(res, 200, {
        ok: true, pending: moderated,
        message: moderated ? '已提交，等管理员审核后才会显示' : '',
        item: { id: Number(r.lastInsertRowid), person_id: pid, name, text, created_at: now },
      });
    }
  }

  const mm = pathname.match(/^\/api\/people\/(\d+)$/);
  if (mm && m === 'DELETE') {
    const limited = rateLimit('d' + h, 3000, 200);
    if (limited) return send(res, 429, { ok: false, error: limited });
    const id = Number(mm[1]);
    const row = q.getPerson.get(id);
    if (!row || row.status !== 'published') {
      return send(res, 404, { ok: false, error: '没有这条（可能已被删）' });
    }
    if (CONFIG.peopleModerated) {
      const dup = q.findRequest.get(id);
      if (dup) {
        return send(res, 202, {
          ok: true, pending: true, message: '这条已经提交过删除申请了，等管理员处理', requestId: Number(dup.id),
        });
      }
      const r = q.addRequest.run('delete', id, clip(req.headers['x-reason'] || '', 200), Date.now(), h);
      return send(res, 202, {
        ok: true, pending: true,
        message: '删除申请已提交，等管理员批准后才真正下架',
        requestId: Number(r.lastInsertRowid),
      });
    }
    const r = q.softDelete.run(Date.now(), id);
    if (!r.changes) return send(res, 404, { ok: false, error: '没有这条（可能已被删）' });
    return send(res, 200, { ok: true, pending: false });
  }

  // ---- 公开：留言板
  if (pathname === '/api/messages' && m === 'GET') {
    return send(res, 200, { ok: true, items: q.listMsgs.all() });
  }

  if (pathname === '/api/messages' && m === 'POST') {
    const limited = rateLimit('m' + h);
    if (limited) return send(res, 429, { ok: false, error: limited });
    const b = await readBody(req);
    const name = clip(b.name, 20) || '匿名';
    const text = clip(b.text, 500);
    if (!text) return send(res, 400, { ok: false, error: '内容不能空' });
    const moderated = CONFIG.messagesModerated;
    const status = moderated ? 'pending' : 'published';
    const now = Date.now();
    const r = q.insertMsg.run(name, text, status, now, h);
    return send(res, 200, {
      ok: true, pending: moderated,
      message: moderated ? '已提交，等管理员审核后才会显示' : '',
      item: { id: Number(r.lastInsertRowid), name, text, created_at: now },
    });
  }

  // ---- 后台
  if (pathname.startsWith('/api/admin/')) {
    const admin = adminOf(req);
    if (!admin) return send(res, 401, { ok: false, error: '管理口令不正确' });

    if (pathname === '/api/admin/settings' && m === 'GET') {
      return send(res, 200, { ok: true, settings: publicSettings() });
    }

    if (pathname === '/api/admin/settings' && m === 'POST') {
      const b = await readBody(req);
      const changed = [];
      for (const k of ['peopleModerated', 'messagesModerated', 'commentsModerated']) {
        if (typeof b[k] === 'boolean' && b[k] !== CONFIG[k]) { CONFIG[k] = b[k]; changed.push(k); }
      }
      if (changed.length) {
        saveConfig();
        audit(admin, '保存审核开关', '', changed.join(', '));
      }
      return send(res, 200, { ok: true, settings: publicSettings(), changed });
    }

    if (pathname === '/api/admin/all' && m === 'GET') {
      return send(res, 200, {
        ok: true,
        people: q.allPeople.all(),
        messages: q.allMsgs.all(),
        requests: q.listRequests.all(),
        comments: q.allComments.all(),
        settings: publicSettings(),
        stats: {
          people: q.countPeople.get().c,
          messages: q.countMsgs.get().c,
          comments: q.countComments.get().c,
          pendingPeople: q.countPendingPeople.get().c,
          pendingRequests: q.countPendingRequests.get().c,
          pendingComments: q.countPendingComments.get().c,
        },
      });
    }

    // ---- 词条：管理员直接新增 / 编辑
    if (pathname === '/api/admin/people' && m === 'POST') {
      const b = await readBody(req);
      const name = clip(b.name, 40);
      const note = clip(b.note, 1200);
      const category = clip(b.category, 10);
      if (!name) return send(res, 400, { ok: false, error: '名字不能空' });
      if (!note) return send(res, 400, { ok: false, error: '内容不能空' });
      if (!CATEGORIES.includes(category)) return send(res, 400, { ok: false, error: '分类不合法' });
      const now = Date.now();
      const r = q.insert.run(name, category, note, 'published', now, 'admin');
      audit(admin, '新增词条', name, category);
      return send(res, 200, {
        ok: true,
        item: { id: Number(r.lastInsertRowid), name, category, note, status: 'published', created_at: now },
      });
    }

    let ep = pathname.match(/^\/api\/admin\/people\/(\d+)$/);
    if (ep && m === 'POST') {
      const id = Number(ep[1]);
      const b = await readBody(req);
      const row = q.getPerson.get(id);
      if (!row) return send(res, 404, { ok: false, error: '没有这条' });
      const name = b.name === undefined ? row.name : clip(b.name, 40);
      const note = b.note === undefined ? row.note : clip(b.note, 1200);
      const category = b.category === undefined ? row.category : clip(b.category, 10);
      if (!name) return send(res, 400, { ok: false, error: '名字不能空' });
      if (!note) return send(res, 400, { ok: false, error: '内容不能空' });
      if (!CATEGORIES.includes(category)) return send(res, 400, { ok: false, error: '分类不合法' });
      q.updatePerson.run(name, category, note, Date.now(), id);
      audit(admin, '编辑词条', '#' + id + ' ' + name);
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/people-review' && m === 'POST') {
      const b = await readBody(req);
      const id = Number(b.id);
      const action = String(b.action || '');
      const row = q.getPerson.get(id);
      if (!row) return send(res, 404, { ok: false, error: '没有这条' });
      if (row.status !== 'pending') return send(res, 409, { ok: false, error: '这条不在待审核状态' });
      if (action === 'approve') { q.setStatus.run('published', Date.now(), id); audit(admin, '通过词条', '#' + id + ' ' + row.name); return send(res, 200, { ok: true }); }
      if (action === 'reject') { q.setStatus.run('rejected', Date.now(), id); audit(admin, '驳回词条', '#' + id + ' ' + row.name); return send(res, 200, { ok: true }); }
      return send(res, 400, { ok: false, error: 'action 只能是 approve / reject' });
    }

    if (pathname === '/api/admin/people-hide' && m === 'POST') {
      const b = await readBody(req);
      const id = Number(b.id);
      const row = q.getPerson.get(id);
      if (!row) return send(res, 404, { ok: false, error: '没有这条' });
      q.setStatus.run('hidden', Date.now(), id);
      audit(admin, '下架词条', '#' + id + ' ' + row.name);
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/delete-review' && m === 'POST') {
      const b = await readBody(req);
      const id = Number(b.id);
      const action = String(b.action || '');
      const reqRow = q.getRequest.get(id);
      if (!reqRow) return send(res, 404, { ok: false, error: '没有这条申请' });
      if (reqRow.status !== 'pending') return send(res, 409, { ok: false, error: '这条申请已处理过' });
      const now = Date.now();
      if (action === 'approve') {
        q.setStatus.run('deleted', now, Number(reqRow.target_id));
        q.decideRequest.run('approved', now, id);
        audit(admin, '批准删除词条', '#' + reqRow.target_id);
        return send(res, 200, { ok: true });
      }
      if (action === 'reject') {
        q.decideRequest.run('rejected', now, id);
        audit(admin, '驳回删除申请', '#' + reqRow.target_id);
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { ok: false, error: 'action 只能是 approve / reject' });
    }

    // ---- 留言 / 词条留言
    if (pathname === '/api/admin/message-delete' && m === 'POST') {
      const { id } = await readBody(req);
      q.delMsg.run(Number(id));
      audit(admin, '隐藏留言', '#' + id);
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/comment' && m === 'POST') {
      const b = await readBody(req);
      const id = Number(b.id);
      const action = String(b.action || '');
      const LABEL = { approve: '通过评论', reject: '驳回评论', hide: '隐藏评论' };
      const NEXT = { approve: 'published', reject: 'rejected', hide: 'deleted' };
      if (NEXT[action]) {
        q.setCommentStatus.run(NEXT[action], id);
        audit(admin, LABEL[action], '#' + id);
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { ok: false, error: 'action 只能是 approve / reject / hide' });
    }

    // ---- 正文编辑
    if (pathname === '/api/admin/pages' && m === 'GET') {
      const saved = new Map(q.allContent.all().map((r) => [r.page, r.updated_at]));
      return send(res, 200, {
        ok: true,
        pages: PAGES.map((p) => ({ page: p.page, path: p.path, edited: saved.has(p.page), updatedAt: saved.get(p.page) || 0 })),
      });
    }

    let cp = pathname.match(/^\/api\/admin\/content\/([\w.-]+)$/);
    if (cp) {
      const page = cp[1];
      if (!PAGE_MAP.has(page)) return send(res, 404, { ok: false, error: '不是可编辑页面' });
      if (m === 'GET') {
        const row = q.getContent.get(page);
        return send(res, 200, {
          ok: true, page,
          html: row ? row.html : '',
          updatedAt: row ? row.updated_at : 0,
          history: q.listHistory.all(page),
        });
      }
      if (m === 'POST') {
        const b = await readBody(req);
        if (typeof b.html !== 'string') return send(res, 400, { ok: false, error: 'html 必须是字符串' });
        const now = Date.now();
        const prev = q.getContent.get(page);
        if (prev) q.pushHistory.run(page, prev.html, now);   // 保存前留一版旧的
        q.putContent.run(page, b.html, now);
        q.trimHistory.run(page, page);
        audit(admin, '保存正文', page, b.html.length + ' 字符');
        return send(res, 200, { ok: true, page, updatedAt: now });
      }
    }

    if (pathname === '/api/admin/content-reset' && m === 'POST') {
      const b = await readBody(req);
      const page = clip(b.page, 60);
      if (!PAGE_MAP.has(page)) return send(res, 404, { ok: false, error: '不是可编辑页面' });
      const prev = q.getContent.get(page);
      if (prev) q.pushHistory.run(page, prev.html, Date.now());
      q.delContent.run(page);
      audit(admin, '恢复正文默认', page);
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/content-history' && m === 'POST') {
      const b = await readBody(req);
      const id = Number(b.id);
      const row = q.getHistory.get(id);
      if (!row) return send(res, 404, { ok: false, error: '没有这版历史' });
      const now = Date.now();
      const cur = q.getContent.get(row.page);
      if (cur) q.pushHistory.run(row.page, cur.html, now);
      q.putContent.run(row.page, row.html, now);
      audit(admin, '回滚正文', row.page, new Date(row.saved_at).toLocaleString());
      return send(res, 200, { ok: true, page: row.page });
    }

    if (pathname === '/api/admin/restore' && m === 'POST') {
      const { id } = await readBody(req);
      q.restore.run(Date.now(), Number(id));
      audit(admin, '恢复为在线', '#' + id);
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/purge' && m === 'POST') {
      const { id, type } = await readBody(req);
      if (type === 'message') q.purgeMsg.run(Number(id));
      else if (type === 'comment') q.purgeComment.run(Number(id));
      else q.purge.run(Number(id));
      audit(admin, '彻底删除', (type || 'person') + ' #' + id);
      return send(res, 200, { ok: true });
    }

    // ---- 多管理员令牌
    if (pathname === '/api/admin/tokens' && m === 'GET') {
      return send(res, 200, {
        ok: true,
        me: admin.id,
        tokens: CONFIG.adminTokens.map((a) => ({
          id: a.id,
          name: a.name,
          hint: String(a.token).slice(0, 6) + '…' + String(a.token).slice(-4),
          createdAt: a.createdAt || 0,
          lastUsedAt: a.lastUsedAt || 0,
          self: a.id === admin.id,
        })),
      });
    }

    if (pathname === '/api/admin/tokens' && m === 'POST') {
      const b = await readBody(req);
      const name = clip(b.name, 20);
      if (!name) return send(res, 400, { ok: false, error: '给这个人起个名字' });
      if (CONFIG.adminTokens.some((a) => a.name === name)) {
        return send(res, 409, { ok: false, error: '已经有同名管理员了' });
      }
      const id = 'a' + Date.now().toString(36);
      const token = newToken();
      CONFIG.adminTokens.push({ id, name, token, createdAt: Date.now(), lastUsedAt: 0 });
      saveConfig();
      audit(admin, '新增管理员', name);
      return send(res, 200, { ok: true, id, name, token });
    }

    if (pathname === '/api/admin/tokens/revoke' && m === 'POST') {
      const b = await readBody(req);
      const id = clip(b.id, 40);
      if (id === admin.id) return send(res, 400, { ok: false, error: '不能吊销自己正在用的这把' });
      const idx = CONFIG.adminTokens.findIndex((a) => a.id === id);
      if (idx < 0) return send(res, 404, { ok: false, error: '没有这个管理员' });
      const gone = CONFIG.adminTokens.splice(idx, 1)[0];
      saveConfig();
      audit(admin, '吊销管理员', gone.name);
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/audit' && m === 'GET') {
      return send(res, 200, { ok: true, items: q.listAudit.all() });
    }

    if (pathname === '/api/admin/snapshot' && m === 'POST') {
      const out = { exportedAt: new Date().toISOString(), people: q.listPublished.all() };
      fs.writeFileSync(path.join(DATA_DIR, 'people.json'), JSON.stringify(out, null, 2), 'utf8');
      return send(res, 200, { ok: true, path: 'data/people.json', count: out.people.length });
    }

    return send(res, 404, { ok: false, error: 'no such admin route' });
  }

  return send(res, 404, { ok: false, error: 'no such api' });
}

// ---------------------------------------------------------------- 启动
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname.startsWith('/api/')) {
    api(req, res, pathname).catch((e) => {
      console.error('[api]', e && e.message);
      if (!res.headersSent) send(res, 500, { ok: false, error: '服务器内部错误' });
    });
    return;
  }
  const legacyTarget = LEGACY_STATIC_REDIRECTS[pathname];
  if (legacyTarget) {
    res.writeHead(301, {
      Location: legacyTarget + new URL(req.url, 'http://x').search,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end();
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log('');
  console.log('  My Confession 已启动（SQLite）');
  console.log('  站点   : http://' + shown + ':' + PORT + '/');
  console.log('  审核台 : http://' + shown + ':' + PORT + '/' + ADMIN_PAGE);
  console.log('  正文编辑: http://' + shown + ':' + PORT + '/' + EDITOR_PAGE);
  console.log('  口令   : ' + CONFIG.adminToken);
  console.log('  词条审核 : ' + (CONFIG.peopleModerated ? '开' : '关') +
              '   留言审核 : ' + (CONFIG.messagesModerated ? '开' : '关') +
              '   评论审核 : ' + (CONFIG.commentsModerated ? '开' : '关'));
  console.log('  数据库 : data/app.db');
  console.log('');
});
