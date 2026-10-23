/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * File search regressions through the production View full factory.
 * Synthetic source-text geometry proves virtual reveal behavior, not browser layout.
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

const directory = await mkdtemp(join(tmpdir(), 'codetree-viewer-search-'));
const modulePath = join(directory, 'content.mjs');
await writeFile(modulePath, await bundle());
const content = await import(pathToFileURL(modulePath));
await rm(directory, {recursive: true, force: true});
const {createRoot, createState, getOwner, untrackActions, withOwner} = content;
const baseSHA = 'a'.repeat(40);
const headSHA = 'b'.repeat(40);

/** Builds a complete, valid replacement patch without depending on search or diff projection internals. */
function revision({
  prefix = ['const prefix = 1;'],
  removed = ['old beacon'],
  added = ['new beacon'],
  suffix = ['shared beacon'],
  path = 'source.txt',
} = {}) {
  const before = [...prefix, ...removed, ...suffix];
  const after = [...prefix, ...added, ...suffix];
  return {
    before: before.join('\n') + '\n',
    after: after.join('\n') + '\n',
    node: {
      path,
      type: 'blob',
      status: 'modified',
      adds: added.length,
      dels: removed.length,
      patch: [
        `@@ -1,${before.length} +1,${after.length} @@`,
        ...prefix.map(line => ` ${line}`),
        ...removed.map(line => `-${line}`),
        ...added.map(line => `+${line}`),
        ...suffix.map(line => ` ${line}`),
      ].join('\n'),
    },
  };
}

/** Installs the real modal feature and controls frame scheduling and revision replies. */
function fixture(t, data = revision()) {
  const {document, window} = dom();
  installDiffViewport(document);
  installViewerSearchDOM(document);
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
        requests.push(message);
        return message.source.sha === baseSHA ? data.before : data.after;
      },
    };
    Object.assign(app, untrackActions(content.createViewer(app)));
    return app;
  });
  t.after(app.dispose);
  return {app, data, document, viewer, window, clock, requests, t};
}

/** Opens View full before mocking timers, so syntax-tokenizer yielding uses its normal clock. */
async function open(ui) {
  await ui.app.showDiff(ui.data.node);
  const body = ui.viewer.querySelector('.viewer-body');
  assert.ok(body?.querySelector('.code-spacer'), body?.textContent);
  ui.t.mock.timers.enable({apis: ['setTimeout']});
  return body;
}

/** Returns publicly labelled find controls; the baseline must fail on the missing UI assertion. */
function controls(ui) {
  const bar = ui.viewer.querySelector('.viewer-find');
  assert.ok(bar, 'View full exposes file search');
  return {
    bar,
    input: bar.querySelector('input'),
    count: bar.querySelector('[role="status"]'),
    previous: bar.querySelector('[aria-label="Previous match"]'),
    next: bar.querySelector('[aria-label="Next match"]'),
    close: bar.querySelector('[aria-label="Close file search"]'),
    toggle: ui.viewer.querySelector('[aria-label="Find in file (Ctrl/Cmd+F)"]'),
  };
}

/** Delivers one window keyboard event and exposes its browser-default cancellation. */
async function key(ui, target, value, modifiers) {
  const event = keyEvent(target, value, modifiers);
  await ui.window.fire('keydown', event);
  return event;
}

/** Advances debounce and bounded asynchronous scan chunks without real-time sleeps. */
async function finish(ui, advance = 120) {
  ui.t.mock.timers.tick(advance);
  for (let turn = 0; turn < 200; turn++) {
    await Promise.resolve();
    ui.t.mock.timers.tick(0);
    ui.clock.flush();
    if (controls(ui).input.getAttribute('aria-busy') === 'false') return;
  }
  assert.fail('File search finishes its bounded scan');
}

/** Enters a query through the actual input handler and waits for its result count. */
async function search(ui, query) {
  const {input} = controls(ui);
  input.value = query;
  await input.fire('input');
  await finish(ui);
}

/** Clicks a public diff-layout control and flushes its viewport frame. */
async function layout(ui, label) {
  const button = ui.viewer.querySelectorAll('button').find(node => node.textContent === label);
  assert.ok(button, `View full exposes ${label}`);
  await button.fire('click');
  ui.clock.flush();
}

/** Returns the rendered active source fragments in DOM order, across syntax spans. */
function activeText(root) {
  return root
    .querySelectorAll('.file-match.active')
    .map(mark => mark.textContent)
    .join('');
}

