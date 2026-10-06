/**
 * Optional browser Sync of preferences and bookmarks.
 *
 * Off by default and enabled per device in Settings. One versioned
 * snapshot (at most 8 KiB) is stored in `chrome.storage.sync`; it contains
 * only whitelisted preferences and bookmark URLs, titles and dates.
 * Tokens, accounts, Viewed marks and caches never leave the device.
 *
 * The newest `updatedAt` wins. Enabling merges remote bookmarks with local
 * ones by URL, keeping local details for duplicates. Only the trusted
 * service worker loads this module.
 *
 * @module background/sync
 */
import * as C from '../shared/preferences.js';

/** `chrome.storage.sync` key of the shared snapshot. */
const snapshotKey = 'codetreeSyncSnapshot';

/** `chrome.storage.local` key of this device's Sync settings. */
const settingsKey = 'syncSettings';

/** Preferences included in the snapshot. */
const preferenceKeys = Object.freeze(['dock', 'width', 'pinned', 'open', 'iconTheme', 'fontFamily', 'fontSize',
  'toggleShortcut', 'searchShortcut', 'pageScope', 'hidePatterns', 'folderClick']);

/** Snapshot size limit, below Chrome's per-item quota. */
const maxItemBytes = 8192;
// Store accessors supplied by the broker, the initialization promise, the
// serialized task queue, whether the remote snapshot was read, the newest
// known snapshot time and the last applied/published snapshot.
let readStore; let writeStore; let ready; let tasks = Promise.resolve(); let remoteLoaded = false; let latestUpdatedAt = 0; let lastSnapshot = '';

/** This device's Sync state, as shown in Settings. */
let settings = {enabled: false, lastSyncedAt: 0, error: ''};

/**
 * Returns a copy of this device's Sync state.
 *
 * @returns {{enabled: boolean, lastSyncedAt: number, error: string}}
 */
export function status() { return {...settings}; }

/** Runs Sync tasks one at a time; a failure does not stop later tasks. */
function serial(callback) {
  const result = tasks.then(callback);
  tasks = result.catch(() => {});
  return result;
}

/** UTF-8 size of a value serialized as JSON. */
function byteSize(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }

/** Size counted against the browser's per-item Sync quota. */
function itemBytes(value) { return snapshotKey.length + byteSize(value); }

/** Validates and normalizes the whitelisted preferences of a snapshot. */
function preferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The synced preferences are invalid.');
  const selected = {};
  for (const key of preferenceKeys) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== typeof C.defaults[key]) throw new Error('The synced preferences are invalid.');
    selected[key] = value[key];
  }
  C.validateNavigation({...C.defaults, ...selected});
  const normalized = C.preferences(selected);
  return Object.fromEntries(preferenceKeys.map(key => [key, normalized[key]]));
}

/** Validates a bookmark: an HTTPS URL without credentials, a title and a creation time. */
function bookmark(value) {
  if (!value || typeof value !== 'object' || typeof value.url !== 'string' || typeof value.title !== 'string') throw new Error('The synced bookmarks are invalid.');
  const url = new URL(value.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS bookmark URLs without credentials can be synced.');
  const createdAt = value.createdAt ?? value.created;
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error('The synced bookmark date is invalid.');
  const result = {url: url.href, title: value.title.slice(0, 180), createdAt};
  if (typeof value.repo === 'string') result.repo = value.repo.slice(0, 180);
  return result;
}

/**
 * Validates a snapshot read from or written to browser Sync.
 *
 * @throws {Error} If the version, size, preferences or bookmarks are invalid.
 */
function snapshot(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 1 || value.updatedAt >= Number.MAX_SAFE_INTEGER || !Array.isArray(value.bookmarks)) throw new Error('The synced snapshot is invalid or uses an unsupported version.');
  if (itemBytes(value) > Math.min(maxItemBytes, chrome.storage.sync.QUOTA_BYTES_PER_ITEM || maxItemBytes)) throw new Error('The synced snapshot exceeds the 8 KiB browser Sync limit.');
  const bookmarks = value.bookmarks.map(bookmark);
  if (new Set(bookmarks.map(item => item.url)).size !== bookmarks.length) throw new Error('The synced bookmarks contain duplicate URLs.');
  return {version: 1, updatedAt: value.updatedAt, preferences: preferences(value.preferences), bookmarks};
}

