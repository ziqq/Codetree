/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Change-block navigation regressions through the production View full modal.
 * Synthetic viewport geometry verifies source mapping and clamping, without
 * claiming installed-browser layout or authenticated provider behavior.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bundle} from './helpers/content.mjs';
import {dom, frames, install} from './helpers/dom.mjs';
import {installDiffViewport} from './helpers/diff-viewport.mjs';

const directory = await mkdtemp(join(tmpdir(), 'codetree-viewer-changes-'));
const modulePath = join(directory, 'content.mjs');
await writeFile(modulePath, await bundle());
const content = await import(pathToFileURL(modulePath));
await rm(directory, {recursive: true, force: true});
const {createRoot, createState, getOwner, untrackActions, withOwner} = content;
const baseSHA = 'a'.repeat(40);
const headSHA = 'b'.repeat(40);
const rowHeight = 22;

/** One validated patch hunk containing four separate change blocks and unequal replacements. */
function sample() {
  const prefix = Array.from({length: 45}, (_, index) => `prefix ${index}: ${'x'.repeat(80)}`);
  const firstGap = Array.from({length: 80}, (_, index) => `first gap ${index}`);
  const secondGap = Array.from({length: 70}, (_, index) => `second gap ${index}`);
  const thirdGap = Array.from({length: 50}, (_, index) => `third gap ${index}`);
  const before = [
    ...prefix,
    'old first A',
    'old first B',
    ...firstGap,
    ...secondGap,
    'removed only A',
    'removed only B',
    'removed only C',
    ...thirdGap,
    'old final A',
    'old final B',
    'old final C',
    'last context',
  ];
  const after = [
    ...prefix,
    'new first A',
    'new first B',
    'new first C',
    ...firstGap,
    'added only A',
    'added only B',
    ...secondGap,
    ...thirdGap,
    'new final A',
    'last context',
  ];
  const patch = [
    `@@ -1,${before.length} +1,${after.length} @@`,
    ...prefix.map(line => ` ${line}`),
    '-old first A',
    '-old first B',
    '+new first A',
    '+new first B',
    '+new first C',
    ...firstGap.map(line => ` ${line}`),
    '+added only A',
    '+added only B',
    ...secondGap.map(line => ` ${line}`),
    '-removed only A',
    '-removed only B',
    '-removed only C',
    ...thirdGap.map(line => ` ${line}`),
    '-old final A',
    '-old final B',
    '-old final C',
    '+new final A',
    ' last context',
  ].join('\n');
  return {
    before: before.join('\n') + '\n',
    after: after.join('\n') + '\n',
    node: {path: 'source.txt', type: 'blob', status: 'modified', adds: 6, dels: 8, patch},
  };
}

/** Creates the actual modal with exact revision replies and deterministic scroll bounds. */
function fixture(t, data = sample()) {
  const {document, window} = dom();
  installDiffViewport(document);
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const node = createElement(tag);
    Object.defineProperty(node, 'firstChild', {get: () => node.children[0] || null});
    return node;
  };
  const clock = frames();
  install(t, {
    document,
    window,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
  });
  const viewer = document.createElement('dialog');
  viewer.showModal = () => {
    viewer.open = true;
  };
  viewer.close = () => {
    viewer.open = false;
    void viewer.fire('close');
  };
  document.body.append(viewer);
  const requests = [];
  const app = createRoot(dispose => {
    const state = createState();
    state.context = {
      origin: 'https://github.com',
      provider: 'github',
      owner: 'sample',
      repo: 'repo',
      kind: 'pull',
      number: 1,
    };
    const source = sha => ({provider: 'github', origin: 'https://github.com', owner: 'sample', repo: 'repo', sha});
    state.diff = {
      base: source(baseSHA),
      head: source(headSHA),
      files: [{...data.node, filename: data.node.path, additions: data.node.adds, deletions: data.node.dels}],
    };
    const app = {
      owner: getOwner(),
      state,
      dispose,
      view: {viewer},
      run: callback => withOwner(callback),
      diffURL: async () => 'https://github.com/sample/repo/pull/1/files',
      async rpc(type, message) {
        assert.equal(type, 'FILE');
        assert.equal(message.path, data.node.path);
        requests.push(message);
        return message.source.sha === baseSHA ? data.before : data.after;
      },
    };
    Object.assign(app, untrackActions(content.createViewer(app)));
    return app;
  });
  t.after(app.dispose);
  return {app, data, viewer, requests, clock};
}

