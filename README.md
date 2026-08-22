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

### Chế độ sửa trông khác trang thật

Trong khung xem của editor, Webflow và jQuery bị tắt tạm và mọi animation bị ép về trạng thái hiện đầy đủ. Chủ ý là vậy: nếu để animation chạy, lúc bấm Lưu sẽ đóng băng trang ở giữa hiệu ứng (chữ mờ, khối lệch). Muốn xem bản có hiệu ứng thật, bấm nút **▶️ Xem có hiệu ứng** trên thanh công cụ.

Các thẻ `<script>` bị tắt vẫn nằm nguyên trong file, chỉ đổi `type` tạm thời, nên lưu bao nhiêu lần cũng không mất.

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

## Bảng giá · sửa một chỗ là xong (18/08/2026)

Toàn bộ số liệu bảng giá trên website nằm trong **một file duy nhất**: `Public/assets/wistorix-pricing.js` (object `window.WISTORIX_PRICING`). Hai trang `index.html` và `pricing.html` đều gắn các phần tử `data-wx="..."` và script này tự điền tên gói, mô tả, giá, đơn vị, bullet, CTA, khối mua lẻ theo lượt và banner Multi-Wistorix khi trang load.

- **Đổi giá / tên gói / bullet** · chỉ sửa `wistorix-pricing.js`, cả hai trang tự cập nhật.
- **Thiết kế khu giá (18/08, bản Option C)** · markup nằm trong `<section class="wxp-sec">` của cả 2 trang: 3 card gói (One-Wistorix nổi bật, badge Phổ biến nhất) + panel nền đen "Mua theo lượt quét" có chọn pack 1/5/10/tuỳ ý, stepper và tổng tiền tự tính theo bậc thang (hàm `rate()` trong JS), gộp luôn dòng Multi-Wistorix. Nội dung và giá lấy từ module Thanh toán của app v5.7 (pack 5 lượt 180.000đ tiết kiệm 10%, 10 lượt 320.000đ tiết kiệm 20%).
- **Ngoại lệ (SEO)** · nếu đổi GIÁ, sửa thêm 2 chỗ tĩnh trong `<head>`: khối JSON-LD `offers` của `pricing.html` và `index.html`, và meta description của `pricing.html`. Crawler không chạy JS sẽ đọc phần tĩnh này.
- Cấu trúc gói hiện tại (theo README ver1 + app v5.7): Free 0đ (xử lý tối đa 100 file) · Standard 59.000đ/tháng · One-Wistorix 69.000đ/Drive/tháng · Mua lẻ theo lượt quét (1–4 lượt 40.000đ · 5–9 lượt 36.000đ · từ 10 lượt 32.000đ, không hết hạn) · Multi-Wistorix liên hệ. Nguồn giá theo lượt: module Thanh toán trong `09_UX_UI/ver1/wistorix-dashboard-v5.html` (v5.7 pay-per-scan).

## SEO & nội dung (đợt 18/08/2026)

- Mỗi trang đã có: canonical, og:url/site_name/locale, og:image (`assets/wistorix-og.png`), twitter:image, alt tiếng Việt cho ảnh nội dung. Root có `robots.txt` + `sitemap.xml` (25 URL). Đã gỡ meta generator Webflow.
- JSON-LD: SoftwareApplication + Organization (index) · FAQPage + offers (pricing) · BlogPosting (6 bài blog).
- Ảnh giao diện thật chụp từ prototype v5: `assets/wistorix-screen-{dashboard,explorer,audit}.webp`, đang dùng ở services.html và 3 trang services__*.
- Domain trong canonical/sitemap/og là `https://wistorix.com`. Nếu deploy domain khác: tìm-thay chuỗi này trong toàn bộ `Public/`.
- Quy tắc nội dung: không dùng "—" trong câu tiếng Việt (dùng phẩy, `·`, `:`); mọi con số phải lấy từ README ver1 hoặc app v5, không tự bịa.
