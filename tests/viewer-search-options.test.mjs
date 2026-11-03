/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Match case, Whole word and diff revision-scope regressions through the production viewer factories.
 * An inline plain-file shell is rendered by the production text renderer beside the actual View full dialog.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fileIconsModule} from '../scripts/file-icons.mjs';
import {root} from '../scripts/build.mjs';
import {source} from './helpers/content.mjs';
import {dom, frames, install} from './helpers/dom.mjs';
import {installDiffViewport} from './helpers/diff-viewport.mjs';
import {installViewerSearchDOM, keyEvent, precedingText} from './helpers/viewer-search.mjs';

const directory = await mkdtemp(join(tmpdir(), 'codetree-viewer-search-options-'));
const modulePath = join(directory, 'content.mjs');
const bundled = await build({
  stdin: {contents: source + "export * from './src/content/viewer/file-content.js';", resolveDir: root},
  bundle: true,
  write: false,
  format: 'esm',
  target: 'chrome140',
  plugins: [
    {
      name: 'fixture-icons',
      setup(builder) {
        builder.onResolve({filter: /^virtual:file-icons$/}, () => ({path: 'icons', namespace: 'fixture'}));
        builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: fileIconsModule(), loader: 'js'}));
      },
    },
  ],
});
await writeFile(modulePath, bundled.outputFiles[0].text);
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

/** Builds an added or removed file whose other revision is empty. */
function oneSided(status, lines) {
  const data = revision();
  const text = lines.join('\n') + '\n';
  data.before = status === 'removed' ? text : '';
  data.after = status === 'added' ? text : '';
  data.node.status = status;
  data.node.patch = '';
  return data;
}

/**
 * Installs the real View full feature and, optionally, an inline plain-file viewer rendered by the
 * production text renderer. Frames and revision replies are controlled by the fixture.
 */
function fixture(t, data = revision(), plain) {
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
    const revisionSource = sha => ({
      provider: 'github',
      origin: 'https://github.com',
      owner: 'sample',
      repo: 'repo',
      sha,
    });
    state.diff = {
      base: revisionSource(baseSHA),
      head: revisionSource(headSHA),
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
    if (plain !== undefined) {
      const element = tag => document.createElement(tag);
      const inline = {actions: element('div'), body: element('div'), bottom: element('div'), owner: getOwner()};
      inline.body.classList.add('viewer-body');
      const main = element('main');
      main.append(inline.actions, inline.body, inline.bottom);
      document.body.append(main);
      app.inline = inline;
      app.inlineReady = content.renderTextFile(app, inline, 'plain.txt', plain, () => true, revisionSource(headSHA));
    }
    return app;
  });
  t.after(app.dispose);
  return {app, data, document, viewer, window, clock, requests, t};
}

/** Opens View full before mocking timers, so syntax-tokenizer yielding uses its normal clock. */
async function open(ui) {
  await ui.app.inlineReady;
  await ui.app.showDiff(ui.data.node);
  const body = ui.viewer.querySelector('.viewer-body');
  assert.ok(body?.querySelector('.code-spacer'), body?.textContent);
  ui.t.mock.timers.enable({apis: ['setTimeout']});
  return body;
}

/** Returns publicly labelled find controls; the baseline must fail on the missing option and scope controls. */
function controls(ui, scope = ui.viewer) {
  const bar = scope.querySelector('.viewer-find');
  assert.ok(bar, 'The viewer exposes file search');
  const labelled = label => bar.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label);
  const revisions = bar
    .querySelectorAll('[role="group"]')
    .find(node => node.getAttribute('aria-label') === 'Search revision');
  return {
    bar,
    input: bar.querySelector('input'),
    count: bar.querySelector('.viewer-find-count'),
    previous: labelled('Previous match'),
    next: labelled('Next match'),
    matchCase: labelled('Match case'),
    wholeWord: labelled('Whole word'),
    options: bar.querySelectorAll('[role="group"]').find(node => node.getAttribute('aria-label') === 'Search options'),
    revisions,
    scopeButton: label => {
      assert.ok(revisions, 'Diff search exposes its revision scope');
      const button = revisions.querySelectorAll('button').find(node => node.textContent === label);
      assert.ok(button, `Search revision exposes ${label}`);
      return button;
    },
    toggle: scope.querySelector('[aria-label="Find in file (Ctrl/Cmd+F)"]'),
  };
}

