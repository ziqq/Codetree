/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Reactive sidebar regressions through the real factories, with synthetic DOM/RPC fixtures.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bundle} from './helpers/content.mjs';
import {dom, frames, install} from './helpers/dom.mjs';

const directory = await mkdtemp(join(tmpdir(), 'codetree-content-'));
const modulePath = join(directory, 'content.mjs');
await writeFile(modulePath, await bundle());
const content = await import(pathToFileURL(modulePath));
await rm(directory, {recursive: true, force: true});
const {batch, createRoot, createState, getOwner, makeTree, onCleanup, untrackActions, withOwner} = content;
const origin = 'https://github.com';
const publicData = {accounts: [], selectedAccounts: {}, bookmarks: []};

for (const [provider, root, path] of [
  ['github', 'https://github.com/sample/repo', '/pull/42/files'],
  ['gitlab', 'https://gitlab.com/team/nested/repo', '/-/merge_requests/42/diffs'],
]) {
  test(`regex-hidden ${provider} navigation clears native buttons and resumes on an allowed page`, async t => {
    const ui = sidebar(t);
    const requests = [];
    let loads = 0;
    ui.state.preferences = {...ui.state.preferences, hidePatterns: 'regex:/(pull|merge_requests)/42/'};
    ui.rpc = async type => {
      requests.push(type);
      if (type === 'STATE') return {...publicData, preferences: ui.state.preferences};
      if (type === 'INIT') return {ref: 'main', repository: {}};
      throw new Error(`Unexpected request: ${type}`);
    };
    ui.loadFiles = async () => {
      loads++;
    };
    ui.clearHeaderButtons = content.createHeaderButtons(ui).clearHeaderButtons;
    install(t, {location: new URL(root)});
    await ui.loadPage();
    requests.length = 0;
    loads = 0;
    const button = globalThis.document.createElement('button');
    button.className = 'codetree-view-full';
    globalThis.document.body.append(button);
    globalThis.location = new URL(root + path);

    await ui.loadPage();
    assert.equal(ui.state.context, null, 'hidden pages have no sidebar context');
    assert.equal(ui.view.branchButton.disabled, true);
    assert.equal(globalThis.document.querySelector('.codetree-view-full'), null);
    assert.deepEqual(requests, []);
    assert.equal(loads, 0);

    globalThis.location = new URL(root);
    await ui.loadPage();
    assert.equal(ui.state.context.provider, provider);
    assert.equal(ui.state.context.repo, 'repo');
    assert.equal(ui.view.branchButton.disabled, false);
    assert.deepEqual(requests, ['STATE', 'INIT']);
    assert.equal(loads, 1);
    assert.deepEqual(ui.errors, []);
  });
}

/** A controllable reply used to reproduce request completion races. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return {promise, resolve, reject};
}

/** Composes the same bindings as the sidebar, exposing fixture clocks and observable DOM. */
function sidebar(t, rpc = () => Promise.resolve({pulls: [], total: 0})) {
  let app;
  t.after(() => app?.dispose());
  const {document, window} = dom();
  const clock = frames();
  install(t, {
    document,
    window,
    location: new URL(`${origin}/sample/repo`),
    chrome: {runtime: {getURL: path => `chrome-extension://fixture/${path}`}},
    CSS: {escape: value => value},
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
  });
  app = createRoot(dispose => {
    const app = {owner: getOwner(), uiReady: true, state: createState(), rpc, clock, dispose, errors: []};
    Object.assign(app.state, {
      epoch: 1,
      context: {origin, provider: 'github', owner: 'sample', repo: 'repo', kind: 'repository'},
      info: {ref: 'main', treeSHA: 'a'.repeat(40), repository: {}},
      public: publicData,
      preferences: {...app.state.preferences, iconTheme: 'minimal'},
    });
    app.run = callback => {
      const bound = withOwner(callback);
      return (...args) =>
        Promise.resolve()
          .then(() => bound(...args))
          .catch(error => app.errors.push(error.message));
    };
    app.closeBranches = () => {
      app.view.branchPopover.hidden = true;
    };
    app.clearHeaderButtons = () => {};
    app.scheduleHeaderButtons = () => {};
    app.prepareHeaderButtons = async () => {};
    app.toast = text => app.errors.push(text);
    app.view = content.createView(app);
    for (const factory of [
      content.createFiles,
      content.createTree,
      content.createPulls,
      content.createBookmarks,
      content.createRender,
      content.createNavigation,
      content.createViewer,
    ])
      Object.assign(app, untrackActions(factory(app)));
    onCleanup(() => app.disposePage?.());
    return app;
  });
  return app;
}

/** Replaces tree data through its production invalidation action. */
function entries(ui, value) {
  batch(() => {
    ui.state.entries = value;
    ui.state.tree = makeTree(value);
    ui.updateTree();
  });
}

/** Captures browser navigation while keeping native diff scrolling observable. */
function fileNavigation(t, provider, kind) {
  const ui = sidebar(t);
  const gitlab = provider === 'gitlab';
  const root = gitlab ? 'https://gitlab.example.com/team/nested/repo' : `${origin}/sample/repo`;
  const path = 'src/a b#?.js';
  const sha = 'b'.repeat(40);
  const request = `${root}/${gitlab ? '-/merge_requests' : 'pull'}/42`;
  const hash = createHash(gitlab ? 'sha1' : 'sha256')
    .update(path)
    .digest('hex');
  const target =
    kind === 'repository'
      ? `${root}/${gitlab ? '-/' : ''}blob/feature%2Freview/src/a%20b%23%3F.js`
      : kind === 'commit'
        ? `${root}/${gitlab ? '-/' : ''}commit/${sha}`
        : gitlab
          ? `${request}/diffs?file_path=src%2Fa%20b%23%3F.js#${hash}`
          : `${request}/changes#diff-${hash}`;
  const page = kind === 'repository' ? root : kind === 'commit' ? target : `${request}/${gitlab ? 'diffs' : 'changes'}`;
  const location = new URL(page);
  const opened = [];
  const assigned = [];
  const replaced = [];
  const scrolled = [];
  location.assign = url => assigned.push(url);
  globalThis.window.open = (...args) => opened.push(args);
  install(t, {location, history: {replaceState: (...args) => replaced.push(args)}});
  batch(() => {
    ui.state.context = {
      origin: new URL(root).origin,
      provider,
      owner: gitlab ? 'team/nested' : 'sample',
      repo: 'repo',
      kind: kind === 'repository' ? 'repo' : kind,
      number: 42,
      sha,
    };
    ui.state.info = {...ui.state.info, ref: 'feature/review'};
    ui.state.mode = kind === 'repository' ? 'files' : 'changes';
    ui.state.selected = 'keep.js';
    if (kind === 'repository') entries(ui, [{path, type: 'blob'}]);
    else ui.applyDiff({...reviewDiff('none', {}, [path]), head: {sha}});
    ui.state.expanded = new Set(['src']);
  });
  const native = globalThis.document.createElement('div');
  native.setAttribute('data-codetree-file', path);
  native.scrollIntoView = options => scrolled.push(options);
  globalThis.document.body.append(native);
  ui.clock.flush();
  return {ui, path, target, page, opened, assigned, replaced, scrolled};
}

