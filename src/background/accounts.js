/* Connected accounts, custom-host content scripts and the state shared with pages. */
import {preferences} from '../shared/preferences.js';
import {normalizeOrigin} from '../shared/routes.js';
import {clearCache} from './cache.js';
import {client} from './client.js';
import {origins, providerFor} from './hosts.js';
import {readStore, windowPin, writeStore} from './storage.js';
import * as sync from './sync.js';

export async function publicState(store, sender) {
  const value = preferences(store.preferences);
  if (Number.isInteger(sender?.tab?.windowId)) {
    const {windowPins = {}} = await chrome.storage.session.get('windowPins');
    if (typeof windowPins[sender.tab.windowId] === 'boolean') value.pinned = windowPins[sender.tab.windowId];
    else value.pinned = await windowPin(sender.tab.windowId, value.pinned, true);
  }
  return {
    preferences: value,
    accounts: (store.accounts || []).map(({id, origin, login, label}) => ({id, origin, login, label, provider: providerFor(origin, store)})),
    hosts: [...origins(store)].map(origin => ({origin, provider: providerFor(origin, store)})),
    selectedAccounts: store.selectedAccounts || {},
    bookmarks: store.bookmarks || [],
    ...(sender?.url === chrome.runtime.getURL('options.html') ? {sync: sync.status()} : {}),
  };
}

export async function registerEnterpriseScripts() {
  const store = await readStore();
  const hosts = [...origins(store)].filter(origin => !['https://github.com', 'https://gitlab.com'].includes(origin));
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const obsolete = existing.filter(script => script.id.startsWith('codetree-')).map(script => script.id);
  if (obsolete.length) await chrome.scripting.unregisterContentScripts({ids: obsolete});
  for (let index = 0; index < hosts.length; index++) {
    if (await chrome.permissions.contains({origins: [`${hosts[index]}/*`]})) {
      await chrome.scripting.registerContentScripts([{id: `codetree-${index}`, matches: [`${hosts[index]}/*`], js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true}]);
    }
  }
}

export async function saveAccount(value, store) {
  const origin = normalizeOrigin(value.origin); const provider = value.provider;
  if (providerFor(origin, store) !== provider && origins(store).has(origin)) throw new Error('This host is connected to another repository provider.');
  if (!(await chrome.permissions.contains({origins: [`${origin === 'https://github.com' ? 'https://api.github.com' : origin}/*`]}))) throw new Error('Grant browser access to this repository host first.');
  const temporary = {...value, id: crypto.randomUUID(), origin};
  const user = await client({origin, provider}, store, temporary).json('/user', 0, true);
  const login = provider === 'gitlab' ? user.username : user.login;
  if (!login) throw new Error('The server did not return an account username.');
  await writeStore(current => {
    const accounts = [...(current.accounts || [])]; const index = accounts.findIndex(account => account.origin === origin && account.login === login);
    const account = {...temporary, id: index === -1 ? temporary.id : accounts[index].id, login, label: String(value.label || login).slice(0, 60)};
    if (index === -1) accounts.push(account); else accounts[index] = account;
    return {accounts};
  });
  await clearCache(); await registerEnterpriseScripts();
}

export async function removeAccount(id) {
  await writeStore(current => {
    const accounts = (current.accounts || []).filter(account => account.id !== id);
    const selectedAccounts = {...current.selectedAccounts};
    for (const origin of Object.keys(selectedAccounts)) if (selectedAccounts[origin] === id) selectedAccounts[origin] = 'auto';
    return {accounts, selectedAccounts};
  });
  await clearCache(); await registerEnterpriseScripts();
}
