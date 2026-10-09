/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Rendering of the composed sidebar on a fake DOM: toolbar controls keep
 * focus, background loads leave other tabs alone, counts follow the search,
 * the header follows navigation, Refresh and failed account switches, and
 * a folder click moves the keyboard tab stop.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createSidebar, document, publicState, settle, waitFor} from './support/sidebar.mjs';

/** Creates a deferred promise. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return {promise, resolve, reject};
}

/** Repository metadata for `INIT`. */
const info = {
  ref: 'main',
  treeSHA: 'a'.repeat(40),
  commitSHA: 'a'.repeat(40),
  path: '',
  repository: {private: false, default_branch: 'main'},
};

/** Open pull requests for `PULLS`. */
const pulls = [
  {number: 1, title: 'Fix the tree', user: {login: 'a'}},
  {number: 2, title: 'Add icons', user: {login: 'b'}},
  {number: 3, title: 'Update docs', user: {login: 'c'}},
];

/**
 * Returns a worker that answers every message; [handlers] override replies by message type.
 *
 * @param {Object<string, Function>} [handlers]
 */
function worker(handlers = {}) {
  return (type, value) => {
    if (handlers[type]) return handlers[type](value);
    if (type === 'STATE') return Promise.resolve(publicState());
    if (type === 'INIT') return Promise.resolve(info);
    if (type === 'TREE')
      return Promise.resolve({
        entries: [
          {path: 'docs', type: 'tree'},
          {path: 'src', type: 'tree'},
          {path: 'src/a.js', type: 'blob'},
          {path: 'README.md', type: 'blob'},
        ],
        lazy: false,
      });
    if (type === 'PULLS') return Promise.resolve({pulls, total: pulls.length});
    return Promise.resolve(true);
  };
}

/** Text of the toolbar count. */
const count = app => app.view.toolbar.querySelector('.count').textContent;

test('changing the review filter keeps the same focused select in the toolbar', async () => {
  const app = await createSidebar(worker());
  app.view.tabButtons.pulls.click();
  await settle();
  const select = app.view.toolbar.querySelector('select');
  select.focus();
  select.value = 'approved';
  select.emit('change');
  await settle();
  assert.equal(app.state.filter, 'approved');
  assert.ok(app.view.toolbar.contains(select), 'the focused select was replaced');
  assert.ok(document.activeElement === select, 'the select lost focus');
});

test('a background tree load does not re-render the request list', async () => {
  const tree = deferred();
  const app = await createSidebar(worker());
  app.view.tabButtons.pulls.click();
  await settle();
  const list = app.view.body.firstChild;
  assert.ok(list.classList.contains('list'));
  app.rpc = (type, value) => (type === 'TREE' ? tree.promise : worker()(type, value));
  const loading = app.loadFiles();
  tree.resolve({entries: [{path: 'new.js', type: 'blob'}], lazy: false});
  await loading;
  await settle();
  assert.ok(app.view.body.firstChild === list, 'the request list was re-rendered');
});

test('the request count shows the requests matching the search', async () => {
  const app = await createSidebar(worker());
  app.view.tabButtons.pulls.click();
  await settle();
  assert.equal(count(app), '3');
  app.view.search.value = 'icons';
  app.view.search.emit('input');
  await new Promise(resolve => setTimeout(resolve, 150));
  await settle();
  assert.equal(app.view.body.querySelectorAll('.pr-item').length, 1);
  assert.equal(count(app), '1');
});

test('the header shows the new repository while its state is still loading', async () => {
  const app = await createSidebar(worker());
  assert.match(app.view.repository.textContent, /sample \/ repo/);
  const state = deferred();
  app.rpc = (type, value) =>
    type === 'STATE' ? state.promise : type === 'INIT' ? new Promise(() => {}) : worker()(type, value);
  Object.assign(globalThis.location, {href: 'https://github.com/other/project', pathname: '/other/project'});
  // The replies for the new page never arrive in this test, so the load is not awaited.
  void app.loadPage();
  await settle();
  assert.match(app.view.repository.textContent, /other \/ project/);
  assert.equal(app.view.branchButton.disabled, true, 'the branch button waits for the new metadata');
});

