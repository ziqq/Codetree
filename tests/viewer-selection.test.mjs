/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Source-line selection and clipboard regressions through the production viewer.
 * Viewport and clipboard completion are controlled, not installed-browser proof.
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
import {installViewerSearchDOM} from './helpers/viewer-search.mjs';

const directory = await mkdtemp(join(tmpdir(), 'codetree-viewer-selection-'));
const modulePath = join(directory, 'content.mjs');
await writeFile(modulePath, await bundle());
const {createRoot, createState, createViewer, getOwner, untrackActions, withOwner} = await import(
  pathToFileURL(modulePath)
);
await rm(directory, {recursive: true, force: true});
const baseSHA = 'a'.repeat(40);
const headSHA = 'b'.repeat(40);

/** Builds unequal changes, blank/tabbed lines and complete source beyond the initial viewport. */
function revision() {
  const prefix = ['const first = 1;', '', '\tconst indent = 2;', 'context'];
  const removed = ['\told first', '', 'old only'];
  const added = ['\tnew first', 'new second'];
  const suffix = Array.from({length: 320}, (_, index) => `tail ${index + 1}`);
  const before = [...prefix, ...removed, ...suffix];
  const after = [...prefix, ...added, ...suffix];
  return {
    before: before.join('\n') + '\n',
    after: after.join('\n') + '\n',
    node: {
      path: 'src/new name.js',
      previous_filename: 'src/old name.js',
      type: 'blob',
      status: 'renamed',
      adds: 2,
      dels: 3,
      patch: [
        `@@ -1,${before.length} +1,${after.length} @@`,
        ...prefix.map(line => ' ' + line),
        ...removed.map(line => '-' + line),
        ...added.map(line => '+' + line),
        ...suffix.map(line => ' ' + line),
      ].join('\n'),
    },
  };
}

/** Adds browser dataset camel-casing locally; shared fixture behavior stays unchanged. */
function selectionDOM(document) {
  const create = document.createElement.bind(document);
  document.createElement = tag => {
    const node = create(tag);
    const attribute = node.setAttribute.bind(node);
    node.setAttribute = (key, value) => {
      attribute(key, value);
      if (key.startsWith('data-'))
        node.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    };
    return node;
  };
}

