/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/**
 * Synchronous fine-grained reactivity with SolidJS semantics.
 *
 * The API mirrors Solid: `createSignal`, `createMemo`, `createRenderEffect`,
 * `createEffect`, `createRoot`, `onCleanup`, `on`, `batch`, `untrack`,
 * `getOwner`, `runWithOwner` and `catchError`. Computations form an owner
 * tree: a computation disposes the computations and cleanups it created
 * before each re-run and when it is disposed, and `createRoot` owns a whole
 * subtree with one `dispose`.
 *
 * Differences from Solid, chosen for this extension:
 *
 * - Memos are lazy: a memo nobody reads (for example the counter of a hidden
 *   tab) never computes. A memo that recomputes to an equal value does not
 *   re-run its readers.
 * - Updates are synchronous and deterministic: when a write or the
 *   outermost `batch` returns, every render effect and then every effect has
 *   run, and the first unhandled error is rethrown to the writer.
 * - Misuse fails loudly: a memo that writes a signal throws, and effects
 *   that never settle throw with the name of the last effect.
 *
 * The module has no side effects and uses no DOM, timers or microtasks, so
 * it runs unchanged under `node --test`.
 *
 * @module content/reactive
 */

/** The owner that new computations and cleanups attach to, or `null`. */
let owner = null;

/** The computation that records what it reads, or `null`. */
let listener = null;

/** Depth of open batches, roots and flushes; queued effects wait until it is 0. */
let depth = 0;

/** Depth of running memos; signals must not be written while it is above 0. */
let computing = 0;

/** Stale render effects; they run before effects, in invalidation order. */
const renderQueue = new Set();

/** Stale effects; they run after every render effect has settled. */
const effectQueue = new Set();

/** Computation runs allowed in one flush before it is treated as a cycle. */
const maxRuns = 10000;

/** Returns the first item of [set], or `undefined`. */
function first(set) {
  return set.values().next().value;
}

/** Records that the listening computation read [node] at its current version. */
function track(node) {
  if (!listener || listener.disposed || node.disposed) return;
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

/**
 * Releases what [node] holds from its last run: owned computations,
 * cleanups (in reverse order) and source subscriptions.
 */
function clean(node) {
  let failure;
  /** Releases one resource without skipping the remaining cleanups after an error. */
  const release = fn => {
    try {
      fn();
    } catch (error) {
      failure ??= {error};
    }
  };
  if (node.owned) {
    const children = node.owned;
    node.owned = null;
    for (let index = children.length - 1; index >= 0; index--) release(() => dispose(children[index]));
  }
  if (node.cleanups) {
    const cleanups = node.cleanups;
    node.cleanups = null;
    for (let index = cleanups.length - 1; index >= 0; index--) release(() => untrack(cleanups[index]));
  }
  if (node.sources) {
    for (const source of node.sources.keys()) source.observers.delete(node);
    node.sources.clear();
  }
  if (failure) throw failure.error;
}

/** Disposes [node] and everything it owns; a queued effect will not run. */
function dispose(node) {
  if (node.disposed) return;
  node.disposed = true;
  node.queue?.delete(node);
  depth++;
  try {
    clean(node);
  } catch (error) {
    handleError(node, error);
  } finally {
    // Cleanup writes cannot run siblings while their owner is being disposed.
    depth--;
    flush();
  }
}

/** Creates an owner node attached to the current owner, if any. */
function createOwner(fields) {
  const node = {owner, owned: null, cleanups: null, handler: null, disposed: Boolean(owner?.disposed), ...fields};
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
    if (current.handler) {
      try {
        return untrack(() => current.handler(error));
      } catch (next) {
        error = next;
      }
    }
  }
  throw error;
}

/** Runs [node]'s function as its owner and listener after releasing its previous run. */
function run(node) {
  const previousOwner = owner;
  const previousListener = listener;
  owner = node;
  listener = node;
  try {
    clean(node);
    node.value = node.fn(node.value);
  } catch (error) {
    handleError(node, error);
  } finally {
    owner = previousOwner;
    listener = previousListener;
  }
}

/**
 * Runs queued render effects, then queued effects, unless a batch, root or
 * flush is open.
 *
 * Computations invalidated while flushing join the same flush. Every queued
 * computation runs even if one throws; the first error is rethrown afterwards.
 *
 * @throws {*} The first unhandled error, or a cycle error after `maxRuns` runs.
 */
