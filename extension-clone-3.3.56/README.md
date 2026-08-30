# Wistorix · bản clone giao diện dashboard (offline)

Bản sao giao diện của extension **Wistorix 3.3.56** đang cài trên Chrome
(ID `phdbinpbhccecfbnlpfodnehphaicoaj`), gỡ phụ thuộc vào Chrome Extension API
để mở thẳng bằng trình duyệt và chỉnh sửa giao diện.

Nguồn: `C:\Users\viethung\AppData\Local\Google\Chrome\User Data\Default\Extensions\phdbinpbhccecfbnlpfodnehphaicoaj\3.3.56_0`
Ngày clone: 29/08/2026.

## Chạy thế nào

Nhấp đúp `start.bat`, trình duyệt sẽ tự mở `http://localhost:5173/dashboard.html`.

Không mở trực tiếp file `.html` bằng `file://`: dashboard dùng ES module và
`fetch()` để nạp fragment trong `pages/`, hai thứ này bị trình duyệt chặn trên
giao thức `file://`. Cần một máy chủ tĩnh, `start.bat` lo phần đó (Node.js,
nếu không có thì fallback sang Python). Dùng Live Server của VS Code trên thư
mục `app/` cũng được.

## Cấu trúc

```
extension-clone-3.3.56/
├─ start.bat          chạy máy chủ tĩnh rồi mở trình duyệt
├─ serve.js           máy chủ tĩnh Node, không cần cài package
├─ README.md          file này
└─ app/               toàn bộ file của extension, giữ nguyên tên và cấu trúc
   ├─ dashboard.html  shell chính, đã chèn 3 dòng script mock trong <head>
   ├─ dashboard.css   toàn bộ style, 6.186 dòng
   ├─ dashboard.js    logic dashboard, 5.251 dòng
   ├─ pages/          fragment của từng route (mydrive, upgrade, settings...)
   ├─ modules/        module nghiệp vụ (drive, auth, actions, profile...)
   ├─ assets/, libs/  ảnh, icon, Chart.js, Lottie, QRCode
   └─ __mock/         phần thêm vào của bản clone
      ├─ mock-data.js       156 file Drive giả lập, cố định giữa các lần load
      ├─ wistorix-mock.js   giả lập chrome.* và Google Drive API
      └─ dev-toolbar.js     thanh chuyển nhanh giữa các màn hình
```

## Sửa giao diện ở đâu

| Muốn sửa | File |
|---|---|
| Bố cục, text màn hình đăng nhập, dashboard, quét dữ liệu | `app/dashboard.html` |
| Toàn bộ màu sắc, spacing, component | `app/dashboard.css` |
| Trang My Drive, Email chia sẻ, Cài đặt, Mời bạn, Nâng cấp | `app/pages/*.html` |
| Text trong bảng, thẻ KPI, toast (sinh bằng JS) | `app/dashboard.js`, khối `I18n._dict` |

Sửa xong nhấn F5. Máy chủ đã tắt cache nên không cần xoá cache trình duyệt.

## Thanh công cụ dev

Góc dưới bên phải có thanh **Wistorix clone · dữ liệu mẫu**:

- **Màn hình**: Đăng nhập · Bắt đầu quét · Đang quét · Kết quả quét · Dashboard
- **Trang**: My Drive · Email chia sẻ · Cài đặt · Mời bạn · Nâng cấp · Dọn dẹp
- **Dữ liệu**: *Nạp lại dữ liệu mẫu* dựng lại toàn bộ 156 file · *Xoá cache quét*
  đưa về trạng thái tài khoản chưa quét lần nào, bấm **QUÉT DỮ LIỆU NGAY** sẽ chạy
  hết luồng quét giả lập: màn hình tiến trình đếm tới 156/156 rồi ra màn hình kết quả
- `Ctrl + Shift + D` để ẩn hoặc hiện thanh này

Thanh này nằm trong `app/__mock/dev-toolbar.js`, xoá dòng script tương ứng
trong `<head>` là mất.

## Demo CTA theo mô hình 25 tệp mỗi ngày

Bảng điều khiển màu đen ở góc dưới bên trái, tên **Demo CTA**. Nó mô phỏng vòng
lặp hằng ngày để xem các lời mời mua xuất hiện lúc nào và nói gì.

