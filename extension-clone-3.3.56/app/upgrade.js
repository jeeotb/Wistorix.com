import { getAuthTokenSilently } from './modules/auth.js';
import { createPaymentLink, getCloudFunctionBase } from './modules/payos.js';
import { trackEvent } from './src/analytics.js';
import { initProfile, getActiveAccount } from './modules/profile.js';
import { computeCredits } from './modules/actions.js';
import { normalizeSubscriptionPlan } from './modules/entitlement.js';
import { buildInvoicePreviewModel, downloadInvoicePreviewPdf, renderInvoicePreviewHtml } from './modules/invoice-template.js';
import { loadVatProfile, saveVatProfile } from './modules/vat-profile.js';
import { getActiveAccountId } from './modules/account-manager.js';

const PRODUCTS = {
  one_wistorix_v3: {
    id: 'one_wistorix_v3',
    name: 'ONE-WISTORIX',
    monthlyPrice: 59000,
    yearlyPrice: 429000
  },
  scan_pack: {
    id: 'scan_pack',
    name: 'Gói lượt quét',
    type: 'one_time'
  }
};

const WISTORIX_SUPPORT_URL = 'https://m.me/wistorix';

function openWistorixSupport() {
  try {
    if (chrome?.tabs?.create) { chrome.tabs.create({ url: WISTORIX_SUPPORT_URL }); return true; }
  } catch (_) {}
  try { return !!window.open(WISTORIX_SUPPORT_URL, '_blank', 'noopener,noreferrer'); } catch (_) { return false; }
}

function getScanUnitPrice(quantity) {
  if (quantity >= 10) return 32000;
  if (quantity >= 5) return 36000;
  return 40000;
}

function calculateScanTotal(quantity) {
  return quantity * getScanUnitPrice(quantity);
}

let currentPlan = null;
let currentStep = 1;
let _currentPayment = null;
let _currentCycle = 'monthly';
let _currentEmail = null;
let _currentQuantity = 1;
let _currentProduct = null;
let _qrCountdownInterval = null;
let _paymentPollInterval = null;
let _paymentPollAbortController = null;
let _paymentPollGeneration = 0;
let _currentTransaction = null;

const Toast = {
  _container: null,
  _getContainer() {
    if (!this._container) {
      this._container = document.getElementById('toast-container-settings');
      if (!this._container) {
        this._container = document.createElement('div');
        this._container.id = 'toast-container-settings';
        this._container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
        document.body.appendChild(this._container);
      }
    }
    return this._container;
  },
  show(message, type, duration) {
    const colors = { success: '#10b981', error: '#e74a3b', warning: '#f59e0b', info: '#0052CD' };
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const bg = colors[type] || colors.info;
    const icon = icons[type] || icons.info;
    const el = document.createElement('div');
    el.style.cssText = `background:${bg};color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,0.18);pointer-events:all;opacity:0;transition:opacity 0.3s,transform 0.3s;transform:translateX(30px);max-width:320px;word-break:break-word;display:flex;align-items:center;gap:8px;`;
    el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    this._getContainer().appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(0)'; });
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translateX(30px)';
      setTimeout(() => el.remove(), 350);
    }, duration || 3500);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg) { this.show(msg, 'info'); }
};

async function getActiveUserAccount() {
  const profile = getActiveAccount();
  if (profile && profile.email) {
    return profile;
  }
  try {
    const token = await getAuthTokenSilently();
    if (!token) return null;
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const info = await res.json();
    if (info.email) {
      return { id: info.id, name: info.name, email: info.email };
    }
  } catch (_) {}
  return null;
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getBackendPlan(product, billingCycle) {
  if (product === 'scan_pack') return 'scan_pack';
  const bc = billingCycle === 'month' ? 'monthly' : billingCycle === 'year' ? 'yearly' : billingCycle;
  return `${product}_${bc}`;
}

function mapPurchaseToCreatePaymentPayload(state) {
  const { email, product, billingCycle, quantity } = state;
  const qty = quantity || 1;
  let unitPrice, subtotal, plan;
  if (product === 'scan_pack') {
    unitPrice = getScanUnitPrice(qty);
    subtotal = unitPrice * qty;
    plan = 'scan_pack';
  } else {
    const info = PRODUCTS[product];
    if (!info) throw new Error('Sản phẩm không hợp lệ: ' + product);
    unitPrice = billingCycle === 'yearly' ? info.yearlyPrice : info.monthlyPrice;
    subtotal = unitPrice * (info.perDrive ? qty : 1);
    plan = `${product}_${billingCycle || 'monthly'}`;
  }
  const vat = Math.round(subtotal * 0.08);
  const total = subtotal + vat;
  return {
    email,
    product,
    productName: product === 'scan_pack' ? 'Gói lượt quét' : (PRODUCTS[product]?.name || product),
    billingCycle: billingCycle || 'monthly',
    quantity: qty,
    unitPrice,
    subtotal,
    vat,
    total,
    plan
  };
}

function renderOrderSummary(product, cycle, quantity) {
  if (product === 'scan_pack') {
    const total = calculateScanTotal(quantity);
    const unitPrice = getScanUnitPrice(quantity);
    const vat = Math.round(total * 0.08);
    const grandTotal = total + vat;
    document.getElementById('order-summary').innerHTML = `
      <div class="row"><span class="lbl">Sản phẩm</span><span class="val">Gói lượt quét</span></div>
      <div class="row"><span class="lbl">Chu kỳ / Số lượng</span><span class="val">${quantity} lượt</span></div>
      <div class="row"><span class="lbl">Đơn giá</span><span class="val">${unitPrice.toLocaleString('vi-VN')}đ / lượt</span></div>
      <div class="row"><span class="lbl">Tạm tính</span><span class="val">${total.toLocaleString('vi-VN')}đ</span></div>
      <div class="row"><span class="lbl">VAT (8%)</span><span class="val">${vat.toLocaleString('vi-VN')}đ</span></div>
      <div class="row total"><span class="lbl">Tổng cộng</span><span class="val" id="qr-amount">${grandTotal.toLocaleString('vi-VN')}đ</span></div>
    `;
    return;
  }
  const info = PRODUCTS[product];
  if (!info) return;
  const unitPrice = cycle === 'yearly' ? info.yearlyPrice : info.monthlyPrice;
  const price = unitPrice * (info.perDrive ? quantity : 1);
  const vat = Math.round(price * 0.08);
  const total = price + vat;
  const cycleLabel = cycle === 'yearly' ? 'Theo năm' : 'Theo tháng';
  document.getElementById('order-summary').innerHTML = `
    <div class="row"><span class="lbl">Sản phẩm</span><span class="val">${info.name}</span></div>
    <div class="row"><span class="lbl">Chu kỳ / Số lượng</span><span class="val">${info.perDrive ? `${quantity} Drive · ` : ''}${cycleLabel}</span></div>
    <div class="row"><span class="lbl">Đơn giá</span><span class="val">${unitPrice.toLocaleString('vi-VN')}đ${info.perDrive ? ' / Drive' : ''}</span></div>
    <div class="row"><span class="lbl">Tạm tính</span><span class="val">${price.toLocaleString('vi-VN')}đ</span></div>
    <div class="row"><span class="lbl">VAT (8%)</span><span class="val">${vat.toLocaleString('vi-VN')}đ</span></div>
    <div class="row total"><span class="lbl">Tổng cộng</span><span class="val" id="qr-amount">${total.toLocaleString('vi-VN')}đ</span></div>
  `;
}

function showStep(step) {
  currentStep = step;
  document.querySelectorAll('.step-panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.modal-stepper .step').forEach(el => {
    el.classList.remove('active', 'done');
    const num = parseInt(el.dataset.step);
    if (num < step) el.classList.add('done');
    else if (num === step) el.classList.add('active');
  });
  document.querySelectorAll('.modal-stepper .connector').forEach((el, idx) => {
    el.classList.toggle('done', idx < step - 1);
  });
  const panel = document.getElementById(`upgrade-step-${step}`);
  if (panel) panel.classList.add('active');
}

function _clearQRInterval() {
  if (_qrCountdownInterval) {
    clearInterval(_qrCountdownInterval);
    _qrCountdownInterval = null;
  }
}

function _clearPaymentPolling() {
  _paymentPollGeneration += 1;
  if (_paymentPollInterval) {
    clearTimeout(_paymentPollInterval);
    _paymentPollInterval = null;
  }
  if (_paymentPollAbortController) {
    _paymentPollAbortController.abort();
    _paymentPollAbortController = null;
  }
}

async function handleProceedPayment() {
  const email = normalizeEmail(_currentEmail);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    Toast.error('Không lấy được email từ tài khoản Google hiện tại. Vui lòng đăng nhập lại.');
    return;
  }
  const product = _currentProduct || 'one_wistorix_v3';
  const cycle = _currentCycle;
  const quantity = _currentQuantity || 1;
  const btn = document.getElementById('btn-proceed-payment');
  if (!btn) return;
  if (btn.disabled) return;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo...';
  try {
    try { trackEvent('checkout_started', { product, cycle }); } catch (_) {}
    const account = await getActiveUserAccount();
    const buyerName = account?.name || email.split('@')[0];
    const payload = mapPurchaseToCreatePaymentPayload({ email, product, billingCycle: cycle, quantity });
    payload.buyerName = buyerName;
    const result = await createPaymentLink(payload);
    _currentPayment = result;
    showStep(2);
    renderQR(result);
    const remainingSeconds = result.expiredAt ? Math.max(0, Math.floor(result.expiredAt - Math.floor(Date.now() / 1000))) : 300;
    _startQRCountdown(remainingSeconds);
    _startPaymentPolling(result.orderCode);
    try {
      trackEvent('payment_created', { product, plan: payload.plan, orderCode: result.orderCode });
      trackEvent('checkout_success', { product, cycle });
    } catch (_) {}
  } catch (err) {
    const msg = err.message || 'Lỗi không xác định';
    Toast.error('Tạo thanh toán thất bại: ' + msg);
    try {
      trackEvent('payment_failed', { error: msg.substring(0, 100), product, cycle });
      trackEvent('checkout_failed', { error: msg.substring(0, 100), product, cycle });
    } catch (_) {}
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Tiếp tục →';
  }
}

