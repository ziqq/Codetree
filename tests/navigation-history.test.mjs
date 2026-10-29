/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Back/Forward navigation history regressions through the production inline
 * workspace and View full factories, plus the bounded history model. Provider
 * replies, stylesheets and viewport geometry are controlled fixtures; they do
 * not establish installed-browser or authenticated API behavior.
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
import {installDiffViewport} from './helpers/diff-viewport.mjs';
import {installViewerSearchDOM, keyEvent} from './helpers/viewer-search.mjs';

const directory = await mkdtemp(join(tmpdir(), 'codetree-navigation-history-'));
const modulePath = join(directory, 'content.mjs');
await writeFile(modulePath, await bundle({fileTabs: true}));
const content = await import(pathToFileURL(modulePath));
await rm(directory, {recursive: true, force: true});
// The model is optional at import time so the behavior tests below fail on missing controls on older checkouts.
const historyModule = new URL('../src/content/viewer/file-history.js', import.meta.url);
const model = existsSync(historyModule) ? await import(historyModule) : {};
const {createRoot, createState, getOwner, onCleanup, untrackActions, withOwner} = content;
const mainSHA = 'a'.repeat(40);
const featureSHA = 'b'.repeat(40);
const reviewSHA = 'c'.repeat(40);
const baseSHA = 'd'.repeat(40);
const paths = ['src/a.js', 'src/b.js', 'src/legacy.js'];
const longText = Array.from({length: 220}, (_, index) => `export const line${index} = ${index};`).join('\n');

