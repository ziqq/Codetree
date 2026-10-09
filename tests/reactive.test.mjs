/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Reactive primitives (`shared/reactive.js`, `content/reactive-dom.js`):
 * synchronous effects, batching, lazy memos with equality cutoff, owner
 * cleanups, error routing, misuse guards, owned listeners, the shared
 * animation frame and delayed values.
 */
import assert from 'node:assert/strict';
import test, {mock} from 'node:test';
import {
  batch,
  catchError,
  createAlive,
  createMemo,
  createRenderEffect,
  createRoot,
  createSetSignal,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
} from '../src/shared/reactive.js';
import {createDelayed, listen, requestFrame} from '../src/content/reactive-dom.js';

test('an effect runs immediately and again before the write returns', () => {
  const [count, setCount] = createSignal(1);
  const seen = [];
  createRoot(() => createRenderEffect(() => seen.push(count())));
  setCount(2);
  assert.deepEqual(seen, [1, 2]);
  setCount(2);
  assert.deepEqual(seen, [1, 2], 'an equal value notifies nobody');
});

test('a batch runs each affected effect once with the final values', () => {
  const [first, setFirst] = createSignal('a');
  const [second, setSecond] = createSignal('b');
  const seen = [];
  createRoot(() => createRenderEffect(() => seen.push(first() + second())));
  batch(() => {
    setFirst('c');
    setSecond('d');
    assert.deepEqual(seen, ['ab'], 'effects wait for the batch');
  });
  assert.deepEqual(seen, ['ab', 'cd']);
});

test('the value of a batch is returned, including a promise started inside it', async () => {
  const [value, setValue] = createSignal(0);
  const seen = [];
  createRoot(() => createRenderEffect(() => seen.push(value())));
  const result = await batch(() => {
    setValue(1);
    setValue(2);
    return Promise.resolve('done');
  });
  assert.equal(result, 'done');
  assert.deepEqual(seen, [0, 2]);
});

test('a memo is lazy, computes once per change and cuts off equal results', () => {
  const [items, setItems] = createSignal([1, 2, 3]);
  let computed = 0;
  const odd = createMemo(() => {
    computed++;
    return items().filter(item => item % 2).length;
  });
  assert.equal(computed, 0, 'nobody read the memo yet');
  const seen = [];
  createRoot(() => createRenderEffect(() => seen.push(odd())));
  assert.equal(computed, 1);
  setItems([1, 3, 4]);
  assert.equal(computed, 2);
  assert.deepEqual(seen, [2], 'an equal result does not re-run readers');
  setItems([1]);
  assert.deepEqual(seen, [2, 1]);
});

test('a diamond runs its effect once with consistent values', () => {
  const [value, setValue] = createSignal(1);
  const double = createMemo(() => value() * 2);
  const triple = createMemo(() => value() * 3);
  const seen = [];
  createRoot(() => createRenderEffect(() => seen.push([double(), triple()])));
  setValue(2);
  assert.deepEqual(seen, [
    [2, 3],
    [4, 6],
  ]);
});

test('dependencies follow the branch an effect took on its last run', () => {
  const [tab, setTab] = createSignal('files');
  const [files, setFiles] = createSignal(1);
  const [pulls, setPulls] = createSignal(1);
  let runs = 0;
  createRoot(() =>
    createRenderEffect(() => {
      runs++;
      return tab() === 'files' ? files() : pulls();
    }),
  );
  setPulls(2);
  assert.equal(runs, 1, 'the hidden branch is not tracked');
  setTab('pulls');
  setFiles(2);
  assert.equal(runs, 2, 'the previous branch is no longer tracked');
  setPulls(3);
  assert.equal(runs, 3);
});

test('untrack reads without subscribing', () => {
  const [tracked, setTracked] = createSignal(0);
  const [hidden, setHidden] = createSignal(0);
  let runs = 0;
  createRoot(() =>
    createRenderEffect(() => {
      runs++;
      tracked();
      untrack(hidden);
    }),
  );
  setHidden(1);
  assert.equal(runs, 1);
  setTracked(1);
  assert.equal(runs, 2);
});

test('cleanups run in reverse order before a re-run and on dispose', () => {
  const [value, setValue] = createSignal(0);
  const log = [];
  const dispose = createRoot(dispose => {
    createRenderEffect(() => {
      const current = value();
      onCleanup(() => log.push(`first ${current}`));
      onCleanup(() => log.push(`second ${current}`));
    });
    return dispose;
  });
  setValue(1);
  assert.deepEqual(log, ['second 0', 'first 0']);
  dispose();
  assert.deepEqual(log, ['second 0', 'first 0', 'second 1', 'first 1']);
  setValue(2);
  assert.equal(log.length, 4, 'a disposed effect never runs again');
});

