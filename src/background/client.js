/* Host-bound GitHub/GitLab API client. Tokens never leave the service worker. */
import {clearCache, memo} from './cache.js';
import {accountFor, providerFor} from './hosts.js';
import {listBudget, responseBytes, responseJSON} from './http.js';
import {refresh} from './oauth/flow.js';
import {readStore, writeStore} from './storage.js';

const refreshing = new Map();

async function authorizedAccount(account) {
  if (!account || account.auth !== 'oauth' || !account.expiresAt || account.expiresAt > Date.now() + 60000) return account;
  if (refreshing.has(account.id)) return refreshing.get(account.id);
  const promise = (async () => {
    const credentials = await refresh(account);
    const updated = {...account, ...credentials};
    const user = (await client({origin: account.origin, provider: account.provider}, await readStore(), {...updated, expiresAt: 0}).request('/user')).data;
    if ((account.provider === 'gitlab' ? user.username : user.login) !== account.login) throw new Error('OAuth refreshed a different account. Reconnect in Settings.');
    await writeStore(current => {
      const accounts = [...(current.accounts || [])]; const index = accounts.findIndex(item => item.id === account.id);
      if (index < 0 || accounts[index].token !== account.token) throw new Error('This account changed during sign-in. Retry with the current account.');
      accounts[index] = updated; return {accounts};
    });
    await clearCache(); return updated;
  })();
  refreshing.set(account.id, promise);
  try { return await promise; } finally { if (refreshing.get(account.id) === promise) refreshing.delete(account.id); }
}

export function client(context, store, override) {
  let account = override || accountFor(context, store);
  const origin = context.origin;
  const provider = context.provider || account?.provider || providerFor(origin, store);
  const label = provider === 'gitlab' ? 'GitLab' : 'GitHub';
  const base = provider === 'gitlab' ? `${origin}/api/v4` : origin === 'https://github.com' ? 'https://api.github.com' : `${origin}/api/v3`;
  const graph = origin === 'https://github.com' ? 'https://api.github.com/graphql' : `${origin}/api/graphql`;
  const prefix = `/${account?.id || 'anonymous'}:${origin}`;
  async function request(path, {method = 'GET', body, raw = false} = {}) {
    account = await authorizedAccount(account);
    const url = path === '@graphql' ? graph : base + path;
    if (path !== '@graphql' && (!path.startsWith('/') || path.startsWith('//'))) throw new Error('Invalid API path.');
    const headers = {Accept: provider === 'gitlab' ? raw ? 'text/plain' : 'application/json' : raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'};
    if (account?.token) headers.Authorization = `Bearer ${account.token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(25000)});
    if (!response.ok) {
      const fail = message => { const error = new Error(message); error.status = response.status; throw error; };
      let message = '';
      try { message = (await responseJSON(response, 64 * 1024)).message || ''; } catch { /* Non-JSON or oversized errors use the status message below. */ }
      if (response.status === 401) fail(account ? `${label} rejected this token. Update the account in Settings.` : `${label} requires an account for this operation. Add a token in Settings.`);
      if ((response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') || response.status === 429) {
        const reset = Number(response.headers.get('X-RateLimit-Reset'));
        fail(`${label} API rate limit reached.${reset ? ` Resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : ''} Add an account or retry later.`);
      }
      if (response.status === 404) fail('Repository, branch, API endpoint or file not found. For a private repository, check the token permissions and organization SSO.');
      fail(`${label} API ${response.status}${message ? `: ${String(message).slice(0, 250)}` : ''}`);
    }
    if (raw) {
      const bytes = await responseBytes(response, 2 * 1024 * 1024, `This file exceeds the 2 MiB text preview limit. Open it on ${label}.`);
      if (bytes.includes(0)) throw new Error(`Binary files cannot be shown as a text diff. Open the file on ${label}.`);
      try { return {data: new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes), next: false}; }
      catch { throw new Error(`This file is not UTF-8 text. Open the file on ${label}.`); }
    }
    return {data: await responseJSON(response), next: /rel="next"/.test(response.headers.get('Link') || '') || Number(response.headers.get('X-Next-Page')) > 0};
  }
  async function json(path, ttl = 30000, fresh = false) {
    return memo(prefix + path, ttl, async () => (await request(path)).data, fresh);
  }
  async function pages(path, property = null) {
    const list = []; const check = listBudget();
    for (let page = 1; page <= 100; page++) {
      const {data, next} = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const values = property ? data[property] : data;
      check(values);
      list.push(...values);
      if (!next) return list;
    }
    throw new Error(`This list exceeds 10,000 results. ${label} did not return a complete list.`);
  }
  async function graphql(query, variables) {
    if (!account) throw new Error('Add a GitHub account in Settings to use this review filter.');
    const {data} = await request('@graphql', {method: 'POST', body: {query, variables}});
    if (data.errors?.length) throw new Error(data.errors.map(error => error.message).join('; ').slice(0, 350));
    return data.data;
  }
  return {account, provider, prefix, request, json, pages, graphql};
}
