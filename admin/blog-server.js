#!/usr/bin/env node
/*
 * =====================================================================
 *  QRANTY BLOG ADMIN — local server
 * =====================================================================
 *  Chạy ngay trong thư mục website tĩnh (qranty-landing).
 *  Không cần cài package nào — chỉ cần Node.js.
 *
 *  Nhiệm vụ:
 *   - Quét các file qranty-blog-*.html có sẵn thành blog-posts.json
 *   - CRUD bài viết qua API cho blog-admin.html
 *   - Sinh lại file .html của từng bài từ blog-post-template.html
 *   - Cập nhật lưới bài viết trong qranty-blog.html
 *   - Lưu ảnh upload vào images/
 *
 *  Mở: http://localhost:8899/blog-admin.html
 * =====================================================================
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// Cau truc thu muc (tu 27/07/2026):
//   qranty-landing/
//     public/   <- website that, deploy len Vercel
//     admin/    <- file nay + blog-admin.html + template + blog-posts.json
const ADMIN = __dirname;
const ROOT = path.resolve(__dirname, '..', 'public');   // thu muc website

/* =====================================================================
   TU NHAN DIEN CAU HINH BLOG THEO THU MUC public/
   ---------------------------------------------------------------------
   Cong cu nay dung cho nhieu site clone khac nhau, moi site dat ten
   bai viet mot kieu:
       qranty-blog.html  +  qranty-blog-<slug>.html      (dau '-')
       blog.html         +  blog__<slug>.html            (dau '__')
   Ham duoi tu tim "ho" nao co nhieu trang con nhat va co ten kieu blog
   de suy ra: trang danh sach, tien to slug, bo loc file bai viet.
   Khong tim thay gi -> quay ve mac dinh Qranty nhu truoc.
   ===================================================================== */
const BLOGISH = /(^|[-_])(blog|news|article|post|insight|resource|cam-nang|tin-tuc)([-_]|$)/i;
function detectBlogSite(root) {
  const fallback = { key: 'qranty-blog', listFile: 'qranty-blog.html', sep: '-', slugPrefix: 'qranty-blog-', detected: false };
  let files = [];
  try { files = fs.readdirSync(root).filter(f => /\.html?$/i.test(f)); } catch (e) { return fallback; }
  if (!files.length) return fallback;
  const stems = files.map(f => f.replace(/\.html?$/i, ''));
  const lower = stems.map(s => s.toLowerCase());
  const cand = [];
  for (const stem of stems) {
    for (const sep of ['__', '-']) {
      const pre = (stem + sep).toLowerCase();
      const n = lower.filter(s => s !== stem.toLowerCase() && s.startsWith(pre)).length;
      if (n >= 2) cand.push({ stem, sep, n, score: n + (BLOGISH.test(stem) ? 100 : 0) });
    }
  }
  if (!cand.length) return fallback;
  cand.sort((a, b) => b.score - a.score || b.stem.length - a.stem.length || a.stem.localeCompare(b.stem));
  const best = cand[0];
  return { key: best.stem, listFile: best.stem + '.html', sep: best.sep, slugPrefix: best.stem + best.sep, detected: true };
}
const SITE = detectBlogSite(ROOT);
// Moi site mot kho du lieu rieng -> bai cua site nay khong lan sang site kia.
const DATA_FILE = path.join(ADMIN, SITE.key === 'qranty-blog' ? 'blog-posts.json' : 'blog-posts.' + SITE.key + '.json');
const LIST_PAGE = path.join(ROOT, SITE.listFile);
const POST_RE = new RegExp('^' + SITE.slugPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.+\\.html$', 'i');
const BACKUP_DIR = path.resolve(__dirname, '..', '_blog_backup');

/* =====================================================================
   PROFILE GIAO DIEN  —  moi bo template website mot cach dat markup khac
   nhau, nen phan "doc bai co san" va "dung the bai" duoc tach ra day.
     qranty : template blog goc cua Qranty (class blog-single-*)
     aeline : ban export Webflow cua template Aeline / Wistorix
              (section sec_internal-blog + sec_internal-content, luoi
               content-blog_wrap, the blog_card)
   Them site moi = them 1 profile o duoi, khong dung vao phan con lai.
   ===================================================================== */
const AE_GRID_WID = '64f8b3e2-b39c-d5c3-7361-c0fb18ecc746';   // id interaction cua the trong luoi (giu hieu ung scroll)
const AE_REL_WID = '4b442626-95bc-af95-997c-b1ad29a69069';    // id interaction cua the "bai lien quan"
const AE_ARROW = '<div class="arrow_button_container"><svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 20 20" fill="none" class="arrow_btn"><path d="M13.0457 8.13128L5.8733 15.3037L4.69479 14.1252L11.8672 6.95277L5.54568 6.95277L5.54568 5.28636H14.7121V14.4528L13.0457 14.4528V8.13128Z" fill="currentColor"></path></svg></div>';
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function isoToEn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return EN_MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
}
function enToIso(s) {
  const m = /^\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(String(s || ''));
  if (!m) return '';
  const i = EN_MONTHS.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  if (i < 0) return '';
  return m[3] + '-' + String(i + 1).padStart(2, '0') + '-' + String(+m[2]).padStart(2, '0');
}

