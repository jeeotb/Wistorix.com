// background.js
// 1. Import các hàm tiện ích từ module
import { scanDrive, syncDriveChanges, getStartPageToken } from './modules/drive.js';
import { formatBytes } from './modules/utils.js';
import { getAuthToken, getAuthTokenSilently } from './modules/auth.js';
import { trackEvent } from './src/analytics.js';
import { getLicenseInfo, isExpired, isNearExpiry, calculateDaysRemaining } from './modules/payos.js';
// Track khi extension được cài lần đầu hoặc update
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      trackEvent('extension_installed', {
        version: chrome.runtime.getManifest().version
      });
    }
    if (details.reason === 'update') {
      trackEvent('extension_updated', {
        version: chrome.runtime.getManifest().version,
        previous_version: details.previousVersion
      });
    }
    chrome.alarms.create('checkLicenseRenewal', { periodInMinutes: 1440 });
  });
  
  

// ── Xử lý token xác thực lúc khởi động ─────────────────────
// Mỗi lần extension update thay đổi scope/version, token cũ cần bị xoá để
// cấp quyền mới. Nhưng KHÔNG được xoá token trên mọi lần khởi động:
// làm vậy khiến `getAuthToken({interactive:false})` fail ngay sau reload
// → scan rơi vào fallback cache cũ / lỗi 401 token hết hạn.
const SCOPE_VERSION = chrome.runtime.getManifest().version;
(async () => {
  try {
    const stored = await chrome.storage.local.get(['authScopeVersion']);
    if (stored.authScopeVersion === SCOPE_VERSION) {
      // Scope không đổi → giữ nguyên token cache, chỉ verify nhẹ (không launch UI)
      await getAuthTokenSilently();
      return;
    }
    // Scope/version thay đổi → xoá token cũ để buộc cấp quyền mới
    const currentToken = await getAuthTokenSilently();
    if (currentToken) {
      chrome.identity.removeCachedAuthToken({ token: currentToken }, () => {});
      console.log('Token cache cũ đã xóa. Cấp quyền mới theo scope version.');
    }
    try {
      const { clearAllAccountTokens } = await import('./modules/account-manager.js');
      await clearAllAccountTokens();
    } catch (_) {}
    await chrome.storage.local.set({ authScopeVersion: SCOPE_VERSION });
  } catch (_) {
    // Không có token cache để xóa là trạng thái hợp lệ.
    try { await chrome.storage.local.set({ authScopeVersion: SCOPE_VERSION }); } catch (_) {}
  }
})();

// ── Daily license renewal check alarm ──────────────────────
chrome.alarms.get('checkLicenseRenewal', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('checkLicenseRenewal', { periodInMinutes: 1440 });
  }
});

// 3. Hàm lấy địa chỉ Email của người dùng hiện tại
async function getUserEmail(token) {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        return data.email; // Trả về ví dụ: nguyenvana@gmail.com
    } catch (e) {
        console.error("Không lấy được email user:", e);
        return null;
    }
}

// 4. Lắng nghe sự kiện báo thức (Auto Scan + License Renewal)
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'checkLicenseRenewal') {
        try {
            const license = await getLicenseInfo();
            if (!license) return;
            if (isExpired(license.expiryDate)) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'assets/icons/wistorix-icon-128.png',
                    title: 'Wistorix — License hết hạn',
                    message: 'Gói Premium của bạn đã hết hạn. Vui lòng gia hạn để tiếp tục sử dụng tính năng cao cấp.'
                });
                return;
            }
            if (isNearExpiry(license.expiryDate, 7)) {
                const days = calculateDaysRemaining(license.expiryDate);
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'assets/icons/wistorix-icon-128.png',
                    title: 'Wistorix — License sắp hết hạn',
                    message: `Gói Premium của bạn còn ${days} ngày. Vui lòng gia hạn để không bị gián đoạn.`
                });
            }
        } catch (_) { /* silent */ }
        return;
    }
    if (alarm.name === 'autoScanDrive') {
        console.log("⏰ Bắt đầu quét tự động (incremental)...");
        
        try {
            // Incremental sync: chỉ fetch thay đổi kể từ lần cuối
            // → lần đầu tự động fallback về full scan + lưu startPageToken
            const files = await syncDriveChanges();
            
            const activeFiles = files.filter(f => !f.trashed);

            // Gửi báo cáo khi có file đang hoạt động.
            if (activeFiles.length > 0) {
                await sendEmailReport(activeFiles);
            } else {
                console.log("✅ Không có file nào cần báo cáo.");
            }

        } catch (error) {
            trackEvent(
                'api_error',
                {
                    error_type:
                        'auto_scan_failure',
            
                    error_message:
                        error.message
                            ?.substring(0,100)
                }
            );
            console.error("Lỗi quy trình Auto Scan:", error);
        }
    }
});