const BANK_MAP = {
  '970448': 'BIDV', '970415': 'MB Bank', '970422': 'Techcombank',
  '970436': 'VPBank', '970423': 'TPBank', '970425': 'ACB',
  '970441': 'Sacombank', '970416': 'VietinBank', '970418': 'Vietcombank',
  '970454': 'PayPal/Visa/Mastercard', '970407': 'SHB', '970432': 'VIB',
  '970412': 'HDBank', '970426': 'MSB', '970437': 'Oceanbank',
  '970443': 'PVcombank', '970457': 'Nam A Bank', '970446': 'OCB',
  '970455': 'Saigonbank', '970406': 'VietBank', '970427': 'Bac A Bank',
};

function _getBankName(bin) {
  if (!bin) return null;
  return BANK_MAP[bin] || null;
}

function extractQrValue(paymentData) {
  return (
    paymentData?.qrCodeRaw ||
    paymentData?.qrCode ||
    paymentData?.qrDataUrl ||
    paymentData?.qrDataURL ||
    paymentData?.qrImageUrl ||
    paymentData?.qrImage ||
    paymentData?.qrUrl ||
    paymentData?.data?.qrCode ||
    paymentData?.data?.qrImageUrl ||
    paymentData?.data?.qrUrl ||
    paymentData?.payment?.qrCode ||
    ''
  );
}

