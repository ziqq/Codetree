/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Exact-revision Outline regressions through production View full factories.
 * Controlled scroll geometry establishes source mapping, not installed-browser layout.
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
import {installViewerSearchDOM, keyEvent} from './helpers/viewer-search.mjs';

const directory = await mkdtemp(join(tmpdir(), 'codetree-viewer-outline-'));
const modulePath = join(directory, 'content.mjs');
await writeFile(modulePath, await bundle());
const content = await import(pathToFileURL(modulePath));
await rm(directory, {recursive: true, force: true});
const {createRoot, createState, getOwner, untrackActions, withOwner} = content;
const baseSHA = 'a'.repeat(40);
const headSHA = 'b'.repeat(40);

/** Builds an unequal replacement with offscreen declarations and a distinct old filename. */
function revision() {
  const prefix = Array.from({length: 320}, (_, index) => `// context ${index}`);
  prefix[199] = 'function context200() {}';
  const removed = ['function oldOnly() {}', 'function oldExtra() {}'];
  const added = ['function newOnly() {}'];
  const suffix = Array.from({length: 100}, (_, index) =>
    index === 40 ? 'function sharedLater() {}' : `// tail ${index}`,
  );
  return {
    before: [...prefix, ...removed, ...suffix].join('\n'),
    after: [...prefix, ...added, ...suffix].join('\n'),
    node: {
      path: 'src/new.js',
      previous_filename: 'src/old.js',
      type: 'blob',
      status: 'renamed',
      adds: 1,
      dels: 2,
      patch: ['@@ -321,2 +321,1 @@', ...removed.map(line => '-' + line), ...added.map(line => '+' + line)].join('\n'),
    },
  };
}

/** Extends only outline-list geometry, using its actual spacer and assigned viewport height. */
function outlineGeometry(document) {
  const create = document.createElement.bind(document);
  document.createElement = tag => {
    const node = create(tag);
    const top = Object.getOwnPropertyDescriptor(node, 'scrollTop');
    const height = Object.getOwnPropertyDescriptor(node, 'clientHeight');
    const replace = node.replaceChildren.bind(node);
    node.replaceChildren = (...children) => {
      if (node.classList.contains('file-outline-spacer') && node.contains(document.activeElement))
        void node.closest('.file-outline').fire('focusout', {target: document.activeElement, relatedTarget: null});
      replace(...children);
    };
    let outlineTop = 0;
    Object.defineProperties(node, {
      clientHeight: {
        configurable: true,
        get() {
          return node.classList.contains('file-outline-list')
            ? Number.parseFloat(node.style.height) || 224
            : height.get.call(node);
        },
      },
      scrollTop: {
        configurable: true,
        get() {
          return node.classList.contains('file-outline-list') ? outlineTop : top.get.call(node);
        },
        set(value) {
          if (!node.classList.contains('file-outline-list')) {
            top.set.call(node, value);
            return;
          }
          const size = Number.parseFloat(node.querySelector('.file-outline-spacer')?.style.height) || 0;
          outlineTop = Math.max(0, Math.min(value, size - node.clientHeight));
        },
      },
    });
    return node;
  };
}

/** Installs the actual modal factory around controlled source replies and owned reactive state. */
function fixture(t, data = revision()) {
  const {document, window} = dom();
  installDiffViewport(document);
  installViewerSearchDOM(document);
  outlineGeometry(document);
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
    state.diff = {
      base: {owner: 'upstream', repo: 'base', sha: baseSHA},
      head: {owner: 'forker', repo: 'fork', sha: headSHA},
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
        requests.push(message);
        const reply = app.reply?.(message);
        return reply === undefined ? (message.source.sha === baseSHA ? data.before : data.after) : reply;
      },
    };
    Object.assign(app, untrackActions(content.createViewer(app)));
    return app;
  });
  t.after(app.dispose);
  return {app, viewer, document, window, clock, requests, data};
}

/** Requires the visible feature before accessing new bridge methods, including on the baseline checkout. */
function controls(ui) {
  const toggle = ui.viewer.querySelector('.file-outline-toggle');
  assert.ok(toggle, 'Loaded View full exposes the compact Outline control.');
  return {
    toggle,
    panel: ui.viewer.querySelector('.file-outline-panel'),
    list: ui.viewer.querySelector('.file-outline-list'),
  };
}

/** Opens the owned popup through its public button, without invoking controller internals. */
async function open(ui) {
  const result = controls(ui);
  result.toggle.focus();
  if (result.panel.hidden) await result.toggle.fire('click');
  assert.equal(result.panel.hidden, false);
  return result;
}

/** Chooses an Outline source side through its shared segmented-control component. */
async function side(ui, value) {
  const panel = controls(ui).panel;
  const button = panel
    .querySelector('.file-outline-revision')
    .querySelectorAll('button')
    .find(button => button.textContent === value);
  button.focus();
  await button.fire('click');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  return ui.app.getViewerSymbols();
}

