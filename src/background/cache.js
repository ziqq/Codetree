/**
 * Bounded API caches.
 *
 * - The memory cache keeps up to 80 entries / 12 MiB of API responses with
 *   per-entry lifetimes and deduplicates concurrent requests.
 * - The tree cache persists revision-scoped trees in local storage, up to
 *   48 entries / 4 MiB for 24 hours.
 *
 * Every clear increments a generation; replies started before the clear
 * are returned to their caller but never written back into the cache.
 *
 * @module background/cache
 */
import {storageReady} from './storage.js';

/** API responses by key: `{value, expires, size}`, oldest first. */
const cache = new Map();

/** In-flight requests by key, shared by concurrent callers. */
const pending = new Map();

/** Persisted trees by key: `{value, expires, size}`, oldest first. */
const trees = new Map();
const treeTTL = 24 * 60 * 60000;

/** Approximate size of the memory cache in bytes (UTF-16). */
let cacheBytes = 0;

/** Incremented by every clear; stale replies compare against it. */
let cacheGeneration = 0; let treeCacheReady; let treeWrites = Promise.resolve();

/**
 * Stores a value, evicting the oldest entries to stay within the limits.
 *
 * Values larger than 8 MiB are not cached.
 */
function putCache(key, value, ttl) {
  const size = JSON.stringify(value).length * 2;
  if (size > 8 * 1024 * 1024) return;
  if (cache.has(key)) { cacheBytes -= cache.get(key).size; cache.delete(key); }
  while (cache.size && (cacheBytes + size > 12 * 1024 * 1024 || cache.size >= 80)) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).size; cache.delete(oldest);
  }
  cache.set(key, {value, expires: Date.now() + ttl, size}); cacheBytes += size;
}

/**
 * Clears both caches, for Refresh and every account or permission change.
 *
 * @returns {Promise<void>} Resolves when the persisted tree cache is cleared.
 */
export async function clearCache() {
  cacheGeneration++; cache.clear(); cacheBytes = 0; pending.clear();
  if (treeCacheReady) await treeCacheReady;
  trees.clear(); await persistTrees();
}

/**
 * Returns a cached value or computes it once for all concurrent callers.
 *
 * @param {string} key A key scoped by account, host and request.
 * @param {number} ttl Lifetime in milliseconds.
 * @param {function(): Promise<*>} callback Computes the value.
 * @param {boolean} [fresh=false] Bypass cached and pending values.
 * @returns {Promise<*>}
 */
export async function memo(key, ttl, callback, fresh = false) {
  const hit = cache.get(key);
  if (!fresh && hit?.expires > Date.now()) return hit.value;
  if (!fresh && pending.has(key)) return pending.get(key);
  const generation = cacheGeneration;
  const promise = callback().then(value => { if (generation === cacheGeneration && pending.get(key) === promise) putCache(key, value, ttl); return value; })
    .finally(() => { if (pending.get(key) === promise) pending.delete(key); });
  pending.set(key, promise);
  return promise;
}

/** Drops expired trees, then the oldest ones beyond 48 entries or 4 MiB. */
function pruneTrees() {
  let size = 0;
  for (const [key, entry] of trees) { if (entry.expires <= Date.now()) trees.delete(key); else size += entry.size; }
  while (trees.size && (trees.size > 48 || size > 4 * 1024 * 1024)) {
    const oldest = trees.keys().next().value; size -= trees.get(oldest).size; trees.delete(oldest);
  }
}

/**
 * Writes the tree cache to local storage after earlier writes.
 *
 * When storage refuses the write (for example, over quota) the persisted
 * cache is removed and trees are only kept in memory.
 */
function persistTrees() {
  const result = treeWrites.then(async () => {
    await storageReady; pruneTrees();
    try { await chrome.storage.local.set({treeCache: {version: 1, entries: [...trees]}}); }
    catch { await chrome.storage.local.remove('treeCache'); trees.clear(); }
  });
  treeWrites = result.catch(() => {}); return result;
}

/**
 * Loads persisted trees once per service-worker lifetime.
 *
 * Entries with invalid shapes or lifetimes are ignored; a clear during
 * loading discards the loaded entries.
 */
function readTrees() {
  if (!treeCacheReady) {
    const generation = cacheGeneration;
    treeCacheReady = storageReady.then(() => chrome.storage.local.get('treeCache')).then(({treeCache}) => {
      if (generation !== cacheGeneration || treeCache?.version !== 1 || !Array.isArray(treeCache.entries)) return;
      for (const [key, entry] of treeCache.entries) {
        if (typeof key === 'string' && Number.isFinite(entry?.expires) && entry.expires > Date.now() && entry.expires <= Date.now() + treeTTL && Array.isArray(entry.value?.entries)) {
          trees.set(key, {...entry, size: (JSON.stringify(entry.value).length + key.length) * 2 + 128});
        }
      }
      pruneTrees();
    }).catch(() => {});
  }
  return treeCacheReady;
}

/**
 * Like [memo], but also persists the tree for 24 hours.
 *
 * @param {string} key A key scoped by account, host, repository and revision.
 * @param {function(): Promise<Object>} callback Loads the tree.
 * @param {boolean} [fresh=false] Bypass cached values.
 * @returns {Promise<Object>}
 */
export async function treeMemo(key, callback, fresh = false) {
  const generation = cacheGeneration;
  await readTrees();
  if (generation !== cacheGeneration) return callback();
  const hit = trees.get(key);
  if (!fresh && hit?.expires > Date.now()) return hit.value;
  const value = await memo(key, treeTTL, callback, fresh);
  if (generation === cacheGeneration && cache.get(key)?.value === value) {
    trees.delete(key); trees.set(key, {value, expires: Date.now() + treeTTL, size: (JSON.stringify(value).length + key.length) * 2 + 128});
    await persistTrees();
  }
  return value;
}
