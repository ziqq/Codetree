/**
 * Service-worker entry point: the trusted message broker.
 *
 * Repository pages and Settings send `{type, context?, …}` messages and
 * receive `{ok: true, value}` or `{ok: false, error}`. Every request is
 * checked against its sender:
 *
 * - Settings may manage accounts, OAuth, Sync and all preferences.
 * - A repository page may only read state, change its own preferences,
 *   bookmarks and window pin, and request data from its own host.
 *
 * Tokens stay in this worker; error messages are redacted before replying.
 *
 * @module background/index
 */
import {preferences, validateNavigation} from '../shared/preferences.js';
import {normalizeOrigin} from '../shared/routes.js';
import {publicState, registerEnterpriseScripts, removeAccount, saveAccount} from './accounts.js';
import {clearCache} from './cache.js';
import {client} from './client.js';
import {origins, validateContext} from './hosts.js';
import {oauthConfig} from './oauth/config.js';
import * as oauth from './oauth/flow.js';
import * as github from './providers/github.js';
import * as gitlab from './providers/gitlab.js';
import {readStore, storageReady, windowPin, writeStore} from './storage.js';
import * as sync from './sync.js';

/** Resolves once Sync settings are loaded; requests wait for it. */
const syncReady = storageReady.then(() => sync.initialize({readStore, writeStore}));
syncReady.catch(() => {});

/**
 * Validates and dispatches one message.
 *
 * @param {Object} message The request.
 * @param {chrome.runtime.MessageSender} sender Its page or Settings.
 * @returns {Promise<*>} The reply value.
 * @throws {Error} With a user-facing message.
 */
async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('Invalid request.');
  await syncReady.catch(() => {});
  const store = await readStore();
  const isOptions = sender.url === chrome.runtime.getURL('options.html');
  let senderOrigin;
  try { senderOrigin = new URL(sender.url || '').origin; } catch { /* Invalid senders are rejected by the origin check below. */ }
  if (!isOptions && (!sender.tab || !origins(store).has(senderOrigin))) throw new Error('This page cannot access extension data.');
  if (message.type === 'STATE') return publicState(store, sender);
  if (message.type === 'OPTIONS') { await chrome.runtime.openOptionsPage(); return true; }
  if (message.type === 'SYNC_SETTINGS') {
    if (!isOptions) throw new Error('Browser Sync can only be configured in extension Settings.');
    return sync.configure(message.enabled);
  }
  if (message.type.startsWith('OAUTH_')) {
    if (!isOptions) throw new Error('OAuth sign-in is available only in extension Settings.');
    if (message.type === 'OAUTH_INFO') return {github: Boolean(oauthConfig.github), gitlab: Boolean(oauthConfig.gitlab),
      redirectUri: `https://${chrome.runtime.id}.chromiumapp.org/gitlab`, device: await oauth.status()};
    if (message.type === 'OAUTH_GITHUB_START') return oauth.start(message.access, message.label);
    if (message.type === 'OAUTH_CANCEL') return oauth.cancel(message.id);
    if (message.type === 'OAUTH_GITHUB_POLL') {
      const result = await oauth.poll(message.id);
      if (result.pending) return result;
      await saveAccount(result.account, store); return {state: await publicState(await readStore(), sender)};
    }
    if (message.type === 'OAUTH_GITLAB') {
      if (!(await chrome.permissions.contains({permissions: ['identity']}))) throw new Error('Allow the browser sign-in permission first.');
      await saveAccount(await oauth.gitlab(message.label), store); return publicState(await readStore(), sender);
    }
    throw new Error('Unknown sign-in request.');
  }
  if (message.type === 'PREFERENCES') {
    validateNavigation({...preferences(store.preferences), ...message.value});
    if (!isOptions && Object.hasOwn(message.value || {}, 'pinned')) throw new Error('Use the window pin button to change pinning in this window.');
    const update = await sync.localWrite(current => ({preferences: preferences({...preferences(current.preferences), ...message.value})}));
    return update.preferences;
  }
  if (message.type === 'WINDOW_PIN') {
    if (!sender.tab || !Number.isInteger(sender.tab.windowId) || typeof message.pinned !== 'boolean') throw new Error('Pinning requires a repository browser window.');
    await windowPin(sender.tab.windowId, message.pinned);
    const tabs = await chrome.tabs.query({windowId: sender.tab.windowId});
    await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, {type: 'WINDOW_PIN_CHANGED', pinned: message.pinned}).catch(() => {})));
    return message.pinned;
  }
  if (message.type === 'SELECT_ACCOUNT') {
    if (message.origin !== senderOrigin && !isOptions) throw new Error('Invalid account host.');
    if (message.id !== 'auto' && !(store.accounts || []).some(account => account.id === message.id && account.origin === message.origin)) throw new Error('Account not found.');
    await writeStore(current => ({selectedAccounts: {...current.selectedAccounts, [message.origin]: message.id}}));
    await clearCache(); return true;
  }
  if (message.type === 'ADD_ACCOUNT' || message.type === 'REMOVE_ACCOUNT') {
    if (!isOptions) throw new Error('Accounts can only be changed in the extension settings.');
    if (message.type === 'ADD_ACCOUNT') {
      const origin = normalizeOrigin(message.origin);
      const provider = message.provider === 'gitlab' ? 'gitlab' : 'github';
      if (typeof message.token !== 'string' || !message.token || /\s/.test(message.token)) throw new Error('Enter a valid personal access token.');
      await saveAccount({origin, provider, auth: 'pat', token: message.token, label: message.label}, store);
    } else await removeAccount(message.id);
    return publicState(await readStore(), sender);
  }
  if (message.type === 'BOOKMARK') {
    const update = await sync.localWrite(current => {
      const bookmarks = [...(current.bookmarks || [])];
      if (message.remove) return {bookmarks: bookmarks.filter(item => item.id !== message.remove)};
      const url = new URL(message.url);
      if (!origins(current).has(url.origin) || url.username || url.password) throw new Error('Only enabled repository hosts can be bookmarked.');
      if (!bookmarks.some(item => item.url === url.href)) bookmarks.unshift({id: crypto.randomUUID(), url: url.href, title: String(message.title || url.pathname).slice(0, 180), created: Date.now()});
      return {bookmarks};
    });
    return update.bookmarks;
  }
  const context = validateContext(message.context, store);
  if (context.origin !== senderOrigin) throw new Error('A page can only request its own repository host.');
  const api = client(context, store);
  return (context.provider === 'gitlab' ? gitlab : github).handle(message, context, api, store);
}
// Replies asynchronously; tokens that slip into error messages are redacted.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(value => sendResponse({ok: true, value}), error => {
    const text = String(error?.message || 'Request failed.').replace(/(?:github_pat_|gh[pousr]_|glpat-)[A-Za-z0-9_-]+/g, '[redacted]');
    sendResponse({ok: false, error: text});
  });
  return true;
});
// Custom-host content scripts are re-registered on install, start and permission changes.
chrome.runtime.onInstalled.addListener(() => registerEnterpriseScripts().catch(() => {}));
chrome.runtime.onStartup.addListener(() => registerEnterpriseScripts().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => { clearCache().catch(() => {}); registerEnterpriseScripts().catch(() => {}); });
// The toolbar button toggles the sidebar, or opens Settings where no sidebar runs.
chrome.action.onClicked.addListener(async tab => {
  try { await chrome.tabs.sendMessage(tab.id, {type: 'TOGGLE'}); }
  catch { await chrome.runtime.openOptionsPage(); }
});
