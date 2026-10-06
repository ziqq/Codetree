/* Bounded in-memory API cache and the persisted, revision-scoped tree cache. */
import {storageReady} from './storage.js';

const cache = new Map();
const pending = new Map();
const trees = new Map();
const treeTTL = 24 * 60 * 60000;
let cacheBytes = 0;
let cacheGeneration = 0; let treeCacheReady; let treeWrites = Promise.resolve();

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
export async function clearCache() {
  cacheGeneration++; cache.clear(); cacheBytes = 0; pending.clear();
  if (treeCacheReady) await treeCacheReady;
  trees.clear(); await persistTrees();
}
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
function pruneTrees() {
  let size = 0;
  for (const [key, entry] of trees) { if (entry.expires <= Date.now()) trees.delete(key); else size += entry.size; }
  while (trees.size && (trees.size > 48 || size > 4 * 1024 * 1024)) {
    const oldest = trees.keys().next().value; size -= trees.get(oldest).size; trees.delete(oldest);
  }
}
function persistTrees() {
  const result = treeWrites.then(async () => {
    await storageReady; pruneTrees();
    try { await chrome.storage.local.set({treeCache: {version: 1, entries: [...trees]}}); }
    catch { await chrome.storage.local.remove('treeCache'); trees.clear(); }
  });
  treeWrites = result.catch(() => {}); return result;
}
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