/** A controlled provider reply for overlapping file/page requests. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return {promise, resolve, reject};
}

/** Gives asynchronous viewer work a timer/I/O turn without consuming explicit stylesheet events. */
async function turn() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/** Composes real navigation, tree, branch and workspace factories around a metadata-only RPC fixture. */
function fixture(t, provider, reviewDiff, {search = false, review = {}} = {}) {
  const {document, window} = dom();
  if (reviewDiff || search) installDiffViewport(document);
  if (search) installViewerSearchDOM(document);
  const clock = frames();
  const gitlab = provider === 'gitlab';
  const root = gitlab ? 'https://gitlab.com/team/nested/repo' : 'https://github.com/sample/repo';
  const publicData = {accounts: [], selectedAccounts: {}, bookmarks: [], hosts: []};
  const shadows = new Map();
  const links = new WeakSet();
  const metadata = new Map();
  const assigned = [];
  const opened = [];
  const files = [];
  const viewedRequests = [];
  const errors = [];
  let app;
  t.after(() => app?.dispose());
  let main = document.createElement('main');
  document.body.append(main);
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const node = createElement(tag);
    if (reviewDiff || search) {
      Object.defineProperty(node, 'firstChild', {get: () => node.children[0] || null});
      if (tag === 'dialog') {
        node.showModal = () => {
          node.open = true;
        };
        node.close = () => {
          node.open = false;
          return node.fire('close');
        };
      }
    }
    const attachShadow = node.attachShadow.bind(node);
    node.attachShadow = () => {
      const shadow = attachShadow();
      shadows.set(node, shadow);
      const prepend = shadow.prepend.bind(shadow);
      shadow.prepend = (...nodes) => {
        if (nodes.some(child => child.tagName === 'LINK')) shadow.layoutReady = false;
        prepend(...nodes);
      };
      return shadow;
    };
    if (tag === 'div') {
      let top = 0;
      const boundedTop = Object.getOwnPropertyDescriptor(node, 'scrollTop');
      // Only the workspace viewport models CSS-dependent geometry. Without its
      // linked stylesheet the block has auto height, so scroll restoration is
      // clamped to zero; with CSS it is a bounded viewport. This reproduces the
      // observed reattachment regression without pretending to emulate layout.
      Object.defineProperty(node, 'clientHeight', {
        configurable: true,
        get() {
          if (!this.classList.contains('file-tab-body')) return 290;
          let shadow = this;
          while (shadow.parent) shadow = shadow.parent;
          return shadow?.layoutReady ? 290 : Number.parseFloat(this.querySelector('.code-spacer')?.style.height) || 0;
        },
      });
      Object.defineProperty(node, 'scrollTop', {
        configurable: true,
        get() {
          if (!this.classList.contains('file-tab-body')) return boundedTop?.get?.call(this) ?? top;
          if (this.classList.contains('file-tab-body') && !this.isConnected) return 0;
          return top;
        },
        set(value) {
          if (!this.classList.contains('file-tab-body')) {
            if (boundedTop?.set) boundedTop.set.call(this, value);
            else top = value;
            return;
          }
          const height = Number.parseFloat(this.querySelector('.code-spacer')?.style.height) || 0;
          top = Math.max(0, Math.min(value, Math.max(0, height - this.clientHeight)));
        },
      });
    }
    return node;
  };

  /** Changes the provider URL while retaining browser navigation as an observable effect. */
  function locationFor(url) {
    const location = new URL(url);
    location.assign = value => assigned.push(value);
    return location;
  }

  install(t, {
    document,
    window,
    location: locationFor(root),
    chrome: {runtime: {getURL: path => `chrome-extension://fixture/${path}`}},
    CSS: {escape: value => value},
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    history: {replaceState() {}},
  });
  window.open = (...args) => opened.push(args);

  /** Provides revision-specific repository fixtures while keeping file completions controllable. */
  async function rpc(type, message = {}) {
    const context = message.context || app.state.context;
    if (type === 'STATE') return {...publicData, preferences: app.state.preferences};
    if (type === 'INIT') {
      const ref = context.kind === 'pull' ? `review-${context.number}` : context.tail.split('/')[0] || 'main';
      return {
        ref,
        path: ['blob', 'blame', 'raw'].includes(context.kind) ? context.tail.split('/').slice(1).join('/') : '',
        commitSHA: ref === 'main' ? mainSHA : ref === 'feature' ? featureSHA : reviewSHA,
        treeSHA: ref === 'feature' ? featureSHA : mainSHA,
        repository: {default_branch: 'main'},
      };
    }
    if (type === 'TREE')
      return {
        entries: paths
          .filter(path => message.sha !== featureSHA || path !== 'src/legacy.js')
          .map(path => ({path, type: 'blob'})),
        lazy: false,
      };
    if (type === 'DIFF')
      return {
        base: source(baseSHA),
        head: source(review.headSHA || reviewSHA),
        files: (review.paths || paths.slice(0, 2)).map(filename => ({
          filename,
          ...(reviewDiff?.file || {status: 'added', additions: 220, deletions: 0, patch: ''}),
        })),
        comments: [],
        viewed: {...review.viewed},
        viewedMode: review.mode || 'none',
        warnings: [],
      };
    if (type === 'BRANCHES') return [{name: 'main'}, {name: 'feature'}];
    if (type === 'REFRESH') return null;
    if (type === 'VIEWED') {
      viewedRequests.push({...message});
      const controlled = app.viewedReply?.(message);
      return controlled === undefined ? {state: message.viewed ? 'VIEWED' : 'UNVIEWED', mode: review.mode} : controlled;
    }
    if (type === 'FILE_TABS') {
      const accountID = app.fileTabsAccount || '';
      const key = JSON.stringify([
        context.origin,
        context.owner,
        context.repo,
        message.scope,
        message.scope === 'review' ? (context.number ?? context.sha) : '',
        accountID,
      ]);
      if (message.value) {
        if (message.accountID !== accountID) throw new Error('The file workspace account changed.');
        if (app.fileTabsReply) await app.fileTabsReply(message, context);
        metadata.set(key, structuredClone(message.value));
      }
      return {...structuredClone(metadata.get(key) || {paths: [], active: '', positions: [], page: ''}), accountID};
    }
    if (type === 'FILE') {
      files.push({...message, context});
      const controlled = app.fileReply?.(message, context);
      if (controlled !== undefined) return controlled;
      if (message.source.sha === featureSHA && message.path === 'src/legacy.js') {
        const error = new Error('The file does not exist at this revision.');
        error.status = 404;
        throw error;
      }
      if (reviewDiff && context.kind === 'pull')
        return message.source.sha === baseSHA ? reviewDiff.before : reviewDiff.after;
      return longText;
    }
    throw new Error(`Unexpected request: ${type}`);
  }

  /** Exact provider source shapes are passed through by the actual file renderer. */
  function source(sha) {
    return gitlab ? {project: 'team/nested/repo', sha} : {owner: 'sample', repo: 'repo', sha};
  }

  /** Creates fresh production factories; session metadata belongs to the broker fixture. */
  function mountApp() {
    return createRoot(dispose => {
      const app = {owner: getOwner(), uiReady: true, state: createState(), rpc, dispose};
      app.state.public = publicData;
      app.state.preferences = {...app.state.preferences, iconTheme: 'minimal'};
      app.run = callback => {
        const owned = withOwner(callback);
        return (...args) =>
          Promise.resolve()
            .then(() => owned(...args))
            .catch(error => errors.push(error.message));
      };
      app.toast = text => errors.push(text);
      app.clearHeaderButtons = () => {};
      app.scheduleHeaderButtons = () => {};
      app.prepareHeaderButtons = async () => {};
      app.closeViewer = () => {};
      app.updateCodeColors = () => {};
      app.view = content.createView(app);
      document.body.append(app.view.host);
      for (const factory of [
        content.createFiles,
        content.createTree,
        content.createBranches,
        content.createNavigation,
        ...(reviewDiff || search ? [content.createViewer] : []),
        content.createFileTabs,
      ].filter(Boolean))
        Object.assign(app, untrackActions(factory(app)));
      app.view.body.append(app.view.spacer);
      onCleanup(() => app.disposePage?.());
      onCleanup(() => app.view.host.remove());
      return app;
    });
  }
  app = mountApp();

  /** Delivers actual shadow-link load events after the test elects to make styles ready. */
  async function loadStyles() {
    for (const [host, shadow] of shadows) {
      if (!host.isConnected) continue;
      for (const link of shadow.querySelectorAll('link')) {
        if (links.has(link)) continue;
        links.add(link);
        shadow.layoutReady = true;
        await link.fire('load');
      }
    }
  }

  /** Drains factory promises and animation frames, optionally retaining pending stylesheet loads. */
  async function drain(count = 5, styles = true) {
    for (let index = 0; index < count; index++) {
      if (styles) await loadStyles();
      clock.flush();
      // An immediate-only loop can exhaust its turns before highlighting timers
      // or native URL hashing finish under parallel load, in either viewer layout.
      await turn();
    }
  }

  /** Awaits an operation while explicitly completing the fixture's style and frame work. */
  async function settle(operation, styles = true) {
    let finished = false;
    let failure;
    const promise = Promise.resolve(operation).then(
      () => {
        finished = true;
      },
      error => {
        failure = error;
        finished = true;
      },
    );
    for (let index = 0; index < 80 && !finished; index++) await drain(1, styles);
    assert.ok(finished, 'The content operation should settle after controlled replies and styles.');
    await promise;
    if (failure) throw failure;
  }

  /** Navigates through the production page loader instead of rewriting workspace state. */
  async function navigate(url) {
    globalThis.location = locationFor(url);
    await settle(app.loadPage());
    clock.flush();
  }

  /** Reloads every content factory while preserving only the broker's session metadata. */
  async function reload() {
    await app.rememberFileTabs?.();
    app.dispose();
    app = mountApp();
    await settle(app.loadPage());
    clock.flush();
  }

  /** Opens a real file-tree row through its production click handler. */
  async function open(path, values = {}) {
    app.state.expanded = new Set(['src']);
    clock.flush();
    const row = app.view.spacer.querySelectorAll('.tree-row').find(row => row.dataset.path === path);
    assert.ok(row, `Expected tree row ${path}`);
    await settle(row.fire('click', values));
    if (!values.ctrlKey && !values.metaKey)
      assert.deepEqual(assigned, [], 'An ordinary file click stays in this page.');
  }

  /** Returns the inline shadow root, asserting the visible feature exists on the page. */
  function workspace() {
    const host = document.getElementById('codetree-file-workspace');
    assert.ok(host, 'File navigation mounts an in-page workspace.');
    return shadows.get(host);
  }

  /** Returns the active file viewport. */
  function body() {
    const body = workspace().querySelector('.file-tab-body');
    assert.ok(body, 'The workspace contains a file viewport.');
    return body;
  }

  /** Captures real scroll-handler effects before another navigation disposes the viewport. */
  async function scroll(top, left = 0) {
    const viewport = body();
    viewport.scrollTop = top;
    viewport.scrollLeft = left;
    await viewport.fire('scroll');
    await app.rememberFileTabs?.();
  }

  /** Reads open/active paths from accessible controls, not internal workspace fields. */
  function selection() {
    const buttons = workspace().querySelectorAll('.file-tab-name');
    return {
      paths: buttons.map(node => node.getAttribute('aria-label')),
      active: buttons.find(node => node.getAttribute('aria-selected') === 'true')?.getAttribute('aria-label') || '',
    };
  }

  /** Selects a provider branch using the real branch popover and handler. */
  async function branch(name) {
    await settle(app.toggleBranches());
    const item = app.view.branchList.querySelectorAll('.branch-item').find(item => item.textContent.startsWith(name));
    assert.ok(item, `Expected branch ${name}`);
    await settle(item.fire('click'));
    const url = assigned.pop();
    assert.ok(url, 'Selecting a branch navigates to its repository page.');
    await navigate(url);
  }

  /** Closes one tab through its visible close control. */
  async function close(path) {
    const control = workspace()
      .querySelectorAll('.file-tab-close')
      .find(node => node.getAttribute('aria-label') === `Close file tab: ${path}`);
    assert.ok(control, `Expected close control for ${path}`);
    await settle(control.fire('click'));
  }

  /** Replaces the native main node, as Turbo/PJAX does, without changing the repository URL. */
  function replaceMain() {
    main?.remove();
    main = document.createElement('main');
    document.body.append(main);
    app.mountFileTabs?.();
  }

  /** Removes provider content until a later native render supplies its replacement. */
  function removeMain() {
    main?.remove();
    main = null;
  }

  return {
    get app() {
      return app;
    },
    root,
    document,
    window,
    clock,
    files,
    viewedRequests,
    errors,
    metadata,
    assigned,
    opened,
    navigate,
    reload,
    open,
    branch,
    close,
    workspace,
    body,
    scroll,
    selection,
    drain,
    settle,
    loadStyles,
    replaceMain,
    removeMain,
    blob: (ref, path) => `${root}${gitlab ? '/-' : ''}/blob/${ref}/${path}`,
    review: number => `${root}/${gitlab ? '-/merge_requests' : 'pull'}/${number}/${gitlab ? 'diffs' : 'files'}`,
  };
}

