import { initProfile } from './profile.js';
document.addEventListener('DOMContentLoaded', () => {
  initProfile().catch(error => console.warn('[profile] bootstrap failed', { code: error?.code || 'UNKNOWN' }));
});