/** Opens the public View full action and requires its accessible block-navigation UI. */
async function open(ui) {
  await ui.app.showDiff(ui.data.node);
  assert.equal(ui.viewer.open, true);
  const body = ui.viewer.querySelector('.viewer-body');
  assert.ok(body.querySelector('.code-spacer'), body.textContent);
  assert.ok(ui.viewer.querySelector('[aria-label="Change blocks"]'), 'View full exposes change-block navigation');
  return body;
}

/** Checks the displayed count and its accessible status text. */
function count(ui, active, total = 4) {
  const status = ui.viewer.querySelector('.diff-changes-count');
  assert.ok(status, 'change counter is present');
  assert.equal(status.textContent, `${active} / ${total}`);
  assert.equal(status.getAttribute('aria-label'), `Change block ${active} of ${total}`);
  assert.equal(status.getAttribute('role'), 'status');
}

/** Activates one public navigation button and flushes any queued viewport rendering. */
async function navigate(ui, direction) {
  const control = ui.viewer.querySelector(`[aria-label="${direction} change block"]`);
  assert.ok(control, `${direction} change block is present`);
  assert.equal(control.disabled, false);
  await control.fire('click');
  ui.clock.flush();
  return control;
}

/** Switches through the same visible layout controls as the user. */
async function layout(ui, label) {
  const control = ui.viewer.querySelectorAll('button').find(node => node.textContent === label);
  assert.ok(control, `View full exposes ${label}`);
  await control.fire('click');
  assert.equal(control.getAttribute('aria-pressed'), 'true');
}

/** Finds the two independently scrollable revision panes. */
function panes(ui) {
  const old = ui.viewer.querySelector('[aria-label="Old revision"]');
  const next = ui.viewer.querySelector('[aria-label="New revision"]');
  assert.ok(old && next, 'both revision panes are present');
  return {old, next};
}

/** Delivers one manual scroll, allowing the production renderer to synchronize and count it. */
async function scroll(ui, viewport, top, left = 0) {
  viewport.scrollTop = top;
  viewport.scrollLeft = left;
  await viewport.fire('scroll');
  ui.clock.flush();
}

test('View full Unified change-block navigation counts contiguous changes rather than patch hunks and reveals virtual rows', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  count(ui, 0);
  assert.equal(body.textContent.includes('added only A'), false, 'distant change is initially virtualized away');
  await navigate(ui, 'Next');
  assert.equal(body.scrollTop, 45 * rowHeight);
  count(ui, 1);
  await navigate(ui, 'Next');
  assert.equal(body.scrollTop, 130 * rowHeight);
  count(ui, 2);
  assert.ok(body.textContent.includes('added only A'), 'navigation renders an off-screen addition-only block');
  assert.ok(body.querySelectorAll('.code-row').length < 40, 'navigation retains bounded virtual rendering');
  await navigate(ui, 'Previous');
  assert.equal(body.scrollTop, 45 * rowHeight);
  count(ui, 1);
  await navigate(ui, 'Previous');
  count(ui, 4);
  assert.equal(body.scrollTop, body.scrollHeight - body.clientHeight, 'last block clamps at the scroll boundary');
  assert.ok(body.textContent.includes('old final A'));
  await navigate(ui, 'Next');
  assert.equal(body.scrollTop, 45 * rowHeight);
  count(ui, 1);
  assert.deepEqual(
    ui.requests.map(request => request.source.sha),
    [baseSHA, headSHA],
  );
});

