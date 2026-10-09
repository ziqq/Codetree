/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Browser helpers for `shared/reactive.js`: owned event listeners, a shared
 * animation-frame queue and delayed values.
 *
 * Every helper releases what it holds (listeners, frames, timers) when its
 * owner re-runs or is disposed; without an owner nothing is released. The
 * module has no side effects; browser globals are read only when a helper
 * is called.
 */
import {batch, createRenderEffect, createSignal, onCleanup, untrack} from '../shared/reactive.js';

/** Callbacks waiting for the next shared animation frame. */
let frameCallbacks = [];

/** Whether the shared animation frame is requested. */
let framePending = false;

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
  target.addEventListener(type, listener, options);
  onCleanup(() => target.removeEventListener(type, listener, options));
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
  const cancel = () => {
    const index = frameCallbacks.indexOf(callback);
    if (index !== -1) frameCallbacks.splice(index, 1);
  };
  frameCallbacks.push(callback);
  onCleanup(cancel);
  if (!framePending) {
    framePending = true;
    requestAnimationFrame(() => {
      const callbacks = frameCallbacks;
      frameCallbacks = [];
      framePending = false;
      batch(() => {
        for (const queued of callbacks) queued();
      });
    });
  }
  return cancel;
}

/**
 * Follows [value] after [delay] milliseconds; a newer value restarts the
 * delay, so it also debounces.
 *
 * `set` applies a value at once and cancels the pending one, for resets
 * such as clearing the search on navigation.
 *
 * @template T
 * @param {() => T} value The source.
 * @param {number} delay Milliseconds.
 * @returns {(() => T) & {set: (next: T) => void}}
 */
export function createDelayed(value, delay) {
  const [current, setCurrent] = createSignal(untrack(value));
  let timer = 0;
  let first = true;
  createRenderEffect(() => {
    const next = value();
    if (first) {
      first = false;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => setCurrent(() => next), delay);
  });
  onCleanup(() => clearTimeout(timer));
  const result = () => current();
  result.set = next => {
    clearTimeout(timer);
    setCurrent(() => next);
  };
  return result;
}
