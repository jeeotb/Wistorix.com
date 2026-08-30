import { readScopedOrLegacy, writeScoped } from './account-manager.js';

const VAT_PROFILE_KEY = 'vatProfile';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeVatProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const type = profile.type === 'business' ? 'business' : 'personal';
  return {
    type,
    recipientName: clean(profile.recipientName),
    email: clean(profile.email),
    address: clean(profile.address),
    companyName: clean(profile.companyName),
    taxCode: clean(profile.taxCode)
  };
}

export async function loadVatProfile() {
  return normalizeVatProfile(await readScopedOrLegacy(VAT_PROFILE_KEY));
}

export async function saveVatProfile(profile) {
  const normalized = normalizeVatProfile(profile);
  if (!normalized) throw new Error('VAT_PROFILE_INVALID');
  await writeScoped(VAT_PROFILE_KEY, normalized);
  return normalized;
}
