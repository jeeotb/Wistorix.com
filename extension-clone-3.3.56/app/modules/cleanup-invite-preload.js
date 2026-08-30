function routerPrefetch(routes) {
  return globalThis.WistorixRouter?.prefetchRoutes?.(routes) || Promise.resolve([]);
}

export async function preloadCleanupInviteResources({
  prefetchRoutes = routerPrefetch,
  loadActions = () => import('./actions.js'),
  loadReferral = () => import('./referral.js'),
  loadInviteData = () => import('./invite-data.js')
} = {}) {
  return Promise.allSettled([
    // Fragments, controller modules, and their CSS warm after Dashboard is
    // interactive. No billing/referral/Drive request is added for Upgrade.
    Promise.resolve(prefetchRoutes(['/cleanup', '/invite', '/upgrade'])),
    loadActions().then(({ computeCredits, getCleanupSessions }) => Promise.all([computeCredits(), getCleanupSessions()])),
    loadReferral().then(({ getReferralUrl }) => getReferralUrl()),
    loadInviteData().then(({ getInvites }) => getInvites())
  ]);
}
