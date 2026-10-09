/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/** Regression contracts for dependency tracking, scheduling, ownership and errors. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  batch,
  catchError,
  createAlive,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSetSignal,
  createSignal,
  getOwner,
  on,
  onCleanup,
  runWithOwner,
  untrack,
  untrackActions,
  withOwner,
} from '../src/content/reactive.js';

/** Gives every test a root that is disposed even after an assertion fails. */
function root(t, fn) {
  return createRoot(dispose => {
    t.after(dispose);
    return fn(dispose);
  });
}

/** Runs an update scenario after root setup has completed, with the same resource owner. */
function scope(t, fn) {
  const {owner, dispose} = root(t, dispose => ({owner: getOwner(), dispose}));
  return runWithOwner(owner, () => fn(dispose));
}

test('signals support updaters, Object.is, custom equality and equals:false', t => {
  scope(t, () => {
    const [value, set] = createSignal(NaN);
    let runs = 0;
    createRenderEffect(() => {
      value();
      runs++;
    });
    set(NaN);
    assert.equal(runs, 1);
    set(0);
    set(previous => previous + 2);
    assert.equal(value(), 2);
    assert.equal(runs, 3);
    const [record, write] = createSignal({id: 1}, {equals: (a, b) => a.id === b.id});
    const original = record();
    write({id: 1});
    assert.equal(record(), original);
    const [forced, force] = createSignal(original, {equals: false});
    let forcedRuns = 0;
    createRenderEffect(() => {
      forced();
      forcedRuns++;
    });
    force(original);
    assert.equal(forcedRuns, 2);
  });
});

test('a batched diamond exposes one consistent final value to its reader', t => {
  scope(t, () => {
    const [source, set] = createSignal(1);
    const left = createMemo(() => source() * 2);
    const right = createMemo(() => source() + 10);
    const joined = createMemo(() => left() + right());
    const seen = [];
    createRenderEffect(() => seen.push([source(), left(), right(), joined()]));
    batch(() => {
      set(2);
      batch(() => set(3));
      assert.equal(seen.length, 1);
    });
    assert.deepEqual(seen, [
      [1, 2, 11, 13],
      [3, 6, 13, 19],
    ]);
  });
});

test('unused memos stay lazy and an equal memo result cuts off its readers', t => {
  scope(t, () => {
    const [source, set] = createSignal(1);
    let unusedRuns = 0;
    createMemo(() => {
      unusedRuns++;
      return source();
    });
    let memoRuns = 0;
    const parity = createMemo(() => {
      memoRuns++;
      return source() % 2;
    });
    const seen = [];
    createRenderEffect(() => seen.push(parity()));
    set(3);
    assert.equal(unusedRuns, 0);
    assert.equal(memoRuns, 2);
    assert.deepEqual(seen, [1]);
    set(4);
    assert.deepEqual(seen, [1, 0]);
  });
});

test('conditional dependencies detach when the computation changes branches', t => {
  scope(t, () => {
    const [active, select] = createSignal(true);
    const [left, setLeft] = createSignal(1);
    const [right, setRight] = createSignal(2);
    const seen = [];
    createRenderEffect(() => seen.push(active() ? left() : right()));
    select(false);
    setLeft(3);
    setRight(4);
    assert.deepEqual(seen, [1, 2, 4]);
  });
});

test('effects wait for root setup and all render effects settle first', t => {
  const events = [];
  let set;
  root(t, () => {
    const [value, write] = createSignal(0);
    set = write;
    createEffect(() => events.push(`effect:${value()}`));
    createRenderEffect(() => events.push(`render:${value()}`));
    events.push('setup');
    write(1);
    assert.deepEqual(events, ['render:0', 'setup']);
  });
  assert.deepEqual(events, ['render:0', 'setup', 'render:1', 'effect:1']);
  set(2);
  assert.deepEqual(events.slice(-2), ['render:2', 'effect:2']);
});

test('on tracks only explicit dependencies and passes previous inputs and results', t => {
  scope(t, () => {
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(2);
    const [incidental, setIncidental] = createSignal(0);
    const seen = [];
    createRenderEffect(
      on(
        [a, b],
        (input, previousInput, previous) => {
          incidental();
          seen.push({input, previousInput, previous});
          return (previous || 0) + 1;
        },
        {defer: true},
      ),
      0,
    );
    setIncidental(1);
    assert.equal(seen.length, 0);
    setA(3);
    setB(4);
    assert.deepEqual(seen, [
      {input: [3, 2], previousInput: [1, 2], previous: 0},
      {input: [3, 4], previousInput: [3, 2], previous: 1},
    ]);
  });
});

test('untrack and action wrappers do not subscribe their callers', t => {
  root(t, () => {
    const [value, set] = createSignal(0);
    const actions = untrackActions({read: () => value(), label: 'stable'});
    let runs = 0;
    createRenderEffect(() => {
      untrack(value);
      actions.read();
      runs++;
    });
    set(1);
    assert.equal(runs, 1);
    assert.equal(actions.read(), 1);
    assert.equal(actions.label, 'stable');
  });
});

test('owned children and reverse cleanups are released before rerun and only once on disposal', t => {
  const events = [];
  const dispose = scope(t, dispose => {
    const [value, set] = createSignal(0);
    createRenderEffect(() => {
      const current = value();
      onCleanup(() => events.push(`first:${current}`));
      onCleanup(() => events.push(`second:${current}`));
      createRenderEffect(() => onCleanup(() => events.push(`child:${current}`)));
    });
    set(1);
    assert.deepEqual(events, ['child:0', 'second:0', 'first:0']);
    return dispose;
  });
  dispose();
  dispose();
  assert.deepEqual(events, ['child:0', 'second:0', 'first:0', 'child:1', 'second:1', 'first:1']);
  let unowned = 0;
  onCleanup(() => unowned++);
  assert.equal(unowned, 0);
});