const PROFILES = {
  qranty: {
    id: 'qranty',
    label: 'Qranty (template blog-single-*)',
    postMarker: 'blog-single-details',
    templateFile: 'blog-post-template.html',
    formatDate: isoToVn,
    relatedCount: 2,
    defaults: {},
    // doc the bai tu trang danh sach
    readCards(html) {
      const out = {};
      const re = /<div class="single-blog-wrap">([\s\S]*?)<\/div><\/div><\/div>/g;
      let m;
      while ((m = re.exec(html))) {
        const card = m[1];
        const file = pick(/<a href="([^"]+\.html)"/i, card);
        if (!file) continue;
        out[file] = {
          cover: pick(/<img src="([^"]+)"[^>]*class="blog-image"/i, card),
          coverAlt: decodeEntities(pick(/<img[^>]*class="blog-image"[^>]*alt="([^"]*)"/i, card)),
          category: decodeEntities(pick(/<div class="blog-categorie">([^<]*)<\/div>/i, card)),
          date: vnToIso(pick(/<div class="blog-date">([^<]*)<\/div>/i, card)),
          excerpt: decodeEntities(stripTags(pick(/<p class="blog-details">([\s\S]*?)<\/p>/i, card)))
        };
      }
      return out;
    },
    parsePost(html, card) {
      const seoTitle = decodeEntities(pick(/<title>([\s\S]*?)<\/title>/i, html));
      return {
        seoTitle,
        metaDescription: decodeEntities(pick(/<meta content="([^"]*)"\s+name="description">/i, html)),
        h1: decodeEntities(stripTags(pick(/<h1 class="blog-single-name">([\s\S]*?)<\/h1>/i, html))) ||
            seoTitle.replace(/\s*-\s*Qranty\s*$/i, ''),
        category: decodeEntities(pick(/<div class="blog-single-categorie-name">([^<]*)<\/div>/i, html)) || card.category || '',
        author: decodeEntities(pick(/<div class="blog-author-name">([^<]*)<\/div>/i, html)),
        authorRole: decodeEntities(pick(/<div class="blog-author-designation">([^<]*)<\/div>/i, html)),
        date: vnToIso(pick(/<div class="blog-single-date">([^<]*)<\/div>/i, html)) || card.date || '',
        coverImage: pick(/<img src="([^"]+)"[^>]*class="blog-single-image"/i, html) || card.cover || '',
        coverAlt: decodeEntities(pick(/<img[^>]*class="blog-single-image"[^>]*alt="([^"]*)"/i, html) ||
                                 pick(/<img[^>]*alt="([^"]*)"[^>]*class="blog-single-image"/i, html)) || card.coverAlt || '',
        excerpt: card.excerpt || '',
        content: extractBlock(html, 'div', 'blog-single-details').trim()
      };
    },
    grid(cards) { return '<div class="blog-grid" style="grid-template-columns:1fr 1fr 1fr;">' + cards + '</div>'; },
    listCard(p, settings) {
      const h = parseInt((settings && settings.cardHeight) || '', 10);
      const linkStyle = h ? ' style="height:' + h + 'px;"' : '';
      return '<div class="single-blog-wrap">'
        + '<a href="' + esc(p.file) + '" class="blog-image-link w-inline-block"' + linkStyle + '>'
        + '<img src="' + esc(p.coverImage) + '" loading="lazy" alt="' + esc(p.coverAlt) + '" class="blog-image"></a>'
        + '<div class="blog-contant"><div class="blog-categorie-date-wrap">'
        + '<div class="blog-categorie-wrap"><div class="blog-categorie">' + esc(p.category) + '</div></div>'
        + '<div class="blog-dot"></div>'
        + '<div class="blog-date-wrap"><div class="blog-date">' + esc(isoToVn(p.date)) + '</div></div></div>'
        + '<a href="' + esc(p.file) + '" class="blog-title-link w-inline-block">'
        + '<h3 class="blog-title">' + esc(p.h1) + '</h3></a>'
        + '<div class="blog-details-wrap"><p class="blog-details">' + esc(p.excerpt) + '</p></div>'
        + '</div></div>';
    },
    relatedCard(p, settings) {
      const h = parseInt((settings && settings.relatedHeight) || '', 10);
      const linkStyle = h ? ' style="height:' + h + 'px;"' : '';
      return '<div class="single-blog-post-wrap"><div class="blog-post-flex-wrap">'
        + '<a href="' + esc(p.file) + '" class="blog-post-image-link w-inline-block"' + linkStyle + '>'
        + '<img src="' + esc(p.coverImage) + '" loading="lazy" alt="' + esc(p.coverAlt) + '" class="blog-post-image"></a>'
        + '<div class="blog-post-contant"><div class="blog-categorie-date-wrap">'
        + '<div class="blog-categorie-wrap"><div class="blog-categorie">' + esc(p.category) + '</div></div>'
        + '<div class="blog-dot"></div>'
        + '<div class="blog-date-wrap"><div class="blog-date">' + esc(isoToVn(p.date)) + '</div></div></div>'
        + '<a href="' + esc(p.file) + '" class="blog-title-link mg-bottom-0px w-inline-block">'
        + '<h3 class="blog-title">' + esc(p.h1) + '</h3></a></div></div></div>';
    }
  },

  aeline: {
    id: 'aeline',
    label: 'Aeline / Wistorix (Webflow export)',
    postMarker: 'sec_internal-blog',
    templateFile: 'blog-post-template.aeline.html',
    formatDate: isoToEn,
    relatedCount: 3,
    defaults: {
      defaultAuthor: 'Wistorix', defaultAuthorRole: '', defaultCategory: 'Insight',
      titleSuffix: ' | Wistorix', categories: ['Insight', 'AI', 'Automation', 'Strategy', 'News'],
      orgName: 'Wistorix', orgDescription: '', orgLogo: '', orgSameAs: [],
      lang: 'en', aboutPage: 'about-us__about-us.html', blogName: 'Blog'
    },
    readCards(html) {
      const out = {};
      const wrap = extractBlock(html, 'div', 'content-blog_wrap');
      const re = /<a[^>]*href="([^"]+\.html)"[^>]*class="content-blog_card[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(wrap))) {
        const inner = m[2];
        out[m[1]] = {
          cover: pick(/<img[^>]*src="([^"]+)"/i, inner),
          coverAlt: decodeEntities(pick(/<img[^>]*alt="([^"]*)"/i, inner)),
          category: '',
          date: enToIso(stripTags(pick(/<div class="text-base text-color-secondary">([^<]*)<\/div>/i, inner))),
          excerpt: ''
        };
      }
      return out;
    },
    parsePost(html, card) {
      const seoTitle = decodeEntities(pick(/<title>([\s\S]*?)<\/title>/i, html));
      const metaDescription = decodeEntities(pick(/<meta content="([^"]*)"\s+name="description">/i, html));
      const hero = extractBlock(html, 'div', 'internal-blog_img');
      return {
        seoTitle,
        metaDescription,
        h1: decodeEntities(stripTags(pick(/<h1[^>]*class="h2[^"]*"[^>]*>([\s\S]*?)<\/h1>/i, html))) ||
            seoTitle.replace(/\s*[|\-–]\s*[^|\-–]{1,30}$/, ''),
        category: card.category || '',
        author: '',
        authorRole: '',
        date: enToIso(stripTags(pick(/<div[^>]*class="tag"[^>]*>[\s\S]*?<div>([^<]*)<\/div>/i, html))) || card.date || '',
        coverImage: pick(/<img[^>]*src="([^"]+)"/i, hero) || card.cover || '',
        coverAlt: decodeEntities(pick(/<img[^>]*alt="([^"]*)"/i, hero)) || card.coverAlt || '',
        excerpt: decodeEntities(stripTags(pick(/<div hero-text="" class="text-base text-color-secondary">([\s\S]*?)<\/div>/i, html))) || metaDescription,
        content: extractBlock(html, 'div', 'w-richtext').trim()
      };
    },
    // marker nam NGAY BEN TRONG <div class="content-blog_wrap"> nen khong boc them the
    grid(cards) { return cards; },
    listCard(p) {
      return '<div role="listitem" class="w-dyn-item">'
        + '<a data-w-id="' + AE_GRID_WID + '" href="' + esc(p.file) + '" class="content-blog_card scroll-right w-inline-block">'
        + '<div class="content-blog_card_img">'
        + '<img src="' + esc(p.coverImage) + '" loading="lazy" alt="' + esc(p.coverAlt) + '" class="img">'
        + AE_ARROW + '</div>'
        + '<div><div class="text-base text-color-secondary">' + esc(isoToEn(p.date)) + '</div>'
        + '<div class="spacer-xsmall"></div><h3>' + esc(p.h1) + '</h3></div></a></div>';
    },
    relatedCard(p) {
      return '<div role="listitem" class="w-dyn-item">'
        + '<a data-w-id="' + AE_REL_WID + '" href="' + esc(p.file) + '" class="blog_card scroll-right w-inline-block">'
        + '<img src="' + esc(p.coverImage) + '" loading="lazy" alt="' + esc(p.coverAlt) + '" class="img">'
        + '<div class="blur-card"></div><div class="blog_card-content"><div class="card-black-gradient"></div>'
        + '<h3 class="text-xl text-color-on-primary relative">' + esc(p.h1) + '</h3></div></a></div>';
    }
  }
};

function detectProfile() {
  let files = [];
  try { files = fs.readdirSync(ROOT).filter(f => POST_RE.test(f)); } catch (e) {}
  const ids = Object.keys(PROFILES);
  for (const f of files.slice(0, 12)) {
    let html = '';
    try { html = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }
    for (const id of ids) if (html.indexOf(PROFILES[id].postMarker) >= 0) return PROFILES[id];
  }
  // khong co bai nao -> doan qua trang danh sach
  try {
    const list = fs.readFileSync(LIST_PAGE, 'utf8');
    if (list.indexOf('content-blog_wrap') >= 0) return PROFILES.aeline;
  } catch (e) {}
  return PROFILES.qranty;
}
const PROFILE = detectProfile();
const POST_MARKER = PROFILE.postMarker;
const TEMPLATE_FILE = path.join(ADMIN, PROFILE.templateFile);
// Anh tai len tu blog-admin di thang vao ngan anh bia cua Cam Nang.
// Cau truc images/ chia theo trang -> khoi, xem README muc 3.
const IMAGES_SUBDIR = 'images/cam-nang/anh-bia';
const IMAGES_DIR = path.join(ROOT, IMAGES_SUBDIR);
const PORTS = [8899, 8900, 8901, 8902, 8903];

const DEFAULT_SETTINGS = {
  siteUrl: 'https://qranty.com',
  defaultAuthor: 'Đội ngũ Qranty',
  defaultAuthorRole: 'Chuyên gia bảo hành điện tử',
  defaultCategory: 'Vận hành',
  titleSuffix: ' - Qranty',
  slugPrefix: SITE.slugPrefix,
  categories: ['Vận hành', 'Hướng dẫn', 'Kinh nghiệm', 'Sản phẩm', 'Tin tức'],
  // --- kích thước ảnh ---
  // MẶC ĐỊNH: KHÔNG khung cố định. Ảnh bìa hiện trọn vẹn theo tỉ lệ gốc,
  // không bị cắt mất phần nào. Chỉ khi user tự điền chiều cao thì mới giới hạn.
  coverHeight: '',       // chiều cao ảnh bìa (px). '' = không giới hạn
  coverFit: 'auto',      // auto (trọn ảnh) | cover (cắt lấp đầy) | contain (thu vừa khung)
  cardHeight: '',        // chiều cao ảnh trên thẻ bài ở trang Cẩm Nang (px), '' = tự do
  relatedHeight: '',     // chiều cao ảnh trong khối "Bài viết liên quan" (px), '' = theo CSS site
  // --- dữ liệu có cấu trúc (JSON-LD) ---
  orgName: 'Qranty',
  orgDescription: 'Phần mềm quản lý bán hàng, kho, bảo hành và sửa chữa cho cửa hàng điện thoại, điện máy.',
  orgLogo: 'images/qranty-favicon-512.png',
  orgSameAs: ['https://www.facebook.com/qranty.vn/', 'https://www.linkedin.com/company/qranty/'],
  lang: 'vi-VN',
  aboutPage: 'qranty-about.html',
  blogName: 'Cẩm Nang'
};
// profile giao diện có thể ghi đè vài mặc định cho hợp site
Object.assign(DEFAULT_SETTINGS, PROFILE.defaults || {});