test('View full Side-by-side change-block navigation reveals additions and removals and synchronizes both panes', async t => {
  const ui = fixture(t);
  await open(ui);
  await layout(ui, 'Side-by-side');
  const {old, next} = panes(ui);
  await scroll(ui, next, 0, 91);
  count(ui, 0);
  await navigate(ui, 'Previous');
  count(ui, 4);
  assert.equal(old.scrollTop, old.scrollHeight - old.clientHeight);
  assert.deepEqual([next.scrollTop, old.scrollLeft, next.scrollLeft], [old.scrollTop, 91, 91]);
  await navigate(ui, 'Previous');
  count(ui, 3);
  assert.deepEqual([old.scrollTop, next.scrollTop], [200 * rowHeight, 200 * rowHeight]);
  assert.ok(old.textContent.includes('removed only A'));
  assert.equal(next.textContent.includes('removed only A'), false);
  await navigate(ui, 'Previous');
  count(ui, 2);
  assert.deepEqual([old.scrollTop, next.scrollTop], [128 * rowHeight, 128 * rowHeight]);
  assert.ok(next.textContent.includes('added only A'));
  assert.equal(old.textContent.includes('added only A'), false);
  await navigate(ui, 'Next');
  count(ui, 3);
  assert.equal(old.scrollTop, next.scrollTop);
  assert.equal(ui.requests.length, 2);
});

test('View full change-block counter follows manual scrolling in Unified and either split revision pane', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  await scroll(ui, body, 60 * rowHeight);
  count(ui, 1);
  await scroll(ui, body, 125 * rowHeight);
  count(ui, 2);
  await layout(ui, 'Side-by-side');
  count(ui, 2);
  const {old, next} = panes(ui);
  await scroll(ui, next, 180 * rowHeight, 57);
  count(ui, 2);
  assert.deepEqual([old.scrollTop, old.scrollLeft], [next.scrollTop, 57]);
  await scroll(ui, old, 197 * rowHeight, 33);
  count(ui, 3);
  assert.deepEqual([next.scrollTop, next.scrollLeft], [old.scrollTop, 33]);
  await scroll(ui, next, 0);
  count(ui, 0);
  await layout(ui, 'Unified');
  count(ui, 0);
});

test('View full change-block navigation retains selection through unequal-row layout roundtrips', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  await navigate(ui, 'Next');
  await navigate(ui, 'Next');
  assert.equal(body.scrollTop, 130 * rowHeight);
  await layout(ui, 'Side-by-side');
  count(ui, 2);
  const {old, next} = panes(ui);
  assert.deepEqual([old.scrollTop, next.scrollTop], [128 * rowHeight, 128 * rowHeight]);
  await navigate(ui, 'Next');
  count(ui, 3);
  await layout(ui, 'Unified');
  assert.equal(body.scrollTop, 202 * rowHeight);
  count(ui, 3);
  await navigate(ui, 'Next');
  count(ui, 4);
  await layout(ui, 'Side-by-side');
  count(ui, 4);
  await layout(ui, 'Unified');
  count(ui, 4);
  assert.equal(ui.requests.length, 2);
});

test('View full change-block counter is zero with disabled navigation for unchanged files in both layouts', async t => {
  const text = 'unchanged line\n';
  const ui = fixture(t, {
    before: text,
    after: text,
    node: {path: 'same.txt', type: 'blob', status: 'renamed', adds: 0, dels: 0, patch: ''},
  });
  await open(ui);
  for (const label of ['Unified', 'Side-by-side']) {
    await layout(ui, label);
    count(ui, 0, 0);
    assert.equal(ui.viewer.querySelector('[aria-label="Previous change block"]').disabled, true);
    assert.equal(ui.viewer.querySelector('[aria-label="Next change block"]').disabled, true);
  }
  assert.equal(ui.requests.length, 2);
});