/** Stores this device's Sync settings; returns whether the write succeeded. */
async function saveSettings() {
  try { await chrome.storage.local.set({[settingsKey]: {...status(), updatedAt: latestUpdatedAt}}); return true; }
  catch { settings.error = 'The browser could not save the Sync setting. Local preferences and bookmarks are kept.'; return false; }
}

/** Records a Sync error for Settings; quota errors get an actionable message. */
async function failure(error) {
  const message = error instanceof Error ? error.message : String(error);
  settings.error = /quota|max_write|write operations/i.test(message)
    ? 'Browser Sync quota or write-rate limit reached. Local changes are saved; save again after reducing synced data or waiting.'
    : message;
  await saveSettings();
  return status();
}

/** Reads and validates the shared snapshot, if any. */
async function remote() {
  const values = await chrome.storage.sync.get(snapshotKey);
  return Object.hasOwn(values, snapshotKey) ? snapshot(values[snapshotKey]) : null;
}

/**
 * Applies a snapshot to local storage.
 *
 * Local bookmark IDs are kept for known URLs. With [merge], local
 * bookmarks are added to the remote ones and win for duplicate URLs.
 */
async function apply(value, merge = false) {
  await writeStore(current => {
    const existing = new Map((current.bookmarks || []).map(item => [item.url, item]));
    const bookmarks = value.bookmarks.map(item => ({id: existing.get(item.url)?.id || crypto.randomUUID(),
      url: item.url, title: item.title, created: item.createdAt, ...(item.repo ? {repo: item.repo} : {})}));
    if (merge) {
      const combined = new Map(bookmarks.map(item => [item.url, item]));
      for (const item of current.bookmarks || []) combined.set(item.url, item);
      return {preferences: value.preferences, bookmarks: [...combined.values()].sort((a, b) => b.created - a.created)};
    }
    return {preferences: value.preferences, bookmarks};
  });
  settings.lastSyncedAt = value.updatedAt;
  latestUpdatedAt = value.updatedAt;
  lastSnapshot = JSON.stringify(value);
  settings.error = '';
}

/**
 * Writes the current local preferences and bookmarks as a new snapshot.
 *
 * Total and item quotas are checked before writing so a failure leaves
 * the previous snapshot intact.
 */
async function publish() {
  const current = await readStore();
  latestUpdatedAt = Math.max(Date.now(), latestUpdatedAt + 1);
  const value = snapshot({version: 1, updatedAt: latestUpdatedAt,
    preferences: preferences(C.preferences(current.preferences)), bookmarks: (current.bookmarks || []).map(bookmark)});
  const values = await chrome.storage.sync.get(null);
  const previousBytes = Object.hasOwn(values, snapshotKey) ? itemBytes(values[snapshotKey]) : 0;
  const usedBytes = await chrome.storage.sync.getBytesInUse(null);
  if (usedBytes - previousBytes + itemBytes(value) > (chrome.storage.sync.QUOTA_BYTES || 102400)) throw new Error('Browser Sync total storage quota reached.');
  if (!Object.hasOwn(values, snapshotKey) && Object.keys(values).length >= (chrome.storage.sync.MAX_ITEMS || 512)) throw new Error('Browser Sync item quota reached.');
  await chrome.storage.sync.set({[snapshotKey]: value});
  settings.lastSyncedAt = value.updatedAt;
  lastSnapshot = JSON.stringify(value);
  settings.error = '';
  await saveSettings();
  return status();
}

/**
 * Applies a newer remote snapshot once, then publishes the local state.
 *
 * With [preserveLocal], a newer remote snapshot only advances the clock,
 * because the caller has just saved a local change.
 */