test('View full file search opens with Ctrl/Cmd+F and selects its existing local query', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  const {bar, input, toggle} = controls(ui);
  assert.equal(bar.hidden, true);
  assert.equal(toggle.classList.contains('icon-button'), true);
  assert.equal(toggle.querySelector('svg')?.tagName, 'SVG');
  const first = await key(ui, body, 'f', {ctrlKey: true});
  assert.equal(first.defaultPrevented, true);
  assert.equal(first.propagationStopped, true);
  assert.equal(bar.hidden, false);
  assert.equal(toggle.hidden, true);
  assert.equal(ui.document.activeElement, input);
  assert.equal(input.getAttribute('aria-label'), 'Find in file');
  assert.equal(input.parentElement.classList.contains('searchbar'), true);
  await search(ui, 'beacon');
  input.selectionStart = input.selectionEnd = 2;
  const second = await key(ui, input, 'F', {metaKey: true});
  assert.equal(second.defaultPrevented, true);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 6]);
  assert.equal(controls(ui).count.textContent, '1 / 3');
  assert.equal(ui.requests.length, 2);
});

test('View full file search navigates Enter and Shift+Enter with wrap and SVG controls', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  await key(ui, body, 'f', {metaKey: true});
  await search(ui, 'beacon');
  const {input, count, previous, next} = controls(ui);
  for (const control of [previous, next]) {
    assert.equal(control.classList.contains('icon-button'), true);
    assert.ok(control.querySelector('svg'));
    assert.equal(control.textContent, '');
  }
  assert.equal(activeText(body), 'beacon');
  for (const expected of ['2 / 3', '3 / 3', '1 / 3']) {
    const event = await key(ui, input, 'Enter');
    assert.equal(event.defaultPrevented, true);
    assert.equal(count.textContent, expected);
  }
  await key(ui, input, 'Enter', {shiftKey: true});
  assert.equal(count.textContent, '3 / 3');
  await next.fire('click');
  assert.equal(count.textContent, '1 / 3');
  await previous.fire('click');
  assert.equal(count.textContent, '3 / 3');
});

test('View full file search consumes Escape before modal dismissal and clears only search highlights', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  const source = body.querySelectorAll('.line-text').map(node => node.textContent);
  await controls(ui).toggle.fire('click');
  await search(ui, 'beacon');
  const {input, bar, toggle} = controls(ui);
  const first = await key(ui, input, 'Escape');
  assert.equal(first.defaultPrevented, true);
  assert.equal(first.propagationStopped, true);
  assert.equal(ui.viewer.open, true);
  assert.equal(bar.hidden, true);
  assert.equal(toggle.hidden, false);
  assert.equal(ui.document.activeElement, body);
  assert.equal(body.querySelectorAll('.file-match').length, 0);
  assert.deepEqual(
    body.querySelectorAll('.line-text').map(node => node.textContent),
    source,
  );
  const second = await key(ui, body, 'Escape');
  assert.equal(second.defaultPrevented, false, 'a closed find bar leaves native dialog Escape available');
  assert.equal(second.propagationStopped, false);
});

test('View full file search preserves native editor shortcuts and excludes composing or modified find events', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  const {bar} = controls(ui);
  for (const tag of ['input', 'textarea', 'select', 'div']) {
    const editor = ui.document.createElement(tag);
    if (tag === 'div') editor.isContentEditable = true;
    ui.document.body.append(editor);
    editor.focus();
    const event = await key(ui, editor, 'f', {ctrlKey: true});
    assert.equal(event.defaultPrevented, false, `${tag} retains its native find shortcut`);
    assert.equal(bar.hidden, true);
  }
  body.focus();
  for (const modifiers of [
    {ctrlKey: true, isComposing: true},
    {ctrlKey: true, altGraph: true},
    {ctrlKey: true, altKey: true},
    {ctrlKey: true, metaKey: true},
    {ctrlKey: true, shiftKey: true},
    {ctrlKey: true, repeat: true},
    {ctrlKey: true, defaultPrevented: true},
    {},
  ]) {
    const event = await key(ui, body, 'f', modifiers);
    assert.equal(bar.hidden, true, JSON.stringify(modifiers));
    assert.equal(event.propagationStopped, false);
  }
  const hiddenInput = ui.document.createElement('input');
  const shadow = ui.document.createElement('div').attachShadow();
  shadow.append(hiddenInput);
  hiddenInput.focus();
  ui.app.view.shadow = shadow;
  const event = await key(ui, body, 'f', {metaKey: true});
  assert.equal(event.defaultPrevented, false, 'closed-shadow editor focus remains authoritative');
  assert.equal(bar.hidden, true);
});