/** Returns the owned Back/Forward controls of one viewer scope by their accessible labels. */
function historyControls(scope) {
  const back = scope.querySelector('[aria-label="Back"]');
  const forward = scope.querySelector('[aria-label="Forward"]');
  assert.ok(back && forward, 'The viewer exposes Back and Forward navigation controls.');
  return {back, forward};
}

/** Reads both controls' availability as [Back enabled, Forward enabled]. */
function available(scope) {
  const {back, forward} = historyControls(scope);
  return [!back.disabled, !forward.disabled];
}

/** Clicks an enabled history control and completes its file/style work. */
async function traverse(ui, scope, label) {
  const control = historyControls(scope)[label === 'Back' ? 'back' : 'forward'];
  assert.equal(control.disabled, false, `${label} is available`);
  await ui.settle(control.fire('click'));
  ui.clock.flush();
}

/** Opens source-line mode through the active viewer's keyboard handler and submits one line. */
async function goToLine(ui, scope, body, number, side) {
  body.focus();
  const open = keyEvent(body, 'g', {ctrlKey: true});
  await ui.window.fire('keydown', open);
  assert.equal(open.defaultPrevented, true, 'The active viewer handles its Go to line shortcut.');
  const bar = scope.querySelector('.viewer-find');
  assert.equal(bar?.hidden, false);
  if (side) {
    const choice = bar
      .querySelector('.viewer-line-revision')
      .querySelectorAll('button')
      .find(button => button.textContent === side);
    await choice.fire('click');
  }
  const input = bar.querySelector('input');
  input.value = `:${number}`;
  await input.fire('input');
  await ui.window.fire('keydown', keyEvent(input, 'Enter'));
  ui.clock.flush();
  assert.equal(bar.hidden, true, 'A successful jump closes the shared field.');
}