/** A changed-file response with a nested folder and an independent sibling file. */
function reviewDiff(viewedMode, viewed = {}, paths = ['src/nested/a.js', 'src/b.js', 'other/c.js']) {
  return {
    head: {sha: 'a'.repeat(40)},
    files: paths.map(filename => ({filename})),
    comments: [],
    viewed,
    viewedMode,
    warnings: [],
  };
}

/** Reads a rendered row by its exact path without depending on the row order. */
function treeRow(ui, path) {
  const row = ui.view.spacer.querySelectorAll('.tree-row').find(row => row.dataset.path === path);
  assert.ok(row, `Expected a visible row for ${path}`);
  return row;
}

/** Reads the persistent review controls so tests exercise their actual change handlers. */
function reviewControls(ui) {
  const filter = ui.view.toolbar.querySelector('[aria-label="Only unviewed files"]');
  const progress = ui.view.toolbar.querySelector('.review-progress');
  assert.ok(filter, 'Expected the Only unviewed checkbox');
  assert.ok(progress, 'Expected the review progress counter');
  return {filter, progress, container: filter.closest('.review-controls')};
}

/** Reads only attached tree rows; the detached virtual spacer can retain old rows in empty states. */
function visibleTreePaths(ui) {
  return ui.view.body.querySelectorAll('.tree-row').map(row => row.dataset.path);
}

test('regex search toggle immediately applies pending input and preserves controls and expansion', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const calls = [];
  const ui = sidebar(t, (...args) => calls.push(args));
  entries(ui, [
    {path: 'src/main.dart', type: 'blob'},
    {path: 'src/Screen.SWIFT', type: 'blob'},
    {path: 'docs/file[1].md', type: 'blob'},
  ]);
  const {search, regexButton, body} = ui.view;
  assert.ok(regexButton, 'Files offers a regex toggle');
  assert.equal(regexButton.getAttribute('aria-pressed'), 'false');
  assert.equal(regexButton.hidden, false);
  search.value = '\\.(dart|swift)$';
  search.focus();
  await search.fire('input');
  assert.equal(ui.state.query, '', 'typing retains the existing debounce');
  body.scrollTop = 150;
  ui.state.focus = 2;
  await regexButton.fire('click');
  ui.clock.flush();
  assert.equal(ui.state.query, '\\.(dart|swift)$', 'toggling uses the latest input immediately');
  assert.equal(regexButton.getAttribute('aria-pressed'), 'true');
  assert.equal(search.placeholder, 'Find a path by regex…');
  assert.deepEqual(visibleTreePaths(ui), ['src', 'src/main.dart', 'src/Screen.SWIFT']);
  assert.equal(ui.view.toolbar.querySelector('.count').textContent, '2');
  assert.equal(body.scrollTop, 0);
  assert.equal(ui.state.focus, 0);
  assert.deepEqual([...ui.state.expanded], []);
  assert.equal(ui.view.search, search);
  assert.equal(globalThis.document.activeElement, search);
  await regexButton.fire('click');
  t.mock.timers.tick(200);
  ui.clock.flush();
  assert.deepEqual(visibleTreePaths(ui), [], 'the same expression is a literal when regex is off');
  assert.equal(search.placeholder, 'Find a file…');
  assert.equal(regexButton.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(calls, [], 'search does not fetch or persist anything');
  assert.deepEqual(ui.errors, []);
});

for (const [invalid, literalPath] of [
  ['[', 'docs/file[1].md'],
  ['(', 'docs/file(1).md'],
  ['\\', 'docs/file\\name.md'],
]) {
  test(`regex search reports invalid ${invalid} and recovers after correction or switching to literal mode`, async t => {
    t.mock.timers.enable({apis: ['setTimeout']});
    const ui = sidebar(t);
    entries(ui, [
      {path: literalPath, type: 'blob'},
      {path: 'src/main.dart', type: 'blob'},
    ]);
    const {search, regexButton} = ui.view;
    assert.ok(regexButton, 'Files offers a regex toggle');
    await regexButton.fire('click');
    search.value = invalid;
    search.focus();
    await search.fire('input');
    t.mock.timers.tick(100);
    ui.clock.flush();
    assert.equal(search.getAttribute('aria-invalid'), 'true');
    assert.match(ui.view.body.textContent, /Invalid regular expression/);
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '0');
    assert.deepEqual(visibleTreePaths(ui), []);
    assert.equal(globalThis.document.activeElement, search);
    search.value = '^src/.*\\.dart$';
    await search.fire('input');
    t.mock.timers.tick(100);
    ui.clock.flush();
    assert.equal(search.getAttribute('aria-invalid'), 'false');
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '1');
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/main.dart']);
    search.value = invalid;
    await search.fire('input');
    await regexButton.fire('click');
    ui.clock.flush();
    assert.equal(search.getAttribute('aria-invalid'), 'false');
    assert.deepEqual(visibleTreePaths(ui), ['docs', literalPath]);
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '1');
    assert.deepEqual(ui.errors, [], 'invalid patterns are handled in the search UI without throwing');
  });
}

for (const mode of ['github', 'local']) {
  test(`regex search combines ${mode} Viewed marks with counts and confirmed or failed writes`, async t => {
    let reply = deferred();
    const ui = sidebar(t, () => reply.promise);
    ui.state.mode = 'changes';
    ui.applyDiff(
      reviewDiff(mode, {'src/Screen.SWIFT': 'VIEWED', 'docs/README.md': 'VIEWED'}, [
        'src/nested/main.dart',
        'src/Screen.SWIFT',
        'test/main_test.dart',
        'docs/README.md',
      ]),
    );
    batch(() => {
      ui.state.expanded = new Set();
      ui.state.searchRegex = true;
      ui.state.query = '\\.(dart|swift)$';
    });
    ui.clock.flush();
    const {filter, progress} = reviewControls(ui);
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '3');
    assert.equal(progress.textContent, '2/4 viewed');
    filter.checked = true;
    await filter.fire('change');
    ui.state.query = '^src/.*\\.(dart|swift)$';
    ui.clock.flush();
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/nested', 'src/nested/main.dart']);
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '1');
    const mark = treeRow(ui, 'src/nested/main.dart').querySelector('.viewed-checkbox');
    mark.checked = true;
    const failed = mark.fire('change');
    await Promise.resolve();
    assert.equal(progress.textContent, '2/4 viewed');
    reply.reject(new Error('Viewed write failed'));
    await failed;
    ui.clock.flush();
    assert.equal(mark.checked, false);
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/nested', 'src/nested/main.dart']);
    reply = deferred();
    mark.checked = true;
    const success = mark.fire('change');
    reply.resolve({state: 'VIEWED'});
    await success;
    ui.clock.flush();
    assert.equal(progress.textContent, '3/4 viewed', 'progress counts even files excluded by the regex');
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '0');
    assert.deepEqual(visibleTreePaths(ui), []);
    assert.match(ui.view.body.textContent, /No matching unviewed files/);
    filter.checked = false;
    await filter.fire('change');
    ui.clock.flush();
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '2');
    assert.equal(progress.textContent, '3/4 viewed');
    assert.deepEqual([...ui.state.expanded], []);
    assert.deepEqual(ui.errors, ['Viewed write failed']);
  });
}

