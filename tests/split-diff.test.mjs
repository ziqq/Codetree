/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * View full layout and scrolling regressions through the production viewer.
 * Synthetic geometry makes overflow and clamping deterministic; these checks
 * do not establish installed-browser layout or authenticated API behavior.
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

const directory = await mkdtemp(join(tmpdir(), 'codetree-split-diff-'));
const modulePath = join(directory, 'content.mjs');
await writeFile(modulePath, await bundle());
const content = await import(pathToFileURL(modulePath));
await rm(directory, {recursive: true, force: true});
const {createRoot, createState, getOwner, untrackActions, withOwner} = content;
const baseSHA = 'a'.repeat(40);
const headSHA = 'b'.repeat(40);
const rowHeight = 22;

/** Two unequal replacement blocks separated by context, followed by enough text to scroll. */
function sample({tabs = false} = {}) {
  const prefix = Array.from({length: 20}, (_, index) => `prefix ${index + 1}: ${'x'.repeat(80)}`);
  const suffix = Array.from({length: 160}, (_, index) => `tail ${index + 1}: ${'y'.repeat(80)}`);
  const oldFirst = tabs ? '\t'.repeat(40) + 'wide old line' : 'old A';
  const before = [...prefix, oldFirst, 'old B', 'separator', 'old C', 'old D', 'old E', ...suffix];
  const after = [...prefix, 'new A', 'new B', 'new C', 'separator', 'new D', ...suffix];
  const patch = [
    `@@ -1,${before.length} +1,${after.length} @@`,
    ...prefix.map(line => ` ${line}`),
    `-${oldFirst}`,
    '-old B',
    '+new A',
    '+new B',
    '+new C',
    ' separator',
    '-old C',
    '-old D',
    '-old E',
    '+new D',
    ...suffix.map(line => ` ${line}`),
  ].join('\n');
  return {
    before: before.join('\n') + '\n',
    after: after.join('\n') + '\n',
    node: {path: 'source.txt', type: 'blob', status: 'modified', adds: 4, dels: 5, patch},
  };
}

/** Creates the actual modal factory with controlled source replies and browser frame scheduling. */
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
  return {app, data, viewer, requests, clock, window};
}

/** Opens the public View full action and checks loading produced a usable viewport. */
async function open(ui) {
  await ui.app.showDiff(ui.data.node);
  assert.equal(ui.viewer.open, true);
  const body = ui.viewer.querySelector('.viewer-body');
  assert.ok(body.querySelector('.code-spacer'), body.textContent);
  return body;
}

/** Clicks the visible mode control, asserting behavior rather than importing a new implementation symbol. */
async function layout(ui, label) {
  const control = ui.viewer.querySelectorAll('button').find(node => node.textContent === label);
  assert.ok(control, `View full exposes ${label}`);
  await control.fire('click');
  assert.equal(control.getAttribute('aria-pressed'), 'true');
  return control;
}

/** Returns both accessible revision viewports. */
function panes(ui) {
  const old = ui.viewer.querySelector('[aria-label="Old revision"]');
  const next = ui.viewer.querySelector('[aria-label="New revision"]');
  assert.ok(old && next, 'both revision panes are present');
  return {old, next};
}

/** Extracts source text, line numbers and gaps from rendered public DOM. */
function rows(viewport) {
  return viewport.querySelectorAll('.code-row').map(row => ({
    text: row.querySelector('.line-text')?.textContent ?? '',
    numbers: row.querySelectorAll('.line-number').map(number => number.textContent),
    gap: row.classList.contains('diff-gap'),
  }));
}

/** Delivers a user scroll followed by the scheduled viewport draw. */
async function scroll(ui, viewport, top, left) {
  viewport.scrollTop = top;
  viewport.scrollLeft = left;
  await viewport.fire('scroll');
  ui.clock.flush();
}

test('View full exposes Unified and Side-by-side and switches validated content without fetching again', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  const initial = rows(body);
  assert.deepEqual(
    ui.requests.map(request => request.source.sha),
    [baseSHA, headSHA],
  );
  assert.equal(ui.viewer.querySelector('.diff-layout')?.getAttribute('aria-label'), 'Diff layout');
  assert.equal(
    ui.viewer
      .querySelectorAll('button')
      .find(node => node.textContent === 'Unified')
      ?.getAttribute('aria-pressed'),
    'true',
  );
  assert.deepEqual(initial[20], {text: 'old A', numbers: ['21', ''], gap: false});
  await layout(ui, 'Side-by-side');
  assert.equal(body.classList.contains('split-diff'), true);
  assert.equal(
    ui.viewer
      .querySelectorAll('button')
      .find(node => node.textContent === 'Unified')
      .getAttribute('aria-pressed'),
    'false',
  );
  await layout(ui, 'Unified');
  assert.equal(body.classList.contains('split-diff'), false);
  assert.deepEqual(rows(body), initial);
  assert.equal(ui.requests.length, 2);
});

test('View full aligns unequal replacement blocks without crossing context or numbering gaps', async t => {
  const ui = fixture(t);
  await open(ui);
  await layout(ui, 'Side-by-side');
  const {old, next} = panes(ui);
  assert.deepEqual(rows(old).slice(20, 27), [
    {text: 'old A', numbers: ['21'], gap: false},
    {text: 'old B', numbers: ['22'], gap: false},
    {text: '', numbers: [], gap: true},
    {text: 'separator', numbers: ['23'], gap: false},
    {text: 'old C', numbers: ['24'], gap: false},
    {text: 'old D', numbers: ['25'], gap: false},
    {text: 'old E', numbers: ['26'], gap: false},
  ]);
  assert.deepEqual(rows(next).slice(20, 27), [
    {text: 'new A', numbers: ['21'], gap: false},
    {text: 'new B', numbers: ['22'], gap: false},
    {text: 'new C', numbers: ['23'], gap: false},
    {text: 'separator', numbers: ['24'], gap: false},
    {text: 'new D', numbers: ['25'], gap: false},
    {text: '', numbers: [], gap: true},
    {text: '', numbers: [], gap: true},
  ]);
  for (const gap of ui.viewer.querySelectorAll('.diff-gap')) assert.equal(gap.getAttribute('aria-hidden'), 'true');
});