/** Opens Find through the production shortcut, enters a query and reveals the next match with Enter. */
async function findNext(t, ui, scope, body, query) {
  body.focus();
  await ui.window.fire('keydown', keyEvent(body, 'f', {ctrlKey: true}));
  const input = scope.querySelector('.viewer-find').querySelector('input');
  t.mock.timers.enable({apis: ['setTimeout']});
  try {
    input.value = query;
    await input.fire('input');
    t.mock.timers.tick(120);
    await Promise.resolve();
    ui.clock.flush();
  } finally {
    t.mock.timers.reset();
  }
  await ui.window.fire('keydown', keyEvent(input, 'Enter'));
  ui.clock.flush();
}

/** Selects a public diff layout and completes its repaint. */
async function layout(ui, scope, label) {
  const target = scope
    .querySelector('.diff-layout')
    .querySelectorAll('button')
    .find(button => button.textContent === label);
  assert.ok(target, `Expected ${label} layout control`);
  await ui.settle(target.fire('click'));
  ui.clock.flush();
}

/** Builds a replaced block where Old 22 and New 22 share one split row but different unified rows. */
function pairedRevision() {
  const before = Array.from({length: 220}, (_, index) => `export const source${index + 1} = ${index + 1};`);
  before[20] = "const oldOnly = 'beacon';";
  before[21] = "const oldPair = 'old branch';";
  before[22] = "const removedOnly = 'gone';";
  before[180] = '// shared beacon';
  const added = ["const newOnly = 'beacon';", "const newPair = 'new branch';"];
  return {
    before: before.join('\n'),
    after: [...before.slice(0, 20), ...added, ...before.slice(23)].join('\n'),
    file: {
      status: 'modified',
      additions: 2,
      deletions: 3,
      patch: [
        '@@ -21,3 +21,2 @@',
        ...before.slice(20, 23).map(line => '-' + line),
        ...added.map(line => '+' + line),
      ].join('\n'),
    },
  };
}