for (const tab of ['pulls', 'bookmarks']) {
  test(`regex search resets on the ${tab} tab without leaking into its literal search`, async t => {
    t.mock.timers.enable({apis: ['setTimeout']});
    const ui = sidebar(t, type =>
      Promise.resolve(
        type === 'STATE'
          ? {
              ...publicData,
              bookmarks: [{id: 'a', title: 'Fix[1]', url: `${origin}/sample/repo`}],
            }
          : {pulls: [{number: 42, title: 'Fix[1]', user: {login: 'alice'}}], total: 1},
      ),
    );
    const {search, regexButton} = ui.view;
    assert.ok(regexButton, 'Files offers a regex toggle');
    await regexButton.fire('click');
    search.value = '^old/';
    await search.fire('input');
    await ui.selectTab(tab);
    assert.equal(ui.state.searchRegex, false);
    assert.equal(regexButton.hidden, true);
    assert.equal(regexButton.getAttribute('aria-pressed'), 'false');
    assert.equal(search.value, '');
    t.mock.timers.tick(200);
    assert.equal(ui.state.query, '', 'old debounced input cannot reappear after the tab switch');
    search.value = 'FIX[';
    await search.fire('input');
    t.mock.timers.tick(100);
    assert.equal(search.getAttribute('aria-invalid'), 'false');
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '1');
    assert.match(ui.view.body.textContent, /Fix\[1\]/);
    await ui.selectTab('files');
    assert.equal(regexButton.hidden, false);
    assert.equal(regexButton.getAttribute('aria-pressed'), 'false');
    assert.equal(search.value, '');
    assert.deepEqual(ui.errors, []);
  });
}

test('regex search and pending input reset on page navigation before new metadata arrives', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const reply = deferred();
  const ui = sidebar(t, type => {
    if (type === 'INIT') return reply.promise;
    if (type === 'STATE') return Promise.resolve({...publicData, preferences: ui.state.preferences});
    return Promise.resolve({
      entries: [
        {path: 'new.js', type: 'blob'},
        {path: 'new.dart', type: 'blob'},
      ],
      lazy: false,
    });
  });
  batch(() => {
    ui.state.searchRegex = true;
    ui.state.query = '[';
  });
  assert.equal(ui.view.search.getAttribute('aria-invalid'), 'true');
  ui.view.search.value = '^old/';
  await ui.view.search.fire('input');
  globalThis.location = new URL(`${origin}/another/repo`);
  const pending = ui.loadPage();
  assert.equal(ui.state.searchRegex, false);
  assert.equal(ui.view.search.getAttribute('aria-invalid'), 'false');
  assert.equal(ui.view.search.value, '');
  reply.resolve({ref: 'main', treeSHA: 'b'.repeat(40), repository: {}});
  await pending;
  t.mock.timers.tick(200);
  ui.clock.flush();
  assert.equal(ui.state.query, '');
  assert.deepEqual(visibleTreePaths(ui), ['new.dart', 'new.js']);
  assert.equal(ui.view.toolbar.querySelector('.count').textContent, '2');
  assert.deepEqual(ui.errors, []);
});

test('regex search updates loaded-file results after a lazy folder reply without fetching on search', async t => {
  const calls = [];
  const ui = sidebar(t, (type, value) => {
    calls.push({type, value});
    return Promise.resolve({
      entries: [
        {path: 'main.dart', type: 'blob'},
        {path: 'helper.js', type: 'blob'},
      ],
    });
  });
  entries(ui, [{path: 'src', type: 'tree', loaded: false, sha: 'c'.repeat(40)}]);
  batch(() => {
    ui.state.lazy = true;
    ui.state.searchRegex = true;
    ui.state.query = '\\.dart$';
  });
  assert.equal(ui.view.toolbar.querySelector('.count').textContent, '0');
  assert.deepEqual(calls, []);
  assert.match(ui.view.notice.textContent, /Search currently includes loaded files/);
  await ui.loadFolder(ui.state.tree.nodes.get('src'));
  ui.clock.flush();
  assert.deepEqual(visibleTreePaths(ui), ['src', 'src/main.dart']);
  assert.equal(ui.view.toolbar.querySelector('.count').textContent, '1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'TREE');
  assert.equal(calls[0].value.path, 'src');
  assert.deepEqual(ui.errors, []);
});

for (const mode of ['github', 'local']) {
  test(`Only unviewed combines ${mode} marks with search and collapsed folders without filtering progress`, async t => {
    const calls = [];
    const ui = sidebar(t, (...args) => calls.push(args));
    ui.state.mode = 'changes';
    ui.applyDiff({
      ...reviewDiff(mode, {'src/nested/a.js': 'VIEWED', 'docs/README.md': 'VIEWED'}, [
        'src/nested/a.js',
        'src/nested/b.js',
        'src/root.js',
        'docs/README.md',
      ]),
      warnings: ['Only 4 of 5 changed files returned.'],
    });
    ui.state.expanded = new Set(['src']);
    ui.clock.flush();
    const {filter, progress, container} = reviewControls(ui);
    assert.equal(container.hidden, false);
    assert.equal(filter.checked, false);
    assert.equal(progress.textContent, '2/4 viewed', 'folders do not count as reviewable files');
    assert.equal(
      progress.getAttribute('aria-label'),
      `2 of 4 listed changed files viewed ${mode === 'github' ? 'on GitHub' : 'locally'}`,
    );
    assert.match(
      ui.view.notice.textContent,
      /Only 4 of 5 changed files returned/,
      'partial response warnings stay visible',
    );
    ui.view.body.scrollTop = 150;
    filter.focus();
    filter.checked = true;
    await filter.fire('change');
    ui.clock.flush();
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/nested', 'src/root.js']);
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '2', 'collapsed unviewed descendants count too');
    assert.equal(ui.view.body.scrollTop, 0);
    assert.equal(globalThis.document.activeElement, filter);

    ui.state.query = ' NESTED ';
    ui.clock.flush();
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/nested', 'src/nested/b.js']);
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '1');
    assert.equal(progress.textContent, '2/4 viewed');
    ui.state.query = 'a.js';
    ui.clock.flush();
    assert.deepEqual(visibleTreePaths(ui), []);
    assert.match(ui.view.body.textContent, /No matching unviewed files/);
    assert.equal(progress.textContent, '2/4 viewed');
    filter.checked = false;
    await filter.fire('change');
    ui.clock.flush();
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/nested', 'src/nested/a.js']);
    ui.state.query = '';
    ui.clock.flush();
    assert.deepEqual(visibleTreePaths(ui), ['docs', 'src', 'src/nested', 'src/root.js']);
    assert.deepEqual([...ui.state.expanded], ['src'], 'filtering and search preserve saved expansion');
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '4');
    assert.equal(reviewControls(ui).filter, filter, 'filtering never replaces the focused control');
    assert.deepEqual(calls, [], 'filtering never requests provider data or writes marks');
    assert.deepEqual(ui.errors, []);
  });

  test(`Only unviewed and review progress follow confirmed ${mode} marks and roll back failed writes`, async t => {
    let reply = deferred();
    const calls = [];
    const ui = sidebar(t, (type, value) => {
      calls.push({type, value});
      return reply.promise;
    });
    ui.state.mode = 'changes';
    ui.applyDiff(reviewDiff(mode, {'src/nested/a.js': 'VIEWED', 'other/c.js': 'VIEWED'}));
    ui.state.expanded = new Set(['src', 'src/nested', 'other']);
    ui.clock.flush();
    const {filter, progress} = reviewControls(ui);
    filter.checked = true;
    await filter.fire('change');
    ui.clock.flush();
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/b.js']);
    const mark = treeRow(ui, 'src/b.js').querySelector('.viewed-checkbox');
    mark.checked = true;
    const failed = mark.fire('change');
    await Promise.resolve();
    assert.equal(mark.disabled, true);
    assert.equal(progress.textContent, '2/3 viewed');
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/b.js'], 'pending writes do not hide the file');
    reply.reject(new Error('Viewed write failed'));
    await failed;
    ui.clock.flush();
    assert.equal(mark.checked, false);
    assert.equal(mark.disabled, false);
    assert.equal(progress.textContent, '2/3 viewed');
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/b.js']);

    reply = deferred();
    mark.checked = true;
    const success = mark.fire('change');
    reply.resolve({state: 'VIEWED'});
    await success;
    ui.clock.flush();
    assert.equal(progress.textContent, '3/3 viewed');
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '0');
    assert.deepEqual(visibleTreePaths(ui), []);
    assert.match(ui.view.body.textContent, /No unviewed files/);
    assert.match(ui.view.body.textContent, /All listed changed files are viewed/);

    filter.checked = false;
    await filter.fire('change');
    ui.clock.flush();
    const unmark = treeRow(ui, 'src/nested/a.js').querySelector('.viewed-checkbox');
    reply = deferred();
    unmark.checked = false;
    const failedUnmark = unmark.fire('change');
    await Promise.resolve();
    assert.equal(progress.textContent, '3/3 viewed');
    reply.reject(new Error('Unmark failed'));
    await failedUnmark;
    assert.equal(unmark.checked, true);
    assert.equal(progress.textContent, '3/3 viewed');
    reply = deferred();
    unmark.checked = false;
    const successUnmark = unmark.fire('change');
    reply.resolve({state: 'UNVIEWED'});
    await successUnmark;
    ui.clock.flush();
    assert.equal(progress.textContent, '2/3 viewed');
    filter.checked = true;
    await filter.fire('change');
    ui.clock.flush();
    assert.deepEqual(visibleTreePaths(ui), ['src', 'src/nested', 'src/nested/a.js']);
    assert.deepEqual(
      calls.map(call => [call.type, call.value.path, call.value.viewed]),
      [
        ['VIEWED', 'src/b.js', true],
        ['VIEWED', 'src/b.js', true],
        ['VIEWED', 'src/nested/a.js', false],
        ['VIEWED', 'src/nested/a.js', false],
      ],
    );
    assert.deepEqual(ui.errors, ['Viewed write failed', 'Unmark failed']);
  });

  test(`Only unviewed and ${mode} progress are hidden outside ready review trees`, async t => {
    const ui = sidebar(t);
    ui.state.mode = 'changes';
    const diff = reviewDiff(mode, {'src/nested/a.js': 'VIEWED'});
    ui.applyDiff(diff);
    ui.state.expanded = new Set(['src', 'src/nested', 'other']);
    ui.clock.flush();
    const {filter, progress, container} = reviewControls(ui);
    filter.checked = true;
    await filter.fire('change');
    ui.state.filesLoading = true;
    assert.equal(container.hidden, true);
    ui.state.filesLoading = false;
    ui.state.filesError = 'Diff unavailable';
    assert.equal(container.hidden, true);
    ui.state.filesError = '';
    assert.equal(container.hidden, false);
    assert.equal(filter.checked, true);
    assert.equal(progress.textContent, '1/3 viewed');
    ui.state.mode = 'files';
    ui.clock.flush();
    assert.equal(container.hidden, true);
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '3');
    assert.ok(visibleTreePaths(ui).includes('src/nested/a.js'), 'repository files ignore the review filter');
    ui.state.mode = 'changes';
    ui.applyDiff({...diff, viewedMode: 'none'});
    ui.clock.flush();
    assert.equal(container.hidden, true);
    assert.ok(visibleTreePaths(ui).includes('src/nested/a.js'), 'unavailable Viewed cannot filter out files');
    ui.applyDiff(diff);
    ui.state.tab = 'bookmarks';
    assert.equal(ui.view.toolbar.contains(container), false);
    ui.state.tab = 'files';
    ui.clock.flush();
    assert.equal(reviewControls(ui).filter, filter);
    assert.equal(container.hidden, false);
    assert.equal(filter.checked, true);
    assert.equal(progress.textContent, '1/3 viewed');
    assert.equal(visibleTreePaths(ui).includes('src/nested/a.js'), false);
    assert.deepEqual(ui.errors, []);
  });
}

