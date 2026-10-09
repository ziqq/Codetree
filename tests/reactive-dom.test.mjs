/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Browser helper lifetime and scheduling contracts with controlled clocks.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {createEffect, createRoot, createSignal, getOwner, runWithOwner} from '../src/content/reactive.js';
import {createDelayed, listen, requestFrame} from '../src/content/reactive-dom.js';
import {dom, frames, install} from './helpers/dom.mjs';

test('owned listeners are removed on disposal and restored ownership reaches async-created resources', async t => {
  const {window} = dom();
  let owner;
  let calls = 0;
  let dispose;
  createRoot(stop => {
    dispose = stop;
    owner = getOwner();
    listen(window, 'event', () => {
      assert.equal(getOwner(), owner);
      calls++;
    });
  });
  t.after(dispose);
  await window.fire('event');
  dispose();
  await window.fire('event');
  assert.equal(calls, 1);
  assert.equal(window.listeners.get('event').length, 0);
});

test('one shared frame batches writes and cancels callbacks with their owner', t => {
  const clock = frames();
  install(t, {requestAnimationFrame: clock.requestAnimationFrame, cancelAnimationFrame: clock.cancelAnimationFrame});
  const seen = [];
  let owner;
  const dispose = createRoot(dispose => {
    owner = getOwner();
    const [value, set] = createSignal(0);
    createEffect(() => seen.push(value()));
    requestFrame(() => {
      assert.equal(getOwner(), owner);
      set(1);
    });
    requestFrame(() => set(2));
    return dispose;
  });
  t.after(dispose);
  assert.equal(clock.pending.size, 1);
  clock.flush();
  assert.deepEqual(seen, [0, 2]);
  runWithOwner(owner, () => requestFrame(() => assert.fail('disposed frame ran')));
  dispose();
  assert.equal(clock.pending.size, 0);
});

test('disposing an owner during a frame also cancels its already-snapshotted callback', t => {
  const clock = frames();
  install(t, {requestAnimationFrame: clock.requestAnimationFrame, cancelAnimationFrame: clock.cancelAnimationFrame});
  let dispose;
  createRoot(stop => {
    dispose = stop;
    requestFrame(() => dispose());
    requestFrame(() => assert.fail('callback survived disposal in the same frame'));
  });
  t.after(dispose);
  clock.flush();
});

test('a cancelled or failing callback does not skip unrelated callbacks', t => {
  const clock = frames();
  install(t, {requestAnimationFrame: clock.requestAnimationFrame, cancelAnimationFrame: clock.cancelAnimationFrame});
  const seen = [];
  requestFrame(() => assert.fail('cancelled callback ran'))();
  requestFrame(() => {
    throw new Error('frame failure');
  });
  requestFrame(() => seen.push('ran'));
  assert.throws(() => clock.flush(), /frame failure/);
  assert.deepEqual(seen, ['ran']);
});

test('delayed values debounce, reset immediately and cannot publish after disposal', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let set;
  let delayed;
  const dispose = createRoot(dispose => {
    const [value, write] = createSignal('');
    set = write;
    delayed = createDelayed(value, 100, '');
    // The first effect must observe changes made during root setup too.
    write('setup');
    return dispose;
  });
  t.after(dispose);
  t.mock.timers.tick(100);
  assert.equal(delayed(), 'setup');
  set('first');
  t.mock.timers.tick(99);
  set('second');
  t.mock.timers.tick(99);
  assert.equal(delayed(), 'setup');
  t.mock.timers.tick(1);
  assert.equal(delayed(), 'second');
  set('stale');
  delayed.set('');
  t.mock.timers.tick(100);
  assert.equal(delayed(), '');
  set('disposed');
  dispose();
  t.mock.timers.tick(100);
  assert.equal(delayed(), '');
});