/** Delivers one window keyboard event and exposes its browser-default cancellation. */
async function key(ui, target, value, modifiers) {
  const event = keyEvent(target, value, modifiers);
  await ui.window.fire('keydown', event);
  return event;
}

/** Advances debounce and bounded asynchronous scan chunks without real-time sleeps. */
async function finish(ui, advance = 120, scope = ui.viewer) {
  ui.t.mock.timers.tick(advance);
  for (let turn = 0; turn < 200; turn++) {
    await Promise.resolve();
    ui.t.mock.timers.tick(0);
    ui.clock.flush();
    if (controls(ui, scope).input.getAttribute('aria-busy') === 'false') return;
  }
  assert.fail('File search finishes its bounded scan');
}

/** Enters a query through the actual input handler and waits for its result count. */
async function search(ui, query, scope = ui.viewer) {
  const {input} = controls(ui, scope);
  input.value = query;
  await input.fire('input');
  await finish(ui, 120, scope);
}

/** Clicks a control as a pointer would (moving focus to it) and lets the scan publish. */
async function press(ui, button, scope = ui.viewer) {
  assert.ok(button, 'The search control exists');
  button.focus();
  await button.fire('click');
  await finish(ui, 0, scope);
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

/** Returns each rendered row's searched text, keyed by its visible source line text. */
function highlighted(root) {
  return root
    .querySelectorAll('.code-row')
    .filter(row => row.querySelector('.file-match'))
    .map(row => row.querySelector('.line-text').textContent);
}

test('Match case and Whole word are labelled pressed toggles that start off and keep focus in the field', async t => {
  const ui = fixture(t, revision({prefix: ['Beacon beacon BEACON beacons'], suffix: []}));
  const body = await open(ui);
  await key(ui, body, 'f', {ctrlKey: true});
  const {input, count, matchCase, wholeWord, options} = controls(ui);
  assert.equal(options?.hidden, false, 'Find shows its option group');
  for (const [control, label, text] of [
    [matchCase, 'Match case', 'Aa'],
    [wholeWord, 'Whole word', 'ab'],
  ]) {
    assert.ok(control, `${label} is exposed`);
    assert.equal(control.tagName, 'BUTTON');
    assert.equal(control.getAttribute('type'), 'button');
    assert.equal(control.textContent, text);
    assert.equal(control.title, label);
    assert.equal(control.getAttribute('aria-pressed'), 'false');
    assert.equal(control.closest('.viewer-find-group'), options, 'Options reuse the segmented toolbar group');
  }
  await search(ui, 'beacon');
  assert.equal(count.textContent, '1 / 6', 'Both start off: case-insensitive substring search as before');
  await press(ui, matchCase);
  assert.equal(matchCase.getAttribute('aria-pressed'), 'true');
  assert.equal(ui.document.activeElement, input);
  assert.equal(input.value, 'beacon');
  assert.equal(count.textContent, '1 / 4');
  await press(ui, wholeWord);
  assert.equal(wholeWord.getAttribute('aria-pressed'), 'true');
  assert.equal(ui.document.activeElement, input);
  assert.equal(count.textContent, '1 / 3');
  assert.equal(activeText(body), 'beacon');
  assert.equal(precedingText(body.querySelector('.line-text'), body.querySelector('.file-match.active')), 'Beacon ');
  await press(ui, matchCase);
  assert.equal(count.textContent, '1 / 5', 'Whole word alone stays case-insensitive');
  assert.equal(ui.requests.length, 2, 'Options rescan loaded rows without refetching');
});

for (const [name, line, query, expected, matchCase = false] of [
  ['ASCII separators and punctuation', 'foo foo.bar (foo) foo-x xfoo', 'foo', ['foo', 'foo', 'foo', 'foo']],
  ['underscore as a word character', 'foo_bar _foo foo', 'foo', ['foo']],
  ['decimal digits, including other scripts', 'foo1 1foo foo٣ foo', 'foo', ['foo']],
  ['digit queries', '123 1234 a123 123', '123', ['123', '123']],
  ['accented letters', 'café cafe cafés caféx', 'café', ['café']],
  ['Cyrillic letters with case folding', 'Привет приветствие привет', 'привет', ['Привет', 'привет']],
  ['Cyrillic letters with Match case', 'Привет приветствие привет', 'привет', ['привет'], true],
  ['CJK letters', '中文字 中文 文中文', '中文', ['中文']],
  ['combining marks', 'é e ae', 'e', ['e']],
  ['astral letters next to the query', '𐐨foo foo𐐨 foo', 'foo', ['foo']],
  ['astral emoji as separators', '😀foo😀 x', 'foo', ['foo']],
  ['queries with non-word edges', 'x(foo) y (foo) (foo', '(foo', ['(foo', '(foo']],
  ['all-punctuation queries', 'a==b a == b', '==', ['==']],
]) {
  test(`Whole word handles ${name}`, async t => {
    const ui = fixture(t, revision({prefix: [line], removed: ['old'], added: ['new'], suffix: []}));
    const body = await open(ui);
    await key(ui, body, 'f', {ctrlKey: true});
    const {count, matchCase: caseToggle, wholeWord} = controls(ui);
    await press(ui, wholeWord);
    if (matchCase) await press(ui, caseToggle);
    await search(ui, query);
    assert.equal(count.textContent, `${expected.length ? 1 : 0} / ${expected.length}`);
    const source = body.querySelector('.line-text');
    assert.equal(source.textContent, line, 'Matching never rewrites source text');
    assert.deepEqual(
      source.querySelectorAll('.file-match').map(mark => mark.textContent),
      expected,
    );
  });
}

test('Whole word highlights keep original UTF-16 offsets after surrogate pairs and across syntax spans', async t => {
  const line = 'const 😀 = "😀value"; const value = 1; // value_x';
  const ui = fixture(t, revision({prefix: [line], removed: ['old'], added: ['new'], suffix: [], path: 'source.js'}));
  const body = await open(ui);
  await key(ui, body, 'f', {ctrlKey: true});
  await press(ui, controls(ui).wholeWord);
  await search(ui, 'value');
  assert.equal(controls(ui).count.textContent, '1 / 2');
  const source = body.querySelector('.line-text');
  const marks = source.querySelectorAll('.file-match');
  assert.deepEqual(
    marks.map(mark => precedingText(source, mark)),
    ['const 😀 = "😀', 'const 😀 = "😀value"; const '],
  );
  assert.ok(source.querySelector('.syntax-string'), 'Syntax spans stay in place');
  assert.equal(source.textContent, line);
  await search(ui, 'value = 1');
  assert.equal(controls(ui).count.textContent, '1 / 1');
  assert.equal(activeText(body), 'value = 1');
});

test('Option toggles cancel pending debounces and yielding scans and never activate an old result', async t => {
  const ui = fixture(
    t,
    revision({
      prefix: Array.from({length: 600}, () => 'Beacon'),
      removed: ['old'],
      added: ['new'],
      suffix: ['beacon here'],
    }),
  );
  const body = await open(ui);
  await key(ui, body, 'f', {ctrlKey: true});
  const {input, count, matchCase, wholeWord} = controls(ui);
  input.value = 'beacon';
  await input.fire('input');
  t.mock.timers.tick(120);
  assert.equal(count.textContent, 'Searching…', 'The case-insensitive scan is yielding');
  matchCase.focus();
  await matchCase.fire('click');
  assert.equal(ui.document.activeElement, input);
  assert.equal(input.value, 'beacon');
  assert.equal(count.textContent, 'Searching…');
  assert.equal(body.querySelectorAll('.file-match').length, 0, 'Old highlights are cleared at once');
  await finish(ui, 0);
  assert.equal(count.textContent, '1 / 1');
  assert.equal(activeText(body), 'beacon');
  await finish(ui, 1000);
  assert.equal(count.textContent, '1 / 1', 'The cancelled scan cannot replace the new result');

  input.value = 'beacon here';
  await input.fire('input');
  t.mock.timers.tick(60);
  await wholeWord.fire('click');
  await finish(ui, 0);
  assert.equal(count.textContent, '1 / 1', 'A toggle scans the latest query without waiting for its debounce');
  await finish(ui, 1000);
  assert.equal(count.textContent, '1 / 1', 'The replaced debounce cannot publish again');
  assert.equal(activeText(body), 'beacon here');
  assert.equal(ui.requests.length, 2);
});

test('Enter immediately after typing flushes the debounce with the latest query and options', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  await key(ui, body, 'f', {ctrlKey: true});
  const {input, count, matchCase} = controls(ui);
  input.value = 'beac';
  await input.fire('input');
  input.value = 'beacon';
  await input.fire('input');
  const enter = await key(ui, input, 'Enter');
  assert.equal(enter.defaultPrevented, true);
  await finish(ui, 0);
  assert.equal(count.textContent, '1 / 3', 'Enter publishes the first match without waiting 120 ms');
  assert.equal(activeText(body), 'beacon');
  await finish(ui, 1000);
  assert.equal(count.textContent, '1 / 3', 'The flushed debounce does not scan again');

  await press(ui, matchCase);
  input.value = 'BEACON';
  await input.fire('input');
  await key(ui, input, 'Enter');
  await finish(ui, 0);
  assert.equal(count.textContent, '0 / 0', 'Enter uses the current Match case option');

  await press(ui, matchCase);
  input.value = 'beacon';
  await input.fire('input');
  await key(ui, input, 'Enter', {shiftKey: true});
  await finish(ui, 0);
  assert.equal(count.textContent, '3 / 3', 'Shift+Enter selects the match before the viewport');
  await key(ui, input, 'Enter');
  assert.equal(count.textContent, '1 / 3', 'Enter steps normally once results are published');
});