async function syncCurrent(preserveLocal = false) {
  await chrome.storage.sync.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  if (!remoteLoaded) {
    const value = await remote();
    if (value && value.updatedAt >= latestUpdatedAt && JSON.stringify(value) !== lastSnapshot) {
      if (preserveLocal) latestUpdatedAt = Math.max(latestUpdatedAt, value.updatedAt);
      else await apply(value);
    }
    remoteLoaded = true;
  }
  return publish();
}

/**
 * Loads the Sync settings and starts listening for remote changes.
 *
 * Called once by the service worker; later calls return the same promise.
 *
 * @param {{readStore: Function, writeStore: Function}} hooks Trusted storage accessors.
 * @returns {Promise<Object>} The Sync status.
 */
export function initialize(hooks) {
  if (ready) return ready;
  readStore = hooks.readStore; writeStore = hooks.writeStore;
  ready = serial(async () => {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes[snapshotKey]?.newValue) return;
        const value = changes[snapshotKey].newValue;
        void serial(async () => {
          if (!settings.enabled) return;
          try {
            await chrome.storage.sync.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
            const incoming = snapshot(value);
            if (incoming.updatedAt < latestUpdatedAt || (incoming.updatedAt === latestUpdatedAt && JSON.stringify(incoming) === lastSnapshot)) return;
            await apply(incoming); remoteLoaded = true; await saveSettings();
          } catch (error) { await failure(error); }
        });
      });
      const values = await chrome.storage.local.get(settingsKey);
      const saved = values[settingsKey];
      settings = {enabled: saved?.enabled === true, lastSyncedAt: Number.isSafeInteger(saved?.lastSyncedAt) && saved.lastSyncedAt >= 0 ? saved.lastSyncedAt : 0, error: ''};
      latestUpdatedAt = Number.isSafeInteger(saved?.updatedAt) && saved.updatedAt >= settings.lastSyncedAt && saved.updatedAt < Number.MAX_SAFE_INTEGER ? saved.updatedAt : settings.lastSyncedAt;
      await chrome.storage.sync.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
      if (settings.enabled) {
        const value = await remote();
        if (value && value.updatedAt >= latestUpdatedAt && JSON.stringify(value) !== lastSnapshot) await apply(value);
        remoteLoaded = true;
      }
      await saveSettings();
    } catch (error) { await failure(error); }
    return status();
  });
  return ready;
}

/**
 * Writes preferences or bookmarks locally and publishes them when Sync is enabled.
 *
 * Sync errors are recorded for Settings and never undo the local write.
 *
 * @param {function(Object): Object} callback Computes the update from the store.
 * @returns {Promise<Object>} The local update.
 */
export async function localWrite(callback) {
  await ready;
  return serial(async () => {
    const update = await writeStore(callback);
    if (settings.enabled) {
      latestUpdatedAt = Math.max(Date.now(), latestUpdatedAt + 1);
      try { await syncCurrent(true); } catch (error) { await failure(error); }
    }
    return update;
  });
}

/**
 * Enables, disables or re-synchronizes Sync on this device.
 *
 * Disabling keeps both the local data and the shared snapshot.
 *
 * @param {boolean} enabled The requested state.
 * @returns {Promise<{sync: Object, preferences: Object, bookmarks: Array}>}
 */
export async function configure(enabled) {
  await ready;
  return serial(async () => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid Sync setting.');
    if (!enabled) {
      settings.enabled = false; settings.error = ''; remoteLoaded = false;
      if (!await saveSettings()) settings.error = 'Sync is stopped for this session, but the disabled setting could not be saved. It may resume after a browser restart. Retry saving the setting.';
    } else if (!settings.enabled) {
      try {
        await chrome.storage.sync.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
        const value = await remote();
        if (value) await apply(value, true);
        settings.enabled = true; remoteLoaded = true;
        await saveSettings();
        await publish();
      } catch (error) { await failure(error); }
    } else {
      try { await syncCurrent(); } catch (error) { await failure(error); }
    }
    const current = await readStore();
    return {sync: status(), preferences: C.preferences(current.preferences), bookmarks: current.bookmarks || []};
  });
}
