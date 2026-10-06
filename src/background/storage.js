/* Trusted local/session storage with serialized writes. */

let writes = Promise.resolve();
let sessionWrites = Promise.resolve();
export const storageReady = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});

export async function readStore() {
  await storageReady;
  return chrome.storage.local.get(['preferences', 'accounts', 'selectedAccounts', 'bookmarks', 'localViewed']);
}
export function writeStore(callback) {
  const result = writes.then(async () => {
    const current = await readStore();
    const update = await callback(current);
    await chrome.storage.local.set(update);
    return update;
  });
  writes = result.catch(() => {});
  return result;
}
export function windowPin(windowId, pinned, initial = false) {
  const result = sessionWrites.then(async () => {
    const {windowPins = {}} = await chrome.storage.session.get('windowPins');
    if (initial && typeof windowPins[windowId] === 'boolean') return windowPins[windowId];
    windowPins[windowId] = pinned;
    const keys = Object.keys(windowPins); while (keys.length > 100) delete windowPins[keys.shift()];
    await chrome.storage.session.set({windowPins});
    return pinned;
  });
  sessionWrites = result.catch(() => {}); return result;
}
export function saveLocalViewed(key, path, state) {
  return writeStore(current => {
    const localViewed = {...current.localViewed, [key]: {...current.localViewed?.[key], [path]: state}};
    const keys = Object.keys(localViewed);
    while (keys.length > 50) delete localViewed[keys.shift()];
    return {localViewed};
  });
}