test('Shift+Enter during a yielding scan selects the published previous result instead of a stale one', async t => {
  const ui = fixture(
    t,
    revision({prefix: Array(600).fill('filler'), removed: ['old'], added: ['new'], suffix: ['needle', 'needle']}),
  );
  const body = await open(ui);
  await key(ui, body, 'f', {ctrlKey: true});
  const {input, count} = controls(ui);
  input.value = 'needle';
  await input.fire('input');
  t.mock.timers.tick(120);
  assert.equal(count.textContent, 'Searching…');
  const event = await key(ui, input, 'Enter', {shiftKey: true});
  assert.equal(event.defaultPrevented, true);
  await finish(ui, 0);
  assert.equal(count.textContent, '2 / 2', 'The pending direction applies to the published matches');
  assert.equal(activeText(body), 'needle');
  await key(ui, input, 'Enter');
  assert.equal(count.textContent, '1 / 2');
});

test('Diff revision scope counts New, Old and shared context once and paints only eligible rows', async t => {
  const ui = fixture(t);
  const body = await open(ui);
  await key(ui, body, 'f', {ctrlKey: true});
  const {input, count, revisions, scopeButton, previous, next} = controls(ui);
  assert.equal(revisions?.hidden, false);
  assert.equal(revisions.classList.contains('viewer-find-group'), true);
  assert.deepEqual(
    revisions.querySelectorAll('button').map(button => [button.textContent, button.getAttribute('aria-pressed')]),
    [
      ['Both', 'true'],
      ['New', 'false'],
      ['Old', 'false'],
    ],
  );
  await search(ui, 'beacon');
  assert.equal(count.textContent, '1 / 3');
  await press(ui, scopeButton('New'));
  assert.equal(scopeButton('New').getAttribute('aria-pressed'), 'true');
  assert.equal(scopeButton('Both').getAttribute('aria-pressed'), 'false');
  assert.equal(ui.document.activeElement, input);
  assert.equal(input.value, 'beacon');
  assert.equal(count.textContent, '1 / 2');
  assert.deepEqual(highlighted(body), ['new beacon', 'shared beacon']);
  for (const expected of ['2 / 2', '1 / 2']) {
    await next.fire('click');
    assert.equal(count.textContent, expected);
  }
  await press(ui, scopeButton('Old'));
  assert.equal(count.textContent, '1 / 2');
  assert.deepEqual(highlighted(body), ['old beacon', 'shared beacon']);
  await previous.fire('click');
  assert.equal(count.textContent, '2 / 2');
  assert.equal(activeText(body), 'beacon');
  assert.match(body.querySelector('.file-match.active').closest('.code-row').textContent, /shared beacon/);
  await layout(ui, 'Side-by-side');
  const oldPane = body.querySelector('[aria-label="Old revision"]');
  const newPane = body.querySelector('[aria-label="New revision"]');
  assert.deepEqual(highlighted(oldPane), ['old beacon', 'shared beacon']);
  assert.deepEqual(highlighted(newPane), ['shared beacon'], 'Shared context is painted in both panes, counted once');
  await layout(ui, 'Unified');
  await press(ui, scopeButton('Both'));
  assert.equal(count.textContent, '1 / 3');
  assert.equal(ui.requests.length, 2, 'Scope changes never refetch source');
});