function detectQrType(value) {
  if (typeof value !== 'string') return 'missing';
  const qr = value.trim();
  if (!qr) return 'missing';
  if (/^data:image\/(?:png|jpeg|jpg|webp|svg\+xml);base64,/i.test(qr)) return 'data-url';
  if (/^https?:\/\//i.test(qr)) return 'remote-url';
  if (/^blob:/i.test(qr)) return 'blob-url';
  if (/^000201/i.test(qr)) return 'raw-vietqr';
  return 'text';
}

function _qrCanvasFill(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return ctx;
}

function _qrCanvasMessage(canvas, text, color) {
  const ctx = _qrCanvasFill(canvas);
  ctx.font = '13px Manrope, sans-serif';
  ctx.fillStyle = color || '#6B7280';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function _drawQrTextToCanvas(canvas, text) {
  _qrCanvasMessage(canvas, 'Đang tạo mã QR...');
  try {
    const host = document.createElement('div');
    const qr = new QRCode(host, {
      width: canvas.width,
      height: canvas.height,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
    qr.makeCode(text);
    const generated = host.querySelector('canvas');
    if (!generated) {
      throw new Error('QR generation returned no canvas');
    }
    const ctx = _qrCanvasFill(canvas);
    ctx.drawImage(generated, 0, 0, canvas.width, canvas.height);
  } catch (err) {
    console.error('[Payment QR] generate failed', {
      type: detectQrType(text),
      error: err
    });
    _qrCanvasMessage(canvas, 'Không thể tải mã QR', '#ef4444');
  }
}

function _drawQrImageToCanvas(canvas, src) {
  _qrCanvasMessage(canvas, 'Đang tải mã QR...');
  const img = new Image();
  img.onload = function () {
    const ctx = _qrCanvasFill(canvas);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.onerror = function () {
    _qrCanvasMessage(canvas, 'Không thể tải mã QR', '#ef4444');
  };
  img.src = src;
}

function renderQrImage(canvas, qrValue) {
  const type = detectQrType(qrValue);
  console.debug('[Payment QR]', {
    type,
    length: typeof qrValue === 'string' ? qrValue.trim().length : 0
  });
  switch (type) {
    case 'data-url':
    case 'remote-url':
    case 'blob-url':
      _drawQrImageToCanvas(canvas, qrValue.trim());
      break;
    default:
      _drawQrTextToCanvas(canvas, qrValue.trim());
      break;
  }
}

function renderQR(data) {
  document.getElementById('qr-amount').textContent = data.amount ? Number(data.amount).toLocaleString('vi-VN') + 'đ' : '—';
  document.getElementById('qr-amount-label').textContent = data.amount ? Number(data.amount).toLocaleString('vi-VN') + 'đ' : '—';
  document.getElementById('qr-account-number').textContent = '0364173472';
  document.getElementById('qr-bank-name').textContent = 'MB Bank';
  document.getElementById('qr-content').textContent = data.description || data.orderCode || '—';
  const canvas = document.getElementById('qr-canvas');
  if (!canvas) return;
  const qrValue = extractQrValue(data);
  if (!qrValue) {
    _qrCanvasMessage(canvas, 'Không thể tải mã QR', '#ef4444');
    return;
  }
  renderQrImage(canvas, qrValue);
}

function _startQRCountdown(seconds) {
  _clearQRInterval();
  const el = document.getElementById('qr-countdown');
  if (!el) return;
  let remaining = seconds;
  el.textContent = _formatCountdown(remaining);
  _qrCountdownInterval = setInterval(() => {
    remaining--;
    el.textContent = _formatCountdown(remaining);
    if (remaining <= 0) {
      _clearQRInterval();
      el.textContent = 'Đã hết hạn';
      const statusEl = document.getElementById('qr-poll-status');
      if (statusEl) {
        statusEl.className = 'poll-status info';
        statusEl.style.display = 'block';
        statusEl.textContent = 'Mã thanh toán đã hết hạn. Vui lòng tạo giao dịch mới.';
      }
    }
  }, 1000);
}

function _formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function _checkPaymentStatus(orderCode, signal) {
  const cloudBase = await getCloudFunctionBase();
  const baseUrl = cloudBase || 'https://us-central1-wistorix.cloudfunctions.net';
  const res = await fetch(`${baseUrl}/checkPaymentStatus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderCode }),
    signal
  });
  if (!res.ok) throw new Error(`Payment status HTTP ${res.status}`);
  return res.json();
}

async function _applyFulfillmentEntitlement(entitlement) {
  if (!entitlement?.email) return;
  const { listSignedInAccounts, upsertAccount } = await import('./modules/account-manager.js');
  const account = (await listSignedInAccounts()).find((item) => normalizeEmail(item.email) === normalizeEmail(entitlement.email));
  if (!account) return;
  const subscription = entitlement.subscription || {};
  const normalizedPlan = normalizeSubscriptionPlan(subscription);
  await upsertAccount({
    ...account,
    plan: normalizedPlan.tier,
    subscription: {
      status: normalizedPlan.status,
      plan: normalizedPlan.plan,
      validUntil: normalizedPlan.validUntil
    },
    subscriptionStatus: normalizedPlan.status,
    subscriptionValidUntil: normalizedPlan.validUntil
  });
  await chrome.storage.local.set({
    [`ws_entitlement::${account.id}`]: {
      email: entitlement.email,
      cleanupCredits: Number(entitlement.cleanupCredits) || 0,
      subscription,
      refreshedAt: new Date().toISOString()
    }
  });
  if (normalizeEmail(getActiveAccount()?.email) === normalizeEmail(entitlement.email)) {
    await initProfile();
    renderCurrentPlan();
    await updateCurrentPlanCredits();
  }
}

async function _finalizeConfirmedPayment(status) {
  if (!_currentPayment || String(status.orderCode) !== String(_currentPayment.orderCode)) return;
  if (status.fulfillment?.status !== 'FULFILLED') return;
  _clearQRInterval();
  _clearPaymentPolling();
  await _applyFulfillmentEntitlement(status.fulfillment.entitlement);
  const tx = _buildTransactionFromPayment(status);
  _currentTransaction = await _saveTransaction(tx);
  _populateStep3Real(_currentTransaction);
  await renderInvoices();
  showStep(3);
}

function _startPaymentPolling(orderCode) {
  _clearPaymentPolling();
  const generation = _paymentPollGeneration;
  let consecutiveFailures = 0;

  const schedule = (delay) => {
    if (generation !== _paymentPollGeneration || !_currentPayment || String(_currentPayment.orderCode) !== String(orderCode)) return;
    _paymentPollInterval = setTimeout(poll, delay);
  };

  const poll = async () => {
    if (generation !== _paymentPollGeneration || !_currentPayment || String(_currentPayment.orderCode) !== String(orderCode)) return;
    const controller = new AbortController();
    _paymentPollAbortController = controller;
    try {
      const status = await _checkPaymentStatus(orderCode, controller.signal);
      if (generation !== _paymentPollGeneration || !_currentPayment || String(_currentPayment.orderCode) !== String(orderCode)) return;
      consecutiveFailures = 0;
      if (status.status === 'PAID' && status.paid === true) {
        if (status.fulfillment?.status === 'FULFILLED') {
          await _finalizeConfirmedPayment(status);
        } else if (status.fulfillment?.status === 'FAILED') {
          _clearQRInterval();
          _clearPaymentPolling();
          const statusEl = document.getElementById('qr-poll-status');
          if (statusEl) {
            statusEl.className = 'poll-status error';
            statusEl.style.display = 'block';
            statusEl.textContent = 'Thanh toán đã nhận nhưng không thể kích hoạt quyền sử dụng. Vui lòng liên hệ hỗ trợ.';
          }
        } else {
          const statusEl = document.getElementById('qr-poll-status');
          if (statusEl) {
            statusEl.className = 'poll-status info';
            statusEl.style.display = 'block';
            statusEl.textContent = 'Thanh toán đã nhận. Đang kích hoạt quyền sử dụng...';
          }
          schedule(5000);
        }
      } else if (status.status === 'EXPIRED' || status.status === 'CANCELLED') {
        _clearQRInterval();
        _clearPaymentPolling();
        document.getElementById('qr-countdown').textContent = 'Đã hết hạn';
      } else {
        schedule(5000);
      }
    } catch (err) {
      if (err.name === 'AbortError' || generation !== _paymentPollGeneration) return;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        _clearPaymentPolling();
        const statusEl = document.getElementById('qr-poll-status');
        if (statusEl) {
          statusEl.className = 'poll-status info';
          statusEl.style.display = 'block';
          statusEl.textContent = 'Không thể kiểm tra trạng thái thanh toán. Vui lòng thử lại sau.';
        }
        return;
      }
      schedule(Math.min(5000 * (2 ** consecutiveFailures), 30000));
    } finally {
      if (_paymentPollAbortController === controller) _paymentPollAbortController = null;
    }
  };
  schedule(0);
}

function _buildTransactionFromPayment(status) {
  const isScanPack = _currentProduct === 'scan_pack';
  const fulfilledValidUntil = status.fulfillment?.entitlement?.subscription?.validUntil;
  let planName, cycleLabel, quantity;
  if (isScanPack) {
    const qty = _currentQuantity || 5;
    planName = `Mua ${qty} lượt quét`;
    cycleLabel = `${qty} lượt`;
    quantity = qty;
  } else {
    const info = PRODUCTS[_currentProduct];
    planName = info ? info.name : 'ONE-WISTORIX';
    cycleLabel = _currentCycle === 'yearly' ? 'Theo năm' : 'Theo tháng';
    quantity = 1;
  }
  const amount = Number(status.amount || _currentPayment?.amount || 0);
  return {
    orderCode: _currentPayment?.orderCode || '',
    purchaseType: isScanPack ? 'scan_pack' : 'subscription',
    planName,
    cycleLabel,
    quantity,
    amount: Number(amount),
    subtotal: Number(_currentPayment?.subtotal || 0),
    vat: Number(_currentPayment?.vat || 0),
    paymentMethod: 'QR / Chuyển khoản',
    status: 'PAID',
    paidAt: status.paidAt || new Date().toISOString(),
    validUntil: fulfilledValidUntil || (status.validUntil && status.validUntil !== 'N/A' ? status.validUntil : null),
    email: _currentEmail || '',
    invoiceStatus: 'NOT_ISSUED',
    invoice: null
  };
}

function _readVatForm() {
  const personalForm = document.querySelector('.vat-form.personal');
  const businessForm = document.querySelector('.vat-form.business');
  const isPersonal = personalForm && personalForm.style.display !== 'none';
  if (isPersonal) {
    return {
      type: 'personal',
      recipientName: document.getElementById('vat-name')?.value || '',
      email: document.getElementById('vat-email')?.value || '',
      address: document.getElementById('vat-address')?.value || '',
      companyName: '',
      taxCode: ''
    };
  }
  return {
    type: 'business',
    recipientName: document.getElementById('vat-biz-name')?.value || '',
    email: document.getElementById('vat-biz-email')?.value || '',
    address: document.getElementById('vat-biz-address')?.value || '',
    companyName: document.getElementById('vat-company')?.value || '',
    taxCode: document.getElementById('vat-tax')?.value || ''
  };
}

function _isValidVatProfile(profile) {
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email || '');
  return Boolean(profile.recipientName && profile.address && emailOk
    && (profile.type !== 'business' || (profile.companyName && profile.taxCode)));
}

function _setVatProfileTab(type) {
  const isBusiness = type === 'business';
  const personalForm = document.querySelector('.vat-form.personal');
  const businessForm = document.querySelector('.vat-form.business');
  if (personalForm) personalForm.style.display = isBusiness ? 'none' : 'flex';
  if (businessForm) businessForm.style.display = isBusiness ? 'flex' : 'none';
  document.querySelectorAll('.vat-tab').forEach(tab => {
    tab.classList.toggle('active', isBusiness ? !tab.textContent.includes('Cá nhân') : tab.textContent.includes('Cá nhân'));
  });
}

async function _loadSavedVatProfile() {
  const accountId = await getActiveAccountId();
  const profile = await loadVatProfile();
  if (accountId !== await getActiveAccountId() || !profile) return profile;
  document.getElementById('vat-name').value = profile.type === 'personal' ? profile.recipientName : '';
  document.getElementById('vat-email').value = profile.type === 'personal' ? profile.email : '';
  document.getElementById('vat-address').value = profile.type === 'personal' ? profile.address : '';
  document.getElementById('vat-biz-name').value = profile.type === 'business' ? profile.recipientName : '';
  document.getElementById('vat-biz-email').value = profile.type === 'business' ? profile.email : '';
  document.getElementById('vat-biz-address').value = profile.type === 'business' ? profile.address : '';
  document.getElementById('vat-company').value = profile.type === 'business' ? profile.companyName : '';
  document.getElementById('vat-tax').value = profile.type === 'business' ? profile.taxCode : '';
  _setVatProfileTab(profile.type);
  return profile;
}

async function _saveVatProfile(button) {
  const profile = _readVatForm();
  if (!_isValidVatProfile(profile)) {
    Toast.error('Vui lòng điền đầy đủ thông tin hóa đơn hợp lệ.');
    return;
  }
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await saveVatProfile(profile);
    Toast.success('Đã lưu thông tin xuất hóa đơn.');
  } catch (error) {
    console.warn('Unable to save VAT profile', error);
    Toast.error('Không thể lưu thông tin xuất hóa đơn. Vui lòng thử lại.');
  } finally {
    if (button) button.disabled = false;
  }
}

function _populateStep3Real(tx) {
  document.getElementById('txn-id').textContent = tx.orderCode || '—';
  document.getElementById('txn-product').textContent = tx.planName || '—';
  document.getElementById('txn-cycle').textContent = tx.cycleLabel || '—';
  const amount = tx.amount != null ? tx.amount.toLocaleString('vi-VN') + 'đ' : '—';
  document.getElementById('txn-amount').textContent = amount;
  document.getElementById('txn-time').textContent = _fmtDateTime(tx.paidAt);
  document.getElementById('txn-expiry').textContent = tx.validUntil ? _fmtDateShort(tx.validUntil) : 'Không thời hạn';
}

let _vatTransaction = null;
let _vatType = 'personal';
let _issuingVat = false;
let _vatPreviewModel = null;
function _showVatStep(step) {
  document.querySelectorAll('#vat-invoice-modal .step-panel').forEach(el => el.classList.remove('active'));
  document.getElementById(`vat-step-${step}`)?.classList.add('active');
  document.querySelectorAll('[data-vat-step]').forEach(el => {
    const value = Number(el.dataset.vatStep);
    el.classList.toggle('active', value === step);
    el.classList.toggle('done', value < step);
  });
  document.querySelectorAll('#vat-invoice-modal .connector').forEach((el, index) => el.classList.toggle('done', index < step - 1));
}
function _formatMoney(amount) { return Number(amount || 0).toLocaleString('vi-VN') + 'đ'; }
async function _openVatInvoice(tx) {
  if (!tx || tx.invoiceStatus === 'ISSUED') return;
  const accountId = await getActiveAccountId();
  const savedProfile = await loadVatProfile();
  if (accountId !== await getActiveAccountId()) return _openVatInvoice(tx);
  _vatTransaction = tx;
  const account = getActiveAccount();
  document.getElementById('vat-transaction-summary').innerHTML = `<div class="row"><span class="lbl">Mã giao dịch</span><span class="val">${tx.orderCode}</span></div><div class="row"><span class="lbl">Sản phẩm</span><span class="val">${tx.planName}</span></div><div class="row total"><span class="lbl">Số tiền thanh toán</span><span class="val">${_formatMoney(tx.amount)}</span></div>`;
  const draft = tx.invoiceDraft?.buyer;
  const buyer = draft?.recipientName ? draft : (savedProfile || {});
  _vatType = buyer.type || 'personal';
  document.getElementById('vat-invoice-name').value = buyer.recipientName || account?.name || '';
  document.getElementById('vat-invoice-address').value = buyer.address || '';
  document.getElementById('vat-invoice-email').value = buyer.email || tx.email || account?.email || '';
  document.getElementById('vat-invoice-company').value = buyer.companyName || '';
  document.getElementById('vat-invoice-tax').value = buyer.taxCode || '';
  document.querySelectorAll('.vat-invoice-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.type === _vatType));
  document.querySelectorAll('.vat-business-field').forEach(el => { el.style.display = _vatType === 'business' ? '' : 'none'; });
  _vatPreviewModel = null;
  document.getElementById('vat-invoice-modal').classList.add('is-open');
  document.body.style.overflow = 'hidden';
  _showVatStep(1);
}
function _vatFormData() {
  const name = document.getElementById('vat-invoice-name').value.trim();
  const address = document.getElementById('vat-invoice-address').value.trim();
  const email = document.getElementById('vat-invoice-email').value.trim();
  const companyName = document.getElementById('vat-invoice-company').value.trim();
  const taxCode = document.getElementById('vat-invoice-tax').value.trim();
  document.querySelectorAll('#vat-invoice-modal .step-field input').forEach(input => input.classList.remove('is-invalid'));
  const invalid = !name || !address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (_vatType === 'business' && (!companyName || !taxCode));
  if (invalid) {
    [['vat-invoice-name', name], ['vat-invoice-address', address], ['vat-invoice-email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)], ['vat-invoice-company', _vatType !== 'business' || companyName], ['vat-invoice-tax', _vatType !== 'business' || taxCode]].forEach(([id, valid]) => {
      if (!valid) document.getElementById(id)?.classList.add('is-invalid');
    });
    return null;
  }
  return { type: _vatType, recipientName: name, address, email, companyName, taxCode };
}
async function _renderVatPreview(form) {
  try {
    const model = buildInvoicePreviewModel(_vatTransaction, form);
    const updated = {
      ..._vatTransaction,
      invoiceStatus: _vatTransaction.invoiceStatus === 'ISSUED' ? 'ISSUED' : 'DRAFT',
      invoiceDraft: {
        buyer: form,
        subtotal: model.subtotal,
        vatAmount: model.vatAmount,
        total: model.total,
        updatedAt: new Date().toISOString()
      }
    };
    _vatTransaction = await _updateTransaction(updated);
    _vatPreviewModel = buildInvoicePreviewModel(_vatTransaction, form);
    document.getElementById('vat-preview').innerHTML = renderInvoicePreviewHtml(_vatPreviewModel);
    return true;
  } catch (error) {
    console.warn('Unable to render VAT preview', error);
    Toast.error('Dữ liệu thanh toán không nhất quán; không thể tạo bản xem trước hóa đơn.');
    return false;
  }
}
async function _issueVatInvoice() {
  if (_issuingVat || !_vatTransaction || _vatTransaction.invoiceStatus === 'ISSUED') return;
  const form = _vatFormData();
  if (!form) return Toast.error('Vui lòng điền đầy đủ thông tin hóa đơn hợp lệ.');
  const issueError = document.getElementById('vat-issue-error');
  const button = document.getElementById('btn-vat-issue');
  _issuingVat = true;
  button.disabled = true;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang phát hành...';
  if (issueError) { issueError.textContent = 'INVOICE_PROVIDER_REQUIRED: Chưa cấu hình dịch vụ phát hành hóa đơn điện tử. Thông tin xem trước chưa được phát hành.'; issueError.hidden = false; }
  _issuingVat = false;
  button.disabled = false;
  button.innerHTML = 'Xác nhận &amp; Phát hành →';
}
function _closeVatInvoice() { document.getElementById('vat-invoice-modal').classList.remove('is-open'); document.body.style.overflow = ''; }
function _downloadInvoicePdf(tx) {
  const activeEmail = String(getActiveAccount()?.email || '').trim().toLowerCase();
  const transactionEmail = String(tx?.email || '').trim().toLowerCase();
  if (!tx || !activeEmail || (transactionEmail && transactionEmail !== activeEmail)) {
    Toast.error('Không có quyền tải chứng từ của giao dịch này.');
    return;
  }
  if (tx.invoiceStatus === 'ISSUED') {
    if (!tx.invoice?.pdfReference) Toast.error('PDF hóa đơn đã phát hành chưa khả dụng từ nhà cung cấp.');
    else Toast.error('INVOICE_PROVIDER_REQUIRED: Chưa có endpoint tải PDF hóa đơn đã phát hành.');
    return;
  }
  if (!tx.invoiceDraft?.buyer) {
    Toast.error('Chưa có bản xem trước hóa đơn để tải.');
    return;
  }
  try {
    downloadInvoicePreviewPdf(buildInvoicePreviewModel(tx, tx.invoiceDraft.buyer));
    Toast.success('Đang tải bản PDF xem trước.');
  } catch (error) {
    console.warn('Unable to download VAT preview PDF', error);
    Toast.error('Không thể tạo bản PDF xem trước từ giao dịch này.');
  }
}

const _legacyRoute = (target) => {
  const m = target ? target.match(/([a-z0-9-]+\.html)(#([^)]*))?/i) : null;
  if (m) {
    const map = { 'dashboard.html': '/dashboard', 'mydrive.html': '/mydrive', 'email-shared.html': '/email-shared', 'settings.html': '/settings', 'invite.html': '/invite', 'upgrade.html': '/upgrade', 'cleanup.html': '/cleanup' };
    return map[m[1]] || ('/' + m[1].replace('.html', ''));
  }
  return null;
};

function _initTabNav() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.href;
      if (!target) return;
      const r = _legacyRoute(target);
      if (r) { window.location.hash = '#' + r; } else { window.location.href = target; }
    });
  });
}

let selectedPack = 5;
let customCount = 5;

function renderPacks() {
  const grid = document.getElementById('pack-grid');
  if (!grid) return;
  const existing = document.querySelector('.pack-item.active');
  const activeVal = existing ? parseInt(existing.dataset.count) || customCount : null;

  const packData = [
    { count: 1, label: '', cls: '', saveLabel: '', savePct: 0, unitPrice: 40000 },
    { count: 5, label: 'PHỔ BIẾN', cls: 'popular', saveLabel: 'Tiết kiệm 10%', savePct: 10, unitPrice: 36000 },
    { count: 10, label: 'TIẾT KIỆM NHẤT', cls: 'best', saveLabel: 'Tiết kiệm 20%', savePct: 20, unitPrice: 32000 },
  ];
  const c = activeVal || customCount;

  let html = '';
  packData.forEach(p => {
    const isActive = activeVal === p.count;
    const total = calculatePrice(p.count);
    const discountText = p.saveLabel ? `<div class="pack-save-badge">${p.saveLabel}</div>` : '';
    const checkMark = isActive ? '<div class="pack-check"><i class="fas fa-check-circle"></i></div>' : '';
    const popularBadge = p.label ? `<div class="pack-label ${p.cls}">${p.label}</div>` : '';
    html += `
      <div class="pack-item ${isActive ? 'active' : ''}" data-count="${p.count}" data-price="${total}">
        ${popularBadge}
        <div class="pack-count">${p.count} <small>lượt</small></div>
        <div class="pack-price">${total.toLocaleString('vi-VN')}đ</div>
        <div class="pack-unit-price">${p.unitPrice.toLocaleString('vi-VN')}đ / lượt</div>
        ${discountText}
        ${checkMark}
      </div>
    `;
  });

  const isCustomActive = c !== null && !packData.some(p => p.count === c);
  const customTotal = calculatePrice(c);
  const customUnitPrice = getUnitPrice(c);
  html += `
    <div class="pack-item pack-custom ${isCustomActive ? 'active' : ''}" data-count="custom">
      <div class="pack-custom-title">Chọn số lượt tùy ý</div>
      <div class="pack-custom-controls">
        <button class="pack-dec" data-delta="-1">−</button>
        <input type="number" class="pack-custom-input" id="pack-custom-input" value="${c}" min="1" max="99">
        <button class="pack-inc" data-delta="1">+</button>
      </div>
      <div class="pack-unit-price">${customUnitPrice.toLocaleString('vi-VN')}đ / lượt</div>
    </div>
  `;

  grid.innerHTML = html;

  document.querySelectorAll('.pack-item:not(.pack-custom)').forEach(el => {
    el.addEventListener('click', () => {
      const count = parseInt(el.dataset.count);
      document.querySelectorAll('.pack-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      document.getElementById('pack-custom-input').value = count;
      updateTotal(count);
    });
  });

  const customInput = document.getElementById('pack-custom-input');
  if (customInput) {
    customInput.addEventListener('change', () => {
      let v = parseInt(customInput.value) || 1;
      if (v < 1) v = 1;
      if (v > 99) v = 99;
      customInput.value = v;
      document.querySelectorAll('.pack-item').forEach(x => x.classList.remove('active'));
      customInput.closest('.pack-item').classList.add('active');
      updateTotal(v);
    });
    customInput.addEventListener('input', () => {
      const v = parseInt(customInput.value) || 0;
      if (v > 0) {
        document.querySelectorAll('.pack-item').forEach(x => x.classList.remove('active'));
        customInput.closest('.pack-item').classList.add('active');
        updateTotal(v);
      }
    });
  }

  if (!existing) {
    const popular = document.querySelector('.pack-item[data-count="5"]');
    if (popular) {
      popular.classList.add('active');
      updateTotal(5);
    }
  }
  const qtyInput = document.getElementById('quantity');
  if (qtyInput && !qtyInput.value) qtyInput.value = 5;
}

function getUnitPrice(quantity) {
  if (quantity >= 1 && quantity <= 4) return 40000;
  if (quantity >= 5 && quantity <= 9) return 36000;
  if (quantity >= 10) return 32000;
  return 40000;
}

function updateTotal(count) {
  const total = calculatePrice(count);
  const unitPrice = getUnitPrice(count);
  const btn = document.getElementById('buy-scans-btn');
  if (btn) btn.textContent = `Mua ${count} lượt quét — ${total.toLocaleString('vi-VN')}đ`;
  const qtyInput = document.getElementById('quantity');
  if (qtyInput) qtyInput.value = count;
  const totalPriceEl = document.getElementById('totalPrice');
  if (totalPriceEl) totalPriceEl.textContent = total.toLocaleString('vi-VN') + 'đ';
  const infoLine = document.getElementById('packInfoLine');
  if (infoLine) infoLine.textContent = `Đã chọn ${count} lượt · ${count * 24} giờ dọn dẹp không giới hạn tệp`;
  const customUnitPrices = document.querySelectorAll('.pack-custom .pack-unit-price');
  customUnitPrices.forEach(el => {
    el.textContent = unitPrice.toLocaleString('vi-VN') + 'đ / lượt';
  });
}

function _loadTransactions() {
  return new Promise(resolve => {
    import('./modules/account-manager.js').then(({ readScopedOrLegacy }) => readScopedOrLegacy('ws_transactions'))
      .then(value => resolve(value || []))
      .catch(() => {
        chrome.storage.local.get(['ws_transactions'], result => {
          resolve(result.ws_transactions || []);
        });
      });
  });
}

function _saveTransaction(tx) {
  return _loadTransactions().then(txs => {
    const existing = txs.find(item => String(item.orderCode) === String(tx.orderCode));
    if (existing) return existing;
    txs.unshift(tx);
    return new Promise(resolve => {
      import('./modules/account-manager.js').then(({ writeScoped }) => writeScoped('ws_transactions', txs))
        .then(() => resolve(tx))
        .catch(() => {
          chrome.storage.local.set({ ws_transactions: txs }, () => resolve(tx));
        });
    });
  });
}

async function _updateTransaction(updated) {
  const txs = await _loadTransactions();
  const index = txs.findIndex(tx => String(tx.orderCode) === String(updated.orderCode));
  if (index === -1) throw new Error('Không tìm thấy giao dịch');
  txs[index] = updated;
  const { writeScoped } = await import('./modules/account-manager.js');
  await writeScoped('ws_transactions', txs);
  return updated;
}

async function renderInvoices() {
  const tbody = document.getElementById('invoice-body');
  if (!tbody) return;
  const txs = await _loadTransactions();
  if (txs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94A3B0;padding:24px;">Chưa có giao dịch nào</td></tr>';
    return;
  }
  tbody.innerHTML = txs.map(tx => {
    const paidAt = tx.paidAt ? _fmtDateShort(tx.paidAt) : '—';
    const amount = tx.amount != null ? tx.amount.toLocaleString('vi-VN') + 'đ' : '—';
    return `<tr>
      <td>${tx.invoice?.invoiceNumber || tx.orderCode || '—'}</td>
      <td>${paidAt}</td>
      <td>${tx.planName || '—'}</td>
      <td>${amount}</td>
      <td><span class="badge-status paid">Đã thanh toán</span></td>
      <td>
        <button class="action-btn" data-vat-order="${tx.orderCode}" ${tx.invoiceStatus === 'ISSUED' ? 'disabled' : ''}>Xuất HĐ</button>
        <button class="action-btn" data-pdf-order="${tx.orderCode}" title="${tx.invoiceStatus === 'ISSUED' ? 'Tải PDF do nhà cung cấp phát hành' : 'Tải bản PDF xem trước'}" ${(tx.invoiceStatus === 'ISSUED' && tx.invoice?.pdfReference) || tx.invoiceDraft?.buyer ? '' : 'disabled'}>PDF</button>
      </td>
    </tr>`;
  }).join('');
}

function _fmtDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function _fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function openInvoiceDetail(invoiceCode) {
  _loadTransactions().then(txs => {
    const tx = txs.find(t => t.invoiceCode === invoiceCode);
    if (!tx) {
      Toast.error('Không tìm thấy hóa đơn: ' + invoiceCode);
      return;
    }
    const modal = document.getElementById('invoice-detail-modal');
    if (!modal) return;
    modal.querySelector('.id-invoice-code').textContent = tx.invoiceCode || '—';
    modal.querySelector('.id-order-code').textContent = tx.orderCode || '—';
    modal.querySelector('.id-plan-name').textContent = tx.planName || '—';
    modal.querySelector('.id-cycle').textContent = tx.cycleLabel || '—';
    modal.querySelector('.id-quantity').textContent = tx.quantity != null ? String(tx.quantity) : '—';
    const amount = tx.amount != null ? tx.amount.toLocaleString('vi-VN') + 'đ' : '—';
    modal.querySelector('.id-amount').textContent = amount;
    modal.querySelector('.id-paid-at').textContent = _fmtDateTime(tx.paidAt);
    modal.querySelector('.id-method').textContent = tx.paymentMethod || '—';
    modal.querySelector('.id-status').textContent = 'Đã thanh toán';
    const email = tx.billingInfo?.email || tx.email || '';
    modal.querySelector('.id-email').textContent = email || '—';
    modal.querySelector('.id-recipient').textContent = tx.billingInfo?.recipientName || tx.billingInfo?.recipient_name || '—';
    modal.querySelector('.id-company').textContent = tx.billingInfo?.companyName || tx.billingInfo?.company_name || '—';
    modal.querySelector('.id-tax-code').textContent = tx.billingInfo?.taxCode || tx.billingInfo?.tax_code || '—';
    modal.querySelector('.id-address').textContent = tx.billingInfo?.address || '—';
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  });
}
window.openInvoiceDetail = openInvoiceDetail;

function closeInvoiceDetail() {
  const modal = document.getElementById('invoice-detail-modal');
  if (modal) modal.classList.remove('is-open');
  document.body.style.overflow = '';
}
window.closeInvoiceDetail = closeInvoiceDetail;

function initVatTabs() {
  const tabs = document.querySelectorAll('.vat-tab');
  const personalForm = document.querySelector('.vat-form.personal');
  const businessForm = document.querySelector('.vat-form.business');
  if (!tabs.length || !personalForm || !businessForm) return;
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      _setVatProfileTab(tab.textContent.includes('Cá nhân') ? 'personal' : 'business');
    });
  });
}

async function openUpgradeModal(plan) {
  const account = await getActiveUserAccount();
  _currentEmail = account ? normalizeEmail(account.email) : null;
  _currentProduct = plan || 'one_wistorix_v3';
  _currentQuantity = 1;
  document.getElementById('upgrade-modal').classList.add('is-open');
  document.body.style.overflow = 'hidden';
  currentStep = 1;
  _currentPayment = null;
  _clearQRInterval();
  _clearPaymentPolling();
  renderOrderSummary(_currentProduct, _currentCycle, 1);
  showStep(1);
}

async function openScanPackModal(quantity) {
  const account = await getActiveUserAccount();
  _currentEmail = account ? normalizeEmail(account.email) : null;
  if (!_currentEmail) {
    Toast.error('Không lấy được email từ tài khoản Google hiện tại. Vui lòng đăng nhập lại.');
    return;
  }
  _currentProduct = 'scan_pack';
  _currentQuantity = quantity || 1;
  document.getElementById('upgrade-modal').classList.add('is-open');
  document.body.style.overflow = 'hidden';
  currentStep = 1;
  _currentPayment = null;
  _clearQRInterval();
  _clearPaymentPolling();
  renderOrderSummary('scan_pack', null, quantity);
  showStep(1);
}

window.openUpgradeModal = openUpgradeModal;

function closeUpgradeModal() {
  document.getElementById('upgrade-modal').classList.remove('is-open');
  document.body.style.overflow = '';
  _clearQRInterval();
  _clearPaymentPolling();
}
window.closeUpgradeModal = closeUpgradeModal;

function copyText(text) {
  navigator.clipboard.writeText(text).then(function() {
    var toast = document.getElementById('toast-container-settings');
    if (toast) {
      var el = document.createElement('div');
      el.style.cssText = 'background:#10b981;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;pointer-events:all;';
      el.textContent = '✅ Đã sao chép: ' + text;
      toast.appendChild(el);
      setTimeout(function() { el.remove(); }, 2000);
    }
  }).catch(function() {});
}
window.copyText = copyText;

function changeCustom(delta) {
  const input = document.getElementById('pack-custom-input');
  if (!input) return;
  let v = parseInt(input.value) || 1;
  v += delta;
  if (v < 1) v = 1;
  if (v > 99) v = 99;
  input.value = v;
  document.querySelectorAll('.pack-item').forEach(x => x.classList.remove('active'));
  input.closest('.pack-item').classList.add('active');
  updateTotal(v);
}
window.changeCustom = changeCustom;

function calculatePrice(quantity) {
  let pricePerUnit = 40000;
  if (quantity >= 5 && quantity <= 9) {
    pricePerUnit = 36000;
  }
  if (quantity >= 10) {
    pricePerUnit = 32000;
  }
  return quantity * pricePerUnit;
}

async function updateCurrentPlanCredits() {
  try {
    const credits = await computeCredits();
    if (credits?.cleanupMode !== 'limited') {
      const fillEl = document.querySelector('.plan-progress .fill');
      const labelEl = document.querySelector('.plan-progress-label');
      if (fillEl) fillEl.style.width = '0%';
      if (labelEl) labelEl.textContent = credits?.timedExpiresAt ? 'Dọn dẹp không giới hạn tệp (có thời hạn)' : 'Dọn dẹp không giới hạn tệp';
      return;
    }
    const used = credits?.usedFiles ?? 0;
    const total = credits?.totalFiles ?? 25;
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    const fillEl = document.querySelector('.plan-progress .fill');
    const labelEl = document.querySelector('.plan-progress-label');
    if (fillEl) fillEl.style.width = pct + '%';
    if (labelEl) labelEl.textContent = used + ' / ' + total + ' tệp đã dùng';
  } catch (_) {
    const fillEl = document.querySelector('.plan-progress .fill');
    const labelEl = document.querySelector('.plan-progress-label');
    if (fillEl) fillEl.style.width = '0%';
    if (labelEl) labelEl.textContent = '0 / 25 tệp đã dùng';
  }
}

function renderCurrentPlan() {
  const account = getActiveAccount();
  const normalized = normalizeSubscriptionPlan(account?.subscription || {
    status: account?.subscriptionStatus,
    plan: account?.plan,
    validUntil: account?.subscriptionValidUntil
  });
  const card = document.querySelector('.current-plan');
  if (!card) return;
  const title = card.querySelector('h2');
  const description = card.querySelector('.plan-desc');
  const renewal = card.querySelector('.plan-right small');
  if (title) title.textContent = `Wistorix ${normalized.displayName}`;
  if (normalized.status === 'FREE') {
    if (description) description.textContent = 'Miễn phí — quét toàn bộ Drive — 25 tệp dọn dẹp.';
    if (renewal) renewal.textContent = 'Không tự động gia hạn gói STANDARD';
    return;
  }
  if (description) description.textContent = `Gói ${normalized.displayName} đang hoạt động.`;
  if (renewal) renewal.textContent = normalized.validUntil ? `Hiệu lực đến ${new Date(`${normalized.validUntil}T00:00:00Z`).toLocaleDateString('vi-VN')}` : 'Đang hoạt động';
}

let _mounted = false;

export async function mount() {
  if (_mounted) return;
  _mounted = true;

  initProfile().catch(error => console.warn('[upgrade] profile refresh failed', { code: error?.code || 'UNKNOWN' }));
  _initTabNav();
  renderPacks();
  initVatTabs();
  renderCurrentPlan();

  document.getElementById('btn-proceed-payment')?.addEventListener('click', handleProceedPayment);
  document.getElementById('btn-back-to-step1')?.addEventListener('click', () => showStep(1));
  document.getElementById('btn-payment-support')?.addEventListener('click', openWistorixSupport);
  document.getElementById('btn-cancel-upgrade')?.addEventListener('click', closeUpgradeModal);

  document.querySelectorAll('.btn-upgrade-plan').forEach(btn => {
    btn.addEventListener('click', () => {
      openUpgradeModal(btn.dataset.plan);
    });
  });
  document.querySelectorAll('[data-consultation-plan="multi_wistorix"]').forEach(btn => {
    btn.addEventListener('click', openWistorixSupport);
  });

  document.querySelectorAll('.cycle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cycle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _currentCycle = btn.dataset.cycle;
      const isYear = _currentCycle === 'yearly';
      document.querySelectorAll('.plan-price--monthly').forEach(el => el.style.display = isYear ? 'none' : '');
      document.querySelectorAll('.plan-price--yearly').forEach(el => el.style.display = isYear ? '' : 'none');
      document.querySelectorAll('.plan-duration--monthly').forEach(el => el.style.display = isYear ? 'none' : '');
      document.querySelectorAll('.plan-duration--yearly').forEach(el => el.style.display = isYear ? '' : 'none');
    });
  });


  document.getElementById('buy-scans-btn')?.addEventListener('click', () => {
    const qty = parseInt(document.getElementById('quantity')?.value) || 5;
    openScanPackModal(qty);
  });

  document.querySelectorAll('.pay-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.pay-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.pay;
      document.getElementById('pay-qr').style.display = mode === 'qr' ? 'block' : 'none';
      document.getElementById('pay-card').style.display = mode === 'card' ? 'block' : 'none';
    });
  });

  document.getElementById('btn-close-upgrade').addEventListener('click', closeUpgradeModal);
  document.getElementById('upgrade-modal').addEventListener('click', function(e) {
    if (e.target === this) closeUpgradeModal();
  });
  document.getElementById('btn-back-to-billing')?.addEventListener('click', closeUpgradeModal);
  document.getElementById('btn-issue-vat')?.addEventListener('click', () => _openVatInvoice(_currentTransaction));
  document.getElementById('btn-close-vat')?.addEventListener('click', _closeVatInvoice);
  document.getElementById('btn-cancel-vat')?.addEventListener('click', _closeVatInvoice);
  document.getElementById('btn-vat-close-complete')?.addEventListener('click', _closeVatInvoice);
  document.getElementById('btn-vat-preview')?.addEventListener('click', async () => {
    const form = _vatFormData();
    if (!form) return Toast.error('Vui lòng điền đầy đủ thông tin hóa đơn hợp lệ.');
    if (await _renderVatPreview(form)) _showVatStep(2);
  });
  document.getElementById('btn-vat-back')?.addEventListener('click', () => _showVatStep(1));
  document.getElementById('btn-vat-issue')?.addEventListener('click', _issueVatInvoice);
  document.getElementById('btn-vat-download-preview')?.addEventListener('click', () => {
    if (!_vatPreviewModel) return Toast.error('Hãy tạo bản xem trước trước khi tải PDF.');
    try { downloadInvoicePreviewPdf(_vatPreviewModel); Toast.success('Đang tải bản PDF xem trước.'); }
    catch (error) { console.warn('Unable to download preview PDF', error); Toast.error('Không thể tạo bản PDF xem trước.'); }
  });
  document.querySelectorAll('.btn-vat').forEach(button => button.addEventListener('click', () => _saveVatProfile(button)));
  document.querySelectorAll('.vat-invoice-tab').forEach(tab => tab.addEventListener('click', () => {
    _vatType = tab.dataset.type; document.querySelectorAll('.vat-invoice-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.vat-business-field').forEach(el => { el.style.display = _vatType === 'business' ? '' : 'none'; });
  }));

  document.querySelectorAll('.cp-btn[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => copyText(btn.dataset.copy));
  });

  document.addEventListener('click', (e) => {
    const decBtn = e.target.closest('.pack-dec[data-delta]');
    if (decBtn) {
      changeCustom(parseInt(decBtn.dataset.delta));
      return;
    }
    const incBtn = e.target.closest('.pack-inc[data-delta]');
    if (incBtn) {
      changeCustom(parseInt(incBtn.dataset.delta));
      return;
    }
  });

  document.getElementById('invoice-body')?.addEventListener('click', e => {
    const vatBtn = e.target.closest('[data-vat-order]');
    if (vatBtn && !vatBtn.disabled) _loadTransactions().then(txs => _openVatInvoice(txs.find(tx => String(tx.orderCode) === vatBtn.dataset.vatOrder)));
    const pdfBtn = e.target.closest('[data-pdf-order]');
    if (pdfBtn && !pdfBtn.disabled) _loadTransactions().then(txs => _downloadInvoicePdf(txs.find(tx => String(tx.orderCode) === pdfBtn.dataset.pdfOrder)));
    const btn = e.target.closest('.action-btn[data-invoice]');
    if (btn) openInvoiceDetail(btn.dataset.invoice);
  });

  document.getElementById('btn-close-invoice-detail')?.addEventListener('click', closeInvoiceDetail);
  document.getElementById('btn-close-invoice-detail-footer')?.addEventListener('click', closeInvoiceDetail);
  document.getElementById('invoice-detail-modal')?.addEventListener('click', function(e) {
    if (e.target === this) closeInvoiceDetail();
  });

  const copyBtn = document.getElementById('copy-referral-btn');
  const copyInput = document.getElementById('referral-input');
  if (copyBtn && copyInput) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(copyInput.value).then(() => {
        copyBtn.textContent = 'Đã sao chép!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Sao chép link';
          copyBtn.classList.remove('copied');
        }, 2000);
      });
    });
  }

  // Invoice, saved VAT profile, and credit total do not affect first paint or
  // checkout bindings. Render their sections when their independent data is ready.
  renderInvoices().catch(error => console.error('[upgrade] invoices', error));
  _loadSavedVatProfile().catch(error => console.error('[upgrade] VAT profile', error));
  updateCurrentPlanCredits().catch(error => console.warn('[upgrade] credit refresh failed', { code: error?.code || 'UNKNOWN' }));
  window.addEventListener('wistorix:cleanup-credits-changed', updateCurrentPlanCredits);
}

export async function onShow() { await _loadSavedVatProfile(); }
export async function onHide() {
  closeUpgradeModal();
}

// Standalone (không qua shell) → tự khởi động
if (!window.WistorixRouter) {
  document.addEventListener('DOMContentLoaded', () => { mount(); });
}
