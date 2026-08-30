import { getAuthTokenSilently } from './auth.js';
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

const USER_MESSAGES = {
  AUTH_REQUIRED: 'Bạn cần đăng nhập lại để gửi yêu cầu.',
  AUTH_INVALID: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  FILE_NOT_FOUND: 'Không tìm thấy tệp hoặc bạn không còn quyền truy cập.',
  FILE_ACCESS_DENIED: 'Bạn không còn quyền truy cập tệp này.',
  GOOGLE_DRIVE_UNAVAILABLE: 'Không thể kết nối Google Drive. Vui lòng thử lại.',
  OWNER_NOT_FOUND: 'Không xác định được chủ sở hữu hiện tại của tệp.',
  NOT_FILE_OWNER: 'Bạn đang là chủ sở hữu của tệp này.',
  TRASHED_FILE: 'Không thể yêu cầu sở hữu tệp trong Thùng rác.',
  SHARED_DRIVE_NOT_SUPPORTED: 'Không hỗ trợ yêu cầu sở hữu cá nhân cho tệp trong Shared Drive.',
  INVALID_FILE_ID: 'Tệp không hợp lệ.',
  GMAIL_SCOPE_REQUIRED: 'Tài khoản cần cấp quyền gửi Gmail. Vui lòng đăng nhập lại và chấp nhận quyền.',
  GMAIL_SEND_FAILED: 'Không gửi được email yêu cầu. Vui lòng thử lại.',
  REQUEST_ALREADY_SENT: 'Yêu cầu này đã được gửi gần đây.',
  RATE_LIMITED: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
  INTERNAL_ERROR: 'Không thể gửi yêu cầu. Vui lòng thử lại.'
};

export function ownershipRequestMessage(code) {
  return USER_MESSAGES[code] || 'Không thể kiểm tra tệp trên Google Drive. Vui lòng thử lại.';
}

function requestError(code) {
  const error = new Error(ownershipRequestMessage(code));
  error.code = code;
  return error;
}

async function fetchVerifiedFile(token, fileId, fetchFn = fetch) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'id,name,webViewLink,trashed,ownedByMe,driveId,owners(emailAddress,displayName,me)');
  let response;
  try {
    response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (_) {
    throw requestError('GOOGLE_DRIVE_UNAVAILABLE');
  }
  if (!response.ok) {
    const code = response.status === 401 ? 'AUTH_INVALID' : response.status === 404 ? 'FILE_NOT_FOUND' : 'FILE_ACCESS_DENIED';
    const error = new Error(ownershipRequestMessage(code));
    error.code = code;
    throw error;
  }
  return response.json();
}

export function validateOwnershipFallbackFiles(files) {
  const owners = new Set();
  for (const file of files) {
    if (file.trashed) throw requestError('TRASHED_FILE');
    if (file.ownedByMe || file.owners?.some(owner => owner.me)) throw requestError('NOT_FILE_OWNER');
    if (file.driveId) throw requestError('SHARED_DRIVE_NOT_SUPPORTED');
    if (!file.owners?.[0]?.emailAddress) throw requestError('OWNER_NOT_FOUND');
    owners.add(String(file.owners[0].emailAddress).trim().toLowerCase());
  }
  if (owners.size !== 1 || !files[0]?.webViewLink) {
    throw requestError('OWNER_NOT_FOUND');
  }
  return { file: files[0], ownerEmail: [...owners][0] };
}

// Drive API has no request-ownership operation for a non-owner. This function
// only verifies the caller's live Drive access and returns the official Drive
// link for the manual owner-contact workflow. It makes no permission mutation.
export async function resolveOwnershipRequestFallback({ fileIds }, { getToken = getAuthTokenSilently, fetchFn = fetch } = {}) {
  const ids = [...new Set((Array.isArray(fileIds) ? fileIds : []).map(value => String(value || '').trim()))];
  if (!ids.length || ids.some(id => !FILE_ID_RE.test(id))) throw requestError('INVALID_FILE_ID');
  let token;
  try {
    token = await getToken();
  } catch (_) {
    throw requestError('AUTH_REQUIRED');
  }
  const files = await Promise.all(ids.map(fileId => fetchVerifiedFile(token, fileId, fetchFn)));
  return { ...validateOwnershipFallbackFiles(files), token };
}

function requestOwnershipUrl() {
  const base = globalThis.WISTORIX_CONFIG?.CLOUD_FUNCTION_BASE || 'https://us-central1-wistorix.cloudfunctions.net';
  return `${String(base).replace(/\/$/, '')}/requestOwnership`;
}

// Validation remains client-side defense. Backend repeats every security check.
export async function submitOwnershipRequest({ fileIds, message = '', requestId }, deps = {}) {
  const getToken = deps.getToken || getAuthTokenSilently;
  const fetchFn = deps.fetchFn || fetch;
  const validation = await resolveOwnershipRequestFallback({ fileIds }, { getToken, fetchFn });
  if (String(message).length > 2000) throw requestError('INTERNAL_ERROR');
  let response;
  try {
    response = await fetchFn(deps.url || requestOwnershipUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${validation.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, fileIds, message: String(message).trim() })
    });
  } catch (_) {
    throw requestError('INTERNAL_ERROR');
  }
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || !data.success) throw requestError(data.error || 'INTERNAL_ERROR');
  return { ...data, ownerEmail: validation.ownerEmail };
}