test('Diff revision scope combines with Match case and Whole word', async t => {
  const ui = fixture(
    t,
    revision({prefix: ['Token tokens'], removed: ['token Token'], added: ['TOKEN token_x token'], suffix: ['token']}),
  );
  const body = await open(ui);
  await key(ui, body, 'f', {ctrlKey: true});
  const {count, matchCase, wholeWord, scopeButton} = controls(ui);
  await search(ui, 'token');
  assert.equal(count.textContent, '1 / 8');
  await press(ui, scopeButton('New'));
  assert.equal(count.textContent, '1 / 6');
  await press(ui, wholeWord);
  assert.equal(count.textContent, '1 / 4');
  await press(ui, matchCase);
  assert.equal(count.textContent, '1 / 2');
  await press(ui, scopeButton('Old'));
  assert.equal(count.textContent, '1 / 2');
  assert.deepEqual(highlighted(body), ['token Token', 'token']);
  await press(ui, scopeButton('Both'));
  assert.equal(count.textContent, '1 / 3');
  assert.equal(ui.requests.length, 2);
});

for (const [status, empty, populated, pane] of [
  ['added', 'Old', 'New', 'New revision'],
  ['removed', 'New', 'Old', 'Old revision'],
]) {
  test(`Diff revision scope reports an empty ${empty} revision for a file with status ${status} and reveals its other side`, async t => {
    const ui = fixture(t, oneSided(status, ['first', 'beacon one', 'beacon two']));
    const body = await open(ui);
    await key(ui, body, 'f', {ctrlKey: true});
    const {count, scopeButton, previous, next, input} = controls(ui);
    await search(ui, 'beacon');
    assert.equal(count.textContent, '1 / 2');
    await press(ui, scopeButton(empty));
    assert.equal(count.textContent, `${empty} revision is empty`);
    assert.equal(input.getAttribute('aria-busy'), 'false');
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, true);
    assert.equal(body.querySelectorAll('.file-match').length, 0);
    await key(ui, input, 'Enter');
    assert.equal(count.textContent, `${empty} revision is empty`);
    await press(ui, scopeButton(populated));
    assert.equal(count.textContent, '1 / 2');
    await layout(ui, 'Side-by-side');
    await key(ui, input, 'Enter');
    const target = body.querySelector(`[aria-label="${pane}"]`);
    assert.equal(count.textContent, '2 / 2');
    assert.equal(activeText(target), 'beacon');
    assert.match(target.querySelector('.file-match.active').closest('.code-row').textContent, /beacon two/);
    assert.equal(ui.requests.length, 1, 'Only the existing revision is fetched, once');
  });
}