test('review progress handles an empty changed-file response without counting folders', async t => {
  const ui = sidebar(t);
  ui.state.mode = 'changes';
  ui.applyDiff(reviewDiff('local', {}, []));
  ui.clock.flush();
  const {filter, progress} = reviewControls(ui);
  assert.equal(progress.textContent, '0/0 viewed');
  filter.checked = true;
  await filter.fire('change');
  ui.applyDiff(reviewDiff('local', {}, ['src/nested/a.js']));
  ui.clock.flush();
  assert.equal(progress.textContent, '0/1 viewed');
  assert.equal(ui.view.toolbar.querySelector('.count').textContent, '1');
  assert.deepEqual(ui.errors, []);
});

for (const invalidate of ['revision', 'navigation', 'tree reload', 'page disposal']) {
  test(`Only unviewed and progress ignore late Viewed replies after ${invalidate}`, async t => {
    const reply = deferred();
    const ui = sidebar(t, () => reply.promise);
    let disposePage;
    content.runWithOwner(ui.owner, () =>
      createRoot(dispose => {
        disposePage = dispose;
        ui.pageAlive = content.createAlive();
      }),
    );
    ui.state.mode = 'changes';
    ui.applyDiff(reviewDiff('local', {'src/nested/a.js': 'VIEWED'}));
    ui.state.expanded = new Set(['src', 'new']);
    ui.clock.flush();
    const {filter, progress} = reviewControls(ui);
    filter.checked = true;
    await filter.fire('change');
    ui.clock.flush();
    const checkbox = treeRow(ui, 'src/b.js').querySelector('.viewed-checkbox');
    checkbox.checked = true;
    const pending = checkbox.fire('change');
    await Promise.resolve();
    const next = reviewDiff('local', {}, ['new/next.js']);
    if (invalidate === 'revision') next.head = {sha: 'b'.repeat(40)};
    else if (invalidate === 'navigation') ui.state.epoch++;
    else if (invalidate === 'tree reload') ui.state.filesGeneration++;
    else disposePage();
    ui.applyDiff(next);
    ui.clock.flush();
    reply.resolve({state: 'VIEWED'});
    await pending;
    ui.clock.flush();
    assert.equal(progress.textContent, '0/1 viewed');
    assert.equal(ui.view.toolbar.querySelector('.count').textContent, '1');
    assert.deepEqual(visibleTreePaths(ui), ['new', 'new/next.js']);
    assert.deepEqual(ui.errors, []);
  });
}

test('Refresh preserves Only unviewed while replacing review progress with the new revision', async t => {
  const reply = deferred();
  const requested = deferred();
  const ui = sidebar(t, type => {
    if (type === 'DIFF') {
      requested.resolve();
      return reply.promise;
    }
    return Promise.resolve(type === 'INIT' ? ui.state.info : true);
  });
  ui.state.mode = 'changes';
  ui.applyDiff(reviewDiff('github', {'src/nested/a.js': 'VIEWED'}));
  ui.clock.flush();
  const {filter, progress, container} = reviewControls(ui);
  filter.checked = true;
  await filter.fire('change');
  const pending = ui.refresh();
  await requested.promise;
  assert.equal(container.hidden, true, 'previous progress is hidden while loading the new diff');
  reply.resolve({...reviewDiff('github', {}, ['new/next.js']), head: {sha: 'b'.repeat(40)}});
  await pending;
  ui.clock.flush();
  assert.equal(container.hidden, false);
  assert.equal(filter.checked, true);
  assert.equal(progress.textContent, '0/1 viewed');
  assert.deepEqual(visibleTreePaths(ui), ['new', 'new/next.js']);
  assert.deepEqual(ui.errors, []);
});

