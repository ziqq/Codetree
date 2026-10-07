/**
 * Host-bound GitHub and GitLab API client.
 *
 * Tokens never leave the service worker. Requests are sent only to the
 * API of the context's own host, with the token in the `Authorization`
 * header, `credentials: 'omit'`, `redirect: 'error'` and a 25-second
 * timeout.
 *
 * @module background/client
 */
import {clearCache, memo} from './cache.js';
import {accountFor, providerFor} from './hosts.js';
import {listBudget, responseBytes, responseJSON} from './http.js';
import {refresh} from './oauth/flow.js';
import {readStore, writeStore} from './storage.js';

/** In-flight OAuth refreshes by account ID, shared by concurrent requests. */
const refreshing = new Map();

/**
 * Refreshes an OAuth account whose access token expires within a minute.
 *
 * The refreshed token must belong to the same user, and the stored
 * account must not have changed in the meantime. Caches are cleared
 * afterwards because cached responses belong to the old credentials.
 *
 * @param {?Object} account The selected account.
 * @returns {Promise<?Object>} The account with valid credentials.
 */
async function authorizedAccount(account) {
  if (!account || account.auth !== 'oauth' || !account.expiresAt || account.expiresAt > Date.now() + 60000)
    return account;
  if (refreshing.has(account.id)) return refreshing.get(account.id);
  const promise = (async () => {
    const credentials = await refresh(account);
    const updated = {...account, ...credentials};
    const user = (
      await client({origin: account.origin, provider: account.provider}, await readStore(), {
        ...updated,
        expiresAt: 0,
      }).request('/user')
    ).data;
    if ((account.provider === 'gitlab' ? user.username : user.login) !== account.login)
      throw new Error('OAuth refreshed a different account. Reconnect in Settings.');
    await writeStore(current => {
      const accounts = [...(current.accounts || [])];
      const index = accounts.findIndex(item => item.id === account.id);
      if (index < 0 || accounts[index].token !== account.token)
        throw new Error('This account changed during sign-in. Retry with the current account.');
      accounts[index] = updated;
      return {accounts};
    });
    await clearCache();
    return updated;
  })();
  refreshing.set(account.id, promise);
  try {
    return await promise;
  } finally {
    if (refreshing.get(account.id) === promise) refreshing.delete(account.id);
  }
}

/**
 * Creates an API client for a repository context.
 *
 * GitHub.com uses `api.github.com`, GitHub Enterprise Server uses
 * `<origin>/api/v3` and `<origin>/api/graphql`, and GitLab uses
 * `<origin>/api/v4`. Cache keys are prefixed with the account and host.
 *
 * @param {Object} context A validated repository context.
 * @param {Object} store The stored data.
 * @param {Object} [override] An account to use instead of the selected one.
 * @returns {{account: ?Object, provider: string, prefix: string, request: Function, json: Function, pages: Function, graphql: Function}}
 */