for (const display of ['Unified', 'Side-by-side']) {
  test(`Diff revision scope reveals unequal replacements in the correct ${display} pane`, async t => {
    const ui = fixture(
      t,
      revision({
        prefix: Array.from({length: 320}, (_, index) => `context ${index}`),
        removed: ['old target'],
        added: ['alpha', 'beta', 'new target'],
        suffix: Array.from({length: 40}, (_, index) => `tail ${index}`),
      }),
    );
    const body = await open(ui);
    await layout(ui, display);
    await key(ui, body, 'f', {ctrlKey: true});
    const {count, scopeButton} = controls(ui);
    const panes = () =>
      display === 'Unified'
        ? {old: body, new: body, all: [body]}
        : {
            old: body.querySelector('[aria-label="Old revision"]'),
            new: body.querySelector('[aria-label="New revision"]'),
            all: body.querySelectorAll('.split-diff-pane'),
          };
    await press(ui, scopeButton('New'));
    await search(ui, 'target');
    assert.equal(count.textContent, '1 / 1');
    assert.equal(activeText(panes().new), 'target');
    assert.match(panes().new.querySelector('.file-match.active').closest('.code-row').textContent, /new target/);
    for (const pane of panes().all) assert.equal(pane.scrollTop, (display === 'Unified' ? 323 : 322) * 22);
    if (display !== 'Unified') assert.equal(panes().old.querySelectorAll('.file-match').length, 0);
    await press(ui, scopeButton('Old'));
    assert.equal(count.textContent, '1 / 1');
    assert.equal(activeText(panes().old), 'target');
    assert.match(panes().old.querySelector('.file-match.active').closest('.code-row').textContent, /old target/);
    for (const pane of panes().all) assert.equal(pane.scrollTop, 320 * 22);
    if (display !== 'Unified') assert.equal(panes().new.querySelectorAll('.file-match').length, 0);
    assert.equal(ui.requests.length, 2);
  });
}