test('an effect disposes the effects it created before it re-runs', () => {
  const [outer, setOuter] = createSignal(0);
  const [inner, setInner] = createSignal(0);
  let innerRuns = 0;
  createRoot(() =>
    createRenderEffect(() => {
      outer();
      createRenderEffect(() => {
        inner();
        innerRuns++;
      });
    }),
  );
  setOuter(1);
  assert.equal(innerRuns, 2);
  setInner(1);
  assert.equal(innerRuns, 3, 'only the inner effect of the latest outer run remains');
});

test('catchError receives errors of effects created inside it, including later runs', () => {
  const [value, setValue] = createSignal(0);
  const errors = [];
  createRoot(() =>
    catchError(
      () =>
        createRenderEffect(() => {
          if (value() === 1) throw new Error('render failed');
        }),
      error => errors.push(error.message),
    ),
  );
  setValue(1);
  assert.deepEqual(errors, ['render failed']);
});

test('an unhandled effect error is rethrown to the writer after every effect ran', () => {
  const [value, setValue] = createSignal(0);
  let other = 0;
  createRoot(() => {
    createRenderEffect(() => {
      if (value() === 1) throw new Error('first failed');
    });
    createRenderEffect(() => {
      value();
      other++;
    });
  });
  assert.throws(() => setValue(1), /first failed/);
  assert.equal(other, 2);
});

test('a memo that writes a signal throws', () => {
  const [, setValue] = createSignal(0);
  const bad = createMemo(() => setValue(1));
  assert.throws(bad, /memos must not write/);
});

test('effects that never settle throw with the name of the last effect', () => {
  const [value, setValue] = createSignal(0);
  assert.throws(
    () => createRoot(() => createRenderEffect(() => setValue(value() + 1), undefined, {name: 'loop'})),
    /did not settle; last effect: loop/,
  );
});

test('runWithOwner attaches work after an await and ignores a disposed owner', async () => {
  const log = [];
  let owner;
  const dispose = createRoot(dispose => {
    owner = getOwner();
    return dispose;
  });
  await Promise.resolve();
  runWithOwner(owner, () => onCleanup(() => log.push('cleaned')));
  dispose();
  assert.deepEqual(log, ['cleaned']);
  assert.equal(
    runWithOwner(owner, () => 'ran'),
    undefined,
  );
});

test('createAlive turns false when its owner is disposed', () => {
  const {alive, dispose} = createRoot(dispose => ({alive: createAlive(), dispose}));
  assert.equal(alive(), true);
  dispose();
  assert.equal(alive(), false);
});

test('a Set signal notifies only when the contents change', () => {
  const [items, setItems] = createSetSignal(new Set(['a']));
  let runs = 0;
  createRoot(() =>
    createRenderEffect(() => {
      items();
      runs++;
    }),
  );
  setItems(new Set(['a']));
  assert.equal(runs, 1);
  setItems(new Set(['a', 'b']));
  assert.equal(runs, 2);
});

test('listen removes its listener with the owner', () => {
  const target = new EventTarget();
  let calls = 0;
  const dispose = createRoot(dispose => {
    listen(target, 'ping', () => calls++);
    return dispose;
  });
  target.dispatchEvent(new Event('ping'));
  dispose();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);
});

test('requestFrame runs one batch per frame and drops callbacks of a disposed owner', () => {
  const frames = [];
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  const [value, setValue] = createSignal(0);
  const seen = [];
  createRoot(() => createRenderEffect(() => seen.push(value())));
  requestFrame(() => setValue(1));
  requestFrame(() => setValue(2));
  const dispose = createRoot(dispose => {
    requestFrame(() => setValue(99));
    return dispose;
  });
  dispose();
  assert.equal(frames.length, 1, 'callbacks share one animation frame');
  frames[0]();
  assert.deepEqual(seen, [0, 2]);
  delete globalThis.requestAnimationFrame;
});

test('a delayed value follows its source after the delay and set applies at once', () => {
  mock.timers.enable({apis: ['setTimeout']});
  try {
    const [source, setSource] = createSignal('');
    const delayed = createRoot(() => createDelayed(source, 100));
    setSource('a');
    setSource('ab');
    mock.timers.tick(99);
    assert.equal(delayed(), '', 'typing restarts the delay');
    mock.timers.tick(1);
    assert.equal(delayed(), 'ab');
    setSource('abc');
    delayed.set('');
    mock.timers.tick(100);
    assert.equal(delayed(), '', 'set cancels the pending value');
  } finally {
    mock.timers.reset();
  }
});