/** Installs the actual modal, owner tree, revision replies and an observable clipboard. */
function fixture(t, provider = 'github', source = {}) {
  const {document, window} = dom();
  installDiffViewport(document);
  installViewerSearchDOM(document);
  selectionDOM(document);
  const clock = frames();
  const writes = [];
  let write = async text => {
    writes.push(text);
  };
  install(t, {
    document,
    window,
    navigator: {clipboard: {writeText: text => write(text)}},
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
  const data = revision();
  const requests = [];
  const app = createRoot(dispose => {
    const state = createState();
    state.context = {
      origin: `https://${provider}.example.com`,
      provider,
      owner: 'target',
      repo: 'repo',
      kind: 'pull',
      number: 1,
    };
    const sources =
      provider === 'github'
        ? {base: {owner: 'target', repo: 'repo', sha: baseSHA}, head: {owner: 'fork', repo: 'source', sha: headSHA}}
        : {
            base: {project: 10, projectPath: 'target/nested/repo', sha: baseSHA},
            head: {project: 20, projectPath: 'fork/nested/source', sha: headSHA},
          };
    state.diff = {...sources, ...source, files: [{...data.node, filename: data.node.path, additions: 2, deletions: 3}]};
    const app = {
      owner: getOwner(),
      state,
      dispose,
      view: {viewer},
      run: callback => withOwner(callback),
      diffURL: async () => `${state.context.origin}/native/diff`,
      async rpc(type, message) {
        assert.equal(type, 'FILE');
        requests.push(message);
        return message.source.sha === baseSHA ? data.before : data.after;
      },
    };
    Object.assign(app, untrackActions(createViewer(app)));
    return app;
  });
  t.after(app.dispose);
  return {
    app,
    data,
    document,
    viewer,
    window,
    clock,
    writes,
    requests,
    setWrite(value) {
      write = value;
    },
  };
}

/** Opens complete revisions and requires visible feature controls, including on the pre-feature baseline. */
async function open(ui) {
  await ui.app.showDiff(ui.data.node);
  const body = ui.viewer.querySelector('.viewer-body');
  assert.ok(body?.querySelector('.code-spacer'), body?.textContent);
  return body;
}

/** Reads user-facing selection actions, rather than controller fields. */
function controls(scope) {
  const group = scope.querySelector('.file-selection');
  assert.ok(group, 'Loaded files expose source-line selection actions.');
  const action = text => {
    const button = group.querySelectorAll('button').find(node => node.textContent === text);
    assert.ok(button, `Expected ${text} action`);
    return button;
  };
  return {
    group,
    label: group.querySelector('.file-selection-label'),
    status: group.querySelector('[role="status"]'),
    code: action('Copy code'),
    link: action('Copy permalink'),
    clear: action('Clear selection'),
  };
}

/** Clicks a visible source number through the viewport's real delegated handler. */
async function select(ui, body, side, line, shiftKey = false) {
  const number = body
    .querySelectorAll('button')
    .find(node => node.getAttribute('aria-label') === `Select ${side} line ${line}`);
  assert.ok(number, `The virtual viewport exposes selectable ${side} line ${line}.`);
  number.focus();
  await body.fire('click', {target: number, shiftKey});
  ui.clock.flush();
}

/** Switches layout through its public control. */
async function layout(ui, name) {
  const button = ui.viewer
    .querySelector('.diff-layout')
    .querySelectorAll('button')
    .find(node => node.textContent === name);
  await button.fire('click');
  ui.clock.flush();
}

/** Delivers a scroll from the active layout's viewport. */
async function scroll(ui, body, top) {
  const viewport = body.querySelector('.split-diff-pane') || body;
  viewport.scrollTop = top;
  await viewport.fire('scroll');
  ui.clock.flush();
}

/** A native write whose eventual completion is controlled separately from its invocation. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return {promise, resolve, reject};
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} selection reverses anchored ranges, changes source side and copies unadorned source`, async t => {
    const ui = fixture(t, provider);
    const body = await open(ui);
    const view = controls(ui.viewer);
    assert.equal(view.group.hidden, true);
    await select(ui, body, 'Old', 7);
    await select(ui, body, 'Old', 5, true);
    assert.equal(view.label.textContent, 'Old · Lines 5–7');
    await view.code.fire('click');
    assert.equal(ui.writes.at(-1), '\told first\n\nold only');
    assert.equal(body.querySelectorAll('.line-selected').length, 3);
    await select(ui, body, 'Old', 6, true);
    assert.equal(view.label.textContent, 'Old · Lines 6–7', 'Shift-click retains the original anchor.');
    await select(ui, body, 'New', 5, true);
    assert.equal(view.label.textContent, 'New · Line 5', 'Crossing Old/New starts a new range.');
    await select(ui, body, 'New', 6, true);
    await view.code.fire('click');
    assert.equal(ui.writes.at(-1), '\tnew first\nnew second');
    assert.equal(ui.requests.length, 2);
    await view.clear.fire('click');
    assert.equal(view.group.hidden, true);
    assert.equal(body.querySelectorAll('.line-selected').length, 0);
    assert.equal(ui.document.activeElement, body);
    assert.equal(ui.viewer.open, true);
  });

  test(`${provider} selection permalink uses renamed Old path and exact fork New source on the custom host`, async t => {
    const ui = fixture(t, provider);
    const body = await open(ui);
    const view = controls(ui.viewer);
    await select(ui, body, 'Old', 5);
    await select(ui, body, 'Old', 7, true);
    await view.link.fire('click');
    const oldPath = provider === 'github' ? 'target/repo' : 'target/nested/repo/-';
    assert.equal(
      ui.writes.at(-1),
      `https://${provider}.example.com/${oldPath}/blob/${baseSHA}/src/old%20name.js#L5-${provider === 'github' ? 'L' : ''}7`,
    );
    await select(ui, body, 'New', 5);
    await view.link.fire('click');
    const newPath = provider === 'github' ? 'fork/source' : 'fork/nested/source/-';
    assert.equal(ui.writes.at(-1), `https://${provider}.example.com/${newPath}/blob/${headSHA}/src/new%20name.js#L5`);
  });
}

for (const display of ['Unified', 'Side-by-side']) {
  test(`selection copies virtual source ranges and survives ${display} scrolling and layout projection`, async t => {
    const ui = fixture(t);
    const body = await open(ui);
    const view = controls(ui.viewer);
    await layout(ui, display);
    await select(ui, body, 'New', 5);
    if (display === 'Side-by-side') {
      const gap = body.querySelector('.diff-gap');
      assert.ok(gap);
      assert.equal(gap.querySelector('button'), null, 'Alignment gaps have no invented selectable source line.');
      await body.fire('click', {target: gap, shiftKey: true});
      assert.equal(view.label.textContent, 'New · Line 5');
    }
    await scroll(ui, body, (display === 'Unified' ? 202 : 200) * 22);
    assert.equal(
      body.querySelectorAll('button').some(node => node.getAttribute('aria-label') === 'Select New line 5'),
      false,
    );
    await select(ui, body, 'New', 200, true);
    assert.equal(view.label.textContent, 'New · Lines 5–200');
    await view.code.fire('click');
    assert.equal(ui.writes.at(-1), ui.data.after.split('\n').slice(4, 200).join('\n'));
    assert.ok(body.querySelectorAll('.code-row').length < 90, 'Selection keeps rendering virtualized.');
    await layout(ui, display === 'Unified' ? 'Side-by-side' : 'Unified');
    assert.equal(view.label.textContent, 'New · Lines 5–200');
    await scroll(ui, body, 0);
    const selected = body.querySelectorAll('.line-selected');
    assert.ok(selected.some(row => row.querySelector('.line-text').textContent === '\tnew first'));
    assert.equal(
      selected.some(row => row.querySelector('.line-text').textContent === '\told first'),
      false,
    );
    assert.equal(ui.requests.length, 2);
  });
}

test('selection keeps footer DOM/focus order and focus across redraw, then clears after modal replacement', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  const view = controls(ui.viewer);
  const bottom = ui.viewer.querySelector('.viewer-bottom');
  const late = ui.document.createElement('button');
  late.textContent = 'Later footer feature';
  bottom.append(late);
  await select(ui, body, 'New', 5);
  assert.equal(bottom.children.at(-1), view.group);
  const focused = ui.document.activeElement;
  assert.equal(focused.getAttribute('aria-label'), 'Select New line 5');
  assert.equal(focused.getAttribute('aria-pressed'), 'true');
  view.code.focus();
  await view.code.fire('click');
  assert.equal(ui.document.activeElement, view.code, 'Clipboard feedback does not detach the focused footer action.');
  assert.deepEqual(
    view.group.querySelectorAll('button').map(button => button.textContent),
    ['Copy permalink', 'Copy code', 'Clear selection'],
  );
  await ui.app.showDiff(ui.data.node);
  assert.equal(view.group.isConnected, false);
  assert.equal(controls(ui.viewer).group.hidden, true);
  const writes = ui.writes.length;
  await view.code.fire('click');
  assert.equal(ui.writes.length, writes);
  assert.equal(body.listeners.get('click').length, 0);
});

test('selection disables unresolved fork permalinks but still copies code', async t => {
  const ui = fixture(t, 'gitlab', {head: {project: 20, sha: headSHA}});
  const body = await open(ui);
  const view = controls(ui.viewer);
  await select(ui, body, 'New', 5);
  assert.equal(view.link.disabled, true);
  assert.equal(view.code.disabled, false);
  await view.link.fire('click');
  assert.deepEqual(ui.writes, []);
  await view.code.fire('click');
  assert.equal(ui.writes.at(-1), '\tnew first');
});

test('selection reports clipboard rejection and retries the same source range', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  const view = controls(ui.viewer);
  await select(ui, body, 'Old', 5);
  ui.setWrite(async () => {
    throw new Error('Permission denied');
  });
  await view.code.fire('click');
  assert.equal(view.status.textContent, 'Could not copy. Focus this page and try again.');
  assert.equal(view.status.classList.contains('error'), true);
  assert.equal(view.code.disabled, false);
  assert.equal(view.label.textContent, 'Old · Line 5');
  ui.setWrite(async text => {
    ui.writes.push(text);
  });
  await view.code.fire('click');
  assert.equal(view.status.textContent, 'Code copied.');
  assert.equal(view.status.classList.contains('error'), false);
  assert.equal(ui.writes.at(-1), '\told first');
});

test('selection serializes writes across range changes, clear and modal disposal/replacement', async t => {
  const ui = fixture(t);
  let body = await open(ui);
  let view = controls(ui.viewer);
  const pending = [];
  t.after(async () => {
    for (const task of pending) task.resolve();
    await Promise.resolve();
  });
  ui.setWrite(text => {
    const task = deferred();
    pending.push({...task, text});
    return task.promise;
  });
  await select(ui, body, 'New', 5);
  const first = view.code.fire('click');
  assert.equal(pending.length, 1);
  await select(ui, body, 'New', 6);
  assert.equal(view.code.disabled, true);
  await view.code.fire('click');
  assert.equal(pending.length, 1);
  await view.clear.fire('click');
  await select(ui, body, 'Old', 5);
  assert.equal(view.link.disabled, true);
  pending[0].resolve();
  await first;
  assert.equal(view.code.disabled, false);
  assert.equal(view.status.textContent, '', 'Stale success is not shown for a new range.');
  const second = view.link.fire('click');
  assert.equal(pending.length, 2);
  const stale = view;
  await ui.app.showDiff(ui.data.node);
  body = ui.viewer.querySelector('.viewer-body');
  view = controls(ui.viewer);
  await select(ui, body, 'New', 6);
  assert.equal(view.code.disabled, true, 'A replacement viewer shares the active native-write gate.');
  await view.code.fire('click');
  assert.equal(pending.length, 2);
  pending[1].reject(new Error('Denied after old viewer closed'));
  await second;
  assert.equal(stale.group.isConnected, false);
  assert.equal(view.code.disabled, false);
  assert.equal(view.status.textContent, '');
  const third = view.code.fire('click');
  assert.equal(pending.length, 3);
  pending[2].resolve();
  await third;
  assert.equal(pending[2].text, 'new second');
  assert.equal(view.status.textContent, 'Code copied.');
});
