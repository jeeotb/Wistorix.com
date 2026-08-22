#!/usr/bin/env node
/*
 * Site Content Editor - local server
 * Serves the folder it lives in and exposes a tiny save API so the editor
 * can write text/image changes straight back to the HTML files on disk.
 * No dependencies. Works with any static website folder.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Cau truc thu muc (tu 27/07/2026):
//   qranty-landing/
//     public/   <- website that, editor sua file trong day
//     admin/    <- file nay + editor.html + start.bat
const ADMIN = __dirname;
const ROOT = path.resolve(__dirname, '..', 'public');   // thu muc website
const SELF = new Set(['server.js', 'editor.html', 'start.bat', 'start.command', 'HUONG-DAN.txt']);
const BACKUP_DIR = path.resolve(__dirname, '..', '_editor_backup');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8'
};

// Keep every write inside ROOT (block path traversal / absolute escapes).
function safeResolve(rel) {
  const clean = decodeURIComponent(String(rel || '')).replace(/^[\\/]+/, '');
  const abs = path.resolve(ROOT, clean);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

const ASSET_DIRS = new Set(['images', 'img', 'assets', 'css', 'js', 'fonts', 'media', 'vendor', 'static', '_editor_backup', 'node_modules', '.git', '.vercel']);
// File tam / backup KHONG hien trong danh sach sua (giu editor gon, chi con trang that da dich).
// Vd: index.aeline-backup.html, editor.html.bak-2026..., abc-backup.html, page.old.html
function isBackupName(name) {
  const n = String(name).toLowerCase();
  return /\.bak(\b|-|\.)|-backup|\.backup\b|\.aeline-backup\.|\.orig\b|\.old\b|~$/.test(n)
      || /(^|[._-])backup([._-]|$)/.test(n);
}
function listHtmlFiles(dir, base = '') {
  let out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    // Bo qua: thu muc/file an (.git...), va MOI thu bat dau bang "_"
    // (ban tieng Anh _aeline_en, thu muc _to_delete, _backup_svg..., _editor_backup), va thu muc asset.
    if (e.name.startsWith('.') || e.name.startsWith('_') || ASSET_DIRS.has(e.name.toLowerCase())) continue;
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) {
      // shallow: one sub-level deep is plenty for typical exported sites (skips asset dirs)
      if (base.split('/').length < 2) out = out.concat(listHtmlFiles(path.join(dir, e.name), rel));
    } else if (/\.html?$/i.test(e.name) && !SELF.has(e.name) && !isBackupName(e.name)) {
      out.push(rel);
    }
  }
  return out.sort();
}

function backupOnce(absFile, rel) {
  try {
    const dest = path.join(BACKUP_DIR, rel);
    if (fs.existsSync(dest)) return;              // already backed up this file
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(absFile, dest);
  } catch (e) { /* non-fatal */ }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 80 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // ---- API ----
  if (pathname === '/__api/list') {
    return sendJson(res, 200, { root: path.basename(ROOT), files: listHtmlFiles(ROOT) });
  }

  // Do xem blog-server.js dang chay o cong nao (8899..8903) de nut "Blog SEO" mo dung tab.
  if (pathname === '/__api/blog-url') {
    const ports = [8899, 8900, 8901, 8902, 8903];
    const probe = (port) => new Promise(resolve => {
      const r = http.get({ host: '127.0.0.1', port, path: '/blog-admin.html', timeout: 400 }, res2 => {
        res2.resume();
        resolve(res2.statusCode === 200 ? port : null);
      });
      r.on('timeout', () => { r.destroy(); resolve(null); });
      r.on('error', () => resolve(null));
    });
    return Promise.all(ports.map(probe)).then(found => {
      const port = found.find(Boolean);
      sendJson(res, 200, port
        ? { ok: true, url: 'http://localhost:' + port + '/blog-admin.html', port }
        : { ok: false, error: 'Chua thay blog-server.js dang chay' });
    });
  }

  if (pathname === '/__api/save' && req.method === 'POST') {
    try {
      const { file, html } = JSON.parse(await readBody(req));
      if (!file || typeof html !== 'string' || !/\.html?$/i.test(file) || SELF.has(path.basename(file)))
        return sendJson(res, 400, { error: 'invalid file' });
      const abs = safeResolve(file);
      if (!abs) return sendJson(res, 400, { error: 'path outside project' });
      if (fs.existsSync(abs)) backupOnce(abs, file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, html, 'utf8');
      return sendJson(res, 200, { ok: true, file });
    } catch (e) { return sendJson(res, 500, { error: String(e && e.message || e) }); }
  }

  if (pathname === '/__api/save-image' && req.method === 'POST') {
    try {
      const { name, dataBase64, subdir } = JSON.parse(await readBody(req));
      const b64 = String(dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
      const safeName = String(name || 'image').replace(/[^A-Za-z0-9._-]/g, '_');
      // images/ duoc chia theo trang -> khoi (xem README muc 3).
      // Anh moi tai len tu editor roi vao ngan cho, tu sap xep sau.
      const folder = (subdir && /^(images|assets|img|fonts|media)$/i.test(subdir)) ? subdir : 'images/_moi';
      const rel = folder + '/' + Date.now() + '_' + safeName;
      const abs = safeResolve(rel);
      if (!abs) return sendJson(res, 400, { error: 'bad path' });
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
      return sendJson(res, 200, { ok: true, path: rel });
    } catch (e) { return sendJson(res, 500, { error: String(e && e.message || e) }); }
  }

  // ---- static files ----
  let rel = pathname === '/' ? 'editor.html' : pathname;
  // Giao dien editor nam trong admin/, moi thu con lai lay tu public/
  const abs = /^\/?editor\.html$/.test(rel)
    ? path.join(ADMIN, 'editor.html')
    : safeResolve(rel);
  if (!abs) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found: ' + rel); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(abs).pipe(res);
  });
});

// Try a range of ports so it always starts.
const PORTS = [8787, 8788, 8789, 8790, 8791];
(function tryListen(i) {
  if (i >= PORTS.length) { console.error('No free port found in', PORTS.join(', ')); process.exit(1); }
  const port = PORTS[i];
  server.once('error', e => { if (e.code === 'EADDRINUSE') tryListen(i + 1); else { console.error(e); process.exit(1); } });
  server.listen(port, '127.0.0.1', () => {
    const link = 'http://localhost:' + port + '/editor.html';
    console.log('\n  Site Editor dang chay:  ' + link);
    console.log('  Thu muc:                ' + ROOT);
    console.log('  (Nhan Ctrl+C de tat)\n');
  });
})(0);
