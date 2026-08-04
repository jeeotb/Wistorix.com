# Wistorix · website tĩnh

Bản clone tĩnh của giao diện Wistorix, kèm một editor local để sửa nội dung mà không cần đụng vào code.

## Cấu trúc thư mục

```
Wistorix/
├── Public/              ← PHẦN DEPLOY. Chỉ có giao diện tĩnh.
│   ├── index.html
│   ├── home__*.html · services__*.html · about-us__*.html
│   ├── blog__*.html · contact-us__*.html · worker__*.html
│   ├── pricing.html · template__*.html
│   └── assets/          CSS, JS, ảnh, font (221 file)
│
├── tools/               ← KHÔNG deploy. Chỉ chạy trên máy.
│   ├── server.js            editor local, zero-dependency
│   ├── start-windows.bat    double-click để chạy trên Windows
│   ├── start-mac.command    double-click để chạy trên macOS
│   └── backups/             bản lưu tự động, có timestamp
│
├── .gitignore           loại tools/ khỏi repo
└── README.md
```

Nguyên tắc: `Public/` phải luôn tự chạy được một mình. Nếu copy riêng folder đó lên hosting là site hoạt động đầy đủ, không cần Node, không cần build.

## Chạy editor trên máy

Cần Node.js bản LTS · https://nodejs.org

- **Windows** · double-click `tools/start-windows.bat`
- **macOS** · double-click `tools/start-mac.command` (lần đầu có thể phải chuột phải → Open)
- **Dòng lệnh** · `node tools/server.js`

Editor mở tại `http://localhost:5173/__editor`. Server đọc và ghi thẳng vào `Public/`, ảnh upload rơi vào `Public/assets/`.

### Backup hoạt động thế nào

Mỗi lần bấm Save, editor copy file cũ sang `tools/backups/` với tên dạng:

```
index.html.2026-08-04T20-35-12.bak
```

Nút **Restore** trong editor đưa trang về **bản đầu tiên** đã lưu, tức bản gốc trước khi bạn sửa lần nào. Các mốc ở giữa vẫn nằm nguyên trong `tools/backups/`, cần quay về mốc nào thì copy tay file `.bak` đó đè lên file trong `Public/`.

Backup không bao giờ bị xoá tự động và không nằm trong `Public/`, nên folder deploy luôn sạch.

## Deploy

Repo đặt ở thư mục gốc, nhưng thứ được publish chỉ là `Public/`. Khi cấu hình hosting, trỏ thư mục gốc của site vào `Public`:

| Nền tảng | Cách đặt |
|---|---|
| Vercel | Project Settings → Build & Development → **Root Directory** = `Public`, Framework Preset = Other |
| Netlify | Site settings → Build & deploy → **Publish directory** = `Public` |
| Cloudflare Pages | Build output directory = `Public` |
| GitHub Pages | Settings → Pages → nhánh `main`, folder `/docs` (đổi tên `Public` thành `docs`), hoặc dùng GitHub Actions |

Không có bước build. Hosting chỉ cần serve file tĩnh.

## Ghi chú kỹ thuật

- **Link ngoài** · toàn bộ trang chỉ còn 3 đích ra ngoài: `wistorix.com`, Facebook và LinkedIn của Wistorix. Mọi link còn lại là link nội bộ giữa các file HTML trong `Public/`.
- **Badge "Made in Webflow"** · đã vô hiệu hoá ở hai lớp: gỡ đoạn tạo badge trong `Public/assets/webflow.schunk.7fa942c6f9da5827.js`, và xoá thuộc tính `data-wf-domain` khỏi thẻ `<html>` của mọi trang (đây là điều kiện kích hoạt badge).
- **Font** · site load Inter và Plus Jakarta Sans từ Google Fonts qua `WebFont.load`. Hai thẻ `preconnect` tới `fonts.googleapis.com` và `fonts.gstatic.com` là cần thiết, đừng xoá.
- **og:image** · các thẻ trỏ ảnh preview của template cũ đã gỡ. Muốn có ảnh preview khi share link, thêm thẻ `og:image` trỏ ảnh của Wistorix vào `<head>` từng trang.
- **Nút CTA** · phần chữ trên nút vẫn còn của template gốc ("Buy Template", "View Demo"), đích đã trỏ về `wistorix.com`. Sửa chữ trực tiếp trong editor.
