/* Gộp bản clone thành MỘT file HTML chạy được không cần máy chủ.
   Chạy: node build-single.js   →   wistorix-demo.html            */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.join(__dirname, 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8');
const esc  = s => s.replace(/<\/script>/gi, '<\\/script>');

/* ảnh nhỏ → data URI để mở bằng file:// vẫn thấy */
const dataUri = (rel) => {
  const abs = path.join(APP, rel);
  if (!fs.existsSync(abs)) return null;
  const ext = path.extname(rel).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
  return 'data:' + mime + ';base64,' + fs.readFileSync(abs).toString('base64');
};

const inlineAssets = (text) => text.replace(/(["'(])(assets\/[A-Za-z0-9/._-]+)(["')])/g, (m, a, rel, b) => {
  const uri = dataUri(rel);
  return uri ? a + uri + b : m;
});

/* 1 · gộp dashboard.js và toàn bộ module thành một script thường */
const entry = path.join(APP, '.bundle-entry.js');
fs.writeFileSync(entry, `
import './dashboard.js';
import * as mydrive from './mydrive.js';
import * as emailShared from './email-shared.js';
import * as settings from './settings.js';
import * as invite from './invite.js';
import * as upgrade from './upgrade.js';
window.__WIX_CTRL = { mydrive, 'email-shared': emailShared, settings, invite, upgrade };
`);
const tmp = path.join(__dirname, '.bundle.tmp.js');
execFileSync('esbuild', [
  entry,
  '--bundle', '--format=iife', '--target=chrome110',
  '--loader:.js=js', '--outfile=' + tmp, '--log-level=warning',
], { stdio: 'inherit' });
let bundle = fs.readFileSync(tmp, 'utf8');
bundle = bundle.replace(/(["'])(assets\/[A-Za-z0-9\/._-]+\.(?:png|jpg|jpeg|svg|gif|webp))(["'])/g,
  (m, a, rel, b) => { const u = dataUri(rel); return u ? a + u + b : m; });
fs.unlinkSync(tmp); fs.unlinkSync(entry);

/* 1b · toàn bộ assets vào một bản đồ: .json/.svg giữ dạng chữ, còn lại thành data URI */
const ASSETS = {};
(function walk(dir) {
  const abs = path.join(APP, dir);
  if (!fs.existsSync(abs)) return;
  for (const f of fs.readdirSync(abs)) {
    const rel = dir + '/' + f;
    const st = fs.statSync(path.join(APP, rel));
    if (st.isDirectory()) { walk(rel); continue; }
    const ext = path.extname(f).toLowerCase();
    ASSETS[rel] = (ext === '.json' || ext === '.svg')
      ? fs.readFileSync(path.join(APP, rel), 'utf8')
      : dataUri(rel);
  }
})('assets');

/* 2 · nạp sẵn các mảnh trang, khỏi phải fetch */
const PAGES = {};
for (const f of fs.readdirSync(path.join(APP, 'pages'))) {
  if (f.endsWith('.html')) PAGES['pages/' + f] = inlineAssets(read('pages/' + f));
}

/* 3 · khung HTML gốc, bỏ các thẻ script/link cục bộ rồi nhét bản gộp vào */
let html = read('dashboard.html');

/* lấy đúng thứ tự các script trong __mock/ từ chính dashboard.html,
   thêm file mới vào đó là bản gộp tự có, khỏi sửa script này */
const MOCK_FILES = [...html.matchAll(/<script src="(__mock\/[^"]+)"><\/script>/g)].map(m => m[1]);

const grab = re => { const m = html.match(re); return m ? m[0] : ''; };

const FONT_DIR = '/home/claude/fonts';
const b64 = (f) => fs.readFileSync(f).toString('base64');
const woff2 = (f) => 'data:font/woff2;base64,' + b64(f);

/* Font Awesome: css gốc, đổi url(webfonts/...) sang data URI */
let faCss = fs.readFileSync(FONT_DIR + '/fa/package/css/all.min.css', 'utf8');
faCss = faCss.replace(/url\(["']?\.\.\/webfonts\/([\w.-]+?)(\?[^)"']*)?["']?\)\s*format\(["']([\w-]+)["']\)/g,
  (m, file, q, fmt) => {
    const abs = FONT_DIR + '/fa/package/webfonts/' + file;
    if (!fs.existsSync(abs) || fmt !== 'woff2') return 'url(about:blank) format("' + fmt + '")';
    return 'url(' + woff2(abs) + ') format("woff2")';
  });

/* Manrope: chỉ lấy woff2, hai bộ latin và vietnamese, các độ đậm đang dùng */
const mpDir = FONT_DIR + '/mp/package/files';
const manropeCss = [300, 400, 500, 600, 700, 800].flatMap(w =>
  ['latin', 'vietnamese'].map(sub => {
    const f = mpDir + '/manrope-' + sub + '-' + w + '-normal.woff2';
    if (!fs.existsSync(f)) return '';
    return '@font-face{font-family:Manrope;font-style:normal;font-weight:' + w +
           ';font-display:swap;src:url(' + woff2(f) + ') format("woff2")}';
  })).filter(Boolean).join('\n');

html = html
  .replace(/<link href="https:\/\/cdnjs\.cloudflare\.com[^>]*>\s*/g, '')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g, '')
  .replace(/<script src="__mock\/[^"]+"><\/script>\s*/g, '')
  .replace(/<link rel="stylesheet" href="dashboard\.css">\s*/g, '')
  .replace(/<link rel="icon"[^>]*>\s*/g, '')
  .replace(/<script src="(dashboard-init|sidebar-toggle|app-state|app-router)\.js"><\/script>\s*/g, '')
  .replace(/<script src="libs\/[^"]+"><\/script>\s*/g, '')
  .replace(/<script type="module" src="dashboard\.js"><\/script>\s*/g, '');

// popup.css chỉ dành cho cửa sổ popup nhỏ của extension, nhúng vào đây sẽ bóp hẹp layout
const CSS_SKIP = new Set(['popup.css']);
const CSS_FILES = fs.readdirSync(APP).filter(f => f.endsWith('.css') && !CSS_SKIP.has(f));
const inlineCss  = '<style>\n' + manropeCss + '\n' + faCss + '\n</style>\n<style>\n' + CSS_FILES.map(f => '/* ' + f + ' */\n' + inlineAssets(read(f)).replace(/@import\s+url\((['\"]?)https:\/\/fonts\.googleapis\.com[^)]*\1\);?/g, '')).join('\n\n') + '\n</style>';
const localLibs  = ['libs/lottie.min.js', 'libs/qrcode.min.js']
  .map(f => '<script>' + esc(read(f)) + '</script>').join('\n');
const appScripts = ['dashboard-init.js', 'sidebar-toggle.js', 'app-state.js', 'app-router.js']
  .map(f => {
    let src = read(f);
    if (f === 'app-router.js') {
      // controller: dùng bản đã gộp thay cho import động
      src = src.replace(/\(\)\s*=>\s*import\('\.\/([\w-]+)\.js'\)/g,
        (_, name) => "() => Promise.resolve((window.__WIX_CTRL || {})['" + name + "'] || null)");
      // css của fragment đã nhúng sẵn, khỏi tải thêm
      src = src.replace('function ensureStylesheet(path) {',
                        'function ensureStylesheet(path) { return Promise.resolve();');
    }
    return '<script>' + esc(src) + '</script>';
  }).join('\n');
const mockScripts = MOCK_FILES
  .map(f => '<script>' + esc(read(f)) + '</script>').join('\n');

/* 4 · lớp đệm: phục vụ mảnh trang từ bộ nhớ, và IndexedDB giả khi mở bằng file:// */
const shim = `<script>
(function () {
  window.__WIX_PAGES  = ${JSON.stringify(PAGES)};
  window.__WIX_ASSETS = ${JSON.stringify(ASSETS)};

  const findKey = (url, map) => Object.keys(map).find(k => String(url).indexOf(k) !== -1);

  /* mảnh trang: trả thẳng từ bộ nhớ thay vì tải qua mạng */
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const pageKey = findKey(url, window.__WIX_PAGES);
    if (pageKey) {
      return Promise.resolve(new Response(window.__WIX_PAGES[pageKey], {
        status: 200, headers: { 'Content-Type': 'text/html' }
      }));
    }
    const assetKey = findKey(url, window.__WIX_ASSETS);
    if (assetKey) {
      const body = window.__WIX_ASSETS[assetKey];
      const type = assetKey.endsWith('.json') ? 'application/json'
                 : assetKey.endsWith('.svg')  ? 'image/svg+xml' : 'text/plain';
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': type } }));
    }
    if (!realFetch) return Promise.reject(new Error('fetch không khả dụng'));
    return realFetch(input, init);
  };

  /* lottie và vài thư viện dùng XMLHttpRequest chứ không dùng fetch */
  const RealXHR = window.XMLHttpRequest;
  if (RealXHR) {
    window.XMLHttpRequest = function () {
      const xhr = new RealXHR();
      const open = xhr.open, send = xhr.send;
      let hit = null;
      xhr.open = function (m, u) {
        hit = findKey(u, window.__WIX_ASSETS);
        if (hit) return;
        return open.apply(xhr, arguments);
      };
      xhr.send = function () {
        if (!hit) return send.apply(xhr, arguments);
        const body = window.__WIX_ASSETS[hit];
        setTimeout(function () {
          try {
            Object.defineProperty(xhr, 'readyState',   { value: 4, configurable: true });
            Object.defineProperty(xhr, 'status',       { value: 200, configurable: true });
            Object.defineProperty(xhr, 'responseText', { value: body, configurable: true });
            Object.defineProperty(xhr, 'response',     { value: body, configurable: true });
          } catch (e) {}
          xhr.onreadystatechange && xhr.onreadystatechange();
          xhr.onload && xhr.onload();
        }, 0);
      };
      return xhr;
    };
  }

  /* mở bằng file:// thì trình duyệt khoá IndexedDB, dựng bản giả trong bộ nhớ */
  let idbOk = true;
  try { if (!window.indexedDB) idbOk = false; } catch (e) { idbOk = false; }
  if (location.protocol === 'file:') idbOk = false;
  if (!idbOk) {
    const mem = {};
    const later = (fn) => setTimeout(fn, 0);
    const req = (getResult) => {
      const r = { onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined };
      later(() => { try { r.result = getResult(r); } catch (e) {} r.onsuccess && r.onsuccess({ target: r }); });
      return r;
    };
    function store(name) {
      mem[name] = mem[name] || {};
      const rows = mem[name];
      return {
        put:    v => req(() => { rows[v && v._cacheKey] = v; }),
        add:    v => req(() => { rows[v && v._cacheKey] = v; }),
        get:    k => req(() => rows[k]),
        delete: k => req(() => { delete rows[k]; }),
        clear:  () => req(() => { for (const k in rows) delete rows[k]; }),
        getAll: () => req(() => Object.values(rows)),
        index:  () => ({ getAll: () => req(() => Object.values(rows)),
                         openCursor: () => req(() => null) }),
        openCursor: () => req(() => null),
        createIndex: () => {},
      };
    }
    const db = {
      objectStoreNames: { contains: n => !!mem[n], length: 1, item: () => 'filesByAccount' },
      createObjectStore: n => { mem[n] = mem[n] || {}; return store(n); },
      deleteObjectStore: n => { delete mem[n]; },
      transaction: () => ({ objectStore: store, oncomplete: null, onerror: null, done: Promise.resolve() }),
      close: () => {},
    };
    window.indexedDB = {
      open: () => {
        const r = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
        later(() => {
          r.onupgradeneeded && r.onupgradeneeded({ target: r, oldVersion: 0 });
          r.onsuccess && r.onsuccess({ target: r });
        });
        return r;
      },
      deleteDatabase: () => { for (const k in mem) delete mem[k]; return req(() => undefined); },
    };
    console.info('[wistorix-demo] Đang chạy từ file://, dùng IndexedDB giả trong bộ nhớ.');
  }
})();
</script>`;

const banner = `<!-- Wistorix · bản demo một file, dựng từ extension-clone-3.3.56
     Dữ liệu là giả lập, không kết nối Google Drive thật.
     Dựng lại bằng: node build-single.js -->`;

html = html
  .replace('</head>', inlineCss + '\n' + shim + '\n' + mockScripts + '\n</head>')
  .replace('</body>', localLibs + '\n' + appScripts + '\n<script>' + esc(bundle) + '</script>\n</body>')
  .replace('<html', banner + '\n<html');

html = inlineAssets(html);
const out = path.join(__dirname, 'wistorix-demo.html');
fs.writeFileSync(out, html);
console.log('xong:', out, '·', (fs.statSync(out).size / 1024).toFixed(0), 'KB');
