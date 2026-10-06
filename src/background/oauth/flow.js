/* Trusted OAuth device (GitHub) and PKCE (GitLab) flows with refresh. No client secret. */
import {responseJSON} from '../http.js';
import {oauthConfig as config} from './config.js';

let pollPending = null;
function clientId(provider) {
  const value = config[provider];
  if (typeof value !== 'string' || !/^[\w.-]{8,256}$/.test(value)) throw new Error('OAuth is not configured in this build. Connect a personal access token instead.');
  return value;
}
async function post(origin, path, parameters) {
  const response = await fetch(origin + path, {method: 'POST', headers: {Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(parameters).toString(), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(25000)});
  let value;
  try { value = await responseJSON(response, 64 * 1024); } catch { throw new Error('The OAuth server returned an invalid response. Try again or use a personal access token.'); }
  if (!response.ok || value.error) {
    const error = new Error('OAuth authorization failed. Reconnect in Settings or use a personal access token.');
    error.code = typeof value.error === 'string' ? value.error : ''; error.interval = Number(value.interval); throw error;
  }
  return value;
}
function credentials(value) {
  if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 4096 || /\s/.test(value.access_token) || value.token_type?.toLowerCase() !== 'bearer') throw new Error('OAuth did not return a valid bearer token.');
  const refreshToken = typeof value.refresh_token === 'string' && value.refresh_token.length <= 4096 && !/\s/.test(value.refresh_token) ? value.refresh_token : '';
  return {token: value.access_token, refreshToken, expiresAt: Number(value.expires_in) > 0 ? Date.now() + Number(value.expires_in) * 1000 : 0};
}
function deviceInfo(flow) { return flow ? {id: flow.id, userCode: flow.userCode, verificationURL: 'https://github.com/login/device', expires: flow.expires, interval: Math.max(1, Math.ceil((flow.nextPollAt - Date.now()) / 1000))} : null; }
export async function status() {
  const {oauthDevice} = await chrome.storage.session.get('oauthDevice');
  if (oauthDevice?.expires > Date.now()) return deviceInfo(oauthDevice);
  await chrome.storage.session.remove('oauthDevice'); return null;
}
export async function start(access, label) {
  const id = clientId('github');
  const data = await post('https://github.com', '/login/device/code', {client_id: id, scope: access === 'private' ? 'repo read:user' : 'read:user'});
  if (typeof data.device_code !== 'string' || !data.device_code || data.device_code.length > 512 || typeof data.user_code !== 'string' || !/^[\w-]{6,20}$/.test(data.user_code) ||
      !Number.isFinite(data.expires_in) || data.expires_in <= 0 || !Number.isFinite(data.interval) || data.interval <= 0) throw new Error('GitHub returned invalid device authorization data.');
  const interval = Math.max(5, Math.min(60, data.interval));
  const flow = {id: crypto.randomUUID(), clientId: id, deviceCode: data.device_code, userCode: data.user_code, label: String(label || '').slice(0, 60),
    expires: Date.now() + Math.min(900, data.expires_in) * 1000, interval, nextPollAt: Date.now() + interval * 1000};
  await chrome.storage.session.set({oauthDevice: flow}); return deviceInfo(flow);
}
export async function cancel(id) {
  const {oauthDevice} = await chrome.storage.session.get('oauthDevice');
  if (oauthDevice?.id === id) await chrome.storage.session.remove('oauthDevice');
  return true;
}
export async function poll(id) {
  if (pollPending?.id === id) return pollPending.promise;
  const promise = (async () => {
    const {oauthDevice: flow} = await chrome.storage.session.get('oauthDevice');
    if (!flow || flow.id !== id || flow.expires <= Date.now()) throw new Error('This sign-in expired or was cancelled. Start again.');
    if (Date.now() < flow.nextPollAt) return {pending: deviceInfo(flow)};
    flow.nextPollAt = Date.now() + flow.interval * 1000; await chrome.storage.session.set({oauthDevice: flow});
    let data;
    try { data = await post('https://github.com', '/login/oauth/access_token', {client_id: flow.clientId, device_code: flow.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code'}); }
    catch (error) {
      if (['authorization_pending', 'slow_down'].includes(error.code)) {
        const {oauthDevice: active} = await chrome.storage.session.get('oauthDevice');
        if (active?.id !== id) throw new Error('Sign-in was cancelled.', {cause: error});
        if (error.code === 'slow_down') flow.interval = Math.max(flow.interval + 5, error.interval || 0);
        flow.nextPollAt = Date.now() + flow.interval * 1000; await chrome.storage.session.set({oauthDevice: flow});
        return {pending: deviceInfo(flow)};
      }
      await cancel(id); throw error;
    }
    const {oauthDevice: active} = await chrome.storage.session.get('oauthDevice');
    if (active?.id !== id) throw new Error('Sign-in was cancelled.');
    await cancel(id);
    return {account: {origin: 'https://github.com', provider: 'github', auth: 'oauth', clientId: flow.clientId, label: flow.label, ...credentials(data)}};
  })();
  pollPending = {id, promise};
  try { return await promise; } finally { if (pollPending?.promise === promise) pollPending = null; }
}
function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
export async function gitlab(label) {
  const id = clientId('gitlab'); const redirectUri = chrome.identity.getRedirectURL('gitlab');
  const state = base64(crypto.getRandomValues(new Uint8Array(32))); const verifier = base64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const parameters = new URLSearchParams({client_id: id, redirect_uri: redirectUri, response_type: 'code', state, scope: 'read_api', code_challenge: challenge, code_challenge_method: 'S256'});
  const result = await chrome.identity.launchWebAuthFlow({url: `https://gitlab.com/oauth/authorize?${parameters}`, interactive: true});
  if (!result) throw new Error('GitLab sign-in was cancelled.');
  const callback = new URL(result); const expected = new URL(redirectUri);
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.searchParams.get('state') !== state || !callback.searchParams.get('code') || callback.searchParams.has('error')) throw new Error('GitLab authorization did not return the expected callback. Start again.');
  const data = await post('https://gitlab.com', '/oauth/token', {client_id: id, code: callback.searchParams.get('code'), grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: verifier});
  return {origin: 'https://gitlab.com', provider: 'gitlab', auth: 'oauth', clientId: id, redirectUri, label: String(label || '').slice(0, 60), ...credentials(data)};
}
export async function refresh(account) {
  if (!account.refreshToken) throw new Error('OAuth access expired. Reconnect the account in Settings.');
  if (!['https://github.com', 'https://gitlab.com'].includes(account.origin)) throw new Error('Invalid OAuth account host.');
  const parameters = {client_id: account.clientId, refresh_token: account.refreshToken, grant_type: 'refresh_token'};
  if (account.provider === 'gitlab') parameters.redirect_uri = account.redirectUri;
  return credentials(await post(account.origin, account.provider === 'gitlab' ? '/oauth/token' : '/login/oauth/access_token', parameters));
}