function flush() {
  if (depth) return;
  depth++;
  let runs = 0;
  let failure = null;
  try {
    for (let node = first(renderQueue) ?? first(effectQueue); node; node = first(renderQueue) ?? first(effectQueue)) {
      node.queue.delete(node);
      try {
        if (!node.disposed && (!node.ran || changed(node))) {
          if (++runs > maxRuns) {
            renderQueue.clear();
            effectQueue.clear();
            try {
              handleError(
                node,
                new Error(`Reactive updates did not settle; last computation: ${node.name || 'anonymous'}.`),
              );
            } catch (error) {
              failure ??= {error};
            }
            break;
          }
          node.ran = true;
          run(node);
        }
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
 * value equal to the current one. Use `{equals: false}` for a value mutated
 * in place, such as a Set, and pass the same object again to notify readers.
 * Writing while a memo computes throws.
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
 * readers re-run only when the result differs by [equals]. [fn] receives the
 * previous result and must not write signals. An unhandled failed read stays
 * failed until a source changes, then it can recover without losing its readers.
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
    if (node.stale || node.disposed) return;
    node.stale = true;
    invalidate(node);
  };
  node.refresh = () => {
    if (node.disposed) return;
    if (!node.stale) {
      if (node.failure) throw node.failure.error;
      return;
    }
    if (node.running) throw new Error(`Reactive memo cycle: ${node.name || 'anonymous'}.`);
    node.running = true;
    try {
      if (node.version && !changed(node)) {
        node.stale = false;
        if (node.failure) throw node.failure.error;
        return;
      }
      const previous = node.value;
      node.failure = null;
      computing++;
      try {
        run(node);
      } finally {
        computing--;
      }
      node.stale = false;
      if (node.version && equals && equals(previous, node.value)) return;
      node.version++;
    } catch (error) {
      // Rearm invalidation after a failed read; cache the error until a source changes.
      node.stale = false;
      node.failure = {error};
      throw error;
    } finally {
      node.running = false;
    }
  };
  return () => {
    node.refresh();
    track(node);
    return node.value;
  };
}

/** Creates an effect computation for [queue]: render effects run at once, effects are queued. */
function createComputation(fn, value, name, queue) {
  const node = createOwner({fn, value, sources: new Map(), ran: false, queue, name});
  node.invalidate = () => {
    if (!node.disposed) queue.add(node);
  };
  if (node.disposed) return;
  if (queue === renderQueue)
    batch(() => {
      node.ran = true;
      run(node);
    });
  else {
    queue.add(node);
    flush();
  }
}

/**
 * Creates a render effect: it runs immediately, even inside a batch or root,
 * and again after a value it read changes, before any `createEffect`.
 *
 * Use it to write values into the DOM. [fn] receives its previous result.
 *
 * @template T
 * @param {(previous: T) => T} fn Applies values to the DOM.
 * @param {T} [value] The value passed to the first run.
 * @param {{name?: string}} [options]
 */
export function createRenderEffect(fn, value, {name} = {}) {
  createComputation(fn, value, name, renderQueue);
}

/**
 * Creates an effect: like `createRenderEffect`, but it runs after every
 * render effect of the same update, so the DOM is already current.
 *
 * Use it for focus, scrolling and other work that reads the rendered DOM.
 *
 * @template T
 * @param {(previous: T) => T} fn The side effect.
 * @param {T} [value] The value passed to the first run.
 * @param {{name?: string}} [options]
 */
export function createEffect(fn, value, {name} = {}) {
  createComputation(fn, value, name, effectQueue);
}

/**
 * Runs [fn] in a new root that owns every computation created inside it.
 *
 * The root is not disposed with the current owner, but errors inside it
 * still reach `catchError` handlers above it. Effects created by [fn] run
 * after [fn] returns.
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
 * Outside any owner it does nothing, so factories also work without a root.
 *
 * @param {() => void} fn
 * @returns {() => void} [fn].
 */
export function onCleanup(fn) {
  if (owner && !owner.disposed) (owner.cleanups ??= []).push(fn);
  return fn;
}

/**
 * Makes the dependencies of an effect or memo explicit.
 *
 * Only [deps] are tracked; [fn] runs untracked with the current and previous
 * inputs, so it can call existing render functions that read many values.
 * With `defer: true` the first run is skipped.
 *
 * @template T, U
 * @param {(() => T)|Array<() => *>} deps The getters to track.
 * @param {(input: T, previousInput: T|undefined, previous: U) => U} fn
 * @param {{defer?: boolean}} [options]
 * @returns {(previous: U) => U} A function for `createEffect`, `createRenderEffect` or `createMemo`.
 */
export function on(deps, fn, {defer = false} = {}) {
  let previousInput;
  return previous => {
    const input = Array.isArray(deps) ? deps.map(dep => dep()) : deps();
    if (defer) {
      defer = false;
      previousInput = input;
      return previous;
    }
    const result = untrack(() => fn(input, previousInput, previous));
    previousInput = input;
    return result;
  };
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

/** Returns the current owner, to restore it after an `await` with `runWithOwner`. */
export function getOwner() {
  return owner;
}

/**
 * Runs [fn] untracked with [node] as the owner, so computations created after
 * an `await` are still disposed with it. Does nothing if [node] was disposed.
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
  } catch (error) {
    return handleError(node, error);
  } finally {
    owner = previousOwner;
    listener = previousListener;
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

/**
 * Binds [fn] to the current owner, so that computations it creates later,
 * for example after an `await`, are still disposed with that owner.
 *
 * @template {Array<*>} A, R
 * @param {(...args: A) => R} fn
 * @returns {(...args: A) => R|undefined}
 */
export function withOwner(fn) {
  const current = owner;
  return (...args) => runWithOwner(current, () => fn(...args));
}

/**
 * Returns a copy of [actions] whose functions run untracked.
 *
 * Feature functions such as `loadFiles` read many values; wrapping them keeps
 * an effect that calls one from subscribing to everything it reads. Values
 * that are not functions are copied unchanged.
 *
 * @template {Object} T
 * @param {T} actions The object returned by a feature factory.
 * @returns {T}
 */
export function untrackActions(actions) {
  const result = {};
  for (const [key, value] of Object.entries(actions))
    result[key] = typeof value === 'function' ? (...args) => untrack(() => value(...args)) : value;
  return result;
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
  return createSignal(value, {
    name,
    equals: (previous, next) => previous.size === next.size && [...previous].every(item => next.has(item)),
  });
}

/**
 * Returns a getter that stays `true` until the current owner re-runs or is
 * disposed, for asynchronous work started by that owner.
 *
 * It complements request generations: work owned by a page root stops
 * applying replies once the root is disposed by navigation.
 *
 * @returns {() => boolean}
 */
export function createAlive() {
  let alive = !owner?.disposed;
  onCleanup(() => {
    alive = false;
  });
  return () => alive;
}