- **Ngày 1 và 2**: dùng hết lượt chỉ hiện popup chốt ngày, nút chính là bật nhắc
  buổi sáng, không nhắc gói và không nhắc giá
- **Ngày 3 và 4**: popup chốt ngày kèm một dòng ước lượng số ngày còn lại
- **Từ ngày 5**: popup C2, lời mời mua chính, chỉ bật khi việc còn lại từ 2 ngày trở lên
- **Chọn nhanh 46 tệp** rồi bấm một nút trên thanh hành động hàng loạt để xem
  modal A1 và dòng cảnh báo vượt hạn mức
- **Sang ngày mới** sau khi đã bật nhắc sẽ hiện thông báo E1 giả lập ở góc trên

Các điểm chạm khác hiện thẳng trong giao diện: dòng chào E3 trên đầu dashboard,
thẻ hạn mức ở sidebar, chú thích dưới ba thẻ rủi ro, chú thích dưới nút xử lý hết,
và phụ đề thẻ nâng cấp đã sửa lại thành "Dọn dẹp không giới hạn số tệp".

Mọi thao tác trong demo là mô phỏng, không đụng tới dữ liệu mẫu và không gọi mạng.

### Tắt demo

Ba cách, từ nhẹ tới dứt điểm:

1. Bấm **Tắt demo** trên bảng điều khiển, có hiệu lực tới khi tải lại trang
2. Xoá dòng `<script src="__mock/cta-demo.js"></script>` trong `<head>` của
   `app/dashboard.html`, bản clone trở lại đúng như giao diện gốc
3. Xoá luôn file `app/__mock/cta-demo.js`

Demo nằm gọn trong một file và không sửa bất kỳ file gốc nào của extension,
ngoài đúng một dòng script trong `dashboard.html`.

## Mock đang giả lập những gì

- `chrome.storage.local` và `chrome.storage.sync` chạy trên `localStorage`
- `chrome.identity` trả token giả nên dashboard vào thẳng, không cần OAuth
- `chrome.runtime`, `chrome.tabs`, `chrome.notifications`, `chrome.alarms`
- `fetch` tới `googleapis.com` và `cloudfunctions.net` được chặn lại và trả dữ
  liệu mẫu: thông tin tài khoản, dung lượng Drive, danh sách file (có phân
  trang để xem được màn hình tiến trình quét), quyền chia sẻ, hồ sơ gói cước
- IndexedDB `DriveCacheDB` được nạp sẵn 156 file mẫu, gồm file công khai, file
  cũ, file trùng lặp, file rỗng, file mồ côi và file trong thùng rác

Không có yêu cầu mạng nào tới Google rời khỏi máy, không đụng tới Google Drive thật.

Hai tài nguyên vẫn tải từ CDN, giống hệt bản extension gốc: bộ icon Font Awesome
(cdnjs) và font Manrope (Google Fonts). Cần mạng để giao diện hiển thị đúng icon
và font. Nếu muốn chạy hoàn toàn offline thì tải hai thứ này về `app/libs/` rồi
sửa hai thẻ `<link>` đầu file `dashboard.html`.

## Đã kiểm thử

Bản clone được chạy thử bằng Chromium: dashboard, My Drive, Email chia sẻ, Cài đặt,
Mời bạn, Nâng cấp, Dọn dẹp đều mở đúng, không lỗi JavaScript. Luồng quét chạy trọn
vẹn từ màn hình bắt đầu tới màn hình kết quả (Risk Score, 17 công khai, 46 cũ 180+
ngày, 7 nhóm trùng lặp).

## Đưa ngược thay đổi về extension

`app/` giữ đúng tên và cấu trúc file gốc nên chép ngược sang repo extension là
được. Ba dòng script `__mock/` trong `<head>` cần gỡ bỏ, còn thư mục `__mock/`
thì không chép sang. Bản thân mock cũng tự tắt khi phát hiện đang chạy trong
extension thật (`chrome.runtime.id` tồn tại), nên nếu lỡ chép nhầm thì extension
vẫn chạy bằng dữ liệu thật.

Lưu ý: `manifest.json`, `background.js` và thư mục `_metadata/` được giữ lại chỉ
để đối chiếu, bản clone tĩnh không dùng tới.