test('View full change-block selection changes between nearby final blocks at the same clamped scroll position', async t => {
  const prefix = Array.from({length: 60}, (_, index) => `prefix ${index}`);
  const ui = fixture(t, {
    before: [...prefix, 'old A', 'separator', 'old B', 'last context'].join('\n') + '\n',
    after: [...prefix, 'new A', 'separator', 'new B', 'last context'].join('\n') + '\n',
    node: {
      path: 'nearby.txt',
      type: 'blob',
      status: 'modified',
      adds: 2,
      dels: 2,
      patch: [
        '@@ -1,64 +1,64 @@',
        ...prefix.map(line => ` ${line}`),
        '-old A',
        '+new A',
        ' separator',
        '-old B',
        '+new B',
        ' last context',
      ].join('\n'),
    },
  });
  const body = await open(ui);
  count(ui, 0, 2);
  await navigate(ui, 'Next');
  count(ui, 1, 2);
  const unifiedTop = body.scrollTop;
  assert.equal(unifiedTop, body.scrollHeight - body.clientHeight);
  await navigate(ui, 'Next');
  count(ui, 2, 2);
  assert.equal(body.scrollTop, unifiedTop, 'the second target clamps to the same Unified position');
  await navigate(ui, 'Previous');
  count(ui, 1, 2);
  assert.equal(body.scrollTop, unifiedTop);
  await navigate(ui, 'Next');
  count(ui, 2, 2);
  await layout(ui, 'Side-by-side');
  count(ui, 2, 2);
  const {old, next} = panes(ui);
  const splitTop = old.scrollTop;
  assert.equal(splitTop, old.scrollHeight - old.clientHeight);
  await navigate(ui, 'Previous');
  count(ui, 1, 2);
  assert.deepEqual([old.scrollTop, next.scrollTop], [splitTop, splitTop]);
  await navigate(ui, 'Next');
  count(ui, 2, 2);
  assert.deepEqual([old.scrollTop, next.scrollTop], [splitTop, splitTop]);
  await layout(ui, 'Unified');
  count(ui, 2, 2);
  await navigate(ui, 'Previous');
  count(ui, 1, 2);
  await layout(ui, 'Side-by-side');
  count(ui, 1, 2);
  assert.equal(ui.requests.length, 2);
});

for (const status of ['added', 'removed']) {
  test(`View full change-block counter remains stable for one whole-file ${status} block in both layouts`, async t => {
    const text = 'source A\nsource B\n';
    const ui = fixture(t, {
      before: status === 'removed' ? text : '',
      after: status === 'added' ? text : '',
      node: {
        path: `${status}.txt`,
        type: 'blob',
        status,
        adds: status === 'added' ? 2 : 0,
        dels: status === 'removed' ? 2 : 0,
        patch: '',
      },
    });
    const body = await open(ui);
    count(ui, 1, 1);
    await navigate(ui, 'Next');
    await navigate(ui, 'Previous');
    assert.equal(body.scrollTop, 0);
    count(ui, 1, 1);
    await layout(ui, 'Side-by-side');
    await navigate(ui, 'Previous');
    await navigate(ui, 'Next');
    count(ui, 1, 1);
    const {old, next} = panes(ui);
    assert.deepEqual([old.scrollTop, next.scrollTop], [0, 0]);
    const blank = status === 'added' ? old : next;
    const source = status === 'added' ? next : old;
    assert.equal(blank.querySelectorAll('.line-text').length, 0, 'the absent revision contains only aligned gaps');
    assert.ok(source.textContent.includes('source A'));
    assert.equal(ui.requests.length, 1, 'the missing revision of a whole-file change is not fetched');
    assert.equal(ui.requests[0].source.sha, status === 'added' ? headSHA : baseSHA);
  });
}

test('View full change-block controls become inert after closing and reopening resets the counter', async t => {
  const ui = fixture(t);
  await open(ui);
  const stale = await navigate(ui, 'Next');
  const staleCount = ui.viewer.querySelector('.diff-changes-count');
  count(ui, 1);
  ui.app.closeViewer();
  assert.equal(stale.isConnected, false);
  const body = await open(ui);
  count(ui, 0);
  assert.equal(ui.viewer.querySelectorAll('.diff-changes').length, 1);
  await stale.fire('click');
  count(ui, 0);
  assert.equal(staleCount.textContent, '1 / 4');
  assert.equal(body.scrollTop, 0);
  assert.equal(ui.requests.length, 4);
});
