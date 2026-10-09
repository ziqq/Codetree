/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/** Reactive sidebar regressions through the real factories, with synthetic DOM/RPC fixtures. */
import assert from 'node:assert/strict';
import test from 'node:test';
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
      info: {ref: 'main', treeSha: 'a'.repeat(40), repository: {}},
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
  initReply.resolve({ref: 'next', treeSha: 'b'.repeat(40), repository: {}});
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
