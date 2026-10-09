/**
 * Synchronous fine-grained reactivity with SolidJS names and semantics.
 *
 * Signals hold values; memos derive values lazily; render effects apply
 * values to the DOM and re-run after a value they read changes.
 * Computations form an owner tree: before each re-run and on dispose a
 * computation disposes the computations and cleanups it created, and
 * `createRoot` owns a whole subtree.
 *
 * Differences from Solid, chosen for the extension:
 *
 * - Updates are synchronous: when a write or the outermost `batch`
 *   returns, every affected effect has run, so code that reads the DOM
 *   right after a write sees the result. Use `batch` for several writes.
 * - Memos are lazy and cut off equal results: a memo nobody reads never
 *   computes, and one that recomputes to an equal value does not re-run its
 *   readers.
 * - Misuse fails loudly: a memo that writes a signal throws, and effects
 *   that never settle throw with the name of the last effect.
 *
 * Only reads through getters are tracked: a value mutated in place (a
 * pushed array, a changed object field) notifies nobody. Replace such
 * values instead.
 *
 * The module has no side effects and uses no DOM, timers or microtasks.
 *
 * @module shared/reactive
 */

/** The owner that new computations and cleanups attach to, or `null`. */
let owner = null;

/** The computation that records what it reads, or `null`. */
let listener = null;

/** Depth of open batches, roots and flushes; queued effects wait until it is 0. */
let depth = 0;

/** Depth of running memos; signals must not be written while it is above 0. */
let computing = 0;

/** Stale effects in invalidation order. */
const queue = new Set();

/** Effect runs allowed in one flush before the updates are treated as a cycle. */
const maxRuns = 10000;

/** Records that the listening computation read [node] at its current version. */
function track(node) {
  if (!listener) return;
  node.observers.add(listener);
  listener.sources.set(node, node.version);
}

/** Marks every reader of [node] stale: memos propagate further, effects are queued. */
function invalidate(node) {
  for (const reader of [...node.observers]) reader.invalidate();
}

/**
 * Whether a source of [node] changed since [node] last ran.
 *
 * Stale memo sources are refreshed first; one that recomputed to an equal
 * value keeps its version, so its readers are skipped.
 */
function changed(node) {
  for (const [source, version] of node.sources) {
    source.refresh?.();
    if (source.version !== version) return true;
  }
  return false;
}

/** Releases what [node] holds from its last run: owned computations, cleanups (in reverse order) and sources. */
function clean(node) {
  if (node.owned) {
    for (const child of node.owned) dispose(child);
    node.owned = null;
  }
  if (node.cleanups) {
    const cleanups = node.cleanups;
    node.cleanups = null;
    for (let index = cleanups.length - 1; index >= 0; index--) untrack(cleanups[index]);
  }
  if (node.sources) {
    for (const source of node.sources.keys()) source.observers.delete(node);
    node.sources.clear();
  }
}

/** Disposes [node] and everything it owns; a queued effect will not run. */
function dispose(node) {
  node.disposed = true;
  queue.delete(node);
  clean(node);
}

/** Creates an owner node attached to the current owner, if any. */
function createOwner(fields) {
  const node = {owner, owned: null, cleanups: null, handler: null, disposed: false, ...fields};
  if (owner) (owner.owned ??= []).push(node);
  return node;
}

/**
 * Passes [error] to the nearest `catchError` handler above [node], or throws it.
 *
 * @throws {*} [error] when no handler exists, or the error of a failing handler.
 */
function handleError(node, error) {
  for (let current = node; current; current = current.owner) {
    if (current.handler) return untrack(() => current.handler(error));
  }
  throw error;
}

/** Runs [node]'s function as its owner and listener after releasing its previous run. */
function run(node) {
  clean(node);
  const previousOwner = owner;
  const previousListener = listener;
  owner = node;
  listener = node;
  try {
    node.value = node.fn(node.value);
  } catch (error) {
    handleError(node, error);
  } finally {
    owner = previousOwner;
    listener = previousListener;
  }
}