test('Line mode hides search options and revision scope and keeps its own line revision group', async t => {
  const ui = fixture(t, revision({prefix: ['// literal :223'], suffix: ['// literal :223']}));
  const body = await open(ui);
  await key(ui, body, 'f', {ctrlKey: true});
  const {bar, input, count, options, revisions, matchCase, scopeButton} = controls(ui);
  await press(ui, matchCase);
  await press(ui, scopeButton('New'));
  await search(ui, ':223');
  assert.equal(count.textContent, '1 / 2', 'A colon query stays literal with options and scope');
  await key(ui, input, 'g', {ctrlKey: true});
  assert.equal(bar.getAttribute('aria-label'), 'Go to line');
  assert.equal(options.hidden, true);
  assert.equal(revisions.hidden, true);
  const lineRevisions = bar.querySelector('[aria-label="Line revision"]');
  assert.equal(lineRevisions.hidden, false);
  assert.notEqual(lineRevisions, revisions);
  input.value = ':2';
  await input.fire('input');
  await key(ui, input, 'Enter');
  ui.clock.flush();
  assert.equal(bar.hidden, true, 'Line mode still submits its source line');
  await key(ui, body, 'f', {ctrlKey: true});
  await finish(ui);
  assert.equal(input.value, ':223');
  assert.equal(options.hidden, false);
  assert.equal(revisions.hidden, false);
  assert.equal(matchCase.getAttribute('aria-pressed'), 'true', 'Options persist for this viewer instance');
  assert.equal(scopeButton('New').getAttribute('aria-pressed'), 'true');
  assert.equal(count.textContent, '1 / 2');
});

test('Inline plain-file search has no revision scope and keeps options independent from View full', async t => {
  const ui = fixture(t, revision(), 'Beacon\nbeacon\nbeacon_x\n');
  const body = await open(ui);
  const inline = controls(ui, ui.app.inline.actions);
  assert.equal(inline.revisions, undefined, 'Plain repository files show no scope control');
  assert.ok(inline.matchCase && inline.wholeWord);
  await inline.toggle.fire('click');
  await search(ui, 'beacon', ui.app.inline.actions);
  assert.equal(inline.count.textContent, '1 / 3');
  await press(ui, inline.matchCase, ui.app.inline.actions);
  assert.equal(inline.count.textContent, '1 / 2');
  assert.equal(ui.document.activeElement, inline.input);

  await key(ui, body, 'f', {metaKey: true});
  const full = controls(ui);
  assert.equal(full.matchCase.getAttribute('aria-pressed'), 'false', 'View full starts with its own options');
  await search(ui, 'BEACON');
  assert.equal(full.count.textContent, '1 / 3');
  await press(ui, full.wholeWord);
  await press(ui, full.scopeButton('Old'));
  assert.equal(full.count.textContent, '1 / 2');
  assert.equal(inline.wholeWord.getAttribute('aria-pressed'), 'false');
  assert.equal(inline.matchCase.getAttribute('aria-pressed'), 'true');
  assert.equal(inline.count.textContent, '1 / 2', 'The modal does not rescan inline results');
  ui.app.closeViewer();
  await Promise.resolve();
  await press(ui, inline.wholeWord, ui.app.inline.actions);
  assert.equal(inline.count.textContent, '1 / 1');
  assert.equal(full.wholeWord.listeners.get('click').length, 0, 'Closed View full disposes its option listeners');
  assert.equal(ui.requests.length, 2);
});