/** Delivers one browser-like keyboard event with cancellation visible to subsequent capture handlers. */
async function key(ui, value) {
  const event = keyEvent(ui.document.activeElement, value);
  const cancel = event.preventDefault;
  event.preventDefault = function () {
    this.defaultPrevented = true;
    cancel();
  };
  await ui.window.fire('keydown', event);
  ui.clock.flush();
  return event;
}

/** Selects a public layout button and completes its virtual repaint. */
async function layout(ui, value) {
  await ui.viewer
    .querySelectorAll('button')
    .find(button => button.textContent === value)
    .fire('click');
  ui.clock.flush();
}

test('View full Outline starts collapsed, stays compact and keeps Close last with viewport-clamped placement', async t => {
  const ui = fixture(t);
  await ui.app.showDiff(ui.data.node);
  const {toggle, panel} = controls(ui);
  assert.equal(panel.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.classList.contains('small-button'), true);
  assert.ok(toggle.closest('.viewer-tools'), 'Outline wraps with Find and the final Close control.');
  const actions = ui.viewer.querySelector('.viewer-actions').querySelectorAll('button');
  assert.equal(actions.at(-1).getAttribute('aria-label'), 'Close viewer');
  toggle.getBoundingClientRect = () => ({left: 900, right: 970, bottom: 100});
  panel.getBoundingClientRect = () => ({width: 320, height: 200});
  await open(ui);
  assert.equal(Number.parseFloat(panel.style.left), 650, 'Popup aligns its right edge with its compact trigger.');
  assert.equal(Number.parseFloat(panel.style.top), 106);
  assert.equal(ui.app.getViewerSymbols().side, 'new');
  assert.equal(ui.requests.length, 2);
  await ui.window.fire('scroll', {target: panel});
  assert.equal(panel.hidden, false, 'The height-bounded popup can scroll without dismissing itself.');
  await ui.window.fire('scroll', {target: ui.viewer.querySelector('.viewer-body')});
  assert.equal(panel.hidden, true, 'Scrolling the source viewport dismisses the anchored popup.');
});

for (const display of ['Unified', 'Side-by-side']) {
  test(`View full Outline maps exact renamed Old/New source symbols in ${display} without refetch`, async t => {
    const ui = fixture(t);
    await ui.app.showDiff(ui.data.node);
    controls(ui);
    await layout(ui, display);
    await open(ui);
    const model = ui.app.getViewerSymbols();
    assert.equal(model.filePath, 'src/new.js');
    assert.equal(model.path, 'src/new.js');
    assert.equal(model.source.owner, 'forker');
    const next = model.symbols.find(symbol => symbol.name === 'newOnly');
    assert.ok(next);
    assert.equal(model.go({...next}), false, 'Only member symbols can navigate this source model.');
    assert.equal(model.go(next), true);
    ui.clock.flush();
    const body = ui.viewer.querySelector('.viewer-body');
    const panes = display === 'Unified' ? [body] : body.querySelectorAll('.split-diff-pane');
    for (const pane of panes) assert.equal(pane.scrollTop, (display === 'Unified' ? 322 : 320) * 22);
    assert.equal(ui.document.activeElement, body);
    await open(ui);
    const old = await side(ui, 'Old');
    assert.equal(old.path, 'src/old.js');
    assert.equal(old.source.sha, baseSHA);
    assert.equal(old.source.owner, 'upstream');
    assert.match(controls(ui).panel.querySelector('.file-outline-source').textContent, /Old.*src\/old.js/);
    assert.equal(old.go(old.symbols.find(symbol => symbol.name === 'oldExtra')), true);
    ui.clock.flush();
    for (const pane of panes) assert.equal(pane.scrollTop, 321 * 22);
    assert.equal(model.current(), true, 'Choosing another side does not invalidate a still-loaded revision.');
    assert.equal(body.querySelectorAll('.code-row').length < 100, true);
    assert.equal(ui.requests.length, 2);
    assert.deepEqual(
      ui.requests.map(message => message.path),
      ['src/old.js', 'src/new.js'],
    );
  });
}

for (const status of ['added', 'removed']) {
  test(`View full Outline defaults to the populated ${status} revision and reports its empty counterpart`, async t => {
    const data = revision();
    data.node.status = status;
    data.node.previous_filename = undefined;
    data.node.patch = '';
    if (status === 'added') data.before = '';
    else data.after = '';
    const ui = fixture(t, data);
    await ui.app.showDiff(data.node);
    await open(ui);
    assert.equal(ui.app.getViewerSymbols().side, status === 'added' ? 'new' : 'old');
    assert.ok(ui.app.getViewerSymbols().symbols.length);
    const empty = await side(ui, status === 'added' ? 'Old' : 'New');
    assert.equal(empty.symbols.length, 0);
    assert.match(controls(ui).panel.querySelector('.file-outline-status').textContent, /No symbols found/);
    assert.equal(ui.requests.length, 1);
  });
}