test('View full file search treats special characters literally and keeps original Unicode offsets across syntax spans', async t => {
  const line = 'const İ = "x"; const value = "a.b[0]"; const astral = "𐐨";';
  const ui = fixture(t, revision({prefix: [line], removed: ['old'], added: ['new'], suffix: [], path: 'source.js'}));
  const body = await open(ui);
  await controls(ui).toggle.fire('click');
  await search(ui, 'A.B[0]');
  assert.equal(controls(ui).count.textContent, '1 / 1');
  assert.equal(activeText(body), 'a.b[0]');
  await search(ui, 'value = "a.b[0]"');
  assert.equal(controls(ui).count.textContent, '1 / 1');
  assert.equal(activeText(body), 'value = "a.b[0]"');
  assert.ok(body.querySelectorAll('.file-match.active').length > 1, 'one literal range crosses preserved token spans');
  assert.ok(body.querySelector('.syntax-string'));
  assert.equal(body.querySelector('.line-text').textContent, line);
  await search(ui, '𐐀');
  assert.equal(controls(ui).count.textContent, '1 / 1');
  assert.equal(activeText(body), '𐐨');
  assert.equal(body.querySelector('.line-text').textContent, line);
});

test('View full file search counts removed, added and shared context once across Unified and Side-by-side', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  await controls(ui).toggle.fire('click');
  await search(ui, 'beacon');
  const {count, input} = controls(ui);
  assert.equal(count.textContent, '1 / 3');
  await layout(ui, 'Side-by-side');
  const old = body.querySelector('[aria-label="Old revision"]');
  const next = body.querySelector('[aria-label="New revision"]');
  assert.equal(count.textContent, '1 / 3');
  assert.equal(activeText(old), 'beacon');
  assert.equal(activeText(next), '');
  await key(ui, input, 'Enter');
  assert.equal(count.textContent, '2 / 3');
  assert.equal(activeText(old), '');
  assert.equal(activeText(next), 'beacon');
  await key(ui, input, 'Enter');
  assert.equal(count.textContent, '3 / 3');
  assert.equal(activeText(old), 'beacon');
  assert.equal(activeText(next), 'beacon');
  await layout(ui, 'Unified');
  assert.equal(input.value, 'beacon');
  assert.equal(count.textContent, '3 / 3');
  assert.equal(activeText(body), 'beacon');
  assert.equal(ui.requests.length, 2, 'mode changes reuse loaded revisions and scan state');
});

test('View full file search reveals offscreen matches on both axes in Unified and synchronizes split panes', async t => {
  const wide = '\t'.repeat(80) + 'const farAway = "beacon";';
  const ui = fixture(
    t,
    revision({
      prefix: Array.from({length: 320}, (_, index) => `source ${index}`),
      removed: [wide],
      added: [wide.replace('farAway', 'nextFarAway')],
      suffix: Array.from({length: 40}, (_, index) => `tail ${index}`),
      path: 'source.js',
    }),
  );
  const body = await open(ui);
  assert.equal(
    body.querySelectorAll('.line-text').some(line => line.textContent.includes('beacon')),
    false,
  );
  await controls(ui).toggle.fire('click');
  await search(ui, 'BEACON');
  assert.equal(controls(ui).count.textContent, '1 / 2');
  assert.equal(body.scrollTop, 320 * 22);
  assert.ok(body.scrollLeft > 2000, 'rendered tab expansion places the match well beyond the viewport');
  const mark = body.querySelector('.file-match.active');
  const bounds = body.getBoundingClientRect();
  assert.ok(mark.getBoundingClientRect().left >= bounds.left);
  assert.ok(mark.getBoundingClientRect().right <= bounds.right);
  assert.ok(body.querySelectorAll('.code-row').length < 50, 'reveal retains row virtualization');
  await layout(ui, 'Side-by-side');
  await key(ui, controls(ui).input, 'Enter');
  const old = body.querySelector('[aria-label="Old revision"]');
  const next = body.querySelector('[aria-label="New revision"]');
  assert.equal(activeText(next), 'beacon');
  assert.equal(activeText(old), '');
  assert.equal(old.scrollTop, 320 * 22);
  assert.equal(next.scrollTop, old.scrollTop);
  assert.equal(next.scrollLeft, old.scrollLeft);
  const nextMark = next.querySelector('.file-match.active').getBoundingClientRect();
  const nextBounds = next.getBoundingClientRect();
  assert.ok(nextMark.left >= nextBounds.left);
  assert.ok(nextMark.right <= nextBounds.right);
});

test('View full file search reports empty and missing queries and debounces replacement without stale marks', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  await controls(ui).toggle.fire('click');
  const {input, count, previous, next} = controls(ui);
  input.value = 'old';
  await input.fire('input');
  t.mock.timers.tick(119);
  assert.equal(count.textContent, 'Searching…');
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, true);
  assert.equal(body.querySelectorAll('.file-match').length, 0);
  input.value = 'new';
  await input.fire('input');
  t.mock.timers.tick(1);
  assert.equal(count.textContent, 'Searching…', 'the cancelled first debounce cannot publish');
  await finish(ui, 119);
  assert.equal(count.textContent, '1 / 1');
  assert.equal(activeText(body), 'new');
  await search(ui, 'absent');
  assert.equal(count.textContent, '0 / 0');
  assert.equal(body.querySelectorAll('.file-match').length, 0);
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, true);
  await key(ui, input, 'Enter');
  assert.equal(count.textContent, '0 / 0');
  await search(ui, '');
  assert.equal(count.textContent, '');
  assert.equal(input.getAttribute('aria-busy'), 'false');
});