test('independent roots outlive the parent but retain its error ancestry', t => {
  let childDispose;
  let set;
  let childAlive;
  const errors = [];
  const parentDispose = root(t, dispose => {
    catchError(
      () => {
        createRoot(dispose => {
          childDispose = dispose;
          childAlive = createAlive();
          const [value, write] = createSignal(0);
          set = write;
          createRenderEffect(() => {
            if (value()) throw new Error('child failure');
          });
        });
      },
      error => errors.push(error.message),
    );
    return dispose;
  });
  t.after(() => childDispose());
  parentDispose();
  assert.equal(childAlive(), true);
  set(1);
  assert.deepEqual(errors, ['child failure']);
  childDispose();
  assert.equal(childAlive(), false);
});

test('callbacks restore ownership, stay untracked and become inert after disposal', t => {
  let captured;
  let bound;
  let cleanups = 0;
  const dispose = root(t, dispose => {
    captured = getOwner();
    bound = withOwner(() => {
      assert.equal(getOwner(), captured);
      onCleanup(() => cleanups++);
      return 42;
    });
    return dispose;
  });
  assert.equal(getOwner(), null);
  assert.equal(bound(), 42);
  assert.equal(
    runWithOwner(captured, () => 7),
    7,
  );
  dispose();
  assert.equal(cleanups, 1);
  assert.equal(bound(), undefined);
  assert.equal(
    runWithOwner(captured, () => assert.fail('disposed owner ran')),
    undefined,
  );
});

test('queued siblings drain after errors and the first unhandled error reaches the writer', t => {
  const {set, seen} = root(t, () => {
    const [value, set] = createSignal(0);
    createRenderEffect(() => {
      if (value()) throw new Error('first failure');
    });
    createRenderEffect(() => {
      if (value()) throw new Error('second failure');
    });
    const seen = [];
    createEffect(() => seen.push(value()));
    return {set, seen};
  });
  assert.throws(() => set(1), /first failure/);
  assert.deepEqual(seen, [0, 1]);
  set(0);
  assert.deepEqual(seen, [0, 1, 0]);
});

test('a failed memo drains sibling work and its readers recover on the next source change', t => {
  const {set, memo, seen, sibling} = root(t, () => {
    const [value, set] = createSignal(0);
    const memo = createMemo(() => {
      const next = value();
      if (next === 1) throw new Error('temporary memo failure');
      return next * 2;
    });
    const seen = [];
    const sibling = [];
    createRenderEffect(() => seen.push(memo()));
    createEffect(() => sibling.push(value()));
    return {set, memo, seen, sibling};
  });
  assert.throws(() => set(1), /temporary memo failure/);
  assert.throws(memo, /temporary memo failure/, 'a failed value is not exposed as a successful cached read');
  assert.deepEqual(sibling, [0, 1]);
  set(2);
  assert.equal(memo(), 4);
  assert.deepEqual(seen, [0, 4]);
  assert.deepEqual(sibling, [0, 1, 2]);
});

test('error handlers fall back to outer handlers and failed cleanups do not skip resources', t => {
  const errors = [];
  const cleaned = [];
  const dispose = root(t, dispose => {
    catchError(
      () => {
        catchError(
          () => {
            createRenderEffect(() => {
              throw new Error('original');
            });
          },
          () => {
            throw new Error('handler failure');
          },
        );
        onCleanup(() => cleaned.push('last'));
        onCleanup(() => {
          throw new Error('cleanup failure');
        });
        onCleanup(() => cleaned.push('first'));
      },
      error => errors.push(error.message),
    );
    return dispose;
  });
  dispose();
  assert.deepEqual(errors, ['handler failure', 'cleanup failure']);
  assert.deepEqual(cleaned, ['first', 'last']);
});

test('memo writes and memo cycles fail loudly without poisoning later computations', t => {
  root(t, () => {
    const [value, set] = createSignal(0, {name: 'target'});
    const writing = createMemo(() => set(1));
    assert.throws(writing, /memo wrote the signal target/);
    let cycle;
    cycle = createMemo(() => cycle(), undefined, {name: 'loop'});
    assert.throws(cycle, /memo cycle: loop/);
    set(2);
    assert.equal(value(), 2);
  });
});

test('a self-writing render effect reaches the named guard and a later flush works', t => {
  assert.throws(
    () =>
      root(t, () => {
        const [value, set] = createSignal(0);
        createRenderEffect(() => set(value() + 1), undefined, {name: 'runaway'});
      }),
    /did not settle; last computation: runaway/,
  );
  const {set, seen} = root(t, () => {
    const [value, set] = createSignal(0);
    const seen = [];
    createRenderEffect(() => seen.push(value()));
    return {set, seen};
  });
  set(1);
  assert.deepEqual(seen, [0, 1]);
});

test('Set signals compare contents and accept immutable updater replacements', t => {
  scope(t, () => {
    const [expanded, set] = createSetSignal(new Set(['src']));
    const seen = [];
    createRenderEffect(() => seen.push([...expanded()]));
    set(new Set(['src']));
    set(previous => new Set([...previous, 'tests']));
    assert.deepEqual(seen, [['src'], ['src', 'tests']]);
  });
});