// 5. HÀM GỬI EMAIL BÁO CÁO (CHÍNH) 
async function sendEmailReport(files) {
    try {
        const token = await getAuthToken();
        const userEmail = await getUserEmail(token);
        
        // Lấy đường dẫn tới trang Dashboard của Extension
        // Đảm bảo file hiển thị chính của bạn tên là 'dashboard.html'
        const extensionUrl = chrome.runtime.getURL("dashboard.html");

        if (!userEmail) throw new Error("Không xác định được email người nhận.");

        // --- XỬ LÝ DỮ LIỆU ---
        // 1. Chỉ lấy file của tôi (ownedByMe)
        // 2. Sắp xếp giảm dần theo kích thước (Lớn -> Bé)
        const myFiles = files
            .filter(f => f.ownedByMe) 
            .sort((a, b) => parseInt(b.size) - parseInt(a.size));

        // 3. Lấy Top 10
        const top10Files = myFiles.slice(0, 10);
        const remainingCount = myFiles.length > 10 ? myFiles.length - 10 : 0;

        if (myFiles.length === 0) {
            console.log("Không có file nào thuộc sở hữu của bạn.");
            return;
        }

        // --- TẠO HTML EMAIL ---
        
        const tdStyle = "padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 14px; vertical-align: middle;";
        const linkStyle = "color: #4e73df; text-decoration: none; font-weight: bold;";

        // Tạo các dòng bảng
        let tableRows = top10Files.map(f => `
            <tr>
                <td style="${tdStyle} color: #333;">
                    <div style="font-weight:bold; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${f.name}
                    </div>
                </td>
                <td style="${tdStyle} white-space: nowrap; color: #555;">
                    ${formatBytes(f.size)}
                </td>
                <td style="${tdStyle} text-align: right;">
                    <a href="${f.webViewLink}" style="${linkStyle}" target="_blank">Xem</a>
                </td>
            </tr>
        `).join('');

        // Thêm dòng "còn lại"
        if (remainingCount > 0) {
            tableRows += `
            <tr>
                <td colspan="3" style="padding: 10px; text-align: center; color: #888; font-style: italic; font-size: 13px;">
                    ... và còn <b>${remainingCount}</b> file khác đang chiếm bộ nhớ.
                </td>
            </tr>`;
        }

        const emailBody = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e3e6f0; border-radius: 8px; overflow: hidden;">
                
                <div style="background-color: #f8f9fc; padding: 20px; border-bottom: 2px solid #4e73df;">
                    <h2 style="color: #4e73df; margin: 0; font-size: 20px;">Wistorix</h2>
                    <p style="margin: 5px 0 0; color: #e74a3b; font-weight: bold; font-size: 14px;">🔔 Cảnh báo dung lượng</p>
                </div>

                <div style="padding: 20px;">
                    <p>Xin chào <b>${userEmail}</b>,</p>
                    <p>Hệ thống vừa quét và phát hiện <b>${myFiles.length}</b> file đang hoạt động thuộc sở hữu của bạn.</p>
                    
                    <p style="margin-bottom: 10px; font-weight: bold; color: #5a5c69;">Top 10 file lớn nhất:</p>
                    
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background-color: #eaecf4; color: #333;">
                                <th style="padding: 10px; border-radius: 4px 0 0 4px; font-size: 13px;">Tên File</th>
                                <th style="padding: 10px; font-size: 13px;">Size</th>
                                <th style="padding: 10px; border-radius: 0 4px 4px 0; text-align: right; font-size: 13px;">Link</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>

                    <br>
                    
                    <div style="text-align: center; margin-top: 20px; padding: 20px; background-color: #f8f9fc; border-radius: 8px;">
                        <a href="${extensionUrl}" target="_blank"
                         style="background-color: #4e73df; color: white; padding: 12px 25px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                           🚀 Mở Wistorix
                        </a>
                        <p style="font-size: 11px; color: #858796; margin-top: 10px; line-height: 1.4;">
                            *Nếu nút không hoạt động (do chính sách bảo mật Email),<br>
                            vui lòng bấm vào <b>biểu tượng tiện ích</b> trên trình duyệt của bạn.
                        </p>
                    </div>
                </div>

                <div style="background-color: #f1f1f1; padding: 15px; text-align: center; font-size: 11px; color: #888;">
                    Quét tự động lúc: ${new Date().toLocaleString('vi-VN')}
                </div>
            </div>
        `;

        // --- GỬI MAIL ---
        const emailContent = [
            `To: ${userEmail}`,
            `From: ${userEmail}`, // Gửi từ chính mình
            `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(`⚠️ Cảnh báo: ${myLargeFiles.length} file lớn đang chiếm dụng bộ nhớ`)))}?=`,
            `Content-Type: text/html; charset=utf-8`,
            `MIME-Version: 1.0`,
            ``,
            emailBody
        ].join('\r\n');

        const encodedEmail = btoa(unescape(encodeURIComponent(emailContent)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw: encodedEmail })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Lỗi API Gmail (${response.status}): ${errText}`);
        }

        console.log("📧 Đã gửi email thành công tới:", userEmail);
        
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'assets/icons/wistorix-icon-128.png',
            title: 'Wistorix — Auto Scan Hoàn tất',
            message: `Đã gửi báo cáo chi tiết ${myLargeFiles.length} file lớn vào email của bạn.`
        });

    } catch (err) {

        trackEvent(
            'api_error',
            {
                error_type:
                    'gmail_send_failure',
    
                error_message:
                    err.message
                        ?.substring(0,100)
            }
        );
    
        console.error(
            "❌ Lỗi gửi mail:",
            err
        );
    }
}