test('View full synchronizes both axes from either revision and respects actual scroll bounds', async t => {
  const ui = fixture(t);
  await open(ui);
  await layout(ui, 'Side-by-side');
  const {old, next} = panes(ui);
  assert.notEqual(old.clientWidth, next.clientWidth);
  await scroll(ui, old, 31 * rowHeight + 5.5, 117);
  assert.deepEqual([next.scrollTop, next.scrollLeft], [old.scrollTop, 117]);
  await scroll(ui, next, 54 * rowHeight + 7.25, 209);
  assert.deepEqual([old.scrollTop, old.scrollLeft], [next.scrollTop, 209]);
  await scroll(ui, old, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  assert.equal(old.scrollTop, old.scrollHeight - old.clientHeight);
  assert.equal(old.scrollLeft, old.scrollWidth - old.clientWidth);
  assert.deepEqual([next.scrollTop, next.scrollLeft], [old.scrollTop, old.scrollLeft]);
  await scroll(ui, next, -100, -100);
  assert.deepEqual([old.scrollTop, next.scrollTop, old.scrollLeft, next.scrollLeft], [0, 0, 0, 0]);
});

test('View full preserves an added-side source anchor and fractional offset across a layout roundtrip', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  const top = 22 * rowHeight + 5.5;
  await scroll(ui, body, top, 107);
  await layout(ui, 'Side-by-side');
  const {old, next} = panes(ui);
  assert.deepEqual([old.scrollTop, next.scrollTop], [20 * rowHeight + 5.5, 20 * rowHeight + 5.5]);
  await scroll(ui, next, next.scrollTop, 179);
  await layout(ui, 'Unified');
  assert.equal(body.scrollTop, top, 'paired old row must not replace the exact added source row');
  assert.equal(body.scrollLeft, 179);
  assert.equal(ui.requests.length, 2);
});

test('View full derives a new canonical source position after vertical scrolling in split mode', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  await scroll(ui, body, 22 * rowHeight + 5.5, 111);
  await layout(ui, 'Side-by-side');
  const {next} = panes(ui);
  await scroll(ui, next, 24 * rowHeight + 7.25, 155);
  await layout(ui, 'Unified');
  assert.equal(body.scrollTop, 26 * rowHeight + 7.25, 'new split row identifies old C in unified source coordinates');
  assert.equal(body.scrollLeft, 155);
});

test('View full retains the source line and fractional offset when font metrics or viewport width change', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  await scroll(ui, body, 22.25 * rowHeight, 101);
  await layout(ui, 'Side-by-side');
  const {old, next} = panes(ui);
  ui.app.state.preferences = {...ui.app.state.preferences, fontSize: 22};
  assert.deepEqual([old.scrollTop, next.scrollTop], [20.25 * 30, 20.25 * 30]);
  old.clientWidth = 410;
  next.clientWidth = 450;
  await ui.window.fire('resize');
  assert.deepEqual([old.scrollLeft, next.scrollLeft], [101, 101]);
  await layout(ui, 'Unified');
  assert.equal(body.scrollTop, 22.25 * 30);
  assert.equal(body.scrollLeft, 101);
  assert.equal(ui.requests.length, 2);
});

test('View full equalizes real tab-expanded overflow before either pane reaches the horizontal edge', async t => {
  const ui = fixture(t, sample({tabs: true}));
  await open(ui);
  await layout(ui, 'Side-by-side');
  const {old, next} = panes(ui);
  const oldCode = old.querySelector('.code-spacer');
  const newCode = next.querySelector('.code-spacer');
  assert.ok(oldCode.scrollWidth > 1700, 'four-column tabs overflow the character-count width estimate');
  assert.equal(oldCode.scrollWidth - old.clientWidth, newCode.scrollWidth - next.clientWidth);
  await scroll(ui, old, 0, Number.MAX_SAFE_INTEGER);
  assert.equal(next.scrollLeft, old.scrollLeft);
  assert.equal(old.scrollLeft, old.scrollWidth - old.clientWidth);
  await scroll(ui, next, 0, 37);
  assert.equal(old.scrollLeft, 37);
  assert.equal(ui.requests.length, 2);
});

test('closing View full cancels queued split draws and removes stale scroll and layout controls', async t => {
  const ui = fixture(t);
  await open(ui);
  const staleControl = await layout(ui, 'Side-by-side');
  const {old, next} = panes(ui);
  const oldCode = old.querySelector('.code-spacer');
  const originalRows = [...oldCode.children];
  old.scrollTop = 70 * rowHeight;
  await old.fire('scroll');
  assert.equal(ui.clock.pending.size, 1);
  ui.app.closeViewer();
  assert.equal(ui.clock.pending.size, 0);
  assert.equal(old.listeners.get('scroll').length, 0);
  assert.equal(next.listeners.get('scroll').length, 0);
  ui.clock.flush();
  assert.deepEqual(oldCode.children, originalRows);
  ui.app.state.diffLayout = 'unified';
  await staleControl.fire('click');
  assert.equal(ui.app.state.diffLayout, 'unified');
  await open(ui);
  assert.equal(ui.viewer.querySelectorAll('.diff-layout').length, 1);
  assert.equal(ui.requests.length, 4);
});
