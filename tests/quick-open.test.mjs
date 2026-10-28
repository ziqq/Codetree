/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Quick Open matching and owned palette regressions through the production factory.
 * Native events, timers and navigation replies are controlled; browser layout is not simulated.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bundle} from './helpers/content.mjs';
import {dom, frames, install} from './helpers/dom.mjs';
import {installViewerSearchDOM, keyEvent} from './helpers/viewer-search.mjs';

const modulePath = new URL('../src/shared/quick-open.js', import.meta.url);
const matching = existsSync(modulePath) ? await import(modulePath) : {};
const directory = await mkdtemp(join(tmpdir(), 'codetree-quick-open-'));
const bundled = join(directory, 'content.mjs');
await writeFile(
  bundled,
  await bundle({quickOpen: existsSync(new URL('../src/content/quick-open.js', import.meta.url))}),
);
const content = await import(pathToFileURL(bundled));
await rm(directory, {recursive: true, force: true});
const {batch, createRoot, createState, getOwner, untrackActions, withOwner} = content;
const mainSHA = 'a'.repeat(40),
  baseSHA = 'b'.repeat(40),
  headSHA = 'c'.repeat(40);

/** A native navigation whose completion can outlive query changes, refresh or palette replacement. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return {promise, resolve, reject};
}

/** Composes the real palette and optional underlying viewer around observable navigation effects. */
function fixture(t, paths = ['src/main.js', 'src/other.js'], provider = 'github') {
  const {document, window} = dom();
  installViewerSearchDOM(document);
  const create = document.createElement.bind(document);
  document.createElement = tag => {
    const node = create(tag);
    if (tag === 'dialog') {
      node.showModal = () => {
        node.open = true;
      };
      node.close = () => {
        node.open = false;
        queueMicrotask(() => void node.fire('close'));
      };
    }
    return node;
  };
  const clock = frames();
  install(t, {
    document,
    window,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow();
  const viewer = document.createElement('dialog');
  shadow.append(viewer);
  const native = [],
    inline = [],
    opened = [],
    rpcCalls = [];
  let reply;
  window.open = (...args) => opened.push(args);
  const app = createRoot(dispose => {
    const state = createState();
    Object.assign(state, {
      epoch: 1,
      filesGeneration: 1,
      context: {provider, origin: `https://${provider}.example.com`, owner: 'team', repo: 'repo', kind: 'repo'},
      info: {ref: 'main', commitSHA: mainSHA, account: 'reviewer'},
      entries: paths.map(path => ({path, type: 'blob'})),
      public: {selectedAccounts: {}, bookmarks: [], accounts: []},
    });
    const app = {
      owner: getOwner(),
      state,
      dispose,
      view: {shadow, viewer},
      run: callback => withOwner(callback),
      focusCount: 0,
      focusFileTab() {
        this.focusCount++;
        document.body.focus();
      },
      async openFileTab(value) {
        inline.push(value);
        return reply?.(value);
      },
      async openFile(node, newTab) {
        native.push({path: node.path, newTab});
      },
      async rpc(type, message) {
        rpcCalls.push({type, message});
        assert.equal(type, 'FILE');
        return 'first\nold\ntail\n';
      },
      diffURL: async () => `${state.context.origin}/native/diff`,
    };
    Object.assign(app, untrackActions(content.createViewer(app)));
    if (content.createQuickOpen) Object.assign(app, untrackActions(content.createQuickOpen(app)));
    return app;
  });
  t.after(app.dispose);
  t.mock.timers.enable({apis: ['setTimeout']});
  return {
    app,
    state: app.state,
    document,
    window,
    shadow,
    viewer,
    clock,
    native,
    inline,
    opened,
    rpcCalls,
    t,
    setReply(value) {
      reply = value;
    },
  };
}

/** Requires the visible capability so the pre-feature archive fails an assertion, not an import. */
function controls(ui) {
  const dialog = ui.shadow.querySelector('.quick-open');
  assert.ok(dialog, 'Repository pages expose the Quick Open palette.');
  return {
    dialog,
    input: dialog.querySelector('input'),
    results: dialog.querySelector('.quick-open-results'),
    status: dialog.querySelector('[role="status"]'),
    notice: dialog.querySelector('.quick-open-notice'),
    close: dialog.querySelector('[aria-label="Close Quick Open"]'),
  };
}

/** Delivers a trusted keyboard event to the actual capture handler and exposes native cancellation. */
async function key(ui, target, name, modifiers = {}) {
  const event = keyEvent(target, name, {isTrusted: true, ...modifiers});
  await ui.window.fire('keydown', event);
  return event;
}

/** Flushes debounce/yield timers and navigation promise continuations without wall-clock sleeps. */
async function drain(ui, milliseconds = 80) {
  ui.t.mock.timers.tick(milliseconds);
  for (let index = 0; index < 40; index++) {
    await Promise.resolve();
    ui.t.mock.timers.tick(0);
    ui.clock.flush();
  }
}

/** Opens via the public shortcut, leaving focus on the real combobox. */
async function open(ui, modifiers = {ctrlKey: true}) {
  ui.document.body.focus();
  const view = controls(ui);
  const event = await key(ui, ui.document.body, 'p', modifiers);
  assert.equal(event.defaultPrevented, true);
  assert.equal(view.dialog.open, true);
  assert.equal(ui.document.activeElement, view.input);
  return view;
}

/** Changes text through its actual input handler, optionally retaining an outstanding debounce. */
async function query(ui, text, finish = true) {
  const view = controls(ui);
  view.input.value = text;
  await view.input.fire('input');
  if (finish) await drain(ui);
  return view;
}

/** Reads result paths in their visible order. */
function paths(ui) {
  return controls(ui)
    .results.querySelectorAll('.quick-open-result')
    .map(node => node.getAttribute('aria-label'));
}

/** Clicks a result through the palette's delegated list handler. */
async function click(ui, index = 0, modifiers = {}) {
  const view = controls(ui);
  const result = view.results.querySelectorAll('.quick-open-result')[index];
  assert.ok(result, `Expected result ${index}`);
  await view.results.fire('click', {target: result, ...modifiers});
  await drain(ui, 0);
}

/** Requires shared parsing/ranking only after checking the old feature boundary explicitly. */
function helpers() {
  assert.equal(typeof matching.parseQuickOpenQuery, 'function', 'Quick Open query parsing and ranking are available.');
  return matching;
}

test('Quick Open parser distinguishes literal colons, source suffixes and invalid/bare line requests', () => {
  const {parseQuickOpenQuery: parse} = helpers();
  assert.deepEqual(parse(' src/main.js:223 '), {query: 'src/main.js', line: 223});
  for (const text of ['api:client.js', 'name:word', 'literal:']) assert.deepEqual(parse(text), {query: text});
  for (const text of [':223', ':0', ':1.5']) assert.match(parse(text).error, /Ctrl\/Cmd\+G/);
  for (const text of ['main:0', 'main:-1', 'main:1.5', 'main:1e2', 'main:100001'])
    assert.match(parse(text).error, /1 to 100000/);
  assert.deepEqual(parse('src/x:100000'), {query: 'src/x', line: 100000});
});

test('Quick Open ranking prefers exact filename/path and prefixes over sparse matches with deterministic ties', () => {
  const {quickOpenScore, compareQuickOpenMatches} = helpers();
  const source = ['src/m_a_i_n.js', 'other/domain.js', 'a/main.js', 'src/main.js', 'main.js', 'src/main.jsx'];
  const rank = values =>
    values
      .map(path => ({path, score: quickOpenScore(path, 'main.js')}))
      .filter(node => node.score)
      .sort(compareQuickOpenMatches)
      .map(node => node.path);
  assert.deepEqual(rank(source), [
    'main.js',
    'a/main.js',
    'src/main.js',
    'src/main.jsx',
    'other/domain.js',
    'src/m_a_i_n.js',
  ]);
  assert.deepEqual(rank([...source].reverse()), rank(source));
  assert.equal(quickOpenScore('src/main.js', 'absent'), null);
  assert.ok(quickOpenScore('src/main.js', 'src/mn'));
  assert.equal(quickOpenScore('other/main.js', 'src/mn'), null, 'Path subsequences must retain every query character.');
  assert.deepEqual(quickOpenScore('SRC/Main.JS', 'main.js'), quickOpenScore('src/main.js', 'MAIN.JS'));
});

test('Quick Open searches loaded blobs independently of tree filters, deduplicates and caps visible results at 50', async t => {
  const ui = fixture(
    t,
    Array.from({length: 70}, (_, index) => `src/file${String(index).padStart(2, '0')}.js`),
  );
  const original = [...ui.state.entries];
  batch(() => {
    ui.state.entries = [
      ...original.reverse().map(node => ({...node, viewed: true})),
      original[0],
      {path: 'src/folder', type: 'tree'},
      {path: 'src/submodule', type: 'commit'},
    ];
    ui.state.lazy = true;
    ui.state.mode = 'changes';
    ui.state.diff = {viewedMode: 'local'};
    ui.state.flat = [];
    ui.state.query = 'not this palette';
    ui.state.unviewedOnly = true;
  });
  const sidebarQuery = ui.state.query;
  await open(ui);
  const view = await query(ui, 'file');
  assert.equal(paths(ui).length, 50);
  assert.equal(paths(ui)[0], 'src/file00.js');
  assert.equal(paths(ui).at(-1), 'src/file49.js');
  assert.equal(view.status.textContent, '70 matches · first 50 shown');
  assert.equal(view.notice.hidden, false);
  assert.match(view.notice.textContent, /loaded files only/);
  assert.equal(ui.state.query, sidebarQuery);
  assert.equal(ui.state.unviewedOnly, true);
  assert.deepEqual(ui.state.flat, [], 'Quick Open does not repurpose the filtered/expanded tree viewport.');
  assert.deepEqual(ui.rpcCalls, []);
  await query(ui, 'submodule');
  assert.deepEqual(paths(ui), []);
});

test('Quick Open retains only 20 recent loaded paths in memory and does not reset them on preferences', async t => {
  const ui = fixture(
    t,
    Array.from({length: 26}, (_, index) => `file${index}.js`),
  );
  const view = await open(ui);
  for (let index = 0; index < 26; index++) ui.app.rememberQuickOpenFile(`file${index}.js`);
  ui.app.rememberQuickOpenFile('not-loaded.js');
  ui.app.rememberQuickOpenFile('file22.js');
  await drain(ui, 0);
  assert.equal(paths(ui).length, 20);
  assert.equal(paths(ui)[0], 'file22.js');
  assert.equal(new Set(paths(ui)).size, 20);
  assert.equal(paths(ui).includes('file5.js'), false);
  assert.equal(view.status.textContent, '20 recent files');
  ui.state.preferences = {...ui.state.preferences, fontSize: 18};
  assert.equal(view.dialog.open, true);
  assert.equal(paths(ui)[0], 'file22.js');
  assert.deepEqual(ui.rpcCalls, []);
  ui.state.entries = ui.state.entries.filter(node => node.path !== 'file22.js');
  await drain(ui, 0);
  assert.equal(paths(ui).length, 19);
  assert.equal(paths(ui).includes('file22.js'), false, 'Recent paths absent from the loaded revision are excluded.');
});

for (const scope of ['account selection', 'resolved account', 'mode', 'route']) {
  test(`Quick Open drops query and recents on ${scope} changes`, async t => {
    const ui = fixture(t);
    const view = await open(ui);
    ui.app.rememberQuickOpenFile('src/main.js');
    await query(ui, 'main');
    if (scope === 'account selection')
      ui.state.public = {...ui.state.public, selectedAccounts: {[ui.state.context.origin]: 'different'}};
    else if (scope === 'resolved account') ui.state.info = {...ui.state.info, account: 'different'};
    else if (scope === 'mode') ui.state.mode = 'changes';
    else ui.state.context = {...ui.state.context, kind: 'pull', number: 99};
    assert.equal(view.dialog.open, false);
    assert.equal(view.input.value, '');
    await open(ui);
    assert.deepEqual(paths(ui), []);
    assert.equal(view.status.textContent, '0 recent files');
  });
}

test('Quick Open accepts trusted Ctrl/Cmd+P while preserving native editor and composition chords', async t => {
  const ui = fixture(t);
  const view = controls(ui);
  for (const tag of ['input', 'textarea', 'select', 'div']) {
    const node = ui.document.createElement(tag);
    if (tag === 'div') node.isContentEditable = true;
    ui.document.body.append(node);
    node.focus();
    const event = await key(ui, node, 'p', {metaKey: true});
    assert.equal(event.defaultPrevented, false);
    assert.equal(Boolean(view.dialog.open), false);
  }
  ui.document.body.focus();
  for (const modifiers of [
    {ctrlKey: true, isTrusted: false},
    {ctrlKey: true, repeat: true},
    {ctrlKey: true, isComposing: true},
    {ctrlKey: true, altGraph: true},
    {ctrlKey: true, metaKey: true},
    {ctrlKey: true, shiftKey: true},
    {ctrlKey: true, altKey: true},
    {},
  ]) {
    const event = await key(ui, ui.document.body, 'p', modifiers);
    assert.equal(event.propagationStopped, false);
    assert.equal(Boolean(view.dialog.open), false);
  }
  await open(ui);
  await key(ui, view.input, 'Escape');
  await open(ui, {metaKey: true});
  assert.equal(view.input.getAttribute('aria-expanded'), 'true');
});

test('Quick Open immediate Enter awaits its current query and cancels a yielding old scan', async t => {
  const ui = fixture(t, [...Array.from({length: 600}, (_, index) => `src/alpha${index}.js`), 'src/final-target.js']);
  const view = await open(ui);
  await query(ui, 'alpha', false);
  t.mock.timers.tick(80);
  assert.equal(view.input.getAttribute('aria-busy'), 'true');
  await query(ui, 'final-target:223', false);
  await key(ui, view.input, 'Enter');
  await drain(ui, 0);
  assert.deepEqual(ui.inline, [{path: 'src/final-target.js', line: 223}]);
  assert.equal(view.dialog.open, false);
  assert.equal(ui.app.focusCount, 1);
});

test('Quick Open Close Enter stays native and Escape restores focus without opening a result', async t => {
  const ui = fixture(t);
  const view = await open(ui);
  await query(ui, 'main');
  view.close.focus();
  const enter = await key(ui, view.close, 'Enter');
  assert.equal(enter.defaultPrevented, false);
  await view.close.fire('click');
  await drain(ui, 0);
  assert.equal(view.dialog.open, false);
  assert.deepEqual(ui.inline, []);
  await open(ui);
  await key(ui, view.input, 'Escape');
  assert.equal(view.dialog.open, false);
  assert.equal(ui.document.activeElement, ui.document.body);
});

test('Quick Open Enter, navigation keys and combobox selection choose the visible active result', async t => {
  const ui = fixture(t, ['src/a.js', 'src/b.js', 'src/c.js']);
  const view = await open(ui);
  await query(ui, '.js');
  await key(ui, view.input, 'ArrowDown');
  assert.equal(view.input.getAttribute('aria-activedescendant'), 'codetree-quick-open-result-1');
  await key(ui, view.input, 'End');
  await key(ui, view.input, 'ArrowUp');
  assert.equal(view.results.querySelectorAll('.quick-open-result')[1].getAttribute('aria-selected'), 'true');
  await key(ui, view.input, 'Enter');
  await drain(ui, 0);
  assert.deepEqual(ui.inline, [{path: 'src/b.js'}]);
});

for (const provider of ['github', 'gitlab']) {
  test(`Quick Open ${provider} modified source-line clicks use exact fork, rename and deleted-file revisions`, async t => {
    const ui = fixture(t, ['src/new name.js', 'src/deleted.js'], provider);
    const base =
      provider === 'github'
        ? {owner: 'target', repo: 'repo', sha: baseSHA}
        : {project: 10, projectPath: 'target/nested/repo', sha: baseSHA};
    const head =
      provider === 'github'
        ? {owner: 'fork', repo: 'source', sha: headSHA}
        : {project: 20, projectPath: 'fork/nested/source', sha: headSHA};
    ui.state.mode = 'changes';
    ui.state.diff = {
      base,
      head,
      files: [
        {filename: 'src/new name.js', previous_filename: 'src/old name.js', status: 'renamed'},
        {filename: 'src/deleted.js', previous_filename: 'src/older.js', status: 'removed'},
      ],
    };
    const view = await open(ui);
    await query(ui, 'new name:9');
    await click(ui, 0, {ctrlKey: true});
    const headPath = provider === 'github' ? 'fork/source' : 'fork/nested/source/-';
    assert.deepEqual(ui.opened[0], [
      `https://${provider}.example.com/${headPath}/blob/${headSHA}/src/new%20name.js#L9`,
      '_blank',
      'noopener',
    ]);
    await query(ui, 'deleted:12');
    await click(ui, 0, {metaKey: true});
    const basePath = provider === 'github' ? 'target/repo' : 'target/nested/repo/-';
    assert.equal(ui.opened[1][0], `https://${provider}.example.com/${basePath}/blob/${baseSHA}/src/older.js#L12`);
    assert.equal(view.dialog.open, true);
    assert.deepEqual(ui.inline, []);
  });
}

test('Quick Open modified clicks without a line use native navigation; unavailable fork links stay actionable errors', async t => {
  const ui = fixture(t, ['src/main.js'], 'gitlab');
  const view = await open(ui);
  await query(ui, 'main');
  await click(ui, 0, {ctrlKey: true});
  assert.deepEqual(ui.native, [{path: 'src/main.js', newTab: true}]);
  ui.state.mode = 'changes';
  ui.state.diff = {
    base: {project: 10, sha: baseSHA},
    head: {project: 20, sha: headSHA},
    files: [{filename: 'src/main.js', status: 'modified'}],
  };
  await open(ui);
  await query(ui, 'main:3');
  await click(ui, 0, {metaKey: true});
  assert.equal(view.dialog.open, true);
  assert.match(view.status.textContent, /exact source revision is unavailable/);
  assert.deepEqual(ui.opened, []);
});

test('Quick Open pending refresh and reopen cannot let old navigation close a new palette or lock its results', async t => {
  const ui = fixture(t);
  const view = await open(ui);
  const first = deferred();
  const second = deferred();
  t.after(() => {
    first.resolve();
    second.resolve();
  });
  ui.setReply(() => first.promise);
  await query(ui, 'main');
  await click(ui);
  assert.equal(view.input.getAttribute('aria-busy'), 'true');
  ui.state.filesGeneration++;
  first.resolve();
  await drain(ui, 0);
  assert.equal(view.dialog.open, true);
  assert.equal(view.input.getAttribute('aria-busy'), 'false');
  ui.setReply(() => second.promise);
  await click(ui);
  await key(ui, view.input, 'Escape');
  await open(ui);
  await query(ui, 'other');
  second.resolve();
  await drain(ui, 0);
  assert.equal(view.dialog.open, true);
  assert.deepEqual(paths(ui), ['src/other.js']);
  assert.equal(ui.app.focusCount, 0);
});

test('Quick Open navigation failure remains visible during list refresh and can be retried', async t => {
  const ui = fixture(t);
  const view = await open(ui);
  ui.setReply(async () => {
    throw new Error('Metadata save failed');
  });
  await query(ui, 'main');
  await click(ui);
  assert.equal(view.status.textContent, 'Metadata save failed');
  ui.state.entries = [...ui.state.entries];
  await drain(ui, 0);
  assert.equal(view.status.textContent, 'Metadata save failed');
  assert.equal(view.input.getAttribute('aria-busy'), 'false');
  ui.setReply(undefined);
  await click(ui);
  assert.equal(view.dialog.open, false);
  assert.equal(ui.inline.length, 2);
});

test('Quick Open continued typing cancels an Enter intent waiting for a yielding scan', async t => {
  const ui = fixture(t, [...Array.from({length: 600}, (_, index) => `alpha${index}.js`), 'beta.js']);
  const view = await open(ui);
  await query(ui, 'alpha', false);
  await key(ui, view.input, 'Enter');
  assert.equal(view.input.getAttribute('aria-busy'), 'true');
  await query(ui, 'beta', false);
  await drain(ui);
  assert.deepEqual(ui.inline, [], 'Typing a replacement query cannot fulfill the old Enter intent.');
  assert.deepEqual(paths(ui), ['beta.js']);
  await key(ui, view.input, 'Enter');
  await drain(ui, 0);
  assert.deepEqual(ui.inline, [{path: 'beta.js'}]);
});

test('Quick Open composing input cannot publish or activate results until compositionend', async t => {
  const ui = fixture(t);
  const view = await open(ui);
  await query(ui, 'main');
  view.input.value = 'other';
  await view.input.fire('input', {isComposing: true});
  await drain(ui);
  assert.deepEqual(paths(ui), []);
  assert.equal(view.status.textContent, 'Composing query…');
  const composing = await key(ui, view.input, 'Enter', {isComposing: true});
  assert.equal(composing.defaultPrevented, false);
  assert.deepEqual(ui.inline, []);
  await view.input.fire('compositionend');
  await drain(ui);
  assert.deepEqual(paths(ui), ['src/other.js']);
});

test('Quick Open validates line requests without navigation and preserves colon-bearing filenames', async t => {
  const ui = fixture(t, ['src/api:client.js']);
  const view = await open(ui);
  for (const text of [':223', 'client:0', 'client:-2', 'client:1.5', 'client:100001']) {
    await query(ui, text);
    assert.equal(view.status.classList.contains('error'), true);
    await key(ui, view.input, 'Enter');
    await drain(ui, 0);
    assert.deepEqual(ui.inline, []);
    assert.equal(view.dialog.open, true);
  }
  await query(ui, 'src/api:client.js');
  assert.deepEqual(paths(ui), ['src/api:client.js']);
  await click(ui, 0, {metaKey: true});
  assert.deepEqual(ui.native, [{path: 'src/api:client.js', newTab: true}]);
  await query(ui, 'src/api:client.js:17');
  await key(ui, view.input, 'Enter');
  await drain(ui, 0);
  assert.deepEqual(ui.inline, [{path: 'src/api:client.js', line: 17}]);
});

test('Quick Open takes shortcut and Escape priority over the actual View full viewer', async t => {
  const ui = fixture(t);
  const node = {path: 'src/main.js', type: 'blob', status: 'modified', adds: 0, dels: 0, patch: ''};
  ui.state.diff = {
    base: {owner: 'team', repo: 'repo', sha: baseSHA},
    head: {owner: 'team', repo: 'repo', sha: headSHA},
    files: [{...node, filename: node.path, additions: 0, deletions: 0}],
  };
  await ui.app.showDiff(node);
  const body = ui.viewer.querySelector('.viewer-body');
  assert.ok(body.querySelector('.code-spacer'));
  body.focus();
  const event = await key(ui, body, 'p', {metaKey: true});
  const view = controls(ui);
  assert.equal(event.defaultPrevented, true);
  assert.equal(ui.viewer.open, true);
  assert.equal(view.dialog.open, true);
  await query(ui, 'main');
  await key(ui, view.input, 'Escape');
  assert.equal(view.dialog.open, false);
  assert.equal(ui.viewer.open, true);
  assert.equal(ui.document.activeElement, body);
  await key(ui, body, 'p', {ctrlKey: true});
  await key(ui, view.input, 'Enter');
  await drain(ui, 0);
  assert.deepEqual(ui.inline, [{path: 'src/main.js'}]);
  assert.equal(view.dialog.open, false);
  assert.equal(ui.viewer.open, false);
});

test('Quick Open disposal cancels yielding scans and releases detached input/list/shortcut handlers', async t => {
  const ui = fixture(
    t,
    Array.from({length: 600}, (_, index) => `alpha${index}.js`),
  );
  const view = await open(ui);
  await query(ui, 'alpha', false);
  t.mock.timers.tick(80);
  assert.equal(view.input.getAttribute('aria-busy'), 'true');
  ui.app.dispose();
  const before = view.status.textContent;
  await drain(ui, 0);
  assert.equal(view.dialog.isConnected, false);
  assert.equal(view.status.textContent, before);
  assert.equal(ui.window.listeners.get('keydown').length, 0);
  assert.equal(view.input.listeners.get('input').length, 0);
  assert.equal(view.results.listeners.get('click').length, 0);
  assert.equal((await key(ui, ui.document.body, 'p', {ctrlKey: true})).defaultPrevented, false);
  assert.deepEqual(ui.inline, []);
});

test('Quick Open recents and query do not survive replacement of their owned factory', async t => {
  const ui = fixture(t);
  const first = await open(ui);
  ui.app.rememberQuickOpenFile('src/main.js');
  await query(ui, 'main');
  assert.deepEqual(paths(ui), ['src/main.js']);
  ui.app.dispose();
  ui.app = createRoot(dispose => {
    const replacement = {...ui.app, owner: getOwner(), dispose};
    Object.assign(replacement, untrackActions(content.createQuickOpen(replacement)));
    return replacement;
  });
  t.after(ui.app.dispose);
  const replacement = await open(ui);
  assert.notEqual(replacement.dialog, first.dialog);
  assert.equal(replacement.input.value, '');
  assert.deepEqual(paths(ui), []);
  assert.equal(replacement.status.textContent, '0 recent files');
  assert.deepEqual(ui.rpcCalls, []);
});
