/**
 * Canonical, non-legal invoice-preview model and renderers.
 * This module deliberately never creates legal invoice identifiers or ISSUED state.
 */

const PREVIEW_STATUS = 'BẢN XEM TRƯỚC';
const NON_LEGAL_NOTICE = 'KHÔNG PHẢI HÓA ĐƠN ĐIỆN TỬ ĐÃ PHÁT HÀNH';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const money = value => `${Math.round(Number(value || 0)).toLocaleString('vi-VN')}đ`;
const date = value => new Intl.DateTimeFormat('vi-VN').format(new Date(value || Date.now()));
const asAmount = (value, field) => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`INVALID_${field}`);
  return amount;
};

export function buildInvoicePreviewModel(transaction, buyer = transaction?.invoiceDraft?.buyer) {
  if (!transaction?.orderCode) throw new Error('MISSING_ORDER_CODE');
  if (!buyer?.recipientName || !buyer?.address || !buyer?.email) throw new Error('MISSING_BUYER');

  const total = asAmount(transaction.amount, 'TOTAL');
  const vatAmount = asAmount(transaction.vatAmount ?? transaction.vat ?? 0, 'VAT');
  const subtotal = asAmount(transaction.subtotal ?? total - vatAmount, 'SUBTOTAL');
  if (subtotal + vatAmount !== total) throw new Error('INVOICE_TOTAL_MISMATCH');

  const quantity = Math.max(1, Number.parseInt(transaction.quantity, 10) || 1);
  const unitAmount = subtotal % quantity === 0 ? subtotal / quantity : subtotal;
  const issued = transaction.invoiceStatus === 'ISSUED' && Boolean(transaction.invoice?.invoiceNumber);
  const buyerName = buyer.type === 'business' && buyer.companyName ? buyer.companyName : buyer.recipientName;

  return Object.freeze({
    orderCode: String(transaction.orderCode),
    paidAt: transaction.paidAt || transaction.createdAt || Date.now(),
    product: transaction.planName || transaction.productName || 'Dịch vụ Wistorix',
    billingCycle: transaction.cycleLabel || (quantity > 1 ? `${quantity} đơn vị` : 'Theo tháng'),
    quantity,
    unitAmount,
    subtotal,
    vatRate: total ? Math.round((vatAmount / subtotal) * 100) : 0,
    vatAmount,
    total,
    buyer: Object.freeze({
      type: buyer.type || 'personal', name: buyerName, taxCode: buyer.taxCode || '',
      address: buyer.address, email: buyer.email
    }),
    // Legal seller identity is intentionally absent until configured by provider/backend.
    seller: Object.freeze({ name: 'Wistorix', taxCode: '', address: '', email: '' }),
    invoiceStatus: issued ? 'ISSUED' : (transaction.invoiceStatus || 'DRAFT'),
    invoiceNumber: issued ? transaction.invoice.invoiceNumber : '',
    isLegalIssued: issued,
    previewStatus: issued ? '' : PREVIEW_STATUS,
    nonLegalNotice: issued ? '' : NON_LEGAL_NOTICE
  });
}

export function renderInvoicePreviewHtml(model) {
  const sellerDetails = model.seller.taxCode || model.seller.address || model.seller.email
    ? `<p>${esc(model.seller.name)}${model.seller.taxCode ? `<br>MST: ${esc(model.seller.taxCode)}` : ''}${model.seller.address ? `<br>${esc(model.seller.address)}` : ''}${model.seller.email ? `<br>${esc(model.seller.email)}` : ''}</p>`
    : '<p>Thông tin pháp nhân được cung cấp khi hóa đơn điện tử được phát hành.</p>';
  const buyerTax = model.buyer.taxCode ? `<br>MST: ${esc(model.buyer.taxCode)}` : '';
  const watermark = model.isLegalIssued ? '' : `<div class="vat-document__watermark"><strong>${PREVIEW_STATUS}</strong><span>${NON_LEGAL_NOTICE}</span></div>`;

  return `<article class="vat-document" data-order-code="${esc(model.orderCode)}">
    ${watermark}
    <h3>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</h3>
    <p class="vat-document__sub">${model.isLegalIssued ? `Ngày phát hành: ${date(model.paidAt)}` : `Bản xem trước · Ngày xuất: ${date(model.paidAt)}`}</p>
    <div class="vat-document__parties"><section><b>ĐƠN VỊ BÁN HÀNG</b>${sellerDetails}</section><section><b>NGƯỜI MUA HÀNG</b><p>${esc(model.buyer.name)}${buyerTax}<br>${esc(model.buyer.address)}<br>${esc(model.buyer.email)}</p></section></div>
    <table class="vat-document__table"><thead><tr><th>TÊN DỊCH VỤ</th><th>KỲ HẠN / SL</th><th>ĐƠN GIÁ (CHƯA VAT)</th><th>THÀNH TIỀN</th></tr></thead><tbody><tr><td>${esc(model.product)}</td><td>${esc(model.billingCycle)}</td><td>${money(model.unitAmount)}</td><td>${money(model.subtotal)}</td></tr></tbody></table>
    <div class="vat-document__totals"><div>Tiền trước VAT <b>${money(model.subtotal)}</b></div><div>VAT (${model.vatRate}%) <b>${money(model.vatAmount)}</b></div><div class="grand">Tổng thanh toán <b>${money(model.total)}</b></div></div>
  </article>`;
}

function drawText(ctx, text, x, y, options = {}) {
  ctx.font = `${options.weight || 400} ${options.size || 26}px Arial, sans-serif`;
  ctx.fillStyle = options.color || '#12203b';
  ctx.textAlign = options.align || 'left';
  ctx.fillText(String(text), x, y);
}

