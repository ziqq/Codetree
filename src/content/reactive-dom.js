/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Browser helpers for `reactive.js`: owned event listeners, a shared
 * animation-frame queue and delayed values.
 *
 * Every helper releases what it holds (listeners, frames, timers) when its
 * owner re-runs or is disposed. The module has no side effects; browser
 * globals are read only when a helper is called.
 */

import {
  batch,
  createEffect,
  createSignal,
  getOwner,
  on,
  onCleanup,
  runWithOwner,
  untrack,
  withOwner,
} from './reactive.js';

/** Callbacks waiting for the next shared animation frame. */
const frameCallbacks = new Set();

/** Whether the shared animation frame is requested. */
let framePending = 0;

/** One cleanup per owner, rather than one retained cleanup per requested frame. */
const ownedFrames = new WeakMap();

/**
 * Adds an event listener that is removed when the current owner re-runs or
 * is disposed.
 *
 * @param {EventTarget} target
 * @param {string} type
 * @param {EventListener} listener
 * @param {boolean|AddEventListenerOptions} [options]
 */
export function listen(target, type, listener, options) {
  const callback = withOwner(listener);
  target.addEventListener(type, callback, options);
  onCleanup(() => target.removeEventListener(type, callback, options));
}

/**
 * Runs [callback] in the next shared animation frame.
 *
 * Callbacks of one frame run in one `batch`, so their writes update each
 * effect once. The callback is cancelled when the current owner re-runs or
 * is disposed.
 *
 * @param {() => void} callback
 * @returns {() => void} Cancels the callback.
 */
export function requestFrame(callback) {
  const owner = getOwner();
  if (owner?.disposed) return () => {};
  const entry = {callback, owner, active: true};
  let pending;
  if (owner) {
    pending = ownedFrames.get(owner);
    if (!pending) {
      pending = new Set();
      ownedFrames.set(owner, pending);
      onCleanup(() => {
        ownedFrames.delete(owner);
        for (const entry of pending) {
          entry.active = false;
          frameCallbacks.delete(entry);
        }
        pending.clear();
        if (!frameCallbacks.size && framePending) {
          cancelAnimationFrame(framePending);
          framePending = 0;
        }
      });
    }
    pending.add(entry);
  }
  const cancel = () => {
    entry.active = false;
    pending?.delete(entry);
    frameCallbacks.delete(entry);
    if (!frameCallbacks.size && framePending) {
      cancelAnimationFrame(framePending);
      framePending = 0;
    }
  };
  frameCallbacks.add(entry);
  if (!framePending) {
    framePending = requestAnimationFrame(() => {
      const callbacks = [...frameCallbacks];
      frameCallbacks.clear();
      framePending = 0;
      batch(() => {
        let failure;
        for (const queued of callbacks) {
          ownedFrames.get(queued.owner)?.delete(queued);
          if (!queued.active) continue;
          try {
            runWithOwner(queued.owner, queued.callback);
          } catch (error) {
            failure ??= {error};
          }
        }
        if (failure) throw failure.error;
      });
    });
  }
  return cancel;
}

/**
 * Follows [value] after [delay] milliseconds; a newer value restarts the
 * delay, so it also debounces.
 *
 * `set` applies a value at once and cancels the pending one, for resets such
 * as clearing the search on navigation.
 *
 * @template T
 * @param {() => T} value The source.
 * @param {number} delay Milliseconds.
 * @param {T} [initial=untrack(value)] The value until the first delay ends.
 * @returns {(() => T) & {set: (next: T) => void}}
 */
export function createDelayed(value, delay, initial = untrack(value)) {
  const [current, setCurrent] = createSignal(initial);
  let timer = 0;
  createEffect(
    on(value, next => {
      clearTimeout(timer);
      if (Object.is(next, untrack(current))) return;
      timer = setTimeout(
        withOwner(() => setCurrent(() => next)),
        delay,
      );
      onCleanup(() => clearTimeout(timer));
    }),
  );
  const result = () => current();
  result.set = next => {
    clearTimeout(timer);
    setCurrent(() => next);
  };
  return result;
}