test('Refresh on the Bookmarks tab updates the bookmark button', async () => {
  const app = await createSidebar(worker());
  app.view.tabButtons.bookmarks.click();
  await settle();
  assert.equal(app.view.bookmarkButton.classList.contains('active'), false);
  const bookmarked = publicState({bookmarks: [{id: 'b1', url: globalThis.location.href, title: 'Repo', created: 1}]});
  app.rpc = (type, value) => (type === 'STATE' ? Promise.resolve(bookmarked) : worker()(type, value));
  await app.refresh();
  await settle();
  assert.equal(app.view.bookmarkButton.classList.contains('active'), true);
  assert.equal(count(app), '1');
});

test('a failed account switch shows the account that is still selected', async () => {
  const accounts = [{id: 'work', origin: 'https://github.com', provider: 'github', login: 'me', label: 'me'}];
  const app = await createSidebar(
    worker({
      STATE: () => Promise.resolve(publicState({accounts})),
      SELECT_ACCOUNT: () => Promise.reject(new Error('Account unavailable')),
    }),
  );
  const select = app.view.accountSelect;
  assert.equal(select.value, 'auto');
  select.value = 'work';
  select.emit('change');
  await settle();
  assert.deepEqual(app.toasts, ['Account unavailable']);
  assert.equal(select.value, 'auto');
});

test('clicking a folder without toggling it moves the keyboard tab stop to its row', async () => {
  const app = await createSidebar(worker());
  app.state.preferences = {...app.state.preferences, folderClick: false};
  await settle();
  const row = path => app.view.spacer.querySelector(`[data-path="${path}"]`);
  assert.equal(row('docs').getAttribute('tabindex'), '0');
  row('src').click();
  await settle();
  assert.equal(app.state.expanded.has('src'), false);
  assert.equal(row('src').getAttribute('tabindex'), '0');
  assert.equal(row('docs').getAttribute('tabindex'), '-1');
});

test('a review diff reloaded from a View full button also reloads the changed-file rows', async () => {
  const {Element} = await import('./support/dom.mjs');
  const diff = (sha, names) => ({
    files: names.map(filename => ({filename, status: 'modified', additions: 1, deletions: 0, patch: ''})),
    comments: [],
    viewed: {},
    viewedMode: 'local',
    warnings: [],
    base: {sha: 'b'.repeat(40)},
    head: {sha},
  });
  const diffs = [diff('1'.repeat(40), ['a.js']), diff('2'.repeat(40), ['a.js', 'b.js'])];
  let requests = 0;
  // A native diff card for a file that the first diff does not contain yet.
  const card = new Element('div');
  card.id = 'diff-b';
  card.setAttribute('data-path', 'b.js');
  const header = new Element('div');
  header.className = 'file-header';
  const actions = new Element('div');
  actions.className = 'file-actions';
  header.append(actions);
  card.append(header);
  document.querySelectorAll = selector => (selector.includes('[id^="diff-"]') ? [card] : []);
  const app = await createSidebar(
    worker({
      DIFF: () => Promise.resolve(diffs[Math.min(requests++, 1)]),
      FILE: () => new Promise(() => {}),
    }),
    'https://github.com/sample/repo/pull/7/files',
  );
  // Header buttons are inserted after the file paths are hashed.
  await waitFor(() => Boolean(card.querySelector('.codetree-view-full')));
  assert.deepEqual(
    app.state.entries.map(entry => entry.path),
    ['a.js'],
  );
  card.querySelector('.codetree-view-full').click();
  await waitFor(() => requests === 3 && !app.state.filesLoading);
  assert.equal(app.state.diff.head.sha, '2'.repeat(40));
  assert.deepEqual(
    app.state.entries.map(entry => entry.path),
    ['a.js', 'b.js'],
  );
  document.querySelectorAll = () => [];
});