test('page navigation resets Only unviewed and does not reuse the previous review progress', async t => {
  const reply = deferred();
  const ui = sidebar(t, type => {
    if (type === 'INIT') return reply.promise;
    if (type === 'STATE') return Promise.resolve({...publicData, preferences: ui.state.preferences});
    return Promise.resolve({entries: [{path: 'new.js', type: 'blob'}], lazy: false});
  });
  ui.state.mode = 'changes';
  ui.applyDiff(reviewDiff('github', {'src/nested/a.js': 'VIEWED'}));
  ui.clock.flush();
  const {filter, container} = reviewControls(ui);
  filter.checked = true;
  await filter.fire('change');
  globalThis.location = new URL(`${origin}/another/repo`);
  const pending = ui.loadPage();
  assert.equal(filter.checked, false);
  assert.equal(container.hidden, true);
  reply.resolve({ref: 'main', treeSHA: 'b'.repeat(40), repository: {}});
  await pending;
  ui.clock.flush();
  assert.deepEqual(visibleTreePaths(ui), ['new.js']);
  assert.equal(container.hidden, true);
  assert.deepEqual(ui.errors, []);
});

for (const provider of ['github', 'gitlab']) {
  for (const kind of ['repository', 'pull', 'commit']) {
    for (const [modifier, keys] of [
      ['Ctrl', {ctrlKey: true}],
      ['Cmd', {metaKey: true}],
    ]) {
      test(`${modifier}-click opens the ${provider} ${kind} file in a separate tab without navigating the source`, async t => {
        const {ui, path, target, page, opened, assigned, replaced, scrolled} = fileNavigation(t, provider, kind);
        const focus = ui.state.focus;
        await treeRow(ui, path).fire('click', keys);
        assert.deepEqual(ui.errors, []);
        assert.deepEqual(opened, [[target, '_blank', 'noopener']]);
        assert.deepEqual(assigned, []);
        assert.deepEqual(replaced, []);
        assert.deepEqual(scrolled, []);
        assert.equal(globalThis.location.href, page);
        assert.equal(ui.state.selected, 'keep.js');
        assert.equal(ui.state.focus, focus);
      });
    }
    test(`ordinary click keeps ${provider} ${kind} file navigation in the source tab`, async t => {
      const {ui, path, target, opened, assigned, replaced, scrolled} = fileNavigation(t, provider, kind);
      await treeRow(ui, path).fire('click');
      assert.deepEqual(ui.errors, []);
      assert.deepEqual(opened, []);
      if (kind === 'repository') {
        assert.deepEqual(assigned, [target]);
        assert.deepEqual(scrolled, []);
        assert.deepEqual(replaced, []);
      } else {
        assert.deepEqual(assigned, []);
        assert.deepEqual(scrolled, [{block: 'start'}]);
        assert.deepEqual(replaced, [[null, '', target]]);
        assert.equal(ui.state.selected, path);
      }
    });
  }
}

for (const keys of [{ctrlKey: true}, {metaKey: true}]) {
  test(`${keys.ctrlKey ? 'Ctrl' : 'Cmd'}-click keeps folder expansion instead of opening a tab`, async t => {
    const ui = sidebar(t);
    const opened = [];
    globalThis.window.open = (...args) => opened.push(args);
    entries(ui, [{path: 'src/a.js', type: 'blob'}]);
    ui.clock.flush();
    await treeRow(ui, 'src').fire('click', keys);
    assert.equal(ui.state.expanded.has('src'), true);
    ui.clock.flush();
    assert.ok(treeRow(ui, 'src/a.js'));
    await treeRow(ui, 'src').fire('click', keys);
    assert.equal(ui.state.expanded.has('src'), false);
    assert.deepEqual(opened, []);
    assert.deepEqual(ui.errors, []);
  });
}

for (const mode of ['github', 'local']) {
  test(`folder Viewed indicators aggregate ${mode} marks across collapsed and searched descendants`, t => {
    const ui = sidebar(t);
    ui.state.mode = 'changes';
    ui.applyDiff(reviewDiff(mode, {'src/nested/a.js': 'VIEWED', 'src/b.js': 'VIEWED'}));
    ui.state.expanded = new Set(['src']);
    ui.clock.flush();
    const label = `All listed files in src viewed ${mode === 'github' ? 'on GitHub' : 'locally'}`;
    assert.equal(treeRow(ui, 'src').querySelector('.folder-viewed')?.getAttribute('aria-label'), label);
    assert.ok(treeRow(ui, 'src/nested').querySelector('.folder-viewed'));
    assert.equal(treeRow(ui, 'src/nested').querySelector('.viewed-checkbox'), null, 'folder marks are read-only');
    assert.equal(treeRow(ui, 'other').querySelector('.folder-viewed'), null, 'unrelated files keep their own state');
    ui.state.expanded = new Set();
    ui.clock.flush();
    assert.ok(treeRow(ui, 'src').querySelector('.folder-viewed'), 'collapsed parent retains its indicator');

    ui.applyDiff(reviewDiff(mode, {'src/nested/a.js': 'VIEWED'}));
    ui.state.query = 'a.js';
    ui.clock.flush();
    assert.ok(treeRow(ui, 'src/nested').querySelector('.folder-viewed'));
    assert.equal(treeRow(ui, 'src').querySelector('.folder-viewed'), null, 'search cannot hide an unviewed sibling');
    ui.applyDiff(reviewDiff(mode));
    ui.clock.flush();
    assert.equal(ui.view.spacer.querySelector('.folder-viewed'), null, 'fresh diff replaces old folder marks');
    assert.deepEqual(ui.errors, []);
  });

  test(`folder Viewed indicators follow confirmed ${mode} changes and survive a rejected write`, async t => {
    let reply = deferred();
    const calls = [];
    const ui = sidebar(t, (type, value) => {
      calls.push({type, value});
      return reply.promise;
    });
    ui.state.mode = 'changes';
    ui.applyDiff(reviewDiff(mode, {'src/nested/a.js': 'VIEWED'}));
    ui.state.expanded = new Set(['src']);
    ui.clock.flush();
    const mark = treeRow(ui, 'src/b.js').querySelector('.viewed-checkbox');
    mark.checked = true;
    const pending = mark.fire('change');
    await Promise.resolve();
    assert.equal(mark.disabled, true);
    assert.equal(treeRow(ui, 'src').querySelector('.folder-viewed'), null, 'pending write cannot mark the folder');
    reply.resolve({state: 'VIEWED'});
    await pending;
    ui.clock.flush();
    assert.deepEqual(calls, [
      {type: 'VIEWED', value: {context: ui.state.context, headSHA: 'a'.repeat(40), path: 'src/b.js', viewed: true}},
    ]);
    assert.ok(treeRow(ui, 'src').querySelector('.folder-viewed'));
    assert.ok(treeRow(ui, 'src/nested').querySelector('.folder-viewed'));
    entries(ui, ui.state.entries);
    ui.state.query = 'a.js';
    ui.clock.flush();
    assert.ok(treeRow(ui, 'src').querySelector('.folder-viewed'), 'confirmed file marks survive rebuilding the tree');

    reply = deferred();
    const unmark = treeRow(ui, 'src/nested/a.js').querySelector('.viewed-checkbox');
    unmark.checked = false;
    const failed = unmark.fire('change');
    await Promise.resolve();
    assert.ok(treeRow(ui, 'src').querySelector('.folder-viewed'), 'pending unmark retains the confirmed indicator');
    reply.reject(new Error('Viewed write failed'));
    await failed;
    ui.clock.flush();
    assert.equal(unmark.checked, true);
    assert.equal(unmark.disabled, false);
    assert.ok(treeRow(ui, 'src').querySelector('.folder-viewed'));
    assert.ok(treeRow(ui, 'src/nested').querySelector('.folder-viewed'));
    assert.deepEqual(ui.errors, ['Viewed write failed']);

    reply = deferred();
    unmark.checked = false;
    const success = unmark.fire('change');
    reply.resolve({state: 'UNVIEWED'});
    await success;
    ui.clock.flush();
    assert.equal(treeRow(ui, 'src').querySelector('.folder-viewed'), null);
    assert.equal(treeRow(ui, 'src/nested').querySelector('.folder-viewed'), null);
    assert.equal(ui.state.entries.find(entry => entry.path === 'src/nested/a.js').viewed, false);
    assert.equal(calls.length, 3, 'folder aggregation never adds bulk Viewed writes');
  });
}