test('navigation history model dedupes, truncates the forward branch and stays bounded', () => {
  assert.equal(typeof model.createNavigationHistory, 'function', 'The history model is available.');
  const history = model.createNavigationHistory(3);
  const at = (path, top, key = 'main') => ({key, path, position: {top, left: 0}});
  assert.equal(history.canBack(null), false);
  history.visit(null, at('a', 0));
  history.visit(at('a', 0), at('a', 0));
  assert.equal(history.entries.length, 1, 'A visit to the same row of the same file is not a new point.');
  history.visit(at('a', 220), at('b', 0));
  assert.deepEqual(
    history.entries.map(entry => [entry.path, entry.position.top]),
    [
      ['a', 220],
      ['b', 0],
    ],
    'The departure position updates the current entry.',
  );
  assert.equal(history.canForward(at('b', 0)), false);
  const target = history.back(at('b', 440));
  assert.deepEqual([target.entry.path, target.entry.position.top], ['a', 220]);
  assert.equal(history.index, 1, 'Back does not move the pointer before the owner restores the target.');
  assert.equal(history.entries[1].position.top, 440, 'Back saves the current position.');
  assert.equal(history.commit(target), true);
  assert.equal(history.canBack(at('a', 220)), false);
  assert.equal(history.canForward(at('a', 220)), true);
  history.visit(at('a', 220), at('c', 0));
  assert.deepEqual(
    history.entries.map(entry => entry.path),
    ['a', 'c'],
    'A new visit discards the forward branch.',
  );
  history.visit(at('c', 0), at('d', 0));
  history.visit(at('d', 0), at('e', 0));
  assert.deepEqual(
    history.entries.map(entry => entry.path),
    ['c', 'd', 'e'],
    'The oldest entries are dropped at the bound.',
  );
  assert.equal(history.index, 2);
  assert.equal(
    history.canBack(at('e', 0), entry => entry.key === 'feature'),
    false,
    'Other scopes are skipped.',
  );
  assert.equal(history.back(at('e', 0), entry => entry.path !== 'd').entry.path, 'c');
  assert.equal(history.back(at('x', 0)).entry.path, 'e', 'Away from the pointer, Back returns to it first.');
  assert.equal(model.maxNavigationHistory, 50);
  history.clear();
  assert.deepEqual([history.entries, history.index], [[], -1]);
});

for (const provider of ['github', 'gitlab']) {
  test(`${provider} Back and Forward restore files, positions and line jumps in the inline workspace`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    assert.deepEqual(available(ui.workspace()), [false, false]);
    await ui.scroll(880, 0);
    await goToLine(ui, ui.workspace(), ui.body(), 150);
    assert.equal(ui.body().scrollTop, 149 * 22);
    assert.deepEqual(available(ui.workspace()), [true, false], 'Go to line creates a navigation point.');
    await ui.open(paths[1]);
    await ui.scroll(440, 0);
    assert.deepEqual(available(ui.workspace()), [true, false]);
    const requests = ui.files.length;
    await traverse(ui, ui.workspace(), 'Back');
    assert.equal(ui.selection().active, paths[0]);
    assert.equal(ui.body().scrollTop, 149 * 22);
    await traverse(ui, ui.workspace(), 'Back');
    assert.equal(ui.selection().active, paths[0]);
    assert.equal(ui.body().scrollTop, 880, 'Back returns to the position before the line jump.');
    assert.equal(ui.files.length, requests + 1, 'A same-file step only moves the existing viewport.');
    assert.deepEqual(available(ui.workspace()), [false, true]);
    await traverse(ui, ui.workspace(), 'Forward');
    assert.equal(ui.body().scrollTop, 149 * 22);
    await traverse(ui, ui.workspace(), 'Forward');
    assert.equal(ui.selection().active, paths[1]);
    assert.equal(ui.body().scrollTop, 440, 'Forward restores the stored position of the later file.');
    assert.deepEqual(available(ui.workspace()), [true, false]);
    assert.deepEqual(ui.selection().paths, paths.slice(0, 2), 'History restoration does not add tabs.');
    assert.deepEqual(ui.errors, []);
  });
}

