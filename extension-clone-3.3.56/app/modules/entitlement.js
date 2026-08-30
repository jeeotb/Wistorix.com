// Product IDs are versioned so historical purchases retain their original meaning.
const PLAN_CATALOG = Object.freeze({
  // New checkout catalog.
  // Stale test SKU from prior catalog revision. Read only; never checkout.
  standard_v2_monthly: { tier: 'STANDARD', displayName: 'STANDARD', billingCycle: 'monthly', legacy: true },
  standard_v2_yearly: { tier: 'STANDARD', displayName: 'STANDARD', billingCycle: 'yearly', legacy: true },
  one_wistorix_v3_monthly: { tier: 'ONE-WISTORIX', displayName: 'ONE-WISTORIX', billingCycle: 'monthly' },
  one_wistorix_v3_yearly: { tier: 'ONE-WISTORIX', displayName: 'ONE-WISTORIX', billingCycle: 'yearly' },

  // Current pre-catalog product IDs: retain the product capability they sold.
  one_wistorix_v2_monthly: { tier: 'STANDARD', displayName: 'STANDARD', billingCycle: 'monthly', legacy: true },
  one_wistorix_v2_yearly: { tier: 'STANDARD', displayName: 'STANDARD', billingCycle: 'yearly', legacy: true },
  multi_wistorix_v2_monthly: { tier: 'ONE-WISTORIX', displayName: 'ONE-WISTORIX', billingCycle: 'monthly', legacy: true },
  multi_wistorix_v2_yearly: { tier: 'ONE-WISTORIX', displayName: 'ONE-WISTORIX', billingCycle: 'yearly', legacy: true },

  // Historical aliases remain readable only. Do not use them for checkout.
  standard_monthly: { tier: 'ONE-WISTORIX', displayName: 'ONE-WISTORIX', billingCycle: 'monthly', legacy: true },
  standard_yearly: { tier: 'ONE-WISTORIX', displayName: 'ONE-WISTORIX', billingCycle: 'yearly', legacy: true },
  one_wistorix_monthly: { tier: 'MULTI-WISTORIX', displayName: 'MULTI-WISTORIX', billingCycle: 'monthly', legacy: true },
  one_wistorix_yearly: { tier: 'MULTI-WISTORIX', displayName: 'MULTI-WISTORIX', billingCycle: 'yearly', legacy: true },
  one_wistorix: { tier: 'MULTI-WISTORIX', displayName: 'MULTI-WISTORIX', billingCycle: null, legacy: true },
  multi_wistorix_v2: { tier: 'ONE-WISTORIX', displayName: 'ONE-WISTORIX', billingCycle: null, legacy: true },
  pro: { tier: 'PRO', displayName: 'Pro', billingCycle: null, legacy: true },
  yearly: { tier: 'PRO', displayName: 'Pro', billingCycle: 'yearly', legacy: true },
  lifetime: { tier: 'LIFETIME', displayName: 'Lifetime', billingCycle: 'lifetime', legacy: true }
});

export function normalizeSubscriptionPlan(subscription = {}) {
  const plan = String(subscription.plan || '').toLowerCase();
  const status = String(subscription.status || '').toUpperCase();
  const config = PLAN_CATALOG[plan];
  const validUntil = subscription.validUntil || subscription.expiresAt || null;
  const expiresAt = validUntil ? Date.parse(`${validUntil}T23:59:59.999Z`) : NaN;
  const active = status === 'ACTIVE' && config && (!Number.isFinite(expiresAt) || expiresAt >= Date.now());
  if (!active) return { tier: 'STANDARD', displayName: 'STANDARD', billingCycle: null, status: 'FREE', validUntil: null, plan: 'free' };
  return { ...config, status: 'ACTIVE', validUntil, plan };
}

export function getCleanupEntitlement(subscription = {}) {
  const plan = normalizeSubscriptionPlan(subscription);
  if (plan.tier === 'ONE-WISTORIX' || plan.tier === 'MULTI-WISTORIX') return { cleanupMode: 'unlimited', cleanupLimit: null, plan };
  // FREE remains backward-compatible with the existing introductory allocation.
  return { cleanupMode: 'limited', cleanupLimit: 25, plan };
}

export const CHECKOUT_PRODUCTS = Object.freeze({
  ONE_WISTORIX: 'one_wistorix_v3'
});