export function client(context, store, override) {
  let account = override || accountFor(context, store);
  const origin = context.origin;
  const provider = context.provider || account?.provider || providerFor(origin, store);
  const label = provider === 'gitlab' ? 'GitLab' : 'GitHub';
  const base =
    provider === 'gitlab'
      ? `${origin}/api/v4`
      : origin === 'https://github.com'
        ? 'https://api.github.com'
        : `${origin}/api/v3`;
  const graph = origin === 'https://github.com' ? 'https://api.github.com/graphql' : `${origin}/api/graphql`;
  const prefix = `/${account?.id || 'anonymous'}:${origin}`;

  /**
   * Sends one API request.
   *
   * Errors are translated into actionable messages (rejected token, rate
   * limit, not found). Raw file bodies are limited to 2 MiB of UTF-8 text
   * without NUL bytes.
   *
   * @param {string} path An API path starting with `/`, or `@graphql`.
   * @param {{method?: string, body?: Object, raw?: boolean}} [options]
   * @returns {Promise<{data: *, next: boolean}>} The body and whether another page exists.
   */
  async function request(path, {method = 'GET', body, raw = false} = {}) {
    account = await authorizedAccount(account);
    const url = path === '@graphql' ? graph : base + path;
    if (path !== '@graphql' && (!path.startsWith('/') || path.startsWith('//'))) throw new Error('Invalid API path.');
    const headers = {
      Accept:
        provider === 'gitlab'
          ? raw
            ? 'text/plain'
            : 'application/json'
          : raw
            ? 'application/vnd.github.raw+json'
            : 'application/vnd.github+json',
    };
    if (account?.token) headers.Authorization = `Bearer ${account.token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      const fail = message => {
        const error = new Error(message);
        error.status = response.status;
        throw error;
      };
      let message = '';
      try {
        message = (await responseJSON(response, 64 * 1024)).message || '';
      } catch {
        /* Non-JSON or oversized errors use the status message below. */
      }
      if (response.status === 401)
        fail(
          account
            ? `${label} rejected this token. Update the account in Settings.`
            : `${label} requires an account for this operation. Add a token in Settings.`,
        );
      if (
        (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') ||
        response.status === 429
      ) {
        const reset = Number(response.headers.get('X-RateLimit-Reset'));
        fail(
          `${label} API rate limit reached.${reset ? ` Resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : ''} Add an account or retry later.`,
        );
      }
      // Without a token, providers answer 404 for private repositories instead of 401.
      if (response.status === 404)
        fail(
          account
            ? `${label} did not find this repository, branch or file with account ${account.login}. Check that the token can read this repository and, for an organization with SSO, that the token is authorized for it.`
            : `${label} did not find this repository, branch or file without an account. If the repository is private, connect a ${label} account with read access to it in Settings.`,
        );
      fail(`${label} API ${response.status}${message ? `: ${String(message).slice(0, 250)}` : ''}`);
    }
    if (raw) {
      const bytes = await responseBytes(
        response,
        2 * 1024 * 1024,
        `This file exceeds the 2 MiB text preview limit. Open it on ${label}.`,
      );
      if (bytes.includes(0)) throw new Error(`Binary files cannot be shown as a text diff. Open the file on ${label}.`);
      try {
        return {data: new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes), next: false};
      } catch {
        throw new Error(`This file is not UTF-8 text. Open the file on ${label}.`);
      }
    }
    return {
      data: await responseJSON(response),
      next: /rel="next"/.test(response.headers.get('Link') || '') || Number(response.headers.get('X-Next-Page')) > 0,
    };
  }

  /**
   * Returns a cached JSON response.
   *
   * @param {string} path An API path.
   * @param {number} [ttl=30000] Cache lifetime in milliseconds.
   * @param {boolean} [fresh=false] Bypass the cache.
   * @returns {Promise<*>}
   */
  async function json(path, ttl = 30000, fresh = false) {
    return memo(prefix + path, ttl, async () => (await request(path)).data, fresh);
  }

  /**
   * Loads every page of a list (100 items per page, up to 100 pages).
   *
   * @param {string} path An API path, with or without a query.
   * @param {?string} [property=null] Property holding the list in each page.
   * @returns {Promise<Array>}
   * @throws {Error} If the list does not end within 10,000 items.
   */
  async function pages(path, property = null) {
    const list = [];
    const check = listBudget();
    for (let page = 1; page <= 100; page++) {
      const {data, next} = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const values = property ? data[property] : data;
      check(values);
      list.push(...values);
      if (!next) return list;
    }
    throw new Error(`This list exceeds 10,000 results. ${label} did not return a complete list.`);
  }

  /**
   * Sends an authenticated GitHub GraphQL request.
   *
   * @param {string} query The GraphQL document.
   * @param {Object} variables Its variables.
   * @returns {Promise<Object>} The `data` object.
   */
  async function graphql(query, variables) {
    if (!account) throw new Error('Add a GitHub account in Settings to use this review filter.');
    const {data} = await request('@graphql', {method: 'POST', body: {query, variables}});
    if (data.errors?.length)
      throw new Error(
        data.errors
          .map(error => error.message)
          .join('; ')
          .slice(0, 350),
      );
    return data.data;
  }
  return {account, provider, prefix, request, json, pages, graphql};
}