test('inline Outline/symbol jumps and source-line opens are points; reopening the active file is not', async t => {
  const ui = fixture(t, 'github', undefined, {search: true});
  ui.app.fileReply = message =>
    Array.from({length: 260}, (_, index) =>
      index === 149 ? 'function onlyTarget() {}' : `// ${message.path} context ${index}`,
    ).join('\n');
  await ui.navigate(ui.root);
  await ui.open(paths[0]);
  await ui.open(paths[0]);
  assert.deepEqual(available(ui.workspace()), [false, false], 'Reopening the active file records nothing.');
  await ui.scroll(220, 0);
  const symbols = ui.app.getFileTabSymbols();
  assert.equal(symbols.go(symbols.symbols.find(symbol => symbol.name === 'onlyTarget')), true);
  ui.clock.flush();
  assert.equal(ui.body().scrollTop, 149 * 22);
  await ui.settle(ui.app.openFileTab({path: paths[1], line: 200}));
  assert.equal(ui.body().scrollTop, 199 * 22);
  await traverse(ui, ui.workspace(), 'Back');
  assert.equal(ui.selection().active, paths[0]);
  assert.equal(ui.body().scrollTop, 149 * 22);
  await traverse(ui, ui.workspace(), 'Back');
  assert.equal(ui.body().scrollTop, 220, 'Back returns to the position before the symbol jump.');
  assert.deepEqual(available(ui.workspace()), [false, true]);
  await traverse(ui, ui.workspace(), 'Forward');
  await traverse(ui, ui.workspace(), 'Forward');
  assert.equal(ui.selection().active, paths[1]);
  assert.equal(ui.body().scrollTop, 199 * 22, 'The source-line open is one point, not two.');
  assert.deepEqual(available(ui.workspace()), [true, false]);
  assert.deepEqual(ui.errors, []);
});

test('inline scrolling, layout switches and find reveals create no navigation points', async t => {
  const ui = fixture(t, 'github', pairedRevision(), {search: true});
  await ui.navigate(ui.review(41));
  assert.equal(ui.selection().active, paths[0]);
  await ui.scroll(660, 0);
  await layout(ui, ui.workspace(), 'Side-by-side');
  await layout(ui, ui.workspace(), 'Unified');
  await findNext(t, ui, ui.workspace(), ui.body(), 'beacon');
  assert.notEqual(ui.body().scrollTop, 660, 'Find moved the viewport to a match.');
  assert.deepEqual(available(ui.workspace()), [false, false]);
  assert.deepEqual(ui.errors, []);
});

test('inline Back reopens a closed file tab at its history position', async t => {
  const ui = fixture(t, 'github');
  await ui.navigate(ui.root);
  await ui.open(paths[0]);
  await ui.scroll(660, 0);
  await ui.open(paths[1]);
  await ui.close(paths[0]);
  assert.deepEqual(ui.selection(), {paths: [paths[1]], active: paths[1]});
  await traverse(ui, ui.workspace(), 'Back');
  assert.deepEqual(ui.selection(), {paths: [paths[1], paths[0]], active: paths[0]});
  assert.equal(ui.body().scrollTop, 660);
  assert.deepEqual(available(ui.workspace()), [false, true]);
  assert.deepEqual(ui.errors, []);
});

test('inline Back to a missing file keeps the pointer, reports it and leaves Retry available', async t => {
  const ui = fixture(t, 'github');
  await ui.navigate(ui.root);
  await ui.open(paths[0]);
  await ui.scroll(660, 0);
  await ui.open(paths[1]);
  await ui.scroll(440, 0);
  ui.app.fileReply = message => {
    if (message.path !== paths[0]) return undefined;
    const error = new Error('The file does not exist at this revision.');
    error.status = 404;
    throw error;
  };
  await traverse(ui, ui.workspace(), 'Back');
  assert.equal(ui.selection().active, paths[0]);
  assert.match(ui.body().textContent, /File not found in main/);
  assert.equal(ui.errors.length, 1);
  assert.match(ui.errors[0], /Could not go to src\/a\.js/);
  assert.deepEqual(
    available(ui.workspace()),
    [true, false],
    'The pointer stays on the last restored point, so Back returns there.',
  );
  ui.app.fileReply = undefined;
  const retry = ui
    .workspace()
    .querySelectorAll('button')
    .find(node => node.textContent === 'Retry');
  assert.ok(retry);
  await ui.settle(retry.fire('click'));
  assert.doesNotMatch(ui.body().textContent, /File not found/);
  await traverse(ui, ui.workspace(), 'Back');
  assert.equal(ui.selection().active, paths[1]);
  assert.equal(ui.body().scrollTop, 440, 'The unmoved pointer still names the last restored file.');
  await traverse(ui, ui.workspace(), 'Back');
  assert.equal(ui.selection().active, paths[0]);
  assert.equal(ui.body().scrollTop, 660);
  assert.equal(ui.errors.length, 1);
});