/**
 * Runs the queued effects unless a batch, root or flush is open.
 *
 * Effects invalidated while flushing join the same flush. Every queued
 * effect runs even if one throws; the first error is rethrown afterwards.
 *
 * @throws {*} The first unhandled error, or a cycle error after `maxRuns` runs.
 */
function flush() {
  if (depth) return;
  depth++;
  let runs = 0;
  let failure = null;
  try {
    for (let node = queue.values().next().value; node; node = queue.values().next().value) {
      queue.delete(node);
      if (++runs > maxRuns) {
        queue.clear();
        throw new Error(`Reactive updates did not settle; last effect: ${node.name || 'anonymous'}.`);
      }
      try {
        if (!node.disposed && changed(node)) run(node);
      } catch (error) {
        failure ??= {error};
      }
    }
  } finally {
    depth--;
  }
  if (failure) throw failure.error;
}

/**
 * Creates a signal.
 *
 * The setter takes a value or an updater `previous => next` and ignores a
 * value equal to the current one by [equals]. Writing while a memo computes
 * throws.
 *
 * @template T
 * @param {T} value The initial value.
 * @param {{equals?: false|((previous: T, next: T) => boolean), name?: string}} [options]
 * @returns {[() => T, (next: T|((previous: T) => T)) => T]} The getter and the setter.
 */
export function createSignal(value, {equals = Object.is, name} = {}) {
  const node = {value, version: 0, observers: new Set(), name};
  const read = () => {
    track(node);
    return node.value;
  };
  const write = next => {
    if (computing) throw new Error(`A memo wrote the signal ${name || 'anonymous'}; memos must not write.`);
    if (typeof next === 'function') next = next(node.value);
    if (equals && equals(node.value, next)) return next;
    node.value = next;
    node.version++;
    invalidate(node);
    flush();
    return next;
  };
  return [read, write];
}

/**
 * Creates a lazily derived value owned by the current owner.
 *
 * It computes on first read and again on read after a source changed. Its
 * readers re-run only when the result differs by [equals]. [fn] receives
 * the previous result and must not write signals.
 *
 * @template T
 * @param {(previous: T) => T} fn Derives the value.
 * @param {T} [value] The value passed to the first run.
 * @param {{equals?: false|((previous: T, next: T) => boolean), name?: string}} [options]
 * @returns {() => T} The getter.
 */
export function createMemo(fn, value, {equals = Object.is, name} = {}) {
  const node = createOwner({fn, value, version: 0, stale: true, observers: new Set(), sources: new Map(), name});
  node.invalidate = () => {
    if (node.stale) return;
    node.stale = true;
    invalidate(node);
  };
  node.refresh = () => {
    if (!node.stale || node.disposed) return;
    if (node.version && !changed(node)) {
      node.stale = false;
      return;
    }
    const previous = node.value;
    computing++;
    try {
      run(node);
    } finally {
      computing--;
    }
    node.stale = false;
    if (node.version && equals && equals(previous, node.value)) return;
    node.version++;
  };
  return () => {
    node.refresh();
    track(node);
    return node.value;
  };
}

/**
 * Creates a render effect: it runs immediately, even inside a batch or
 * root, and again after a value it read changes.
 *
 * Use it to apply values to the DOM. When it calls a function that reads
 * values it should not depend on, wrap the call in `untrack`.
 *
 * @template T
 * @param {(previous: T) => T} fn Applies values to the DOM; receives its previous result.
 * @param {T} [value] The value passed to the first run.
 * @param {{name?: string}} [options]
 */
export function createRenderEffect(fn, value, {name} = {}) {
  const node = createOwner({fn, value, sources: new Map(), name});
  node.invalidate = () => {
    if (!node.disposed) queue.add(node);
  };
  run(node);
}