function createPreviewCanvas(model) {
  const canvas = document.createElement('canvas');
  canvas.width = 1654; canvas.height = 2339; // A4 at ~200 dpi
  const ctx = canvas.getContext('2d');
  const pad = 120; const right = canvas.width - pad;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#cfdae8'; ctx.lineWidth = 2; ctx.strokeRect(54, 54, canvas.width - 108, canvas.height - 108);
  drawText(ctx, 'HÓA ĐƠN GIÁ TRỊ GIA TĂNG', canvas.width / 2, 190, { size: 42, weight: 700, align: 'center' });
  drawText(ctx, `Bản xem trước · Ngày xuất: ${date(model.paidAt)}`, canvas.width / 2, 235, { size: 24, color: '#64748b', align: 'center' });
  ctx.fillStyle = 'rgba(0,82,205,.09)'; ctx.fillRect(pad, 276, right - pad, 92);
  drawText(ctx, PREVIEW_STATUS, canvas.width / 2, 315, { size: 29, weight: 700, color: '#0052cd', align: 'center' });
  drawText(ctx, NON_LEGAL_NOTICE, canvas.width / 2, 345, { size: 19, weight: 700, color: '#49617f', align: 'center' });
  ctx.strokeStyle = '#dce3ec'; ctx.lineWidth = 2; ctx.strokeRect(pad, 410, right - pad, 310);
  drawText(ctx, 'ĐƠN VỊ BÁN HÀNG', pad + 28, 460, { size: 21, weight: 700, color: '#64748b' });
  drawText(ctx, 'NGƯỜI MUA HÀNG', pad + 720, 460, { size: 21, weight: 700, color: '#64748b' });
  drawText(ctx, 'Wistorix', pad + 28, 508, { size: 28, weight: 700 });
  drawText(ctx, 'Thông tin pháp nhân sẽ được cung cấp khi phát hành.', pad + 28, 550, { size: 20, color: '#64748b' });
  const buyerLines = [model.buyer.name, model.buyer.taxCode && `MST: ${model.buyer.taxCode}`, model.buyer.address, model.buyer.email].filter(Boolean);
  buyerLines.forEach((line, index) => drawText(ctx, line, pad + 720, 508 + index * 38, { size: index === 0 ? 28 : 22, weight: index === 0 ? 700 : 400, color: index === 0 ? '#12203b' : '#475569' }));
  const tableY = 780; const cols = [pad, 670, 990, right];
  ctx.fillStyle = '#f3f6fa'; ctx.fillRect(pad, tableY, right - pad, 66);
  ['TÊN DỊCH VỤ', 'KỲ HẠN / SL', 'ĐƠN GIÁ (CHƯA VAT)', 'THÀNH TIỀN'].forEach((header, index) => drawText(ctx, header, cols[index] + 18, tableY + 41, { size: 18, weight: 700, color: '#52647d' }));
  ctx.strokeStyle = '#dce3ec'; ctx.strokeRect(pad, tableY, right - pad, 150); ctx.beginPath(); ctx.moveTo(pad, tableY + 66); ctx.lineTo(right, tableY + 66); ctx.stroke();
  [model.product, model.billingCycle, money(model.unitAmount), money(model.subtotal)].forEach((value, index) => drawText(ctx, value, cols[index] + 18, tableY + 112, { size: 22, color: '#12203b' }));
  const totalsX = 970; const totalsY = 1060;
  [[`Tiền trước VAT`, money(model.subtotal)], [`VAT (${model.vatRate}%)`, money(model.vatAmount)], ['TỔNG THANH TOÁN', money(model.total)]].forEach(([label, value], index) => {
    const y = totalsY + index * 58;
    if (index === 2) { ctx.strokeStyle = '#aabbd0'; ctx.beginPath(); ctx.moveTo(totalsX - 18, y - 32); ctx.lineTo(right, y - 32); ctx.stroke(); }
    drawText(ctx, label, totalsX, y, { size: index === 2 ? 26 : 22, weight: index === 2 ? 700 : 400, color: index === 2 ? '#0052cd' : '#475569' });
    drawText(ctx, value, right, y, { size: index === 2 ? 27 : 22, weight: 700, color: index === 2 ? '#0052cd' : '#12203b', align: 'right' });
  });
  drawText(ctx, `Mã giao dịch: ${model.orderCode}`, pad, 2140, { size: 19, color: '#64748b' });
  drawText(ctx, NON_LEGAL_NOTICE, canvas.width / 2, 2190, { size: 18, weight: 700, color: '#64748b', align: 'center' });
  return canvas;
}

function jpegPdfBlob(canvas) {
  const jpeg = Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.96).split(',')[1]), char => char.charCodeAt(0));
  const encoder = new TextEncoder(); const chunks = []; let size = 0;
  const add = value => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); size += bytes.length; };
  const offsets = [0];
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (number, body, stream) => { offsets[number] = size; add(`${number} 0 obj\n${body}${stream ? '\nstream\n' : '\n'}`); if (stream) add(stream); add(stream ? '\nendstream\nendobj\n' : 'endobj\n'); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>');
  const pageContent = 'q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ';
  obj(4, `<< /Length ${encoder.encode(pageContent).length} >>`, pageContent);
  obj(5, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  const xref = size; add(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(i => `${String(offsets[i]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

export function downloadInvoicePreviewPdf(model) {
  if (model.isLegalIssued) throw new Error('PROVIDER_PDF_REQUIRED');
  const url = URL.createObjectURL(jpegPdfBlob(createPreviewCanvas(model)));
  const link = document.createElement('a');
  link.href = url; link.download = `Wistorix-VAT-Preview-${String(model.orderCode).replace(/[^a-z0-9_-]/gi, '_')}.pdf`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const INVOICE_PREVIEW_STATUS = { PREVIEW_STATUS, NON_LEGAL_NOTICE };