test('a Back that resolves after a newer open neither restores nor commits', async t => {
  const ui = fixture(t, 'github');
  await ui.navigate(ui.root);
  await ui.open(paths[0]);
  await ui.scroll(660, 0);
  await ui.open(paths[1]);
  await ui.scroll(440, 0);
  const late = deferred();
  ui.app.fileReply = message => (message.path === paths[0] ? late.promise : undefined);
  const pending = historyControls(ui.workspace()).back.fire('click');
  await ui.drain();
  await ui.open(paths[2]);
  late.resolve('LATE BACK MUST NOT ENTER THE ACTIVE VIEW');
  await ui.settle(pending);
  ui.app.fileReply = undefined;
  assert.equal(ui.selection().active, paths[2]);
  assert.equal(ui.body().scrollTop, 0);
  assert.doesNotMatch(ui.body().textContent, /LATE BACK/);
  await traverse(ui, ui.workspace(), 'Back');
  assert.equal(ui.selection().active, paths[1], 'The stale Back did not move the pointer to the first file.');
  assert.equal(ui.body().scrollTop, 440);
  assert.deepEqual(ui.errors, []);
});

test('inline history is cleared by branch changes and Refresh', async t => {
  const ui = fixture(t, 'github');
  await ui.navigate(ui.root);
  await ui.open(paths[0]);
  await ui.open(paths[1]);
  assert.deepEqual(available(ui.workspace()), [true, false]);
  await ui.branch('feature');
  assert.deepEqual(available(ui.workspace()), [false, false], 'A branch change starts a new history.');
  await ui.open(paths[0]);
  assert.deepEqual(available(ui.workspace()), [true, false]);
  await ui.settle(ui.app.refresh());
  assert.deepEqual(available(ui.workspace()), [false, false], 'Refresh starts a new history.');
  assert.deepEqual(ui.errors, []);
});

test('inline entries recorded for other review revisions are not applied', async t => {
  const ui = fixture(t, 'github');
  await ui.navigate(ui.review(41));
  await ui.scroll(660, 0);
  await ui.open(paths[1]);
  assert.deepEqual(available(ui.workspace()), [true, false]);
  // Re-render the same workspace against a replaced head revision without a workspace load.
  ui.app.state.diff = {...ui.app.state.diff, head: {...ui.app.state.diff.head, sha: 'e'.repeat(40)}};
  ui.replaceMain();
  await ui.drain();
  assert.equal(ui.selection().active, paths[1]);
  assert.deepEqual(available(ui.workspace()), [false, false], 'Entries for the previous head are inapplicable.');
  const requests = ui.files.length;
  await ui.settle(historyControls(ui.workspace()).back.fire('click'));
  assert.equal(ui.selection().active, paths[1]);
  assert.equal(ui.files.length, requests);
  assert.deepEqual(ui.errors, []);
});

/** Composes the production View full dialog around three changed files with controlled revisions. */
function modalFixture(t) {
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
  const data = pairedRevision();
  const errors = [];
  const app = createRoot(dispose => {
    const state = createState();
    state.context = {origin: 'https://github.com', provider: 'github', owner: 'sample', repo: 'repo', kind: 'pull'};
    state.diff = {
      base: {owner: 'sample', repo: 'repo', sha: baseSHA},
      head: {owner: 'sample', repo: 'repo', sha: reviewSHA},
      files: paths.map(filename => ({filename, ...data.file})),
    };
    const app = {
      owner: getOwner(),
      state,
      dispose,
      view: {viewer},
      toast: text => errors.push(text),
      run: callback => {
        const owned = withOwner(callback);
        return (...args) =>
          Promise.resolve()
            .then(() => owned(...args))
            .catch(error => errors.push(error.message));
      },
      diffURL: async () => 'https://github.com/sample/repo/pull/1/files',
      async rpc(type, message) {
        assert.equal(type, 'FILE');
        return message.source.sha === baseSHA ? data.before : data.after;
      },
    };
    Object.assign(app, untrackActions(content.createViewer(app)));
    return app;
  });
  t.after(app.dispose);

  /** Completes asynchronous file loads and owned frames. */
  async function settle(operation) {
    await operation;
    for (let index = 0; index < 5; index++) {
      clock.flush();
      await turn();
    }
  }
  return {
    app,
    viewer,
    document,
    window,
    clock,
    errors,
    settle,
    /** The open file's visible title. */
    path: () => viewer.querySelector('.viewer-heading').querySelector('strong').textContent,
    body: () => viewer.querySelector('.viewer-body'),
    /** Opens a changed file from outside the dialog, as the sidebar does. */
    show: path => settle(app.showDiff(content.diffNode(state().files.find(file => file.filename === path)))),
    /** Clicks a public bottom-bar file control. */
    step: label => settle(viewer.querySelector(`[aria-label="${label}"]`).fire('click')),
  };

  /** Reads the dialog's current diff state. */
  function state() {
    return app.state.diff;
  }
}

