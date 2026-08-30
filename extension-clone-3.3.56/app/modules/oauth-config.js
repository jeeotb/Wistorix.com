// Public OAuth client IDs are configuration, not secrets.  Main Login keeps
// using manifest.oauth2.client_id through chrome.identity.getAuthToken().
// Add Account uses launchWebAuthFlow and therefore needs a Web OAuth client
// that has the runtime chromiumapp.org redirect URI registered in Google Cloud.
// Set by the release build after creating the dedicated Google Web OAuth
// client.  Leave blank in source when no production client exists yet.
export const ADD_ACCOUNT_OAUTH_CLIENT_ID = '172477157648-vokn1t71lcv57eptir2ccii1mclsopbt.apps.googleusercontent.com';

export function getAddAccountOAuthClientId() {
  const configured = typeof globalThis !== 'undefined'
    ? globalThis.WISTORIX_CONFIG?.ADD_ACCOUNT_OAUTH_CLIENT_ID
    : '';
  const clientId = String(configured || ADD_ACCOUNT_OAUTH_CLIENT_ID || '').trim();
  return /^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(clientId) ? clientId : '';
}
