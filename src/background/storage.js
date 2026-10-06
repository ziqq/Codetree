/**
 * Trusted extension storage with serialized writes.
 *
 * `chrome.storage.local` is restricted to trusted contexts, so content
 * scripts can never read tokens. Writes run one after another so that
 * concurrent requests cannot lose each other's read-modify-write updates.
 *
 * @module background/storage
 */

/** Tail of the serialized local-storage write queue. */
let writes = Promise.resolve();

/** Tail of the serialized session-storage write queue. */
let sessionWrites = Promise.resolve();

/** Resolves once local storage is limited to trusted extension contexts. */
export const storageReady = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});

/**
 * Reads the stored preferences, accounts, account selections, bookmarks and local Viewed marks.
 *
 * @returns {Promise<Object>}
 */
export async function readStore() {
  await storageReady;
  return chrome.storage.local.get(['preferences', 'accounts', 'selectedAccounts', 'bookmarks', 'localViewed']);
}

/**
 * Applies an update computed from the current store, after all earlier writes.
 *
 * A failed write rejects only its own promise; the queue continues.
 *
 * @param {function(Object): (Object|Promise<Object>)} callback Returns the keys to store.
 * @returns {Promise<Object>} The stored update.
 */
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

/**
 * Stores whether the sidebar is pinned in a browser window.
 *
 * Pin states live in session storage, so they reset when the browser or
 * extension restarts. At most 100 windows are remembered.
 *
 * @param {number} windowId The browser window.
 * @param {boolean} pinned The new state, or the default when [initial] is set.
 * @param {boolean} [initial=false] Keep an existing state instead of overwriting it.
 * @returns {Promise<boolean>} The effective pin state.
 */
export function windowPin(windowId, pinned, initial = false) {
  const result = sessionWrites.then(async () => {
    const {windowPins = {}} = await chrome.storage.session.get('windowPins');
    if (initial && typeof windowPins[windowId] === 'boolean') return windowPins[windowId];
    windowPins[windowId] = pinned;
    const keys = Object.keys(windowPins);
    while (keys.length > 100) delete windowPins[keys.shift()];
    await chrome.storage.session.set({windowPins});
    return pinned;
  });
  sessionWrites = result.catch(() => {});
  return result;
}

/**
 * Records a local Viewed mark for a file in one request revision.
 *
 * Marks are keyed by account, host, repository, request and head SHA, so
 * a new head starts unmarked. Only the 50 most recent revisions are kept.
 *
 * @param {string} key The revision key.
 * @param {string} path The file path.
 * @param {'VIEWED'|'UNVIEWED'} state The new state.
 * @returns {Promise<Object>}
 */
export function saveLocalViewed(key, path, state) {
  return writeStore(current => {
    const localViewed = {...current.localViewed, [key]: {...current.localViewed?.[key], [path]: state}};
    const keys = Object.keys(localViewed);
    while (keys.length > 50) delete localViewed[keys.shift()];
    return {localViewed};
  });
}
