/* ================================================================
   WISTORIX CLONE — máy chủ tĩnh cục bộ (không cần cài package)
   Chạy:  node serve.js  [port]
   Mặc định: http://localhost:5173/dashboard.html
   ================================================================ */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.join(__dirname, 'app');
const START_PORT = parseInt(process.argv[2], 10) || 5173;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.mjs':  'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.mp4':  'video/mp4',
    '.txt':  'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (urlPath === '/' ) urlPath = '/dashboard.html';

    const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^([/\\])+/, ''));
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 · không tìm thấy: ' + urlPath);
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store, must-revalidate'
        });
        fs.createReadStream(filePath).pipe(res);
    });
});

function listen(port, attemptsLeft) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
            listen(port + 1, attemptsLeft - 1);
        } else {
            console.error('Không khởi động được máy chủ:', err.message);
            process.exit(1);
        }
    });
    server.listen(port, () => {
        const url = 'http://localhost:' + port + '/dashboard.html';
        console.log('');
        console.log('  Wistorix clone đang chạy tại: ' + url);
        console.log('  Thư mục phục vụ: ' + ROOT);
        console.log('  Sửa file trong app/ rồi F5 để xem thay đổi. Ctrl+C để dừng.');
        console.log('');
        const opener = process.platform === 'win32' ? 'start ""' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
        exec(opener + ' "' + url + '"', () => {});
    });
}

listen(START_PORT, 20);