for (const mode of ['github', 'local']) {
  test(`tree Viewed writes publish confirmed ${mode} marks to the shared diff without replacing it`, async t => {
    let reply = deferred();
    const ui = sidebar(t, () => reply.promise);
    ui.state.mode = 'changes';
    const diff = reviewDiff(mode, {}, ['__proto__', 'src/a.js']);
    ui.applyDiff(diff);
    ui.clock.flush();
    const prototype = Object.getPrototypeOf(diff.viewed);
    let checkbox = treeRow(ui, '__proto__').querySelector('.viewed-checkbox');
    checkbox.checked = true;
    const mark = checkbox.fire('change');
    await Promise.resolve();
    assert.equal(Object.hasOwn(diff.viewed, '__proto__'), false, 'a pending write is not a confirmed shared mark');
    reply.resolve({state: 'VIEWED', mode});
    await mark;
    ui.clock.flush();
    assert.equal(ui.state.diff, diff, 'publishing a mark must not reload an open viewer');
    assert.equal(Object.hasOwn(diff.viewed, '__proto__'), true, 'literal file paths become own map entries');
    assert.equal(diff.viewed.__proto__, 'VIEWED');
    assert.equal(Object.getPrototypeOf(diff.viewed), prototype);
    assert.equal(reviewControls(ui).progress.textContent, '1/2 viewed');

    reply = deferred();
    checkbox = treeRow(ui, '__proto__').querySelector('.viewed-checkbox');
    checkbox.checked = false;
    const unmark = checkbox.fire('change');
    await Promise.resolve();
    assert.equal(diff.viewed.__proto__, 'VIEWED');
    reply.resolve({state: 'UNVIEWED', mode});
    await unmark;
    ui.clock.flush();
    assert.equal(ui.state.diff, diff);
    assert.equal(diff.viewed.__proto__, 'UNVIEWED', 'other review controls see confirmed unmarks too');
    assert.equal(reviewControls(ui).progress.textContent, '0/2 viewed');
    assert.deepEqual(ui.errors, []);
  });
}

test('a confirmed GitHub local fallback updates the shared mode, sidebar notice and progress wording', async t => {
  const ui = sidebar(t, async () => ({state: 'VIEWED', mode: 'local'}));
  ui.state.mode = 'changes';
  const diff = reviewDiff('github', {}, ['src/a.js']);
  ui.applyDiff(diff);
  ui.state.expanded = new Set(['src']);
  ui.clock.flush();
  assert.doesNotMatch(ui.view.notice.textContent, /Viewed marks are local/);
  const checkbox = treeRow(ui, 'src/a.js').querySelector('.viewed-checkbox');
  checkbox.checked = true;
  await checkbox.fire('change');
  ui.clock.flush();
  assert.equal(ui.state.diff, diff);
  assert.equal(diff.viewedMode, 'local');
  assert.equal(diff.viewed['src/a.js'], 'VIEWED');
  assert.match(ui.view.notice.textContent, /Viewed marks are local to this browser/);
  assert.equal(reviewControls(ui).progress.getAttribute('aria-label'), '1 of 1 listed changed files viewed locally');
  assert.equal(treeRow(ui, 'src/a.js').querySelector('.viewed-checkbox').title, 'Viewed locally');
  assert.deepEqual(ui.errors, []);
});

for (const [label, result] of [
  ['opposite mark', {state: 'UNVIEWED', mode: 'github'}],
  ['unsupported mode', {state: 'VIEWED', mode: 'none'}],
]) {
  test(`tree Viewed controls reject an acknowledgement with an ${label}`, async t => {
    const ui = sidebar(t, async () => result);
    ui.state.mode = 'changes';
    const diff = reviewDiff('github', {}, ['src/a.js']);
    ui.applyDiff(diff);
    ui.state.expanded = new Set(['src']);
    ui.clock.flush();
    const checkbox = treeRow(ui, 'src/a.js').querySelector('.viewed-checkbox');
    checkbox.checked = true;
    await checkbox.fire('change');
    ui.clock.flush();
    assert.deepEqual(diff.viewed, {});
    assert.equal(diff.viewedMode, 'github');
    assert.equal(checkbox.checked, false);
    assert.equal(checkbox.disabled, false);
    assert.equal(reviewControls(ui).progress.textContent, '0/1 viewed');
    assert.deepEqual(ui.errors, ['The Viewed update was not confirmed. Try again.']);
  });
}

test('folder Viewed aggregation does not mark empty or partially loaded folders', () => {
  const tree = makeTree([
    {path: 'empty', type: 'tree', viewed: true},
    {path: 'pending', type: 'tree', loaded: false, viewed: true},
    {path: 'pending/a.js', viewed: true},
    {path: 'parent/nested', type: 'tree', loaded: false},
    {path: 'parent/nested/a.js', viewed: true},
    {path: 'parent/b.js', viewed: true},
  ]);
  for (const path of ['empty', 'pending', 'parent', 'parent/nested'])
    assert.equal(Boolean(tree.nodes.get(path).viewed), false, `${path} cannot claim complete review`);
});

test('folder Viewed indicators are hidden in repository trees and when Viewed is unavailable', t => {
  const ui = sidebar(t);
  const diff = reviewDiff('local', {'src/nested/a.js': 'VIEWED', 'src/b.js': 'VIEWED'});
  entries(
    ui,
    diff.files.map(file => ({path: file.filename, viewed: true})),
  );
  ui.clock.flush();
  assert.equal(ui.view.spacer.querySelector('.folder-viewed'), null);
  ui.state.mode = 'changes';
  ui.applyDiff(diff);
  ui.clock.flush();
  assert.ok(treeRow(ui, 'src').querySelector('.folder-viewed'));
  ui.applyDiff({...diff, viewedMode: 'none'});
  ui.clock.flush();
  assert.equal(ui.view.spacer.querySelector('.folder-viewed'), null);
  assert.equal(ui.view.spacer.querySelector('.viewed-checkbox'), null);
});

