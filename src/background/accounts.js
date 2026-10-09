/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/**
 * Connected accounts, custom-host content scripts and the public state
 * shared with pages.
 *
 * @module background/accounts
 */
import {preferences} from '../shared/preferences.js';
import {normalizeOrigin} from '../shared/routes.js';
import {clearCache} from './cache.js';
import {client} from './client.js';
import {enabledBookmarks, origins, providerFor} from './hosts.js';
import {readStore, windowPin, writeStore} from './storage.js';
import * as sync from './sync.js';

/**
 * Returns the state a page or Settings may see.
 *
 * Accounts are reduced to their ID, host, username, label and provider;
 * tokens are never included. Pages receive only the accounts and account
 * selection of their own host and bookmarks for enabled hosts. Pinning
 * reflects the sender's window, and only Settings receives the Sync status.
 *
 * @param {Object} store The stored data.
 * @param {chrome.runtime.MessageSender} sender The requesting page or Settings.
 * @returns {Promise<Object>}
 */
export async function publicState(store, sender) {
  const value = preferences(store.preferences);
  const isOptions = sender?.url === chrome.runtime.getURL('options.html');
  const visible = origin => isOptions || origin === new URL(sender?.url || 'about:blank').origin;
  if (Number.isInteger(sender?.tab?.windowId)) {
    const {windowPins = {}} = await chrome.storage.session.get('windowPins');
    if (typeof windowPins[sender.tab.windowId] === 'boolean') value.pinned = windowPins[sender.tab.windowId];
    else value.pinned = await windowPin(sender.tab.windowId, value.pinned, true);
  }
  return {
    preferences: value,
    accounts: (store.accounts || [])
      .filter(account => visible(account.origin))
      .map(({id, origin, login, label}) => ({id, origin, login, label, provider: providerFor(origin, store)})),
    hosts: [...origins(store)].map(origin => ({origin, provider: providerFor(origin, store)})),
    selectedAccounts: Object.fromEntries(
      Object.entries(store.selectedAccounts || {}).filter(([origin]) => visible(origin)),
    ),
    bookmarks: isOptions ? store.bookmarks || [] : enabledBookmarks(store.bookmarks, store),
    ...(isOptions ? {sync: sync.status()} : {}),
  };
}

/**
 * Registers the content script for every connected custom host.
 *
 * github.com and gitlab.com use the manifest's content scripts. Custom
 * hosts are registered only while their optional host permission is
 * granted; previous registrations are always replaced.
 *
 * @returns {Promise<void>}
 */
export async function registerEnterpriseScripts() {
  const store = await readStore();
  const hosts = [...origins(store)].filter(origin => !['https://github.com', 'https://gitlab.com'].includes(origin));
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const obsolete = existing.filter(script => script.id.startsWith('codetree-')).map(script => script.id);
  if (obsolete.length) await chrome.scripting.unregisterContentScripts({ids: obsolete});
  for (let index = 0; index < hosts.length; index++) {
    if (await chrome.permissions.contains({origins: [`${hosts[index]}/*`]})) {
      await chrome.scripting.registerContentScripts([
        {
          id: `codetree-${index}`,
          matches: [`${hosts[index]}/*`],
          js: ['content.js'],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ]);
    }
  }
}

/**
 * Verifies credentials against the host's `/user` endpoint and stores the account.
 *
 * Connecting the same host and username again replaces the previous
 * credentials and keeps the account ID.
 *
 * @param {Object} value `{origin, provider, auth, token, label, …}` for a PAT or OAuth account.
 * @param {Object} store The stored data.
 * @returns {Promise<void>}
 * @throws {Error} If the host permission is missing, the host belongs to
 *     another provider or the server rejects the credentials.
 */
export async function saveAccount(value, store) {
  const origin = normalizeOrigin(value.origin);
  const provider = value.provider;
  if (providerFor(origin, store) !== provider && origins(store).has(origin))
    throw new Error('This host is connected to another repository provider.');
  if (
    !(await chrome.permissions.contains({
      origins: [`${origin === 'https://github.com' ? 'https://api.github.com' : origin}/*`],
    }))
  )
    throw new Error('Grant browser access to this repository host first.');
  const temporary = {...value, id: crypto.randomUUID(), origin};
  const user = await client({origin, provider}, store, temporary).json('/user', 0, true);
  const login = provider === 'gitlab' ? user.username : user.login;
  if (!login) throw new Error('The server did not return an account username.');
  await writeStore(current => {
    const accounts = [...(current.accounts || [])];
    const index = accounts.findIndex(account => account.origin === origin && account.login === login);
    const account = {
      ...temporary,
      id: index === -1 ? temporary.id : accounts[index].id,
      login,
      label: String(value.label || login).slice(0, 60),
    };
    if (index === -1) accounts.push(account);
    else accounts[index] = account;
    return {accounts};
  });
  await clearCache();
  await registerEnterpriseScripts();
}

/**
 * Removes an account; hosts that selected it fall back to automatic selection.
 *
 * Provider-side OAuth grants are not revoked.
 *
 * @param {string} id The account ID.
 * @returns {Promise<void>}
 */
export async function removeAccount(id) {
  await writeStore(current => {
    const accounts = (current.accounts || []).filter(account => account.id !== id);
    const selectedAccounts = {...current.selectedAccounts};
    for (const origin of Object.keys(selectedAccounts))
      if (selectedAccounts[origin] === id) selectedAccounts[origin] = 'auto';
    return {accounts, selectedAccounts};
  });
  await clearCache();
  await registerEnterpriseScripts();
}
