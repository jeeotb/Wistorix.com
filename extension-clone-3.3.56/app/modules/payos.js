import { getAuthTokenSilently } from './auth.js';

const CLOUD_FUNCTION_BASE = (typeof globalThis !== 'undefined' && globalThis.WISTORIX_CONFIG && globalThis.WISTORIX_CONFIG.CLOUD_FUNCTION_BASE)
  ? globalThis.WISTORIX_CONFIG.CLOUD_FUNCTION_BASE
  : 'https://us-central1-wistorix.cloudfunctions.net';

const CONFIG = {
  createPaymentLinkUrl: `${CLOUD_FUNCTION_BASE}/createPaymentLink`,
  validateLicenseUrl: `${CLOUD_FUNCTION_BASE}/validateLicense`
};

export async function setCloudFunctionBase(projectId) {
  CONFIG.createPaymentLinkUrl = `https://us-central1-${projectId}.cloudfunctions.net/createPaymentLink`;
  CONFIG.validateLicenseUrl = `https://us-central1-${projectId}.cloudfunctions.net/validateLicense`;
}

export async function getCloudFunctionBase() {
  return CONFIG.createPaymentLinkUrl.replace('/createPaymentLink', '');
}

async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createPaymentLink(payload) {
  if (!payload || !payload.email) {
    throw new Error('Email không được để trống');
  }
  if (!payload.plan && !payload.product) {
    throw new Error('Thiếu thông tin gói sản phẩm');
  }
  const body = { ...payload };
  try {
    const response = await fetchWithTimeout(CONFIG.createPaymentLinkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Kết nối tới máy chủ thanh toán bị timeout. Vui lòng thử lại.');
    }
    console.error('createPaymentLink error:', err);
    throw err;
  }
}

export async function validateLicense(licenseKey, email) {
  try {
    const response = await fetchWithTimeout(CONFIG.validateLicenseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey, email })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Kết nối tới máy chủ license bị timeout. Vui lòng thử lại.');
    }
    console.error('validateLicense error:', err);
    throw err;
  }
}

export async function getLicenseInfo() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      'licenseKey', 'licensePlan', 'licenseEmail',
      'licenseExpiryDate', 'licenseActivatedAt'
    ], (result) => {
      if (result.licenseKey && result.licenseExpiryDate) {
        resolve({
          key: result.licenseKey,
          plan: result.licensePlan || 'yearly',
          email: result.licenseEmail || '',
          expiryDate: result.licenseExpiryDate,
          activatedAt: result.licenseActivatedAt || null
        });
      } else {
        resolve(null);
      }
    });
  });
}

export async function saveLicenseInfo(info) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      licenseKey: info.key,
      licensePlan: info.plan,
      licenseEmail: info.email,
      licenseExpiryDate: info.expiryDate,
      licenseActivatedAt: new Date().toISOString()
    }, resolve);
  });
}

export async function clearLicenseInfo() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([
      'licenseKey', 'licensePlan', 'licenseEmail',
      'licenseExpiryDate', 'licenseActivatedAt'
    ], resolve);
  });
}

export function calculateDaysRemaining(expiryDateStr) {
  const expiry = new Date(expiryDateStr);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  expiry.setUTCHours(0, 0, 0, 0);
  const diffMs = expiry.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function isLifetime(plan) {
  return plan === 'lifetime';
}

export function isExpired(expiryDateStr) {
  return calculateDaysRemaining(expiryDateStr) <= 0;
}

export function isNearExpiry(expiryDateStr, daysThreshold = 30) {
  const remaining = calculateDaysRemaining(expiryDateStr);
  return remaining > 0 && remaining <= daysThreshold;
}