test('View full file search waits for compositionend before scanning an IME query', async t => {
  const ui = fixture(t);
  await open(ui);
  await controls(ui).toggle.fire('click');
  const {input, count} = controls(ui);
  input.value = 'beacon';
  await input.fire('input', {isComposing: true});
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(count.textContent, 'Searching…');
  assert.equal(input.getAttribute('aria-busy'), 'true');
  await input.fire('compositionend');
  await finish(ui);
  assert.equal(count.textContent, '1 / 3');
  const event = await key(ui, input, 'Enter', {isComposing: true});
  assert.equal(event.defaultPrevented, false);
  assert.equal(count.textContent, '1 / 3');
});

test('View full file search bounds retained matches and reports the 10000+ cap without expanding virtual rows', async t => {
  const ui = fixture(
    t,
    revision({prefix: Array.from({length: 5001}, () => 'a a'), removed: ['old'], added: ['new'], suffix: []}),
  );
  const body = await open(ui);
  await controls(ui).toggle.fire('click');
  await search(ui, 'a');
  const {count, input} = controls(ui);
  assert.equal(count.textContent, '1 / 10000+');
  assert.equal(count.title, 'Only the first 10,000 matches are listed.');
  assert.ok(body.querySelectorAll('.code-row').length < 50);
  assert.ok(body.querySelectorAll('.file-match').length < 100);
  await key(ui, input, 'Enter', {shiftKey: true});
  assert.equal(count.textContent, '10000 / 10000+');
  assert.equal(body.scrollTop, Math.min(4999 * 22, body.scrollHeight - body.clientHeight));
  assert.equal(
    body.querySelector('.file-match.active').closest('.code-row').querySelector('.line-number').textContent,
    '5000',
  );
  await key(ui, input, 'Enter');
  assert.equal(count.textContent, '1 / 10000+');
});

test('View full file search cancels a yielding scan when another query replaces it', async t => {
  const ui = fixture(
    t,
    revision({
      prefix: Array.from({length: 600}, (_, index) => `old ${index}`),
      removed: ['old'],
      added: ['new'],
      suffix: ['replacement needle'],
    }),
  );
  const body = await open(ui);
  await controls(ui).toggle.fire('click');
  const {input, count} = controls(ui);
  input.value = 'old';
  await input.fire('input');
  t.mock.timers.tick(120);
  assert.equal(count.textContent, 'Searching…', 'the scan yields before publishing a partial result');
  input.value = 'needle';
  await input.fire('input');
  await finish(ui);
  assert.equal(count.textContent, '1 / 1');
  assert.equal(activeText(body), 'needle');
  assert.equal(
    body.querySelectorAll('.file-match').every(mark => mark.textContent === 'needle'),
    true,
  );
  await finish(ui, 1000);
  assert.equal(count.textContent, '1 / 1', 'the old scan cannot replace the completed query');
});

test('View full file search cancels debounce and yielding work on close and disposes stale controls', async t => {
  const ui = fixture(
    t,
    revision({prefix: Array.from({length: 600}, () => 'beacon'), removed: ['old'], added: ['new'], suffix: []}),
  );
  const body = await open(ui);
  await controls(ui).toggle.fire('click');
  const stale = controls(ui);
  stale.input.value = 'beacon';
  await stale.input.fire('input');
  await stale.close.fire('click');
  await finish(ui, 1000);
  assert.equal(stale.bar.hidden, true);
  assert.equal(body.querySelectorAll('.file-match').length, 0);
  await stale.toggle.fire('click');
  t.mock.timers.tick(120);
  assert.equal(stale.count.textContent, 'Searching…');
  ui.app.closeViewer();
  await Promise.resolve();
  t.mock.timers.tick(1000);
  await Promise.resolve();
  ui.clock.flush();
  assert.equal(ui.viewer.open, false);
  assert.equal(ui.viewer.querySelector('.viewer-find'), null);
  assert.equal(ui.window.listeners.get('keydown')?.length, 0);
  assert.equal(stale.input.listeners.get('input')?.length, 0);
  const staleCount = stale.count.textContent;
  await stale.next.fire('click');
  await stale.toggle.fire('click');
  assert.equal(stale.count.textContent, staleCount, 'detached icon controls cannot publish or reopen a disposed view');
  assert.equal(ui.viewer.querySelector('.viewer-find'), null);
  assert.equal(ui.clock.pending.size, 0);
  const event = await key(ui, body, 'f', {ctrlKey: true});
  assert.equal(event.defaultPrevented, false);
});