for (const invalidate of ['revision', 'navigation', 'tree reload']) {
  test(`folder Viewed indicators reject a late file acknowledgement after ${invalidate}`, async t => {
    const reply = deferred();
    const ui = sidebar(t, () => reply.promise);
    ui.state.mode = 'changes';
    ui.applyDiff(reviewDiff('local', {'src/nested/a.js': 'VIEWED'}));
    ui.state.expanded = new Set(['src']);
    ui.clock.flush();
    const checkbox = treeRow(ui, 'src/b.js').querySelector('.viewed-checkbox');
    checkbox.checked = true;
    const pending = checkbox.fire('change');
    await Promise.resolve();
    const next = reviewDiff('local');
    if (invalidate === 'revision') next.head = {sha: 'b'.repeat(40)};
    else if (invalidate === 'navigation') ui.state.epoch++;
    else ui.state.filesGeneration++;
    ui.applyDiff(next);
    ui.clock.flush();
    reply.resolve({state: 'VIEWED'});
    await pending;
    ui.clock.flush();
    assert.equal(ui.view.spacer.querySelector('.folder-viewed'), null);
    assert.equal(treeRow(ui, 'src/b.js').querySelector('.viewed-checkbox').checked, false);
    assert.equal(ui.state.entries.find(entry => entry.path === 'src/b.js').viewed, false);
    assert.deepEqual(ui.errors, []);
  });
}

test('filter focus and control identity survive search, loading, errors and replies', async t => {
  const reply = deferred();
  const ui = sidebar(t, () => reply.promise);
  ui.state.tab = 'pulls';
  const filter = ui.view.toolbar.querySelector('select');
  filter.focus();
  filter.value = 'approved';
  const pending = filter.fire('change');
  await Promise.resolve();
  assert.equal(ui.state.loading, true);
  ui.state.query = 'alice';
  assert.equal(ui.view.toolbar.querySelector('select'), filter);
  assert.equal(globalThis.document.activeElement, filter);
  reply.resolve({pulls: [{number: 1, title: 'Fix', user: {login: 'alice'}}], total: 1});
  await pending;
  assert.equal(ui.state.filter, 'approved');
  assert.equal(ui.view.toolbar.querySelector('select'), filter);
  assert.equal(globalThis.document.activeElement, filter);
  ui.state.error = 'API unavailable';
  assert.equal(globalThis.document.activeElement, filter);
  ui.state.error = '';
  assert.equal(globalThis.document.activeElement, filter);
});

test('every count matches its searched body, including request author/number and bookmark URL', t => {
  const ui = sidebar(t);
  entries(ui, [
    {path: 'src', type: 'tree'},
    {path: 'src/first.js', type: 'blob'},
    {path: 'second.js', type: 'blob'},
  ]);
  const count = () => ui.view.toolbar.querySelector('.count').textContent;
  assert.equal(count(), '2', 'Files counts collapsed descendants too');
  ui.state.query = 'FIRST';
  assert.equal(count(), '1');
  ui.clock.flush();
  assert.equal(ui.view.spacer.querySelectorAll('.tree-row').length, 2, 'matching file retains its ancestor');
  batch(() => {
    ui.state.tab = 'pulls';
    ui.state.pulls = [
      {number: 42, title: 'First change', user: {login: 'alice'}},
      {number: 7, title: 'Other change', user: {login: 'bob'}},
    ];
    ui.state.query = 'ALICE';
  });
  assert.equal(count(), '1');
  assert.equal(ui.view.body.querySelectorAll('.pr-item').length, 1);
  ui.state.query = '7';
  assert.equal(count(), '1');
  assert.match(ui.view.body.textContent, /Other change/);
  batch(() => {
    ui.state.tab = 'bookmarks';
    ui.state.public = {
      ...publicData,
      bookmarks: [
        {id: 'a', title: 'First', url: `${origin}/sample/first`},
        {id: 'b', title: 'Second', url: `${origin}/sample/second`},
      ],
    };
    ui.state.query = '/SECOND';
  });
  assert.equal(count(), '1');
  assert.equal(ui.view.body.querySelectorAll('.bookmark-item').length, 1);
  ui.state.query = 'missing';
  assert.equal(count(), '0');
  assert.match(ui.view.body.textContent, /No bookmarks match/);
  ui.state.query = '';
  assert.equal(count(), '2');
});

for (const tab of ['pulls', 'bookmarks']) {
  for (const fail of [false, true]) {
    test(`background Files ${fail ? 'failure' : 'success'} preserves the ${tab} body and scroll`, async t => {
      const reply = deferred();
      const ui = sidebar(t, () => reply.promise);
      ui.state.tab = tab;
      ui.view.body.scrollTop = 87;
      const body = ui.view.body.children[0];
      const pending = ui.loadFiles();
      if (fail) reply.reject(new Error('Files failed'));
      else reply.resolve({entries: [{path: 'file.js', type: 'blob'}], lazy: false});
      await pending;
      assert.equal(ui.view.body.children[0], body);
      assert.equal(ui.view.body.scrollTop, 87);
      assert.equal(ui.state.loading, false);
      assert.equal(ui.state.error, '');
      await ui.selectTab('files');
      assert.equal(ui.state.error, fail ? 'Files failed' : '');
      if (fail) assert.match(ui.view.body.textContent, /Files failed/);
      else {
        ui.clock.flush();
        assert.match(ui.view.spacer.textContent, /file.js/);
      }
    });
  }
}

test('a new page resets repository and disables Branch before STATE or INIT replies', async t => {
  const stateReply = deferred();
  const initReply = deferred();
  const ui = sidebar(t, type =>
    type === 'STATE'
      ? stateReply.promise
      : type === 'INIT'
        ? initReply.promise
        : Promise.resolve({entries: [], lazy: false}),
  );
  globalThis.location = new URL(`${origin}/other/new-repo`);
  const pending = ui.loadPage();
  assert.match(ui.view.repository.textContent, /other \/ new-repo/);
  assert.equal(ui.view.branchButton.disabled, true);
  assert.equal(ui.view.branchLabel.textContent, 'Branch');
  stateReply.resolve({...publicData, preferences: ui.state.preferences});
  initReply.resolve({ref: 'next', treeSHA: 'b'.repeat(40), repository: {}});
  await pending;
  assert.equal(ui.view.branchButton.disabled, false);
  assert.equal(ui.view.branchLabel.textContent, 'next');
});

test('bookmark Refresh updates the header button and list together', async t => {
  const bookmark = {id: 'a', title: 'Current repository', url: `${origin}/sample/repo`};
  const ui = sidebar(t, type => Promise.resolve(type === 'STATE' ? {...publicData, bookmarks: [bookmark]} : true));
  ui.state.tab = 'bookmarks';
  assert.equal(ui.view.bookmarkButton.classList.contains('active'), false);
  await ui.refresh();
  assert.equal(ui.view.bookmarkButton.classList.contains('active'), true);
  assert.equal(ui.view.toolbar.querySelector('.count').textContent, '1');
  assert.match(ui.view.body.textContent, /Current repository/);
});