for (const [path, text, expected] of [
  ['source.txt', 'function hidden() {}', 'not available'],
  ['source.js', '// no declarations', 'No symbols found'],
]) {
  test(`View full Outline honestly reports ${path} without inventing symbols`, async t => {
    const data = revision();
    data.before = data.after = text;
    data.node = {...data.node, path, previous_filename: undefined, patch: ''};
    const ui = fixture(t, data);
    await ui.app.showDiff(data.node);
    await open(ui);
    const model = ui.app.getViewerSymbols();
    assert.equal(model.supported, path.endsWith('.js'));
    assert.equal(model.symbols.length, 0);
    assert.match(controls(ui).panel.querySelector('.file-outline-status').textContent, new RegExp(expected));
    assert.equal(controls(ui).list.hidden, true);
  });
}

test('View full Outline keeps a bounded list, honest partial notice and keyboard cursor after scrolling/reopening', async t => {
  const data = revision();
  data.before = data.after = Array.from({length: 2100}, (_, index) => `function symbol${index}() {}`).join('\n');
  data.node = {...data.node, previous_filename: undefined, patch: ''};
  const ui = fixture(t, data);
  await ui.app.showDiff(data.node);
  const {toggle, panel, list} = await open(ui);
  const model = ui.app.getViewerSymbols();
  assert.equal(model.limited, true);
  assert.equal(model.symbols.length, 2000);
  assert.equal(panel.querySelector('.file-outline-notice').hidden, false);
  assert.match(panel.querySelector('.file-outline-notice').textContent, /Partial outline/);
  assert.ok(list.querySelectorAll('button').length <= 16);
  list.scrollTop = 100 * 28;
  await list.fire('scroll');
  ui.clock.flush();
  const first = Number(ui.document.activeElement.dataset.index);
  assert.equal(first, 100);
  await key(ui, 'ArrowDown');
  assert.equal(Number(ui.document.activeElement.dataset.index), 101);
  await key(ui, 'Escape');
  assert.equal(panel.hidden, true);
  assert.equal(ui.document.activeElement, toggle);
  await open(ui);
  assert.ok(Number(ui.document.activeElement.dataset.index) >= 100);
  await key(ui, 'ArrowDown');
  const next = Number(ui.document.activeElement.dataset.index);
  assert.ok(next >= 101, 'The cursor follows the focused visible row instead of jumping to index 1.');
  await key(ui, 'End');
  assert.equal(panel.hidden, false, 'Repainting the focused virtual row must not dismiss the owned popup.');
  assert.equal(Number(ui.document.activeElement.dataset.index), 1999);
  await key(ui, 'Enter');
  assert.equal(panel.hidden, true);
  assert.equal(ui.viewer.open, true);
  const body = ui.viewer.querySelector('.viewer-body');
  assert.equal(body.scrollTop, 1999 * 22);
  assert.equal(ui.document.activeElement, body);
  assert.ok(body.querySelectorAll('.code-row').length < 50);
  assert.equal(ui.requests.length, 2);
});

test('View full Outline model is null during replacement/comments/error and rejects stale navigation after cleanup', async t => {
  const ui = fixture(t);
  await ui.app.showDiff(ui.data.node);
  controls(ui);
  const old = ui.app.getViewerSymbols();
  const symbol = old.symbols[0];
  let release;
  ui.app.reply = () =>
    new Promise(resolve => {
      release = resolve;
    });
  const opening = ui.app.showDiff({...ui.data.node, status: 'added', patch: ''});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ui.app.getViewerSymbols(), null);
  assert.equal(old.current(), false);
  assert.equal(old.go(symbol), false);
  ui.app.closeViewer();
  release(ui.data.after);
  await opening;
  assert.equal(ui.app.getViewerSymbols(), null);
  ui.app.reply = undefined;
  await ui.app.showDiff(ui.data.node);
  controls(ui);
  ui.app.showComments({...ui.data.node, comments: []});
  assert.equal(ui.app.getViewerSymbols(), null);
  await ui.app.showDiff({...ui.data.node, patch: '@@ -1 +1 @@\n-wrong\n+also wrong'});
  assert.match(ui.viewer.querySelector('.viewer-body').textContent, /unavailable/);
  assert.equal(ui.app.getViewerSymbols(), null);
  ui.app.closeViewer();
  ui.clock.flush();
  assert.equal(ui.window.listeners.get('keydown')?.length || 0, 0);
  assert.equal(ui.viewer.querySelector('.file-outline'), null);
});

test('View full Outline Escape and focus transfer leave the independent Find state intact', async t => {
  const ui = fixture(t);
  await ui.app.showDiff(ui.data.node);
  controls(ui);
  const find = ui.viewer.querySelector('.viewer-find');
  const input = find.querySelector('input');
  const toggle = ui.viewer.querySelector('[aria-label="Find in file (Ctrl/Cmd+F)"]');
  await toggle.fire('click');
  input.value = 'context';
  await input.fire('input');
  const outline = await open(ui);
  await key(ui, 'Escape');
  assert.equal(outline.panel.hidden, true);
  assert.equal(find.hidden, false);
  assert.equal(input.value, 'context');
  await open(ui);
  const focused = ui.document.activeElement;
  input.focus();
  await ui.viewer.querySelector('.file-outline').fire('focusout', {target: focused, relatedTarget: input});
  assert.equal(outline.panel.hidden, true);
  assert.equal(ui.document.activeElement, input);
  assert.equal(ui.viewer.open, true);
  ui.app.closeViewer();
});