/**
 * Runs [fn] in a new root that owns every computation created inside it.
 *
 * The root is not disposed with the current owner, but errors inside it
 * still reach `catchError` handlers above it. Effects invalidated while
 * [fn] runs re-run after it returns.
 *
 * @template T
 * @param {(dispose: () => void) => T} fn Creates the computations.
 * @returns {T} The result of [fn].
 */
export function createRoot(fn) {
  const root = {owner, owned: null, cleanups: null, handler: null, disposed: false};
  const previousOwner = owner;
  const previousListener = listener;
  owner = root;
  listener = null;
  depth++;
  try {
    return fn(() => dispose(root));
  } finally {
    owner = previousOwner;
    listener = previousListener;
    depth--;
    flush();
  }
}

/**
 * Registers [fn] to run when the current owner re-runs or is disposed.
 *
 * Outside any owner it does nothing, so features also work without a root.
 *
 * @param {() => void} fn
 * @returns {() => void} [fn].
 */
export function onCleanup(fn) {
  if (owner) (owner.cleanups ??= []).push(fn);
  return fn;
}

/**
 * Runs [fn] with effects deferred until the outermost batch returns, so
 * several writes run each affected effect once.
 *
 * @template T
 * @param {() => T} fn Writes signals.
 * @returns {T} The result of [fn].
 */
export function batch(fn) {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
    flush();
  }
}

/**
 * Runs [fn] without recording what it reads.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T} The result of [fn].
 */
export function untrack(fn) {
  const previous = listener;
  listener = null;
  try {
    return fn();
  } finally {
    listener = previous;
  }
}

/**
 * Runs [fn] in an owner whose errors, including later errors of the
 * computations created inside it, go to [handler] instead of the writer.
 *
 * @template T
 * @param {() => T} fn
 * @param {(error: *) => void} handler
 * @returns {T|undefined} The result of [fn], or `undefined` after a handled error.
 */
export function catchError(fn, handler) {
  const node = createOwner({handler});
  const previousOwner = owner;
  owner = node;
  try {
    return fn();
  } catch (error) {
    return handleError(node, error);
  } finally {
    owner = previousOwner;
  }
}

/** Returns the current owner, to restore it after an `await` with `runWithOwner`. */
export function getOwner() {
  return owner;
}

/**
 * Runs [fn] untracked with [node] as the owner, so computations and
 * cleanups created after an `await` still belong to it. Does nothing if
 * [node] was disposed.
 *
 * @template T
 * @param {?Object} node An owner from `getOwner`.
 * @param {() => T} fn
 * @returns {T|undefined} The result of [fn].
 */
export function runWithOwner(node, fn) {
  if (node?.disposed) return undefined;
  const previousOwner = owner;
  const previousListener = listener;
  owner = node;
  listener = null;
  try {
    return fn();
  } finally {
    owner = previousOwner;
    listener = previousListener;
  }
}

/**
 * Creates a signal holding a Set that is replaced, never mutated, and
 * compared by contents, so an equal new Set does not notify readers.
 *
 * @template T
 * @param {Set<T>} [value=new Set()] The initial Set.
 * @param {{name?: string}} [options]
 * @returns {[() => Set<T>, (next: Set<T>|((previous: Set<T>) => Set<T>)) => Set<T>]}
 */
export function createSetSignal(value = new Set(), {name} = {}) {
  return createSignal(value, {name, equals: sameItems});
}

/** Whether two Sets contain the same items. */
export function sameItems(previous, next) {
  return previous.size === next.size && [...previous].every(item => next.has(item));
}

/**
 * Returns a getter that stays `true` until the current owner re-runs or is
 * disposed, for asynchronous work started by that owner.
 *
 * It complements request generations: work owned by a page root stops
 * applying replies once navigation disposes the root.
 *
 * @returns {() => boolean}
 */
export function createAlive() {
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  return () => alive;
}