/** Scrolls the unified modal viewport through its real scroll listener. */
async function modalScroll(ui, top) {
  const body = ui.body();
  body.scrollTop = top;
  await body.fire('scroll');
  ui.clock.flush();
}

test('View full Back and Forward restore previous/next changed files and keep Close last', async t => {
  const ui = modalFixture(t);
  await ui.show(paths[0]);
  assert.deepEqual(available(ui.viewer), [false, false], 'The initial open records only its start point.');
  const actions = ui.viewer.querySelector('.viewer-actions');
  assert.equal(actions.querySelectorAll('button').at(-1).getAttribute('aria-label'), 'Close viewer');
  const order = actions.children;
  assert.ok(
    order.indexOf(actions.querySelector('.viewer-history')) < order.indexOf(actions.querySelector('.viewer-tools')),
    'History controls precede the find tools.',
  );
  await modalScroll(ui, 880);
  await ui.step('Next changed file');
  assert.equal(ui.path(), paths[1]);
  await modalScroll(ui, 440);
  await traverse(ui, ui.viewer, 'Back');
  assert.equal(ui.path(), paths[0]);
  assert.equal(ui.body().scrollTop, 880);
  assert.deepEqual(available(ui.viewer), [false, true]);
  assert.equal(
    ui.viewer.querySelector('.viewer-actions').querySelectorAll('button').at(-1).getAttribute('aria-label'),
    'Close viewer',
    'Re-created shells keep Close last.',
  );
  await traverse(ui, ui.viewer, 'Forward');
  assert.equal(ui.path(), paths[1]);
  assert.equal(ui.body().scrollTop, 440);
  assert.deepEqual(available(ui.viewer), [true, false]);
  ui.viewer.close();
  await ui.settle();
  await ui.show(paths[1]);
  assert.deepEqual(available(ui.viewer), [false, false], 'Closing the dialog clears its history.');
  assert.deepEqual(ui.errors, []);
});

test('View full history restores exact Old and New rows in either diff layout', async t => {
  const ui = modalFixture(t);
  await ui.show(paths[0]);
  await layout(ui, ui.viewer, 'Side-by-side');
  const panes = () => ui.body().querySelectorAll('.split-diff-pane');
  await goToLine(ui, ui.viewer, ui.body(), 22, 'Old');
  assert.deepEqual(
    panes().map(pane => pane.scrollTop),
    [21 * 22, 21 * 22],
  );
  await goToLine(ui, ui.viewer, ui.body(), 22, 'New');
  assert.deepEqual(
    panes().map(pane => pane.scrollTop),
    [21 * 22, 21 * 22],
    'Old 22 and New 22 share one split row.',
  );
  await goToLine(ui, ui.viewer, ui.body(), 110, 'New');
  await ui.step('Next changed file');
  await layout(ui, ui.viewer, 'Unified');
  await traverse(ui, ui.viewer, 'Back');
  assert.equal(ui.path(), paths[0]);
  assert.equal(ui.body().scrollTop, 112 * 22);
  await traverse(ui, ui.viewer, 'Back');
  assert.equal(ui.body().scrollTop, 24 * 22, 'The New row is restored, not its paired Old row.');
  await traverse(ui, ui.viewer, 'Back');
  assert.equal(ui.body().scrollTop, 21 * 22, 'The exact Old row is restored.');
  await layout(ui, ui.viewer, 'Side-by-side');
  assert.deepEqual(
    panes().map(pane => pane.scrollTop),
    [21 * 22, 21 * 22],
  );
  await traverse(ui, ui.viewer, 'Forward');
  await layout(ui, ui.viewer, 'Unified');
  assert.equal(ui.body().scrollTop, 24 * 22, 'Split restoration keeps the canonical New anchor.');
  assert.deepEqual(ui.errors, []);
});
