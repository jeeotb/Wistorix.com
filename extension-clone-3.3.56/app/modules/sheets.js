// modules/sheets.js
import { fetchGoogleApiWithAuthRetry } from './drive.js';

export async function createGoogleSheet(files) {
  // 1. Tạo Spreadsheet
  const createRes = await fetchGoogleApiWithAuthRetry(token => fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: `Scan Drive - ${new Date().toLocaleString()}` } })
  }));
  
  if (!createRes.ok) throw new Error("Lỗi API tạo Sheet: " + createRes.statusText);
  const sheetData = await createRes.json();
  const spreadsheetId = sheetData.spreadsheetId;

  // 2. Chuẩn bị dữ liệu (cắt bớt nếu quá 500 file để tránh lỗi bộ nhớ popup)
  // Popup chịu tải kém, ta chỉ lấy 500 file đầu tiên làm mẫu
  const safeFiles = files.slice(0, 500); 
  
  const rows = safeFiles.map(f => [f.name, f.mimeType, (f.size || 0).toString(), f.webViewLink]);
  const values = [["Tên File", "Loại", "Size", "Link"], ...rows];

  // 3. Ghi dữ liệu
  const appendRes = await fetchGoogleApiWithAuthRetry(token => fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: values })
  }));
  if (!appendRes.ok) throw new Error("Lỗi API ghi Sheet: " + appendRes.statusText);

  return sheetData.spreadsheetUrl;
}