test('native diff replacement keeps head, rows, comments and Viewed marks from one revision', t => {
  const ui = sidebar(t);
  ui.state.mode = 'changes';
  const first = {
    head: {sha: 'a'.repeat(40)},
    files: [{filename: 'old.js'}],
    comments: [],
    viewed: {'old.js': 'VIEWED'},
    viewedMode: 'local',
    warnings: [],
  };
  ui.applyDiff(first);
  ui.clock.flush();
  const next = {
    head: {sha: 'b'.repeat(40)},
    files: [{filename: 'new.js'}],
    comments: [{path: 'new.js', body: 'new comment'}],
    viewed: {},
    viewedMode: 'local',
    warnings: [],
  };
  ui.applyDiff(next);
  ui.clock.flush();
  assert.equal(ui.state.diff, next);
  assert.deepEqual(
    ui.state.flat.map(node => node.path),
    ['new.js'],
  );
  assert.equal(ui.state.flat[0].viewed, false);
  assert.equal(ui.state.flat[0].comments[0].body, 'new comment');
  assert.equal(ui.view.spacer.querySelector('.viewed-checkbox').checked, false);
});

test('a native View full click installs fresh diff rows before opening the viewer', async t => {
  const diff = {
    head: {sha: 'b'.repeat(40)},
    files: [{filename: 'new.js'}],
    comments: [{path: 'new.js', body: 'fresh'}],
    viewed: {},
    viewedMode: 'local',
    warnings: [],
  };
  const ui = sidebar(t, type => {
    assert.equal(type, 'DIFF');
    return Promise.resolve(diff);
  });
  batch(() => {
    ui.state.context = {...ui.state.context, kind: 'pull', number: 42};
    ui.state.mode = 'changes';
  });
  ui.applyDiff({
    ...diff,
    head: {sha: 'a'.repeat(40)},
    files: [{filename: 'old.js'}],
    comments: [],
    viewed: {'old.js': 'VIEWED'},
  });
  const document = globalThis.document;
  const card = document.createElement('div');
  card.setAttribute('data-path', 'new.js');
  const header = document.createElement('div');
  const actions = document.createElement('div');
  header.append(actions);
  card.append(header);
  document.body.append(card);
  // Native selector matching is a fixture boundary; inserted controls and their handlers are real factory output.
  const queryAll = document.querySelectorAll.bind(document);
  document.querySelectorAll = selector => (selector.startsWith('[id^="diff-"]') ? [card] : queryAll(selector));
  const query = card.querySelector.bind(card);
  card.querySelector = selector => (selector.startsWith('[class*=') ? header : query(selector));
  header.querySelector = selector => (selector === '.rd-diff-file-info, .file-actions' ? actions : null);
  ui.positionHandle = () => {};
  const opened = deferred();
  ui.viewerShell = () => ({body: document.createElement('div')});
  ui.isCurrent = () => true;
  ui.showDiff = async node => {
    assert.equal(node.path, 'new.js');
    assert.equal(ui.state.diff, diff);
    assert.deepEqual(
      ui.state.flat.map(row => row.path),
      ['new.js'],
    );
    assert.equal(ui.state.flat[0].viewed, false);
    assert.equal(ui.state.flat[0].comments[0].body, 'fresh');
    opened.resolve();
  };
  Object.assign(
    ui,
    content.runWithOwner(ui.owner, () => content.createHeaderButtons(ui)),
  );
  ui.scheduleHeaderButtons();
  ui.clock.flush();
  const button = actions.querySelector('.codetree-view-full');
  assert.ok(button);
  await button.fire('click');
  await opened.promise;
  assert.deepEqual(ui.errors, []);
});

test('failed account selection restores the authoritative value without reloading the page', async t => {
  const ui = sidebar(t, () => Promise.reject(new Error('Account unavailable')));
  ui.state.public = {
    ...publicData,
    selectedAccounts: {[origin]: 'saved'},
    accounts: [
      {id: 'saved', origin, login: 'saved', label: 'saved'},
      {id: 'new', origin, login: 'new', label: 'new'},
    ],
  };
  let reloads = 0;
  ui.loadPage = async () => {
    reloads++;
  };
  ui.view.accountSelect.value = 'new';
  await ui.view.accountSelect.fire('change');
  assert.equal(ui.view.accountSelect.value, 'saved');
  assert.deepEqual(ui.errors, ['Account unavailable']);
  assert.equal(reloads, 0);
});

test('folderClick=false keeps the clicked folder as the only keyboard tab stop', async t => {
  const ui = sidebar(t);
  entries(ui, [
    {path: 'first', type: 'tree'},
    {path: 'second', type: 'tree'},
  ]);
  ui.state.preferences = {...ui.state.preferences, folderClick: false};
  ui.clock.flush();
  const [first, second] = ui.view.spacer.querySelectorAll('.tree-row');
  await second.fire('click');
  assert.equal(first.tabIndex, -1);
  assert.equal(second.tabIndex, 0);
  assert.equal(globalThis.document.activeElement, second);
  assert.equal(ui.state.expanded.size, 0);
});

test('one expansion/data batch flattens once and load-all commits once per four folders', async t => {
  const ui = sidebar(t, () => Promise.resolve({entries: [{path: 'child.js', type: 'blob'}]}));
  entries(
    ui,
    Array.from({length: 8}, (_, index) => ({path: `folder${index}`, type: 'tree', loaded: false, sha: 'a'.repeat(40)})),
  );
  let flattenWrites = 0;
  let previous = ui.state.flat;
  // Count published row sets, which are the output of the production flatten binding.
  content.runWithOwner(ui.owner, () =>
    content.createRenderEffect(() => {
      const flat = ui.state.flat;
      if (flat !== previous) {
        flattenWrites++;
        previous = flat;
      }
    }),
  );
  batch(() => {
    ui.state.expanded = new Set(['folder0']);
    ui.updateTree();
  });
  assert.equal(flattenWrites, 1);
  flattenWrites = 0;
  await ui.loadAllFolders();
  assert.equal(flattenWrites, 2);
  assert.equal(ui.state.entries.filter(entry => entry.type === 'blob').length, 8);
  assert.equal(ui.state.loadingAll, false);
  assert.equal(ui.state.lazy, false);
});

test('disposed page work cannot apply replies even without a generation change', async t => {
  const reply = deferred();
  const ui = sidebar(t, () => reply.promise);
  let disposePage;
  content.runWithOwner(ui.owner, () =>
    createRoot(dispose => {
      disposePage = dispose;
      ui.pageAlive = content.createAlive();
    }),
  );
  const pending = ui.loadFiles();
  disposePage();
  reply.resolve({entries: [{path: 'stale.js', type: 'blob'}], lazy: false});
  await pending;
  assert.equal(ui.state.entries.length, 0);
});

test('replacing or closing a viewer disposes its listener/frame resources', async t => {
  const ui = sidebar(t);
  ui.view.viewer.showModal = () => {
    ui.view.viewer.open = true;
  };
  ui.view.viewer.close = () => {
    ui.view.viewer.open = false;
    void ui.view.viewer.fire('close');
  };
  const first = ui.viewerShell('first', 'revision A');
  let calls = 0;
  content.runWithOwner(first.owner, () => {
    content.listen(first.body, 'scroll', () => calls++);
    content.requestFrame(() => calls++);
  });
  const second = ui.viewerShell('second', 'revision B');
  await first.body.fire('scroll');
  ui.clock.flush();
  assert.equal(calls, 0);
  assert.equal(ui.isCurrent(first), false);
  assert.equal(ui.isCurrent(second), true);
  ui.closeViewer();
  assert.equal(second.alive(), false);
});