/* Dựng thuộc tính style cho ảnh bìa trang bài viết.
   4 kiểu:
     auto      - hiện trọn ảnh theo kích thước thật, KHÔNG cắt, KHÔNG phóng to (mặc định)
     fullwidth - kéo đủ bề ngang cột, giữ tỉ lệ (ảnh nhỏ sẽ bị phóng to)
     contain   - có giới hạn chiều cao, thu ảnh vừa khung, không cắt
     cover     - có giới hạn chiều cao, cắt bớt cho lấp đầy khung */
function coverStyle(post, settings) {
  const fit = post.coverFit || settings.coverFit || 'auto';
  const hRaw = (post.coverHeight === 0 || post.coverHeight) ? post.coverHeight : settings.coverHeight;
  const h = parseInt(hRaw, 10);
  const AUTO = 'max-width:100%;width:auto;height:auto;object-fit:none;display:block;margin:0 auto;';
  if (fit === 'auto') return AUTO;
  if (fit === 'fullwidth' || !h) return 'width:100%;height:auto;';
  return 'width:100%;max-height:' + h + 'px;object-fit:' + (fit === 'contain' ? 'contain' : 'cover') + ';';
}

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

/* =====================================================================
   Tiện ích chung
   ===================================================================== */

function safeResolve(rel) {
  const clean = decodeURIComponent(String(rel || '')).replace(/^[\\/]+/, '');
  const abs = path.resolve(ROOT, clean);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function backupOnce(absFile, rel) {
  try {
    const dest = path.join(BACKUP_DIR, rel);
    if (fs.existsSync(dest)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(absFile)) fs.copyFileSync(absFile, dest);
  } catch (e) { /* không nghiêm trọng */ }
}

/* ---- Ngày tháng kiểu Việt Nam: "05 Thg 5, 2026" ---- */
function isoToVn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${m[3]} Thg ${parseInt(m[2], 10)}, ${m[1]}`;
}

function vnToIso(vn) {
  const m = /(\d{1,2})\s*Thg\s*(\d{1,2}),?\s*(\d{4})/i.exec(String(vn || ''));
  if (!m) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
}

function todayIso() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---- Bỏ dấu tiếng Việt để tạo slug ---- */
function slugify(str) {
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/* =====================================================================
   Đọc / ghi kho dữ liệu
   ===================================================================== */

function computeSkipped() {
  SKIPPED.length = 0;
  for (const file of listPostFiles()) {
    try {
      if (fs.readFileSync(path.join(ROOT, file), 'utf8').indexOf(POST_MARKER) < 0) SKIPPED.push(file);
    } catch (e) { /* bỏ qua */ }
  }
}

function loadStore() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      raw.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
      raw.posts = Array.isArray(raw.posts) ? raw.posts : [];
      // Kho rỗng nhưng trong public/ có bài đọc được -> nạp lại (hay gặp khi
      // kho được tạo lúc chưa nhận diện đúng profile giao diện).
      if (!raw.posts.length) {
        const found = scanExistingPosts();
        if (found.length) {
          raw.posts = found;
          saveStore(raw);
          console.log('  > Kho đang rỗng, đã nạp lại ' + found.length + ' bài viết có sẵn.');
        }
      }
      computeSkipped();
      return raw;
    } catch (e) {
      console.error('  ! blog-posts.json lỗi định dạng, sẽ quét lại từ file HTML:', e.message);
    }
  }
  const store = { settings: Object.assign({}, DEFAULT_SETTINGS), posts: scanExistingPosts() };
  saveStore(store);
  console.log('  > Đã tạo blog-posts.json từ ' + store.posts.length + ' bài viết có sẵn.');
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

/* =====================================================================
   Quét các bài viết đã có sẵn trên site
   ===================================================================== */

function pick(re, s) {
  const m = re.exec(s);
  return m ? m[1].trim() : '';
}

function extractBlock(html, startTag, className) {
  // Lấy nội dung bên trong <div class="className"> ... </div> cân bằng thẻ
  const openRe = new RegExp('<' + startTag + '[^>]*class="[^"]*\\b' + className + '\\b[^"]*"[^>]*>', 'i');
  const m = openRe.exec(html);
  if (!m) return '';
  const start = m.index + m[0].length;
  const tagRe = new RegExp('<' + startTag + '\\b[^>]*>|</' + startTag + '>', 'gi');
  tagRe.lastIndex = start;
  let depth = 1, mm;
  while ((mm = tagRe.exec(html))) {
    depth += mm[0].charAt(1) === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start, mm.index);
  }
  return '';
}

function listPostFiles() {
  try { return fs.readdirSync(ROOT).filter(f => POST_RE.test(f)).sort(); }
  catch (e) { return []; }
}

function readListingCards() {
  // Lấy excerpt / ảnh bìa từ lưới trong trang danh sách (chính xác hơn meta)
  if (!fs.existsSync(LIST_PAGE)) return {};
  try { return PROFILE.readCards(fs.readFileSync(LIST_PAGE, 'utf8')) || {}; }
  catch (e) { return {}; }
}

function readListingCardsLegacy() {
  const out = {};
  if (!fs.existsSync(LIST_PAGE)) return out;
  const html = fs.readFileSync(LIST_PAGE, 'utf8');
  const re = /<div class="single-blog-wrap">([\s\S]*?)<\/div><\/div><\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const card = m[1];
    const file = pick(/<a href="([^"]+\.html)"/i, card);
    if (!file) continue;
    out[file] = {
      cover: pick(/<img src="([^"]+)"[^>]*class="blog-image"/i, card),
      coverAlt: decodeEntities(pick(/<img[^>]*class="blog-image"[^>]*alt="([^"]*)"/i, card) ||
                               pick(/<img[^>]*alt="([^"]*)"[^>]*class="blog-image"/i, card)),
      category: decodeEntities(pick(/<div class="blog-categorie">([^<]*)<\/div>/i, card)),
      date: vnToIso(pick(/<div class="blog-date">([^<]*)<\/div>/i, card)),
      excerpt: decodeEntities(stripTags(pick(/<p class="blog-details">([\s\S]*?)<\/p>/i, card)))
    };
  }
  return out;
}

const SKIPPED = [];

function scanExistingPosts() {
  const cards = readListingCards();
  const posts = [];
  SKIPPED.length = 0;
  for (const file of listPostFiles()) {
    let html;
    try { html = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch (e) { continue; }

    // Chỉ nhận các trang dùng đúng template blog của website.
    // Trang tự thiết kế riêng (landing page rời) được bỏ qua, dashboard không đụng vào.
    if (html.indexOf(POST_MARKER) < 0) { SKIPPED.push(file); continue; }

    const card = cards[file] || {};
    const f = PROFILE.parsePost(html, card) || {};

    // Kích thước ảnh bìa: KHÔNG kế thừa khung cố định của bản Webflow cũ
    // (bản cũ khóa max-height:420px + object-fit:cover nên ảnh cao bị cắt cụt).
    // Để trống -> bài chạy theo mặc định trong Cài đặt = hiện trọn ảnh.
    const coverH = '';
    const coverFit = '';

    posts.push({
      id: file.replace(/\.html$/i, ''),
      slug: file.replace(/\.html$/i, ''),
      file: file,
      status: 'published',
      seoTitle: f.seoTitle || '',
      metaDescription: f.metaDescription || '',
      focusKeyword: '',
      secondaryKeywords: [],
      h1: f.h1 || '',
      category: f.category || DEFAULT_SETTINGS.defaultCategory || '',
      tags: [],
      author: f.author || DEFAULT_SETTINGS.defaultAuthor,
      authorRole: f.authorRole || DEFAULT_SETTINGS.defaultAuthorRole,
      date: f.date || todayIso(),
      coverImage: f.coverImage || '',
      coverAlt: f.coverAlt || '',
      coverHeight: coverH,
      coverFit: coverFit,
      excerpt: f.excerpt || f.metaDescription || '',
      content: f.content || '',
      relatedIds: [],
      imported: true,
      managed: false,   // chưa từng được dashboard sinh lại -> giữ nguyên file gốc
      updatedAt: new Date().toISOString()
    });
  }
  posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return posts;
}

/* =====================================================================
   Sinh HTML
   ===================================================================== */

function loadTemplate() {
  if (!fs.existsSync(TEMPLATE_FILE)) throw new Error('Thiếu file blog-post-template.html');
  return fs.readFileSync(TEMPLATE_FILE, 'utf8');
}

function fileNameOf(post, settings) {
  let slug = String(post.slug || '').replace(/\.html$/i, '').trim();
  if (!slug) slug = slugify(post.h1 || post.seoTitle);
  const prefix = settings.slugPrefix || '';
  if (prefix && !slug.startsWith(prefix)) slug = prefix + slug;
  return slug + '.html';
}

function relatedFor(post, posts) {
  const N = PROFILE.relatedCount || 2;
  const pool = posts.filter(p => p.id !== post.id && p.status === 'published');
  let chosen = [];
  if (Array.isArray(post.relatedIds) && post.relatedIds.length) {
    chosen = post.relatedIds.map(id => pool.find(p => p.id === id)).filter(Boolean);
  }
  if (chosen.length < N) {
    const sameCat = pool.filter(p => p.category === post.category && !chosen.includes(p));
    const rest = pool.filter(p => p.category !== post.category && !chosen.includes(p));
    chosen = chosen.concat(sameCat, rest).slice(0, N);
  }
  return chosen.slice(0, N);
}

function renderRelatedCardLegacy(p, settings) {
  const h = parseInt((settings && settings.relatedHeight) || '', 10);
  const linkStyle = h ? ' style="height:' + h + 'px;"' : '';
  return '<div class="single-blog-post-wrap"><div class="blog-post-flex-wrap">'
    + '<a href="' + esc(p.file) + '" class="blog-post-image-link w-inline-block"' + linkStyle + '>'
    + '<img src="' + esc(p.coverImage) + '" loading="lazy" alt="' + esc(p.coverAlt) + '" class="blog-post-image"></a>'
    + '<div class="blog-post-contant"><div class="blog-categorie-date-wrap">'
    + '<div class="blog-categorie-wrap"><div class="blog-categorie">' + esc(p.category) + '</div></div>'
    + '<div class="blog-dot"></div>'
    + '<div class="blog-date-wrap"><div class="blog-date">' + esc(isoToVn(p.date)) + '</div></div></div>'
    + '<a href="' + esc(p.file) + '" class="blog-title-link mg-bottom-0px w-inline-block">'
    + '<h3 class="blog-title">' + esc(p.h1) + '</h3></a></div></div></div>';
}

function renderListCard(p, settings) { return PROFILE.listCard(p, settings); }
function renderRelatedCard(p, settings) { return PROFILE.relatedCard(p, settings); }

function renderListCardLegacy(p, settings) {
  const h = parseInt((settings && settings.cardHeight) || '', 10);
  const linkStyle = h ? ' style="height:' + h + 'px;"' : '';
  return '<div class="single-blog-wrap">'
    + '<a href="' + esc(p.file) + '" class="blog-image-link w-inline-block"' + linkStyle + '>'
    + '<img src="' + esc(p.coverImage) + '" loading="lazy" alt="' + esc(p.coverAlt) + '" class="blog-image"></a>'
    + '<div class="blog-contant"><div class="blog-categorie-date-wrap">'
    + '<div class="blog-categorie-wrap"><div class="blog-categorie">' + esc(p.category) + '</div></div>'
    + '<div class="blog-dot"></div>'
    + '<div class="blog-date-wrap"><div class="blog-date">' + esc(isoToVn(p.date)) + '</div></div></div>'
    + '<a href="' + esc(p.file) + '" class="blog-title-link w-inline-block">'
    + '<h3 class="blog-title">' + esc(p.h1) + '</h3></a>'
    + '<div class="blog-details-wrap"><p class="blog-details">' + esc(p.excerpt) + '</p></div>'
    + '</div></div>';
}

/* Bỏ thẻ HTML, trả về text thuần (dùng cho FAQ trong JSON-LD). */
function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

/* Nhận diện một tiêu đề có phải câu hỏi không.
   Tiếng Việt hay viết câu hỏi mà không có dấu "?", nên xét thêm từ để hỏi. */
const QUESTION_TAIL = /(kh[ôo]ng|ch[ưu]a|g[ìi]|n[àa]o|sao|đ[âa]u|l[âa]u|nhi[êe]u|m[ấa]y|ai)\s*[.!]?$/i;
// Dùng (?=\s|$) thay cho \b: chữ có dấu tiếng Việt không nằm trong \w của JS nên \b không chạy đúng.
const QUESTION_HEAD = /^(c[óo]|n[êe]n|l[àa]m sao|v[ìi] sao|t[ạa]i sao|khi n[àa]o|bao l[âa]u|bao nhi[êe]u|th[ếe] n[àa]o|c[ầa]n)(?=\s|$)/i;

function looksLikeQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return t.indexOf('?') >= 0 || QUESTION_TAIL.test(t) || QUESTION_HEAD.test(t);
}

/* Rút mục FAQ từ thân bài để sinh schema FAQPage.
   Quy ước: một <h2> chứa chữ "câu hỏi thường gặp", bên dưới là các cặp <h3> câu hỏi + <p> trả lời.
   Dừng khi gặp <h2> kế tiếp. Ưu tiên post.faq nếu bài có sẵn mảng này. */
function extractFaq(post) {
  if (Array.isArray(post.faq) && post.faq.length) {
    return post.faq
      .map(x => ({ q: stripTags(x.q || x.question), a: stripTags(x.a || x.answer) }))
      .filter(x => x.q && x.a);
  }
  const html = String(post.content || '');
  const h2s = [];
  const reH2 = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let m;
  while ((m = reH2.exec(html))) h2s.push({ start: m.index, end: reH2.lastIndex, text: stripTags(m[1]) });
  const idx = h2s.findIndex(h => /c[âa]u\s*h[ỏo]i\s*th[ưu][ờo]ng\s*g[ăặa]p/i.test(h.text));
  if (idx < 0) return [];
  const from = h2s[idx].end;
  let to = idx + 1 < h2s.length ? h2s[idx + 1].start : html.length;
  let block = html.slice(from, to);
  // Cắt trước các khối cuối bài (CTA, "Xem thêm", quote) — <h3> trong đó không phải câu hỏi.
  for (const stop of ['class="qr-cta-', 'class="qr-readmore', '<blockquote']) {
    const i = block.indexOf(stop);
    if (i >= 0) block = block.slice(0, i);
  }
  const out = [];
  const reQ = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>|$)/gi;
  let q;
  while ((q = reQ.exec(block))) {
    const question = stripTags(q[1]);
    const ps = String(q[2] || '').match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
    const answer = stripTags(ps.join(' '));
    // Chỉ nhận thẻ h3 thật sự là câu hỏi.
    if (question && answer && looksLikeQuestion(question)) out.push({ q: question, a: answer });
  }
  return out;
}

function buildJsonLd(post, settings) {
  const site = (settings.siteUrl || '').replace(/\/$/, '');
  const url = site + '/' + post.file;
  const img = post.coverImage ? (site + '/' + String(post.coverImage).replace(/^\//, '')) : '';
  const modified = (post.updatedAt || '').slice(0, 10) || post.date;
  const words = stripTags(post.content).split(' ').filter(Boolean).length;
  const keywords = [post.focusKeyword]
    .concat(Array.isArray(post.secondaryKeywords) ? post.secondaryKeywords : [])
    .filter(Boolean).join(', ');

  const graph = [
    {
      '@type': 'Organization',
      '@id': site + '/#organization',
      name: settings.orgName || '',
      url: site + '/',
      logo: settings.orgLogo ? { '@type': 'ImageObject', url: site + '/' + String(settings.orgLogo).replace(/^\//, '') } : undefined,
      description: settings.orgDescription || undefined,
      sameAs: (Array.isArray(settings.orgSameAs) && settings.orgSameAs.length) ? settings.orgSameAs : undefined
    },
    {
      '@type': 'WebSite',
      '@id': site + '/#website',
      url: site + '/',
      name: settings.orgName || '',
      inLanguage: settings.lang || 'vi-VN',
      publisher: { '@id': site + '/#organization' }
    },
    {
      '@type': 'BlogPosting',
      '@id': url + '#article',
      headline: String(post.h1 || post.seoTitle).slice(0, 110),
      name: post.seoTitle,
      description: post.metaDescription,
      inLanguage: settings.lang || 'vi-VN',
      keywords: keywords || undefined,
      articleSection: post.category || undefined,
      wordCount: words || undefined,
      image: img ? { '@type': 'ImageObject', url: img, caption: post.coverAlt || undefined } : undefined,
      datePublished: post.date,
      dateModified: modified,
      author: { '@type': 'Organization', name: post.author || settings.defaultAuthor, url: site + '/' + (settings.aboutPage || '') },
      publisher: { '@id': site + '/#organization' },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      isPartOf: { '@id': site + '/#website' }
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: site + '/' },
        { '@type': 'ListItem', position: 2, name: settings.blogName || 'Blog', item: site + '/' + SITE.listFile },
        { '@type': 'ListItem', position: 3, name: post.h1 || post.seoTitle, item: url }
      ]
    }
  ];

  const faq = extractFaq(post);
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': url + '#faq',
      mainEntity: faq.map(x => ({
        '@type': 'Question',
        name: x.q,
        acceptedAnswer: { '@type': 'Answer', text: x.a }
      }))
    });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

function renderPost(post, store) {
  const settings = store.settings;
  const posts = store.posts;
  const tpl = loadTemplate();
  const url = (settings.siteUrl || '').replace(/\/$/, '') + '/' + post.file;
  const ogImage = post.coverImage
    ? ((settings.siteUrl || '').replace(/\/$/, '') + '/' + String(post.coverImage).replace(/^\//, ''))
    : '';
  const related = relatedFor(post, posts).map(p => renderRelatedCard(p, settings)).join('');

  const map = {
    '{{SEO_TITLE}}': esc(post.seoTitle),
    '{{META_DESC}}': esc(post.metaDescription),
    '{{OG_URL}}': esc(url),
    '{{OG_IMAGE}}': esc(ogImage),
    '{{JSONLD}}': buildJsonLd(post, settings),
    '{{CATEGORY}}': esc(post.category),
    '{{H1}}': esc(post.h1),
    '{{AUTHOR}}': esc(post.author || settings.defaultAuthor),
    '{{AUTHOR_ROLE}}': esc(post.authorRole || settings.defaultAuthorRole),
    '{{COVER_IMG}}': esc(post.coverImage),
    '{{COVER_ALT}}': esc(post.coverAlt),
    '{{COVER_STYLE}}': esc(coverStyle(post, settings)),
    '{{DATE}}': esc((PROFILE.formatDate || isoToVn)(post.date)),
    '{{DATE_ISO}}': esc(post.date || ''),
    '{{MODIFIED_ISO}}': esc((post.updatedAt || '').slice(0, 10) || post.date || ''),
    '{{SHARE_FB}}': esc('https://www.facebook.com/sharer/sharer.php?u=' + url),
    '{{SHARE_LI}}': esc('https://www.linkedin.com/shareArticle?mini=true&url=' + url),
    '{{EXCERPT}}': esc(post.excerpt || post.metaDescription || ''),
    '{{CONTENT}}': post.content || '',
    '{{RELATED}}': related
  };
  let out = tpl;
  for (const k of Object.keys(map)) out = out.split(k).join(map[k]);
  return out;
}

function rebuildListing(store) {
  if (!fs.existsSync(LIST_PAGE)) return { ok: false, error: 'Không tìm thấy trang danh sách ' + SITE.listFile };
  let html = fs.readFileSync(LIST_PAGE, 'utf8');
  if (html.indexOf('<!--QR-BLOG-GRID:START-->') < 0) {
    return { ok: false, error: SITE.listFile + ' chưa có marker <!--QR-BLOG-GRID:START-->' };
  }
  backupOnce(LIST_PAGE, SITE.listFile);

  const published = store.posts
    .filter(p => p.status === 'published')
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const grid = PROFILE.grid(published.map(p => renderListCard(p, store.settings)).join(''));

  html = html.replace(
    /<!--QR-BLOG-GRID:START-->[\s\S]*?<!--QR-BLOG-GRID:END-->/,
    '<!--QR-BLOG-GRID:START-->' + grid + '<!--QR-BLOG-GRID:END-->'
  );
  html = html.replace(
    /<!--QR-BLOG-COUNT:START-->[\s\S]*?<!--QR-BLOG-COUNT:END-->/,
    '<!--QR-BLOG-COUNT:START-->' + published.length + '<!--QR-BLOG-COUNT:END-->'
  );
  fs.writeFileSync(LIST_PAGE, html, 'utf8');
  const sm = writeSitemap(store);
  ensureRobots(store);
  return { ok: true, count: published.length, sitemap: sm };
}

/* =====================================================================
   sitemap.xml + robots.txt
   ---------------------------------------------------------------------
   Chạy tự động mỗi lần lưới bài viết được dựng lại, nên thêm/xoá/sửa bài
   xong là sitemap đã đúng — không phải sửa tay.
   ===================================================================== */

/* `file` = file trên đĩa để lấy lastmod; `loc` = đường dẫn thật khi deploy.
   Trang chủ deploy dưới tên index.html nên URL là "/" chứ không phải "/qranty.html"
   (xem .vercelignore — qranty.html không được đẩy lên). */
const STATIC_PAGES = [
  { file: 'index.html',          loc: '/',                    priority: '1.0', changefreq: 'weekly',  fallback: 'qranty.html' },
  { file: 'qranty-feature.html', loc: '/qranty-feature.html', priority: '0.9', changefreq: 'monthly' },
  { file: 'qranty-pricing.html', loc: '/qranty-pricing.html', priority: '0.9', changefreq: 'monthly' },
  { file: 'qranty-about.html',   loc: '/qranty-about.html',   priority: '0.6', changefreq: 'monthly' },
  { file: 'qranty-blog.html',    loc: '/qranty-blog.html',    priority: '0.8', changefreq: 'weekly' }
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function writeSitemap(store) {
  try {
    const site = (store.settings.siteUrl || '').replace(/\/$/, '');
    if (!site) return { ok: false, error: 'settings.siteUrl trống' };
    const today = todayIso();
    const rows = [];

    for (const p of STATIC_PAGES) {
      let src = path.join(ROOT, p.file);
      if (!fs.existsSync(src) && p.fallback) src = path.join(ROOT, p.fallback);
      if (!fs.existsSync(src)) continue;
      let lastmod = today;
      try { lastmod = fs.statSync(src).mtime.toISOString().slice(0, 10); } catch (e) {}
      rows.push({ loc: site + p.loc, lastmod: lastmod, changefreq: p.changefreq, priority: p.priority });
    }

    const published = store.posts
      .filter(p => p.status === 'published' && p.file)
      .slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    for (const p of published) {
      rows.push({
        loc: site + '/' + p.file,
        lastmod: (p.updatedAt || '').slice(0, 10) || p.date || today,
        changefreq: 'monthly',
        priority: '0.7'
      });
    }

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + rows.map(r =>
          '  <url>\n'
          + '    <loc>' + esc(r.loc) + '</loc>\n'
          + '    <lastmod>' + esc(r.lastmod) + '</lastmod>\n'
          + '    <changefreq>' + r.changefreq + '</changefreq>\n'
          + '    <priority>' + r.priority + '</priority>\n'
          + '  </url>'
        ).join('\n')
      + '\n</urlset>\n';

    fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
    return { ok: true, urls: rows.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* Chỉ tạo robots.txt khi chưa có — không ghi đè bản người dùng đã sửa tay. */
function ensureRobots(store) {
  try {
    const abs = path.join(ROOT, 'robots.txt');
    if (fs.existsSync(abs)) return { ok: true, skipped: true };
    const site = (store.settings.siteUrl || '').replace(/\/$/, '');
    const txt = 'User-agent: *\nAllow: /\n\n'
      + 'Disallow: /editor.html\nDisallow: /blog-admin.html\nDisallow: /blog-post-template.html\n'
      + 'Disallow: /fizens_live.html\nDisallow: /blog-posts.json\n\n'
      + (site ? 'Sitemap: ' + site + '/sitemap.xml\n' : '');
    fs.writeFileSync(abs, txt, 'utf8');
    return { ok: true, created: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function writePostFile(post, store) {
  const abs = path.join(ROOT, post.file);
  backupOnce(abs, post.file);
  fs.writeFileSync(abs, renderPost(post, store), 'utf8');
}

function rebuildAll(store) {
  const published = store.posts.filter(p => p.status === 'published');
  for (const p of published) { writePostFile(p, store); p.managed = true; }
  const r = rebuildListing(store);
  return { rendered: published.length, listing: r };
}

/* =====================================================================
   Nhập bài từ output HTML của skill qranty-blog-seo
   ===================================================================== */

const META_LABELS = [
  ['seoTitle', /^SEO\s*title$/i],
  ['metaDescription', /^Meta\s*description$/i],
  ['slug', /^Slug(\s*\/\s*URL)?$/i],
  ['focusKeyword', /^Focus\s*keyword$/i],
  ['secondaryKeywords', /^T[ừu]\s*kh[óo]a\s*ph[ụu]$/i],
  ['category', /^Chuy[êe]n\s*m[ụu]c$/i],
  ['coverImage', /^[ẢA]nh\s*[đd][ạa]i\s*di[ệe]n$/i]
];

function parseSkillHtml(raw, settings) {
  const post = {
    seoTitle: '', metaDescription: '', slug: '', focusKeyword: '',
    secondaryKeywords: [], category: '', coverImage: '', coverAlt: '',
    h1: '', excerpt: '', content: ''
  };

  // 1. Đọc khối comment SEO META
  const comments = raw.match(/<!--[\s\S]*?-->/g) || [];
  for (const c of comments) {
    if (!/SEO\s*META/i.test(c)) continue;
    for (const line of c.split(/\r?\n/)) {
      const m = /^[\s|*]*([^:]{2,40}?)\s*:\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      const label = m[1].trim();
      const value = m[2].trim();
      if (!value || /^\.\.\.$/.test(value)) continue;
      for (const [key, re] of META_LABELS) {
        if (re.test(label)) {
          if (key === 'secondaryKeywords') post[key] = value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
          else post[key] = value;
        }
      }
    }
  }

  // 2. Bỏ toàn bộ comment (SEO META, danh sách ảnh, checklist) khỏi nội dung
  let body = raw.replace(/<!--[\s\S]*?-->/g, '');

  // 3. Nếu là file HTML đầy đủ thì chỉ lấy phần <body>
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(body);
  if (bodyMatch) body = bodyMatch[1];
  body = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');

  // 4. Tách H1 ra làm tiêu đề trang
  const h1m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body);
  if (h1m) {
    post.h1 = stripTags(h1m[1]);
    body = body.replace(h1m[0], '');
  }

  // 5. Sapo -> excerpt
  const pm = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(body);
  if (pm) post.excerpt = stripTags(pm[1]).slice(0, 320);

  post.content = body.replace(/^\s*[\r\n]+/, '').trim();

  // 6. Chuẩn hoá các trường suy ra được
  if (!post.h1) post.h1 = post.seoTitle.replace(/\s*-\s*Qranty\s*$/i, '');
  if (!post.seoTitle && post.h1) post.seoTitle = post.h1 + (settings.titleSuffix || '');
  else if (post.seoTitle && !/qranty/i.test(post.seoTitle)) post.seoTitle = post.seoTitle + (settings.titleSuffix || '');
  post.slug = String(post.slug || '').replace(/^\/+/, '').replace(/\.html$/i, '');
  if (!post.slug) post.slug = slugify(post.h1);
  if (!post.category) post.category = settings.defaultCategory;
  if (!post.excerpt) post.excerpt = post.metaDescription;
  if (post.coverImage && !/[\\/]/.test(post.coverImage)) post.coverImage = 'images/' + post.coverImage;
  if (!post.coverAlt) post.coverAlt = post.h1;
  return post;
}

/* =====================================================================
   QUẢN LÝ LINK TOÀN WEBSITE
   Đọc mọi thẻ <a> trong các trang .html, cho sửa đích đến, và cho
   bọc link quanh một đoạn chữ bất kỳ.
   ===================================================================== */

// Những file không phải trang của website -> không đụng tới
const LINK_SKIP = new Set(['blog-admin.html', 'editor.html', 'blog-post-template.html']);

function listSitePages() {
  return fs.readdirSync(ROOT)
    .filter(f => /\.html?$/i.test(f) && !LINK_SKIP.has(f))
    .sort();
}

/* Vùng cần bỏ qua: <script>, <style>, comment HTML */
function maskedRanges(html) {
  const out = [];
  const re = /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi;
  let m;
  while ((m = re.exec(html))) out.push([m.index, m.index + m[0].length]);
  return out;
}

function inRanges(ranges, pos) {
  for (const r of ranges) if (pos >= r[0] && pos < r[1]) return true;
  return false;
}

function getAttr(attrs, name) {
  const m = new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'i').exec(attrs);
  return m ? m[1] : '';
}

function setAttr(attrs, name, value) {
  const re = new RegExp('\\s' + name + '\\s*=\\s*"[^"]*"', 'i');
  if (value === null || value === undefined || value === '') return attrs.replace(re, '');
  const pair = ' ' + name + '="' + String(value).replace(/"/g, '&quot;') + '"';
  return re.test(attrs) ? attrs.replace(re, pair) : attrs + pair;
}

/* Webflow hay lặp chữ 2 lần (text + hover-text) -> gộp lại cho dễ đọc */
function tidyLinkText(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  const half = s.length / 2;
  if (s.length > 3 && s.length % 2 === 0 && s.slice(0, half) === s.slice(half)) return s.slice(0, half);
  return s;
}

function extractLinks(html) {
  const masked = maskedRanges(html);
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    if (inRanges(masked, m.index)) continue;
    const attrs = m[1], inner = m[2];
    let text = tidyLinkText(stripTags(decodeEntities(inner)));
    if (!text) {
      const alt = pick(/<img[^>]*alt="([^"]*)"/i, inner);
      text = alt ? '🖼 ' + decodeEntities(alt) : (/<img/i.test(inner) ? '🖼 (ảnh không có alt)' : '(trống)');
    }
    out.push({
      index: out.length,
      href: decodeEntities(getAttr(attrs, 'href')),
      target: getAttr(attrs, 'target'),
      rel: getAttr(attrs, 'rel'),
      cls: getAttr(attrs, 'class'),
      text: text.slice(0, 120),
      tagStart: m.index,
      tagEnd: m.index + 1 + 1 + attrs.length,   // hết thẻ mở
      end: m.index + m[0].length
    });
  }
  return out;
}

/* Thẻ <a> mà Webflow dùng làm nút giao diện (giỏ hàng ẩn, accordion FAQ,
   dropdown, tab). Chúng cố tình không có đích đến -> đừng báo là link hỏng. */
const UI_CLASS_RE = /w-commerce|cart-|accordion|w-dropdown|w-tab|lightbox/i;

/* Phân loại + phát hiện link hỏng */
function classifyLink(href, cls) {
  const h = String(href || '').trim();
  if (UI_CLASS_RE.test(cls || '') && (!h || h === '#')) {
    return { kind: 'ui', broken: false, note: 'Nút giao diện của Webflow — không cần đích đến' };
  }
  if (!h) return { kind: 'empty', broken: true, note: 'Không có href' };
  if (h === '#') return { kind: 'dead', broken: true, note: 'Link rỗng (#) — chưa trỏ đi đâu' };
  if (/^#/.test(h)) return { kind: 'anchor', broken: false, note: '' };
  if (/^(mailto:|tel:)/i.test(h)) return { kind: 'contact', broken: false, note: '' };
  if (/^https?:/i.test(h)) return { kind: 'external', broken: false, note: '' };
  const clean = h.split('#')[0].split('?')[0].replace(/^\.?\//, '');
  if (!clean) return { kind: 'anchor', broken: false, note: '' };
  const exists = fs.existsSync(path.join(ROOT, clean));
  return {
    kind: 'internal',
    broken: !exists,
    note: exists ? '' : 'Không tìm thấy file ' + clean + ' trong thư mục website'
  };
}

function linksOfFile(file) {
  const abs = safeResolve(file);
  if (!abs || !fs.existsSync(abs)) return null;
  const html = fs.readFileSync(abs, 'utf8');
  return extractLinks(html).map(l => Object.assign({ file: file }, l, classifyLink(l.href, l.cls)));
}

/* Vị trí một đoạn chữ nằm trong text node (không nằm trong thẻ, script,
   comment, và không nằm sẵn trong một thẻ <a>) */
function textOccurrences(html, needle) {
  if (!needle) return [];
  const masked = maskedRanges(html);
  const anchors = extractLinks(html);
  const out = [];
  let i = 0;
  while ((i = html.indexOf(needle, i)) !== -1) {
    const pos = i;
    i += needle.length;
    if (inRanges(masked, pos)) continue;
    const lt = html.lastIndexOf('<', pos);
    const gt = html.lastIndexOf('>', pos);
    if (lt > gt) continue;                                   // đang ở trong một thẻ
    if (anchors.some(a => pos >= a.tagStart && pos < a.end)) continue;  // đã nằm trong link
    out.push({
      pos: pos,
      context: stripTags(html.slice(Math.max(0, pos - 90), pos + needle.length + 90)).slice(0, 190)
    });
  }
  return out;
}

/* =====================================================================
   HTTP
   ===================================================================== */

let store = null;
let previewHtml = '<!doctype html><meta charset="utf-8"><p>Chưa có bản xem trước.</p>';

function nextId(base) {
  let id = base, n = 2;
  while (store.posts.some(p => p.id === id)) id = base + '-' + (n++);
  return id;
}

function normalizePost(input) {
  const s = store.settings;
  const p = Object.assign({}, input);
  p.status = p.status === 'draft' ? 'draft' : 'published';
  p.date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : todayIso();
  p.author = p.author || s.defaultAuthor;
  p.authorRole = p.authorRole || s.defaultAuthorRole;
  p.category = p.category || s.defaultCategory;
  p.h1 = (p.h1 || '').trim();
  p.seoTitle = (p.seoTitle || '').trim() || (p.h1 + (s.titleSuffix || ''));
  p.secondaryKeywords = Array.isArray(p.secondaryKeywords)
    ? p.secondaryKeywords
    : String(p.secondaryKeywords || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
  p.tags = Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
  p.relatedIds = Array.isArray(p.relatedIds) ? p.relatedIds : [];
  // Kích thước ảnh bìa riêng của bài; để trống = dùng mặc định trong Cài đặt
  p.coverFit = ['cover', 'contain', 'auto', 'fullwidth'].indexOf(p.coverFit) >= 0 ? p.coverFit : '';
  p.coverHeight = parseInt(p.coverHeight, 10) || '';
  p.managed = true;   // đã đi qua dashboard -> từ nay do dashboard sinh ra
  p.excerpt = (p.excerpt || p.metaDescription || '').trim();
  p.content = p.content || '';
  p.file = fileNameOf(p, s);
  p.slug = p.file.replace(/\.html$/i, '');
  p.updatedAt = new Date().toISOString();
  if (!p.id) p.id = nextId(p.slug);
  return p;
}

/* Bao cao ket qua tu nhan dien + nhung gi con thieu de dung duoc cho site nay */
function siteReport() {
  const postFiles = listPostFiles();
  const usable = postFiles.filter(f => {
    try { return fs.readFileSync(path.join(ROOT, f), 'utf8').indexOf(POST_MARKER) >= 0; } catch (e) { return false; }
  });
  const listExists = fs.existsSync(LIST_PAGE);
  const hasMarker = listExists && fs.readFileSync(LIST_PAGE, 'utf8').indexOf('<!--QR-BLOG-GRID:START-->') >= 0;
  const problems = [];
  if (!SITE.detected) problems.push('Không dò được cấu trúc blog trong public/ — đang dùng mặc định ' + SITE.listFile + '.');
  if (!listExists) problems.push('Không thấy trang danh sách ' + SITE.listFile + '.');
  else if (!hasMarker) problems.push(SITE.listFile + ' chưa có cặp marker <!--QR-BLOG-GRID:START--> / :END--> nên chưa dựng lại lưới bài được.');
  if (postFiles.length && !usable.length)
    problems.push('Có ' + postFiles.length + ' file bài viết nhưng không file nào khớp profile "' + PROFILE.id + '" (thiếu "' + POST_MARKER + '"). Dashboard chỉ đọc/hiển thị, chưa quản lý được các bài này.');
  if (!fs.existsSync(TEMPLATE_FILE))
    problems.push('Thiếu file template ' + PROFILE.templateFile + ' — chưa sinh được trang bài viết mới cho site này.');
  return {
    key: SITE.key, listFile: SITE.listFile, slugPrefix: SITE.slugPrefix,
    profile: PROFILE.id, profileLabel: PROFILE.label, templateFile: PROFILE.templateFile,
    detected: SITE.detected, dataFile: path.basename(DATA_FILE),
    postFiles: postFiles.length, usablePosts: usable.length,
    listExists, hasMarker, problems
  };
}

const API = {
  'state': async () => ({
    ok: true,
    posts: store.posts,
    settings: store.settings,
    templateOk: fs.existsSync(TEMPLATE_FILE),
    listingOk: fs.existsSync(LIST_PAGE) &&
      fs.readFileSync(LIST_PAGE, 'utf8').indexOf('<!--QR-BLOG-GRID:START-->') >= 0,
    skipped: SKIPPED.slice(),
    site: siteReport()
  }),

  'save': async (body) => {
    const incoming = normalizePost(body.post || {});
    if (!incoming.h1) return { ok: false, error: 'Bài viết cần có tiêu đề (H1).' };

    const idx = store.posts.findIndex(p => p.id === incoming.id);
    const old = idx >= 0 ? store.posts[idx] : null;

    // Trùng tên file với bài khác -> thêm hậu tố
    if (store.posts.some(p => p.id !== incoming.id && p.file === incoming.file)) {
      let n = 2, base = incoming.file.replace(/\.html$/i, '');
      while (store.posts.some(p => p.id !== incoming.id && p.file === base + '-' + n + '.html')) n++;
      incoming.file = base + '-' + n + '.html';
      incoming.slug = incoming.file.replace(/\.html$/i, '');
    }

    if (idx >= 0) store.posts[idx] = incoming; else store.posts.unshift(incoming);

    // Đổi slug -> chuyển file cũ vào thư mục sao lưu
    if (old && old.file && old.file !== incoming.file) {
      const oldAbs = path.join(ROOT, old.file);
      if (fs.existsSync(oldAbs)) {
        const dest = path.join(BACKUP_DIR, 'renamed', old.file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        try { fs.renameSync(oldAbs, dest); } catch (e) { /* bỏ qua */ }
      }
    }

    if (incoming.status === 'published') {
      writePostFile(incoming, store);
    }
    const listing = rebuildListing(store);
    // Khối "Bài viết liên quan" của các bài khác có thể đổi -> dựng lại.
    // Chỉ đụng vào những bài đã do dashboard quản lý; bài cũ nhập từ site giữ nguyên
    // cho tới khi người dùng chủ động sửa hoặc bấm "Dựng lại toàn bộ".
    for (const p of store.posts.filter(x => x.status === 'published' && x.managed && x.id !== incoming.id)) {
      writePostFile(p, store);
    }
    saveStore(store);
    return { ok: true, post: incoming, listing: listing };
  },

  'delete': async (body) => {
    const id = body.id;
    const idx = store.posts.findIndex(p => p.id === id);
    if (idx < 0) return { ok: false, error: 'Không tìm thấy bài viết.' };
    const post = store.posts[idx];
    const abs = path.join(ROOT, post.file);
    if (fs.existsSync(abs)) {
      const dest = path.join(BACKUP_DIR, 'deleted', post.file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try { fs.renameSync(abs, dest); } catch (e) { try { fs.unlinkSync(abs); } catch (e2) {} }
    }
    store.posts.splice(idx, 1);
    const listing = rebuildListing(store);
    for (const p of store.posts.filter(x => x.status === 'published' && x.managed)) writePostFile(p, store);
    saveStore(store);
    return { ok: true, listing: listing, movedTo: '_blog_backup/deleted/' + post.file };
  },

  'import': async (body) => {
    let html = String(body.html || '');
    if (!html && body.inboxFile) {
      const abs = safeResolve('_inbox/' + path.basename(body.inboxFile));
      if (!abs || !fs.existsSync(abs)) return { ok: false, error: 'Không tìm thấy file trong _inbox.' };
      html = fs.readFileSync(abs, 'utf8');
    }
    if (!html.trim()) return { ok: false, error: 'Không có nội dung để nhập.' };
    const parsed = parseSkillHtml(html, store.settings);
    return { ok: true, post: parsed, source: body.inboxFile || '' };
  },

  // Danh sách file bài viết đang chờ trong thư mục _inbox/
  // (nơi Claude ghi thẳng output của skill /qranty-blog-seo vào)
  'inbox': async () => {
    const dir = path.join(ROOT, '_inbox');
    if (!fs.existsSync(dir)) return { ok: true, files: [] };
    const files = fs.readdirSync(dir)
      .filter(f => /\.html?$/i.test(f))
      .map(f => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return { ok: true, files: files };
  },

  // Chuyển file trong _inbox sang _inbox/_da-nhap sau khi đã đăng
  'inbox-done': async (body) => {
    const name = path.basename(String(body.file || ''));
    const abs = safeResolve('_inbox/' + name);
    if (!abs || !fs.existsSync(abs)) return { ok: false, error: 'Không tìm thấy file.' };
    const dest = path.join(ROOT, '_inbox', '_da-nhap', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { fs.renameSync(abs, dest); } catch (e) { return { ok: false, error: String(e.message) }; }
    return { ok: true };
  },

  'preview': async (body) => {
    const p = normalizePost(body.post || {});
    previewHtml = renderPost(p, store);
    return { ok: true };
  },

  'upload': async (body) => {
    const b64 = String(body.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) return { ok: false, error: 'Thiếu dữ liệu ảnh.' };
    const safeName = String(body.name || 'image').replace(/[^A-Za-z0-9._-]/g, '_');
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const rel = 'images/' + Date.now() + '_' + safeName;
    fs.writeFileSync(path.join(ROOT, rel), Buffer.from(b64, 'base64'));
    return { ok: true, path: rel };
  },

  'rebuild': async () => {
    const r = rebuildAll(store);
    saveStore(store);
    return Object.assign({ ok: true }, r);
  },

  'rescan': async () => {
    const scanned = scanExistingPosts();
    const known = new Set(store.posts.map(p => p.file));
    const added = scanned.filter(p => !known.has(p.file));
    store.posts = store.posts.concat(added);
    store.posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    saveStore(store);
    return { ok: true, added: added.length };
  },

  /* ---------- LINK ---------- */

  // Danh sách trang + số link, dùng cho dropdown và cho bảng tổng quan
  'pages': async () => {
    const pages = listSitePages().map(f => {
      const links = linksOfFile(f) || [];
      return {
        file: f,
        total: links.length,
        broken: links.filter(l => l.broken).length,
        isPost: /^qranty-blog-/i.test(f)
      };
    });
    return { ok: true, pages: pages };
  },

  // Toàn bộ link của một trang, hoặc của tất cả trang khi file rỗng
  'links': async (body) => {
    if (body.file) {
      const links = linksOfFile(body.file);
      if (!links) return { ok: false, error: 'Không tìm thấy trang ' + body.file };
      return { ok: true, links: links };
    }
    let all = [];
    for (const f of listSitePages()) all = all.concat(linksOfFile(f) || []);
    return { ok: true, links: all };
  },

  // Sửa đích đến của một link cụ thể
  'link-save': async (body) => {
    const abs = safeResolve(body.file);
    if (!abs || !fs.existsSync(abs)) return { ok: false, error: 'Không tìm thấy trang.' };
    const html = fs.readFileSync(abs, 'utf8');
    const links = extractLinks(html);
    const l = links[body.index];
    if (!l) return { ok: false, error: 'Không còn link ở vị trí này — hãy tải lại danh sách.' };
    if (typeof body.oldHref === 'string' && l.href !== body.oldHref) {
      return { ok: false, error: 'Trang đã thay đổi kể từ lúc bạn mở. Tải lại danh sách rồi sửa lại.' };
    }
    const open = html.slice(l.tagStart, l.tagEnd + 1);          // <a ...>
    const attrs = open.replace(/^<a/i, '').replace(/>$/, '');
    let next = setAttr(attrs, 'href', body.href);
    if ('target' in body) next = setAttr(next, 'target', body.target);
    if ('rel' in body) next = setAttr(next, 'rel', body.rel);
    const out = html.slice(0, l.tagStart) + '<a' + next + '>' + html.slice(l.tagEnd + 1);

    backupOnce(abs, body.file);
    fs.writeFileSync(abs, out, 'utf8');
    return { ok: true, links: linksOfFile(body.file) };
  },

  // Đổi hàng loạt: mọi link đang trỏ tới A -> B, trên toàn site
  'link-bulk': async (body) => {
    const from = String(body.from || '').trim();
    const to = String(body.to || '').trim();
    if (!from) return { ok: false, error: 'Chưa nhập đích đến cũ.' };
    const changed = [];
    for (const f of (body.files && body.files.length ? body.files : listSitePages())) {
      const abs = safeResolve(f);
      if (!abs || !fs.existsSync(abs)) continue;
      let html = fs.readFileSync(abs, 'utf8');
      const links = extractLinks(html).filter(l => l.href === from);
      if (!links.length) continue;
      // sửa từ cuối lên đầu để không lệch vị trí
      for (const l of links.slice().reverse()) {
        const open = html.slice(l.tagStart, l.tagEnd + 1);
        const attrs = open.replace(/^<a/i, '').replace(/>$/, '');
        html = html.slice(0, l.tagStart) + '<a' + setAttr(attrs, 'href', to) + '>' + html.slice(l.tagEnd + 1);
      }
      backupOnce(abs, f);
      fs.writeFileSync(abs, html, 'utf8');
      changed.push({ file: f, count: links.length });
    }
    return { ok: true, changed: changed, total: changed.reduce((s, c) => s + c.count, 0) };
  },

  // Tìm một đoạn chữ trên trang để chuẩn bị bọc link
  'link-find-text': async (body) => {
    const abs = safeResolve(body.file);
    if (!abs || !fs.existsSync(abs)) return { ok: false, error: 'Không tìm thấy trang.' };
    const html = fs.readFileSync(abs, 'utf8');
    return { ok: true, hits: textOccurrences(html, String(body.text || '')) };
  },

  // Bọc <a href> quanh một đoạn chữ đang có sẵn trên trang
  'link-wrap': async (body) => {
    const abs = safeResolve(body.file);
    if (!abs || !fs.existsSync(abs)) return { ok: false, error: 'Không tìm thấy trang.' };
    const text = String(body.text || '');
    const href = String(body.href || '').trim();
    if (!text) return { ok: false, error: 'Chưa nhập đoạn chữ cần gắn link.' };
    if (!href) return { ok: false, error: 'Chưa nhập đích đến.' };

    const html = fs.readFileSync(abs, 'utf8');
    const hits = textOccurrences(html, text);
    if (!hits.length) return { ok: false, error: 'Không tìm thấy đoạn chữ này trong trang (chữ phải khớp chính xác, kể cả dấu).' };
    const n = parseInt(body.occurrence, 10);
    if (hits.length > 1 && !(n >= 0 && n < hits.length)) {
      return { ok: false, error: 'Đoạn chữ xuất hiện ' + hits.length + ' lần — hãy chọn đúng vị trí cần gắn.', hits: hits };
    }
    const pos = hits[hits.length > 1 ? n : 0].pos;

    let attrs = ' href="' + href.replace(/"/g, '&quot;') + '"';
    if (body.target) attrs += ' target="' + esc(body.target) + '"';
    if (body.rel) attrs += ' rel="' + esc(body.rel) + '"';
    if (body.cls) attrs += ' class="' + esc(body.cls) + '"';
    const out = html.slice(0, pos) + '<a' + attrs + '>' + text + '</a>' + html.slice(pos + text.length);

    backupOnce(abs, body.file);
    fs.writeFileSync(abs, out, 'utf8');
    return { ok: true, links: linksOfFile(body.file) };
  },

  // Gỡ thẻ <a>, giữ nguyên chữ bên trong
  'link-unwrap': async (body) => {
    const abs = safeResolve(body.file);
    if (!abs || !fs.existsSync(abs)) return { ok: false, error: 'Không tìm thấy trang.' };
    const html = fs.readFileSync(abs, 'utf8');
    const links = extractLinks(html);
    const l = links[body.index];
    if (!l) return { ok: false, error: 'Không còn link ở vị trí này.' };
    if (typeof body.oldHref === 'string' && l.href !== body.oldHref) {
      return { ok: false, error: 'Trang đã thay đổi. Tải lại danh sách rồi thử lại.' };
    }
    const inner = html.slice(l.tagEnd + 1, l.end - 4);   // bỏ '</a>'
    const out = html.slice(0, l.tagStart) + inner + html.slice(l.end);
    backupOnce(abs, body.file);
    fs.writeFileSync(abs, out, 'utf8');
    return { ok: true, links: linksOfFile(body.file) };
  },

  'settings': async (body) => {
    store.settings = Object.assign({}, store.settings, body.settings || {});
    saveStore(store);
    return { ok: true, settings: store.settings };
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // Đặt ở gốc (không phải /__blog/...) để mọi đường dẫn tương đối
  // css/… js/… images/… fonts/… trong template phân giải đúng.
  if (pathname === '/__blog-preview.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(previewHtml);
  }

  if (pathname.startsWith('/__blog/api/')) {
    const action = pathname.slice('/__blog/api/'.length);
    const fn = API[action];
    if (!fn) return sendJson(res, 404, { ok: false, error: 'Không có API: ' + action });
    try {
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
      return sendJson(res, 200, await fn(body));
    } catch (e) {
      console.error('  ! Lỗi API ' + action + ':', e);
      return sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
    }
  }

  // ---- file tĩnh ----
  const rel = pathname === '/' ? 'blog-admin.html' : pathname;
  // Trang quan tri nam trong admin/, moi thu con lai lay tu public/
  const abs = /^\/?blog-admin\.html$/.test(rel)
    ? path.join(ADMIN, 'blog-admin.html')
    : safeResolve(rel);
  if (!abs) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found: ' + rel); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(abs).pipe(res);
  });
});

/* ---- khởi động ---- */
try {
  store = loadStore();
} catch (e) {
  console.error('Không khởi động được:', e.message);
  process.exit(1);
}

(function tryListen(i) {
  if (i >= PORTS.length) { console.error('Không còn cổng trống trong', PORTS.join(', ')); process.exit(1); }
  const port = PORTS[i];
  server.once('error', e => {
    if (e.code === 'EADDRINUSE') tryListen(i + 1);
    else { console.error(e); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const rp = siteReport();
    console.log('\n  BLOG ADMIN dang chay:         http://localhost:' + port + '/blog-admin.html');
    console.log('  Thu muc:                      ' + ROOT);
    console.log('  Site tu nhan dien:            ' + rp.key + (rp.detected ? '' : '  (mac dinh, khong do duoc)'));
    console.log('    - trang danh sach:          ' + rp.listFile + (rp.listExists ? (rp.hasMarker ? '  [co marker]' : '  [THIEU marker]') : '  [KHONG CO]'));
    console.log('    - tien to bai viet:         ' + rp.slugPrefix + '<slug>.html   (' + rp.postFiles + ' file, ' + rp.usablePosts + ' dung template)');
    console.log('    - kho du lieu:              ' + rp.dataFile);
    console.log('  So bai dang quan ly:          ' + store.posts.length);
    for (const w of rp.problems) console.log('  !  ' + w);
    console.log('  (Nhan Ctrl+C de tat)\n');
  });
})(0);

module.exports = { scanExistingPosts, renderPost, rebuildListing, parseSkillHtml, slugify, isoToVn, vnToIso };
