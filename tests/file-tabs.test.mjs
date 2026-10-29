/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * In-page file navigation regressions through the production content factories.
 * Provider/API and stylesheet completion are controlled; these fixtures do not
 * establish installed-browser or authenticated API behavior.
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

const directory = await mkdtemp(join(tmpdir(), 'codetree-file-tabs-'));
const modulePath = join(directory, 'content.mjs');
// The same suite runs against the pre-feature checkout: old tree/branch handlers
// must fail the visible behavior assertions, rather than fail an absent import.
await writeFile(
  modulePath,
  await bundle({
    fileTabs: existsSync(new URL('../src/content/viewer/file-tabs.js', import.meta.url)),
    quickOpen: true,
  }),
);
const content = await import(pathToFileURL(modulePath));
await rm(directory, {recursive: true, force: true});
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
function fixture(t, provider, reviewDiff, {search = false, review = {}, quickOpen = false} = {}) {
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
        ...(quickOpen ? [content.createQuickOpen] : []),
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

for (const provider of ['github', 'gitlab']) {
  test(`${provider} ordinary tree clicks open and close file tabs without native navigation`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await ui.open(paths[1]);
    assert.deepEqual(ui.selection(), {paths: paths.slice(0, 2), active: paths[1]});
    await ui.close(paths[1]);
    assert.deepEqual(ui.selection(), {paths: [paths[0]], active: paths[0]});
    assert.equal(ui.body().scrollTop, 0);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Ctrl/Cmd-click preserves browser-tab file navigation`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0], {ctrlKey: true});
    await ui.open(paths[1], {metaKey: true});
    assert.deepEqual(ui.opened, [
      [ui.blob('main', paths[0]), '_blank', 'noopener'],
      [ui.blob('main', paths[1]), '_blank', 'noopener'],
    ]);
    assert.deepEqual(ui.assigned, []);
  });

  test(`${provider} branch changes retain tabs and restore vertical and horizontal positions per branch`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await ui.scroll(880, 75);
    await ui.open(paths[1]);
    await ui.scroll(440, 25);
    await ui.branch('feature');
    assert.deepEqual(ui.selection(), {paths: paths.slice(0, 2), active: paths[1]});
    assert.equal(ui.body().scrollTop, 0);
    await ui.scroll(1320, 95);
    await ui.branch('main');
    assert.equal(ui.body().scrollTop, 440);
    assert.equal(ui.body().scrollLeft, 25);
    await ui.open(paths[0]);
    assert.equal(ui.body().scrollTop, 880);
    assert.equal(ui.body().scrollLeft, 75);
    await ui.branch('feature');
    await ui.open(paths[1]);
    assert.equal(ui.body().scrollTop, 1320);
    assert.equal(ui.body().scrollLeft, 95);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} missing branch files stay open with retry, default-branch and close actions`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[2]);
    await ui.scroll(660, 65);
    await ui.branch('feature');
    assert.deepEqual(ui.selection(), {paths: [paths[2]], active: paths[2]});
    assert.match(ui.body().textContent, /File not found in feature/);
    const retry = ui
      .workspace()
      .querySelectorAll('button')
      .find(node => node.textContent === 'Retry');
    assert.ok(retry);
    await ui.settle(retry.fire('click'));
    assert.match(ui.body().textContent, /File not found in feature/);
    const fallback = ui
      .workspace()
      .querySelectorAll('button')
      .find(node => node.textContent === 'Open in main');
    assert.ok(fallback);
    await ui.settle(fallback.fire('click'));
    assert.equal(ui.assigned.pop(), ui.blob('main', paths[2]));
    await ui.navigate(ui.blob('main', paths[2]));
    assert.equal(ui.body().scrollTop, 660);
    assert.equal(ui.body().scrollLeft, 65);
    await ui.branch('feature');
    await ui.close(paths[2]);
    assert.equal(globalThis.document.getElementById('codetree-file-workspace').hidden, false);
    assert.equal(ui.workspace().querySelector('.file-tab-recovery').hidden, false);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} review workspaces restore their own tabs after another review and Code`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[2]);
    await ui.scroll(220, 15);
    await ui.navigate(ui.review(41));
    await ui.open(paths[1]);
    await ui.scroll(880, 80);
    await ui.navigate(ui.review(42));
    await ui.open(paths[0]);
    await ui.scroll(440, 40);
    await ui.navigate(ui.review(41));
    assert.deepEqual(ui.selection(), {paths: paths.slice(0, 2), active: paths[1]});
    assert.equal(ui.body().scrollTop, 880);
    assert.equal(ui.body().scrollLeft, 80);
    await ui.branch('main');
    assert.deepEqual(ui.selection(), {paths: [paths[2]], active: paths[2]});
    assert.equal(ui.body().scrollTop, 220);
    await ui.navigate(ui.review(42));
    assert.deepEqual(ui.selection(), {paths: [paths[0]], active: paths[0]});
    assert.equal(ui.body().scrollTop, 440);
    assert.equal(ui.body().scrollLeft, 40);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Refresh and page reload preserve active tab instead of the original blob URL`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.blob('main', paths[0]));
    await ui.open(paths[1]);
    await ui.scroll(1100, 90);
    await ui.settle(ui.app.refresh());
    assert.equal(ui.selection().active, paths[1]);
    assert.equal(ui.body().scrollTop, 1100);
    await ui.reload();
    assert.equal(ui.selection().active, paths[1]);
    assert.equal(ui.body().scrollTop, 1100);
    assert.equal(ui.body().scrollLeft, 90);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} closing every review tab survives leaving and returning`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.review(41));
    await ui.open(paths[0]);
    const workspace = ui.workspace();
    await ui.close(paths[0]);
    await ui.navigate(ui.review(42));
    await ui.navigate(ui.review(41));
    assert.equal(workspace.querySelectorAll('.file-tab-name').length, 0);
    const host = globalThis.document.getElementById('codetree-file-workspace');
    assert.ok(!host || host.hidden, 'An intentionally empty review does not reopen a file.');
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} late file replies cannot replace the newer active file or route`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    const old = deferred();
    ui.app.fileReply = message => (message.path === paths[1] ? old.promise : undefined);
    const pending = ui.open(paths[1]);
    await ui.drain();
    await ui.open(paths[0]);
    old.resolve('OLD FILE MUST NOT ENTER THE ACTIVE VIEW');
    await ui.settle(pending);
    assert.equal(ui.selection().active, paths[0]);
    assert.doesNotMatch(ui.body().textContent, /OLD FILE MUST NOT/);
    const previous = deferred();
    ui.app.fileReply = message => (message.path === paths[1] ? previous.promise : undefined);
    const leaving = ui.open(paths[1]);
    await ui.drain();
    await ui.navigate(ui.review(42));
    previous.resolve('OLD ROUTE MUST NOT ENTER THE REVIEW');
    await ui.settle(leaving);
    assert.equal(ui.selection().active, paths[0]);
    assert.doesNotMatch(ui.body().textContent, /OLD ROUTE MUST NOT/);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} stylesheet reattachment waits for new layout before restoring scroll`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await ui.scroll(1540, 110);
    const requests = ui.files.length;
    ui.replaceMain();
    await ui.drain(6, false);
    assert.equal(ui.files.length, requests, 'A replacement stylesheet must load before another file render.');
    assert.doesNotMatch(ui.body().textContent, /export const line/);
    await ui.loadStyles();
    await ui.drain();
    assert.equal(ui.body().scrollTop, 1540);
    assert.equal(ui.body().scrollLeft, 110);
    assert.ok(ui.body().querySelectorAll('.code-row').length < 50, 'The restored viewport remains bounded.');
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} in-flight file replies wait for the replacement stylesheet before restoring position`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[1]);
    await ui.scroll(1760, 125);
    await ui.open(paths[0]);
    const old = deferred();
    ui.app.fileReply = message => (message.path === paths[1] ? old.promise : undefined);
    const opening = ui.open(paths[1]);
    await ui.drain();
    const requests = ui.files.length;
    ui.replaceMain();
    old.resolve(longText);
    await ui.drain(6, false);
    assert.equal(ui.files.length, requests, 'The restarted render waits for the latest linked sheet.');
    assert.equal(
      ui.body().querySelectorAll('.code-row').length,
      0,
      'A stale reply cannot render into an unstyled viewport.',
    );
    await ui.loadStyles();
    await ui.settle(opening);
    await ui.drain();
    assert.equal(ui.selection().active, paths[1]);
    assert.equal(ui.body().scrollTop, 1760);
    assert.equal(ui.body().scrollLeft, 125);
    assert.ok(ui.body().querySelectorAll('.code-row').length < 50);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} a later native main mount resumes the selected file automatically`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    ui.removeMain();
    await ui.open(paths[0]);
    assert.equal(ui.files.length, 0, 'Detached workspaces do not fetch or draw unbounded content.');
    ui.replaceMain();
    await ui.drain();
    assert.equal(ui.selection().active, paths[0]);
    assert.match(ui.body().textContent, /export const line/);
    assert.ok(ui.body().querySelectorAll('.code-row').length < 50);
    assert.deepEqual(ui.errors, []);
  });
}

/** Unequal replacement makes post-change unified and split coordinates observably different. */
function splitRevision() {
  const before = Array.from({length: 220}, (_, index) => `export const source${index + 1} = ${index + 1};`);
  before[100] = '// ' + 'wide source '.repeat(90);
  const added = ['export const replacementA = true;', 'export const replacementB = false;'];
  return {
    before: before.join('\n'),
    after: [...before.slice(0, 4), ...added, ...before.slice(9)].join('\n'),
    file: {
      status: 'modified',
      additions: 2,
      deletions: 5,
      patch: ['@@ -5,5 +5,2 @@', ...before.slice(4, 9).map(line => '-' + line), ...added.map(line => '+' + line)].join(
        '\n',
      ),
    },
  };
}

/** Clicks the visible layout control, requiring the feature rather than assigning internal state. */
async function diffLayout(ui, scope, label) {
  const controls = scope.querySelector('.diff-layout');
  assert.ok(controls, 'Changed files expose the Unified / Side-by-side layout control.');
  const target = controls.querySelectorAll('button').find(button => button.textContent === label);
  assert.ok(target, `Expected ${label} layout control`);
  await ui.settle(target.fire('click'));
  assert.equal(target.getAttribute('aria-pressed'), 'true');
  assert.equal(
    controls.querySelectorAll('button').filter(button => button.getAttribute('aria-pressed') === 'true').length,
    1,
  );
}

/** Returns the two visible revision viewports in their Old/New order. */
function diffPanes(scope) {
  const panes = scope.querySelectorAll('.split-diff-pane');
  assert.equal(panes.length, 2, 'Side-by-side displays both source revisions.');
  assert.deepEqual(
    panes.map(pane => pane.getAttribute('aria-label')),
    ['Old revision', 'New revision'],
  );
  return panes;
}

/** Delivers a real pane scroll event and drains the renderer's owned frame. */
async function paneScroll(ui, pane, top, left) {
  pane.scrollTop = top;
  pane.scrollLeft = left;
  await pane.fire('scroll');
  await ui.drain();
}

/** Visible coordinates of both panes, without reading renderer or projection state. */
function panePositions(scope) {
  // Fractional row-coordinate conversions may differ by a few floating-point ULPs.
  return diffPanes(scope).map(pane => ({top: Math.round(pane.scrollTop * 1e6) / 1e6, left: pane.scrollLeft}));
}

/** One complete patch contains four distinct runs, including one-sided blocks and a clamped final block. */
function changeRevision() {
  const before = Array.from({length: 260}, (_, index) => `export const source${index + 1} = ${index + 1};`);
  before[100] = '// ' + 'wide source '.repeat(90);
  const edits = [
    {start: 20, remove: 2, add: ['export const firstReplacement = true;']},
    {start: 79, remove: 0, add: ['export const secondAddedA = true;', 'export const secondAddedB = false;']},
    {start: 159, remove: 3, add: []},
    {
      start: 258,
      remove: 1,
      add: ['export const finalAddedA = true;', 'export const finalAddedB = false;', 'export const finalAddedC = 3;'],
    },
  ];
  const after = [];
  const patch = [];
  let cursor = 0;
  for (const edit of edits) {
    const context = before.slice(cursor, edit.start);
    after.push(...context, ...edit.add);
    patch.push(...context.map(line => ' ' + line));
    patch.push(...before.slice(edit.start, edit.start + edit.remove).map(line => '-' + line));
    patch.push(...edit.add.map(line => '+' + line));
    cursor = edit.start + edit.remove;
  }
  after.push(...before.slice(cursor));
  patch.push(...before.slice(cursor).map(line => ' ' + line));
  return {
    before: before.join('\n'),
    after: after.join('\n'),
    file: {
      status: 'modified',
      additions: 6,
      deletions: 6,
      patch: [`@@ -1,${before.length} +1,${after.length} @@`, ...patch].join('\n'),
    },
  };
}

/** Reads the visible, accessible feature so the same tests fail against the pre-feature production bundle. */
function changeControls(scope) {
  const group = scope.querySelector('.diff-changes');
  assert.ok(group, 'A loaded diff exposes change-block navigation.');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'Change blocks');
  const control = label => {
    const node = group.querySelectorAll('button').find(button => button.getAttribute('aria-label') === label);
    assert.ok(node, `Expected ${label} control`);
    assert.ok(node.classList.contains('icon-button'), 'Change navigation uses the shared icon-button component.');
    assert.ok(node.querySelector('svg'), 'Change navigation uses an original SVG icon.');
    return node;
  };
  const count = group.querySelector('[role="status"]');
  assert.ok(count, 'The current block and total are exposed as a status.');
  return {
    group,
    count,
    previous: control('Previous change block'),
    next: control('Next change block'),
  };
}

/** Clicks an owned change navigation button and finishes its scheduled viewport update. */
async function changeStep(ui, controls, direction = 'next') {
  await ui.settle(controls[direction].fire('click'));
  await ui.drain(1);
}

for (const provider of ['github', 'gitlab']) {
  for (const layout of ['Unified', 'Side-by-side']) {
    test(`${provider} ${layout} change-block navigation counts runs, reveals offscreen rows and cycles`, async t => {
      const ui = fixture(t, provider, changeRevision());
      await ui.navigate(ui.review(41));
      const controls = changeControls(ui.workspace());
      await diffLayout(ui, ui.workspace(), layout);
      assert.equal(controls.count.textContent, '0 / 4', 'No change block is initially visible.');
      assert.equal(controls.previous.disabled, false);
      assert.equal(controls.next.disabled, false);
      assert.doesNotMatch(ui.body().textContent, /secondAddedA|finalAddedA/);
      const requests = ui.files.length;
      const split = layout === 'Side-by-side';
      const starts = split ? [20, 79, 161, 260] : [20, 80, 162, 261];
      const end = (split ? 264 : 266) * 22 - 290;
      const markers = [/firstReplacement/, /secondAddedA/, /source160/, /finalAddedA/];
      for (let index = 0; index < starts.length; index++) {
        await changeStep(ui, controls);
        assert.equal(controls.count.textContent, `${index + 1} / 4`);
        assert.equal(controls.count.getAttribute('aria-label'), `Change block ${index + 1} of 4`);
        const expectedTop = Math.min(starts[index] * 22, end);
        if (split)
          assert.deepEqual(panePositions(ui.body()), [
            {top: expectedTop, left: 0},
            {top: expectedTop, left: 0},
          ]);
        else assert.equal(ui.body().scrollTop, expectedTop);
        assert.match(ui.body().textContent, markers[index], 'The selected source block enters the virtual DOM.');
        const viewports = split ? diffPanes(ui.body()) : [ui.body()];
        for (const viewport of viewports) assert.ok(viewport.querySelectorAll('.code-row').length < 50);
      }
      await changeStep(ui, controls);
      assert.equal(controls.count.textContent, '1 / 4', 'Next wraps from the last block to the first.');
      await changeStep(ui, controls, 'previous');
      assert.equal(controls.count.textContent, '4 / 4', 'Previous wraps to the final block despite scroll clamping.');
      if (split) await paneScroll(ui, diffPanes(ui.body())[1], 100 * 22, 85);
      else {
        await ui.scroll(100 * 22, 85);
        await ui.drain(1);
      }
      assert.equal(controls.count.textContent, '2 / 4', 'Manual scrolling follows the preceding change block.');
      await changeStep(ui, controls);
      assert.equal(controls.count.textContent, '3 / 4');
      if (split)
        assert.deepEqual(panePositions(ui.body()), [
          {top: 161 * 22, left: 85},
          {top: 161 * 22, left: 85},
        ]);
      else assert.deepEqual({top: ui.body().scrollTop, left: ui.body().scrollLeft}, {top: 162 * 22, left: 85});
      assert.equal(ui.files.length, requests, 'Block navigation reuses the loaded revisions.');
      assert.deepEqual(ui.errors, []);
    });
  }

  test(`${provider} change-block counters follow saved source positions across tabs, layouts and PR/MR workspaces`, async t => {
    const ui = fixture(t, provider, changeRevision());
    await ui.navigate(ui.review(41));
    let controls = changeControls(ui.workspace());
    await changeStep(ui, controls);
    await changeStep(ui, controls);
    assert.equal(controls.count.textContent, '2 / 4');
    await ui.open(paths[1]);
    controls = changeControls(ui.workspace());
    assert.equal(controls.count.textContent, '0 / 4', 'A newly opened file starts at its own source position.');
    for (let index = 0; index < 3; index++) await changeStep(ui, controls);
    assert.equal(controls.count.textContent, '3 / 4');
    await ui.open(paths[0]);
    assert.equal(changeControls(ui.workspace()).count.textContent, '2 / 4');
    assert.equal(ui.body().scrollTop, 80 * 22);
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    assert.equal(changeControls(ui.workspace()).count.textContent, '2 / 4');
    assert.deepEqual(panePositions(ui.body()), [
      {top: 79 * 22, left: 0},
      {top: 79 * 22, left: 0},
    ]);
    await ui.navigate(ui.review(42));
    controls = changeControls(ui.workspace());
    assert.equal(controls.count.textContent, '0 / 4', 'A separate PR/MR has an independent saved source position.');
    for (let index = 0; index < 3; index++) await changeStep(ui, controls);
    await ui.navigate(ui.review(41));
    assert.equal(changeControls(ui.workspace()).count.textContent, '2 / 4');
    assert.deepEqual(panePositions(ui.body()), [
      {top: 79 * 22, left: 0},
      {top: 79 * 22, left: 0},
    ]);
    await diffLayout(ui, ui.workspace(), 'Unified');
    assert.equal(changeControls(ui.workspace()).count.textContent, '2 / 4');
    assert.equal(ui.body().scrollTop, 80 * 22);
    await ui.open(paths[1]);
    assert.equal(changeControls(ui.workspace()).count.textContent, '3 / 4');
    assert.equal(ui.body().scrollTop, 162 * 22);
    await ui.navigate(ui.review(42));
    assert.equal(changeControls(ui.workspace()).count.textContent, '3 / 4');
    assert.equal(ui.body().scrollTop, 162 * 22);
    await ui.branch('main');
    await ui.open(paths[0]);
    assert.equal(
      ui.workspace().querySelector('.diff-changes'),
      null,
      'Plain Code files have no change-block controls.',
    );
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} change-block counters and positions stay independent in inline tabs and actual View full`, async t => {
    const ui = fixture(t, provider, changeRevision());
    await ui.navigate(ui.review(41));
    const inline = changeControls(ui.workspace());
    await changeStep(ui, inline);
    await changeStep(ui, inline);
    const file = ui.app.state.diff.files[0];
    await ui.settle(ui.app.showDiff({...file, path: file.filename, adds: file.additions, dels: file.deletions}));
    const modal = ui.app.view.viewer;
    const full = changeControls(modal);
    assert.equal(full.count.textContent, '0 / 4');
    for (let index = 0; index < 3; index++) await changeStep(ui, full);
    assert.equal(full.count.textContent, '3 / 4');
    assert.equal(inline.count.textContent, '2 / 4');
    assert.equal(ui.body().scrollTop, 80 * 22);
    const requests = ui.files.length;
    await diffLayout(ui, modal, 'Side-by-side');
    assert.equal(full.count.textContent, '3 / 4');
    assert.equal(inline.count.textContent, '2 / 4');
    assert.deepEqual(panePositions(modal), [
      {top: 161 * 22, left: 0},
      {top: 161 * 22, left: 0},
    ]);
    assert.deepEqual(panePositions(ui.body()), [
      {top: 79 * 22, left: 0},
      {top: 79 * 22, left: 0},
    ]);
    await changeStep(ui, inline, 'previous');
    assert.equal(inline.count.textContent, '1 / 4');
    assert.equal(full.count.textContent, '3 / 4', 'An inline jump does not change the modal counter.');
    await changeStep(ui, full);
    assert.equal(full.count.textContent, '4 / 4');
    assert.deepEqual(panePositions(ui.body()), [
      {top: 20 * 22, left: 0},
      {top: 20 * 22, left: 0},
    ]);
    assert.equal(ui.files.length, requests);
    ui.app.closeViewer();
    await ui.open(paths[1]);
    await ui.open(paths[0]);
    assert.equal(changeControls(ui.workspace()).count.textContent, '1 / 4');
    await diffLayout(ui, ui.workspace(), 'Unified');
    assert.equal(ui.body().scrollTop, 20 * 22, 'View full cannot overwrite the inline navigation position.');
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} change-block controls disposed by tab or PR/MR changes cannot move another file`, async t => {
    const ui = fixture(t, provider, changeRevision());
    await ui.navigate(ui.review(41));
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    const old = changeControls(ui.workspace());
    const oldPane = diffPanes(ui.body())[0];
    await changeStep(ui, old);
    await ui.open(paths[1]);
    const current = changeControls(ui.workspace());
    await changeStep(ui, current);
    await changeStep(ui, current);
    await ui.app.rememberFileTabs();
    const stored = structuredClone([...ui.metadata]);
    assert.equal(old.group.isConnected, false);
    await changeStep(ui, old);
    await changeStep(ui, old, 'previous');
    await paneScroll(ui, oldPane, 200 * 22, 95);
    assert.equal(current.count.textContent, '2 / 4');
    assert.deepEqual(panePositions(ui.body()), [
      {top: 79 * 22, left: 0},
      {top: 79 * 22, left: 0},
    ]);
    assert.deepEqual([...ui.metadata], stored, 'Detached controls cannot save another active file position.');
    await ui.navigate(ui.review(42));
    const review = changeControls(ui.workspace());
    assert.equal(review.count.textContent, '0 / 4');
    await changeStep(ui, current);
    await changeStep(ui, current, 'previous');
    assert.equal(review.count.textContent, '0 / 4');
    assert.deepEqual(panePositions(ui.body()), [
      {top: 0, left: 0},
      {top: 0, left: 0},
    ]);
    assert.deepEqual(ui.errors, []);
  });
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} Split diff switches inline layout without refetching and keeps post-change position`, async t => {
    const ui = fixture(t, provider, splitRevision());
    await ui.navigate(ui.review(41));
    const initialControls = ui.workspace().querySelector('.diff-layout');
    assert.ok(initialControls, 'Changed files expose their layout controls.');
    assert.equal(initialControls.querySelectorAll('button')[0].getAttribute('aria-pressed'), 'true');
    await ui.scroll(1107, 75); // unified row 50 + 7px; split removes two added-only rows above it.
    const requests = ui.files.length;
    for (let repeat = 0; repeat < 2; repeat++) {
      await diffLayout(ui, ui.workspace(), 'Side-by-side');
      assert.deepEqual(panePositions(ui.body()), [
        {top: 1063, left: 75},
        {top: 1063, left: 75},
      ]);
      await diffLayout(ui, ui.workspace(), 'Unified');
      assert.equal(ui.body().scrollTop, 1107);
      assert.equal(ui.body().scrollLeft, 75);
    }
    assert.equal(ui.files.length, requests, 'Layout changes reuse both already-loaded revisions.');
    assert.equal(ui.workspace().querySelectorAll('.viewer-bottom').length, 1);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Split diff preserves the added source line through pairing and a fresh page reload`, async t => {
    const ui = fixture(t, provider, splitRevision());
    await ui.navigate(ui.review(41));
    await ui.scroll(227, 41); // second added row: unified index 10, split pair index 5, fractional offset 7.
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    assert.deepEqual(panePositions(ui.body()), [
      {top: 117, left: 41},
      {top: 117, left: 41},
    ]);
    await ui.open(paths[1]);
    await ui.open(paths[0]);
    assert.deepEqual(panePositions(ui.body()), [
      {top: 117, left: 41},
      {top: 117, left: 41},
    ]);
    await diffLayout(ui, ui.workspace(), 'Unified');
    assert.equal(
      Math.round(ui.body().scrollTop * 1e6) / 1e6,
      227,
      'An added line does not silently become the paired removed line.',
    );
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    await ui.reload();
    assert.equal(ui.body().querySelectorAll('.split-diff-pane').length, 0, 'A fresh page defaults to Unified.');
    assert.equal(
      Math.round(ui.body().scrollTop * 1e6) / 1e6,
      227,
      'Session metadata stores the source position, not split pixels.',
    );
    assert.equal(ui.body().scrollLeft, 41);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Split diff restores each file after pane scrolling, Refresh and reload`, async t => {
    const ui = fixture(t, provider, splitRevision());
    await ui.navigate(ui.review(41));
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    await paneScroll(ui, diffPanes(ui.body())[1], 1063, 125);
    assert.deepEqual(panePositions(ui.body()), [
      {top: 1063, left: 125},
      {top: 1063, left: 125},
    ]);
    await ui.open(paths[1]);
    await paneScroll(ui, diffPanes(ui.body())[0], 1503, 85);
    await ui.open(paths[0]);
    assert.deepEqual(panePositions(ui.body()), [
      {top: 1063, left: 125},
      {top: 1063, left: 125},
    ]);
    await ui.settle(ui.app.refresh());
    assert.deepEqual(panePositions(ui.body()), [
      {top: 1063, left: 125},
      {top: 1063, left: 125},
    ]);
    await ui.reload();
    assert.equal(ui.body().scrollTop, 1107);
    assert.equal(ui.body().scrollLeft, 125);
    await ui.open(paths[1]);
    assert.equal(ui.body().scrollTop, 1547);
    assert.equal(ui.body().scrollLeft, 85);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Split diff keeps independent inline and View full positions while sharing the layout`, async t => {
    const ui = fixture(t, provider, splitRevision());
    await ui.navigate(ui.review(41));
    await ui.scroll(1107, 75);
    const file = ui.app.state.diff.files[0];
    await ui.settle(ui.app.showDiff({...file, path: file.filename, adds: file.additions, dels: file.deletions}));
    const modal = ui.app.view.viewer;
    const modalBody = modal.querySelector('.viewer-body');
    modalBody.scrollTop = 1547;
    modalBody.scrollLeft = 155;
    await modalBody.fire('scroll');
    const requests = ui.files.length;
    await diffLayout(ui, modal, 'Side-by-side');
    assert.deepEqual(panePositions(ui.body()), [
      {top: 1063, left: 75},
      {top: 1063, left: 75},
    ]);
    assert.deepEqual(panePositions(modal), [
      {top: 1503, left: 155},
      {top: 1503, left: 155},
    ]);
    await paneScroll(ui, diffPanes(modal)[1], 1943, 195);
    await diffLayout(ui, ui.workspace(), 'Unified');
    assert.equal(modalBody.scrollTop, 1987);
    assert.equal(modalBody.scrollLeft, 195);
    assert.equal(ui.body().scrollTop, 1107, 'Scrolling View full does not move the inline workspace.');
    assert.equal(ui.files.length, requests);
    ui.app.closeViewer();
    await ui.open(paths[1]);
    await ui.open(paths[0]);
    assert.equal(ui.body().scrollTop, 1107, 'Closing View full cannot overwrite the inline saved position.');
    assert.equal(ui.body().scrollLeft, 75);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Split diff review positions remain isolated across PR/MR workspaces and Code`, async t => {
    const ui = fixture(t, provider, splitRevision());
    await ui.navigate(ui.review(41));
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    await paneScroll(ui, diffPanes(ui.body())[0], 1063, 125);
    await ui.navigate(ui.review(42));
    await paneScroll(ui, diffPanes(ui.body())[1], 1503, 85);
    await ui.branch('main');
    await ui.open(paths[0]);
    assert.equal(ui.workspace().querySelectorAll('.diff-layout').length, 0, 'Plain Code files have no diff layout.');
    await ui.scroll(220, 0);
    await ui.navigate(ui.review(41));
    assert.deepEqual(panePositions(ui.body()), [
      {top: 1063, left: 125},
      {top: 1063, left: 125},
    ]);
    await diffLayout(ui, ui.workspace(), 'Unified');
    await ui.navigate(ui.review(42));
    assert.equal(ui.body().scrollTop, 1547);
    assert.equal(ui.body().scrollLeft, 85);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Split diff disposed file controls preserve the active position and metadata`, async t => {
    const ui = fixture(t, provider, splitRevision());
    await ui.navigate(ui.review(41));
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    const oldPanes = diffPanes(ui.body());
    const oldUnified = ui.workspace().querySelector('.diff-layout').querySelectorAll('button')[0];
    await paneScroll(ui, oldPanes[0], 1063, 125);
    const opening = ui.app.openFileTab({path: paths[1]});
    await oldPanes[0].fire('scroll'); // queue a frame while replacement is waiting for its metadata save.
    await ui.settle(opening);
    for (const pane of oldPanes) assert.equal(pane.listeners.get('scroll').length, 0);
    assert.equal(oldUnified.listeners.get('click').length, 0);
    await paneScroll(ui, diffPanes(ui.body())[0], 1503, 85);
    await ui.app.rememberFileTabs(); // Flush the active file's own pending save before probing stale callbacks.
    const stored = structuredClone([...ui.metadata]);
    await oldUnified.fire('click');
    await paneScroll(ui, oldPanes[1], 2200, 250);
    assert.deepEqual(panePositions(ui.body()), [
      {top: 1503, left: 85},
      {top: 1503, left: 85},
    ]);
    assert.deepEqual([...ui.metadata], stored, 'Detached controls preserve the current workspace metadata.');
    assert.equal(ui.selection().active, paths[1]);
    assert.ok(diffPanes(ui.body()).every(pane => pane.querySelectorAll('.code-row').length < 50));
    assert.deepEqual(ui.errors, []);
  });
}

/** Returns visible find controls through their accessible labels and status text. */
function findControls(scope) {
  const bar = scope.querySelector('.viewer-find');
  assert.ok(bar, 'A loaded file exposes its owned search controls.');
  const input = bar.querySelector('input');
  assert.equal(input?.getAttribute('aria-label'), 'Find in file');
  const control = label => {
    const button = bar.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label);
    assert.ok(button, `Expected ${label} search control`);
    return button;
  };
  return {
    bar,
    input,
    count: bar.querySelector('[role="status"]'),
    previous: control('Previous match'),
    next: control('Next match'),
    close: control('Close file search'),
  };
}

/** Opens find using the production window capture handler rather than invoking search internals. */
async function openFind(ui, scope, body, modifiers = {ctrlKey: true}) {
  body.focus();
  const event = keyEvent(body, 'f', modifiers);
  await ui.window.fire('keydown', event);
  assert.equal(event.defaultPrevented, true, 'The active viewer handles its find shortcut.');
  const controls = findControls(scope);
  assert.equal(controls.bar.hidden, false);
  assert.equal(ui.document.activeElement, controls.input);
  return controls;
}

/** Advances only the input debounce, after file loading and stylesheet work have completed. */
async function findText(t, ui, controls, query) {
  t.mock.timers.enable({apis: ['setTimeout']});
  try {
    controls.input.value = query;
    await controls.input.fire('input');
    t.mock.timers.tick(120);
    await Promise.resolve();
    ui.clock.flush();
  } finally {
    t.mock.timers.reset();
  }
  assert.equal(controls.input.getAttribute('aria-busy'), 'false', 'The completed query publishes its visible count.');
}

/** Dispatches Enter and Escape through the same active-viewer shortcut handler. */
async function findKey(ui, controls, key, modifiers) {
  const event = keyEvent(controls.input, key, modifiers);
  await ui.window.fire('keydown', event);
  ui.clock.flush();
  assert.equal(event.defaultPrevented, true);
}

/** Counts removed, added and distant context hits without counting shared context twice. */
function searchRevision() {
  const before = Array.from({length: 220}, (_, index) => `export const source${index + 1} = ${index + 1};`);
  before[20] = "const oldOnly = 'search beacon';";
  before[21] = "const oldPair = 'old branch';";
  before[22] = "const removedOnly = 'gone';";
  before[180] = '// search beacon in shared context';
  const added = ["const newOnly = 'search beacon';", "const newPair = 'new branch';"];
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

/** Opens source-line mode through the active viewer's keyboard handler and returns its shared field. */
async function openLine(ui, scope, body, modifiers = {ctrlKey: true}) {
  body.focus();
  const event = keyEvent(body, 'g', modifiers);
  await ui.window.fire('keydown', event);
  assert.equal(event.defaultPrevented, true, 'The active viewer handles its Go to line shortcut.');
  const bar = scope.querySelector('.viewer-find');
  assert.equal(bar?.hidden, false);
  assert.equal(bar.getAttribute('aria-label'), 'Go to line');
  const input = bar.querySelector('input');
  assert.equal(input.value, ':');
  assert.equal(ui.document.activeElement, input);
  return {bar, input};
}

/** Selects a source revision and submits a one-based line through Enter, without calling viewer internals. */
async function submitLine(ui, controls, number, side) {
  if (side) {
    const revisions = controls.bar.querySelector('.viewer-line-revision');
    assert.equal(revisions.hidden, false);
    const button = revisions.querySelectorAll('button').find(button => button.textContent === side);
    await button.fire('click');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
  }
  controls.input.value = `:${number}`;
  await controls.input.fire('input');
  await findKey(ui, controls, 'Enter');
  assert.equal(controls.bar.hidden, true, 'A successful jump closes the shared field.');
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} shared field preserves literal colon search and saves line jumps across tabs, branches and reload`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    const lines = longText.split('\n').map(line => line + ' '.repeat(150));
    lines[180] += '// private query :223';
    ui.app.fileReply = () => lines.join('\n');
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    const find = await openFind(ui, ui.workspace(), ui.body());
    await findText(t, ui, find, ':223');
    assert.equal(find.count.textContent, '1 / 1');
    assert.equal(find.bar.hidden, false, 'A colon query remains in literal Find mode.');
    const requests = ui.files.length;
    const line = await openLine(ui, ui.workspace(), ui.body());
    assert.equal(line.input, find.input);
    assert.equal(line.bar.querySelector('.viewer-line-revision').hidden, true, 'Plain files have no revision picker.');
    assert.equal(line.input.getAttribute('aria-label'), 'Line number');
    await submitLine(ui, line, 150);
    assert.equal(ui.body().scrollTop, 149 * 22);
    assert.equal(ui.files.length, requests);
    const restoredFind = await openFind(ui, ui.workspace(), ui.body(), {metaKey: true});
    assert.equal(restoredFind.input.value, ':223');
    // Cancel the restored query's debounce with a line jump before saving its position.
    await submitLine(ui, await openLine(ui, ui.workspace(), ui.body(), {metaKey: true}), 150);
    await ui.open(paths[1]);
    await ui.open(paths[0]);
    assert.equal(ui.body().scrollTop, 149 * 22);
    await ui.branch('feature');
    assert.equal(ui.body().scrollTop, 0, 'A new branch starts with its own position.');
    await submitLine(ui, await openLine(ui, ui.workspace(), ui.body()), 180);
    assert.equal(ui.body().scrollTop, 179 * 22);
    await ui.branch('main');
    assert.equal(ui.body().scrollTop, 149 * 22);
    await ui.reload();
    assert.equal(ui.body().scrollTop, 149 * 22, 'The jump flows through ordinary session-position saves.');
    assert.equal(findControls(ui.workspace()).bar.hidden, true);
    assert.doesNotMatch(JSON.stringify([...ui.metadata]), /:223|private query/);
    assert.ok(ui.body().querySelectorAll('.code-row').length < 50);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Go to line maps Old/New diff lines in both layouts and restores their source anchor across tabs`, async t => {
    const ui = fixture(t, provider, searchRevision(), {search: true});
    await ui.navigate(ui.review(41));
    const requests = ui.files.length;
    for (const display of ['Unified', 'Side-by-side']) {
      await diffLayout(ui, ui.workspace(), display);
      for (const [side, number, unifiedRow, splitRow, source] of [
        ['New', 21, 23, 20, 'newOnly'],
        ['Old', 23, 22, 22, 'removedOnly'],
        ['New', 110, 112, 110, 'source111'],
      ]) {
        const line = await openLine(ui, ui.workspace(), ui.body(), {metaKey: true});
        await submitLine(ui, line, number, side);
        const panes = display === 'Unified' ? [ui.body()] : diffPanes(ui.body());
        for (const pane of panes) {
          assert.equal(pane.scrollTop, (display === 'Unified' ? unifiedRow : splitRow) * 22);
          assert.ok(pane.querySelectorAll('.code-row').length < 50);
        }
        assert.match(ui.body().textContent, new RegExp(source));
      }
    }
    assert.equal(ui.files.length, requests, 'Neither source-side selection nor layout changes refetch revisions.');
    await submitLine(ui, await openLine(ui, ui.workspace(), ui.body()), 21, 'New');
    await ui.open(paths[1]);
    await ui.open(paths[0]);
    assert.deepEqual(panePositions(ui.body()), [
      {top: 20 * 22, left: 0},
      {top: 20 * 22, left: 0},
    ]);
    await diffLayout(ui, ui.workspace(), 'Unified');
    assert.equal(ui.body().scrollTop, 23 * 22, 'The paired split row retains New rather than its Old counterpart.');
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Go to line gives View full priority and disposes controls after file and PR/MR switches`, async t => {
    const ui = fixture(t, provider, searchRevision(), {search: true});
    await ui.navigate(ui.review(41));
    const inline = await openFind(ui, ui.workspace(), ui.body());
    await findText(t, ui, inline, 'source110');
    const inlineTop = ui.body().scrollTop;
    const file = ui.app.state.diff.files[0];
    await ui.settle(ui.app.showDiff({...file, path: file.filename, adds: file.additions, dels: file.deletions}));
    const modal = ui.app.view.viewer;
    const modalBody = modal.querySelector('.viewer-body');
    const full = await openLine(ui, modal, modalBody, {metaKey: true});
    await submitLine(ui, full, 110, 'New');
    assert.equal(modalBody.scrollTop, 112 * 22);
    assert.equal(ui.body().scrollTop, inlineTop);
    assert.equal(inline.input.value, 'source110');
    assert.equal(inline.bar.getAttribute('role'), 'search');
    assert.equal(modal.open, true);
    await openLine(ui, modal, modalBody);
    await findKey(ui, full, 'Escape');
    assert.equal(modal.open, true);
    assert.equal(ui.document.activeElement, modalBody);
    ui.app.closeViewer();
    const old = await openLine(ui, ui.workspace(), ui.body());
    const revision = old.bar.querySelector('.viewer-line-revision').querySelectorAll('button')[1];
    await ui.open(paths[1]);
    assert.equal(old.bar.isConnected, false);
    assert.equal(old.input.listeners.get('input').length, 0);
    assert.equal(revision.listeners.get('click').length, 0);
    await revision.fire('click');
    const current = await openLine(ui, ui.workspace(), ui.body());
    await submitLine(ui, current, 120, 'New');
    assert.equal(ui.body().scrollTop, 122 * 22);
    await ui.navigate(ui.review(42));
    assert.equal(current.bar.isConnected, false);
    assert.equal(findControls(ui.workspace()).bar.hidden, true);
    assert.equal(ui.body().scrollTop, 0, 'A different PR/MR retains its separate position.');
    await current.input.fire('input');
    assert.equal(ui.body().scrollTop, 0);
    assert.deepEqual(ui.errors, []);
  });
}

/** Reads the inline review action through its visible label and accessible status. */
function fileReviewControls(ui) {
  const group = ui.workspace().querySelector('.file-review');
  assert.ok(group, 'A loaded review file exposes Viewed and next-unviewed navigation.');
  assert.equal(group.getAttribute('aria-label'), 'File review');
  const button = group.querySelector('button');
  const status = group.querySelector('[role="status"]');
  assert.ok(button?.classList.contains('small-button'), 'Review navigation uses the shared button component.');
  assert.ok(button.querySelector('svg'), 'The action retains its original check icon.');
  assert.equal(status?.getAttribute('aria-live'), 'polite');
  return {group, button, status};
}

for (const provider of ['github', 'gitlab']) {
  const mode = provider === 'github' ? 'github' : 'local';

  test(`${provider} Viewed waits for confirmation and wraps through the full list despite sidebar filters`, async t => {
    const reviewPaths = [paths[0], 'src/viewed.js', paths[1], 'src/also-viewed.js'];
    const ui = fixture(t, provider, splitRevision(), {
      review: {mode, paths: reviewPaths, viewed: {[reviewPaths[1]]: 'VIEWED', [reviewPaths[3]]: 'VIEWED'}},
    });
    await ui.navigate(ui.review(41));
    await ui.open(paths[1]);
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    ui.app.state.query = 'also-viewed.js';
    ui.app.state.unviewedOnly = true;
    await ui.drain(1);
    assert.equal(ui.app.state.flat.filter(node => node.type === 'blob').length, 0);
    const controls = fileReviewControls(ui);
    const pending = deferred();
    ui.app.viewedReply = () => pending.promise;
    assert.equal(controls.button.textContent, 'Viewed & next');
    const saving = controls.button.fire('click');
    await ui.drain(1);
    assert.equal(controls.button.disabled, true);
    assert.equal(controls.button.textContent, 'Saving…');
    assert.equal(ui.selection().active, paths[1]);
    assert.equal(
      ui.app.state.diff.viewed[paths[1]],
      undefined,
      'An unconfirmed write is not published optimistically.',
    );
    assert.equal(ui.viewedRequests.length, 1);
    await controls.button.fire('click');
    assert.equal(ui.viewedRequests.length, 1, 'A pending action cannot send a duplicate mark.');
    assert.deepEqual(ui.viewedRequests[0], {
      context: ui.app.state.context,
      headSHA: reviewSHA,
      path: paths[1],
      viewed: true,
    });
    pending.resolve({state: 'VIEWED', mode});
    await ui.settle(saving);
    assert.equal(
      ui.selection().active,
      paths[0],
      'Navigation skips viewed files and wraps to the earlier unviewed file.',
    );
    assert.equal(ui.app.state.diff.viewed[paths[1]], 'VIEWED');
    assert.equal(
      ui.body().querySelectorAll('.split-diff-pane').length,
      2,
      'The chosen diff layout survives navigation.',
    );
    assert.equal(controls.group.isConnected, false, 'The previous file releases its review control.');
    assert.equal(fileReviewControls(ui).button.textContent, 'Viewed & next');
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} a failed Viewed write stays on the file, retries and completes the listed review`, async t => {
    const ui = fixture(t, provider, splitRevision(), {review: {mode}});
    await ui.navigate(ui.review(41));
    const controls = fileReviewControls(ui);
    ui.app.viewedReply = () => Promise.reject(new Error('Viewed could not be saved.'));
    await ui.settle(controls.button.fire('click'));
    assert.equal(ui.selection().active, paths[0]);
    assert.equal(ui.app.state.diff.viewed[paths[0]], undefined);
    assert.equal(controls.button.disabled, false);
    assert.equal(controls.button.textContent, 'Viewed & next');
    assert.equal(controls.status.textContent, 'Viewed could not be saved.');
    assert.ok(controls.status.classList.contains('error'));
    ui.app.viewedReply = undefined;
    await ui.settle(controls.button.fire('click'));
    assert.equal(ui.selection().active, paths[1]);
    assert.equal(ui.viewedRequests.length, 2);
    const final = fileReviewControls(ui);
    await ui.settle(final.button.fire('click'));
    assert.equal(ui.selection().active, paths[1], 'Completing the list keeps the final file open.');
    assert.equal(final.button.disabled, true);
    assert.equal(final.status.textContent, 'All listed files viewed');
    assert.equal(ui.viewedRequests.length, 3);
    assert.deepEqual(ui.app.state.diff.viewed, {[paths[0]]: 'VIEWED', [paths[1]]: 'VIEWED'});
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} failed next-tab metadata preserves a confirmed mark and retries without another Viewed write`, async t => {
    const ui = fixture(t, provider, splitRevision(), {review: {mode}});
    await ui.navigate(ui.review(41));
    const controls = fileReviewControls(ui);
    ui.app.fileTabsReply = message => {
      if (message.value.active === paths[1]) throw new Error('File tabs could not be saved.');
    };
    await ui.settle(controls.button.fire('click'));
    assert.deepEqual(ui.selection(), {paths: [paths[0]], active: paths[0]});
    assert.equal(ui.app.state.diff.viewed[paths[0]], 'VIEWED', 'The successful mark is not rolled back.');
    assert.equal(ui.viewedRequests.length, 1);
    assert.equal(controls.button.textContent, 'Next unviewed');
    assert.equal(controls.status.textContent, 'File tabs could not be saved.');
    assert.equal(controls.button.disabled, false);
    ui.app.fileTabsReply = undefined;
    await ui.settle(controls.button.fire('click'));
    assert.deepEqual(ui.selection(), {paths: paths.slice(0, 2), active: paths[1]});
    assert.equal(ui.viewedRequests.length, 1, 'A navigation retry does not repeat the confirmed mark.');
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} scrolling during the next-file save preserves the new active tab and outgoing position`, async t => {
    const ui = fixture(t, provider, splitRevision(), {review: {mode}});
    await ui.navigate(ui.review(41));
    const nextSave = deferred();
    // The trusted broker serializes writes: later scroll saves complete after
    // the delayed next-file save, even while the old file remains visible.
    ui.app.fileTabsReply = () => nextSave.promise;
    const saving = fileReviewControls(ui).button.fire('click');
    await ui.drain(1);
    assert.equal(ui.selection().active, paths[0]);
    t.mock.timers.enable({apis: ['setTimeout']});
    try {
      const body = ui.body();
      body.scrollTop = 440;
      body.scrollLeft = 55;
      await body.fire('scroll');
      t.mock.timers.tick(150);
      await Promise.resolve();
    } finally {
      t.mock.timers.reset();
    }
    await ui.drain(1);
    nextSave.resolve();
    await ui.settle(saving);
    await ui.drain();
    assert.deepEqual(ui.selection(), {paths: paths.slice(0, 2), active: paths[1]});
    assert.equal(ui.metadata.size, 1);
    const saved = [...ui.metadata.values()][0];
    assert.deepEqual(saved.paths, paths.slice(0, 2), 'A delayed old-file scroll cannot drop the newly opened tab.');
    assert.equal(saved.active, paths[1], 'The next file is the persisted active tab.');
    assert.deepEqual(
      saved.positions.find(position => position.path === paths[0]),
      {ref: `${baseSHA}:${reviewSHA}`, path: paths[0], top: 440, left: 55},
      'The outgoing file still retains its latest scroll position.',
    );
    assert.equal(ui.viewedRequests.length, 1);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} sidebar Viewed updates the open file action without refetching or resetting its viewport`, async t => {
    const ui = fixture(t, provider, splitRevision(), {review: {mode}});
    await ui.navigate(ui.review(41));
    await ui.scroll(440, 55);
    const controls = fileReviewControls(ui);
    const body = ui.body();
    const requests = ui.files.length;
    const checkbox = ui.app.view.spacer
      .querySelectorAll('.viewed-checkbox')
      .find(node => node.getAttribute('aria-label') === `Mark ${paths[0]} as viewed`);
    assert.ok(checkbox, 'The current review file has its real sidebar Viewed checkbox.');
    checkbox.checked = true;
    await ui.settle(checkbox.fire('change'));
    assert.equal(controls.button.textContent, 'Next unviewed');
    assert.equal(ui.body(), body, 'Publishing the mark retains the currently rendered file.');
    assert.equal(ui.body().scrollTop, 440);
    assert.equal(ui.body().scrollLeft, 55);
    assert.equal(ui.files.length, requests, 'The shared mark must not reload the file text.');
    assert.equal(ui.selection().active, paths[0]);
    await ui.settle(controls.button.fire('click'));
    assert.equal(ui.selection().active, paths[1]);
    assert.equal(ui.viewedRequests.length, 1, 'Next unviewed skips the mark already confirmed by the checkbox.');
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} manual tab intent wins while Viewed and the manual metadata save are pending`, async t => {
    const ui = fixture(t, provider, splitRevision(), {review: {mode, paths}});
    await ui.navigate(ui.review(41));
    const pendingViewed = deferred();
    const pendingTab = deferred();
    ui.app.viewedReply = () => pendingViewed.promise;
    const saving = fileReviewControls(ui).button.fire('click');
    await ui.drain(1);
    ui.app.fileTabsReply = message => (message.value.active === paths[2] ? pendingTab.promise : undefined);
    const opening = ui.app.openFileTab({path: paths[2]});
    await ui.drain(1);
    assert.equal(ui.selection().active, paths[0], 'The manual file has not published before its metadata save.');
    pendingViewed.resolve({state: 'VIEWED', mode});
    await ui.settle(saving);
    assert.equal(ui.app.state.diff.viewed[paths[0]], 'VIEWED');
    assert.equal(ui.selection().active, paths[0], 'The late mark must not start automatic navigation.');
    pendingTab.resolve();
    await ui.settle(opening);
    assert.deepEqual(ui.selection(), {paths: [paths[0], paths[2]], active: paths[2]});
    assert.equal(ui.viewedRequests.length, 1);
    assert.deepEqual(ui.errors, []);
  });

  for (const replacement of ['review', 'revision', 'disposal']) {
    test(`${provider} a Viewed reply after ${replacement} cannot update or advance a stale inline viewer`, async t => {
      const review = {mode};
      const ui = fixture(t, provider, splitRevision(), {review});
      await ui.navigate(ui.review(41));
      const oldDiff = ui.app.state.diff;
      const controls = fileReviewControls(ui);
      const pending = deferred();
      ui.app.viewedReply = () => pending.promise;
      const saving = controls.button.fire('click');
      await ui.drain(1);
      if (replacement === 'review') await ui.navigate(ui.review(42));
      else if (replacement === 'revision') {
        review.headSHA = featureSHA;
        await ui.settle(ui.app.refresh());
        assert.equal(ui.app.state.diff.head.sha, featureSHA);
      } else ui.app.dispose();
      await ui.drain(1);
      const fileRequests = ui.files.length;
      const stored = structuredClone([...ui.metadata]);
      pending.resolve({state: 'VIEWED', mode});
      await ui.settle(saving);
      assert.deepEqual(oldDiff.viewed, {}, 'A reply cannot publish a mark after its review or page is obsolete.');
      assert.equal(controls.group.isConnected, false);
      assert.equal(ui.files.length, fileRequests, 'A stale completion cannot load another file.');
      assert.deepEqual([...ui.metadata], stored, 'A stale completion cannot persist a different active file.');
      if (replacement !== 'disposal') {
        assert.equal(ui.selection().active, paths[0]);
        assert.deepEqual(ui.app.state.diff.viewed, {});
        assert.equal(fileReviewControls(ui).button.textContent, 'Viewed & next');
      }
      assert.deepEqual(ui.errors, []);
    });
  }

  test(`${provider} Viewed navigation is absent in Code, commits and unsupported review mode`, async t => {
    const revision = splitRevision();
    const review = {mode: 'none'};
    const ui = fixture(t, provider, revision, {review});
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    assert.equal(ui.workspace().querySelector('.file-review'), null);
    await ui.navigate(ui.review(41));
    assert.ok(ui.body().querySelector('.code-row'), 'The unsupported review still renders its diff.');
    assert.equal(ui.workspace().querySelector('.file-review'), null);
    review.mode = mode;
    ui.app.fileReply = (message, context) =>
      context.kind === 'commit' ? (message.source.sha === baseSHA ? revision.before : revision.after) : undefined;
    await ui.navigate(`${ui.root}/${provider === 'gitlab' ? '-/' : ''}commit/${reviewSHA}`);
    assert.ok(ui.body().querySelector('.code-row'), 'The commit still renders its diff.');
    assert.equal(ui.workspace().querySelector('.file-review'), null);
    assert.deepEqual(ui.viewedRequests, []);
    assert.deepEqual(ui.errors, []);
  });
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} file search finds literal offscreen text and retains its revealed position across tabs`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    const lines = longText.split('\n');
    lines[5] = '// needle without literal punctuation';
    lines[180] = '// ' + 'wide prefix '.repeat(15) + '[Needle].*';
    lines[195] = '// [needle].*';
    ui.app.fileReply = message => (message.path === paths[0] ? lines.join('\n') : longText);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    assert.equal(ui.body().querySelectorAll('.file-match').length, 0);
    assert.doesNotMatch(ui.body().textContent, /\[Needle\]/, 'The distant source row starts outside the virtual DOM.');
    const controls = await openFind(ui, ui.workspace(), ui.body());
    const requests = ui.files.length;
    await findText(t, ui, controls, '[needle].*');
    assert.equal(controls.count.textContent, '1 / 2', 'Punctuation is literal and matching is case insensitive.');
    assert.equal(
      ui
        .body()
        .querySelectorAll('.file-match.active')
        .map(node => node.textContent)
        .join(''),
      '[Needle].*',
    );
    assert.equal(ui.body().scrollTop, 180 * 22);
    assert.ok(ui.body().scrollLeft > 0, 'A match beyond the visible columns is revealed horizontally.');
    await findKey(ui, controls, 'Enter');
    assert.equal(controls.count.textContent, '2 / 2');
    assert.equal(ui.body().scrollTop, 195 * 22);
    await findKey(ui, controls, 'Enter', {shiftKey: true});
    assert.equal(controls.count.textContent, '1 / 2');
    const revealed = {top: ui.body().scrollTop, left: ui.body().scrollLeft};
    assert.equal(ui.files.length, requests, 'Searching the complete source does not refetch the file.');
    await ui.open(paths[1]);
    assert.equal(
      findControls(ui.workspace()).bar.hidden,
      true,
      'A newly loaded file starts with its own closed search.',
    );
    await ui.open(paths[0]);
    assert.deepEqual({top: ui.body().scrollTop, left: ui.body().scrollLeft}, revealed);
    assert.doesNotMatch(
      JSON.stringify([...ui.metadata]),
      /needle/i,
      'Session metadata retains positions, not search text.',
    );
    assert.ok(ui.body().querySelectorAll('.code-row').length < 50);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} file search retains its diff query and active source across Unified and Side-by-side`, async t => {
    const ui = fixture(t, provider, searchRevision(), {search: true});
    await ui.navigate(ui.review(41));
    const controls = await openFind(ui, ui.workspace(), ui.body(), {metaKey: true});
    const requests = ui.files.length;
    await findText(t, ui, controls, 'search beacon');
    assert.equal(controls.count.textContent, '1 / 3');
    assert.match(ui.body().querySelector('.file-match.active').closest('.code-row').textContent, /oldOnly/);
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    assert.equal(controls.input.value, 'search beacon');
    assert.equal(controls.count.textContent, '1 / 3');
    const [oldPane, newPane] = diffPanes(ui.body());
    assert.match(oldPane.querySelector('.file-match.active').closest('.code-row').textContent, /oldOnly/);
    assert.equal(newPane.querySelectorAll('.file-match.active').length, 0);
    await findKey(ui, controls, 'Enter');
    assert.equal(controls.count.textContent, '2 / 3');
    assert.match(newPane.querySelector('.file-match.active').closest('.code-row').textContent, /newOnly/);
    assert.equal(oldPane.querySelectorAll('.file-match.active').length, 0);
    await findKey(ui, controls, 'Enter');
    assert.equal(
      controls.count.textContent,
      '3 / 3',
      'Shared context contributes one result, despite two rendered panes.',
    );
    for (const pane of [oldPane, newPane]) {
      assert.match(pane.querySelector('.file-match.active').closest('.code-row').textContent, /shared context/);
      assert.ok(pane.scrollTop > 3000);
    }
    assert.equal(oldPane.scrollTop, newPane.scrollTop);
    await diffLayout(ui, ui.workspace(), 'Unified');
    assert.equal(controls.count.textContent, '3 / 3');
    assert.match(ui.body().querySelector('.file-match.active').closest('.code-row').textContent, /shared context/);
    assert.equal(ui.files.length, requests);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} file search gives actual View full shortcut priority and keeps its query separate from inline`, async t => {
    const ui = fixture(t, provider, searchRevision(), {search: true});
    await ui.navigate(ui.review(41));
    const inline = await openFind(ui, ui.workspace(), ui.body());
    await findText(t, ui, inline, 'source110');
    assert.equal(inline.count.textContent, '1 / 1');
    const inlineTop = ui.body().scrollTop;
    const file = ui.app.state.diff.files[0];
    await ui.settle(ui.app.showDiff({...file, path: file.filename, adds: file.additions, dels: file.deletions}));
    const modal = ui.app.view.viewer;
    const modalBody = modal.querySelector('.viewer-body');
    const full = await openFind(ui, modal, modalBody, {metaKey: true});
    assert.equal(full.input.value, '', 'View full starts its own query.');
    assert.equal(inline.input.value, 'source110');
    await findText(t, ui, full, 'newOnly');
    assert.equal(full.count.textContent, '1 / 1');
    assert.equal(inline.count.textContent, '1 / 1');
    assert.equal(ui.body().scrollTop, inlineTop, 'A modal match does not move the inline file.');
    await findKey(ui, full, 'Escape');
    assert.equal(full.bar.hidden, true);
    assert.equal(modal.open, true, 'The first Escape closes find before the underlying diff dialog.');
    assert.equal(ui.document.activeElement, modalBody);
    ui.app.closeViewer();
    const reopened = await openFind(ui, ui.workspace(), ui.body(), {metaKey: true});
    assert.equal(reopened.input, inline.input);
    assert.equal(reopened.input.value, 'source110');
    assert.equal(reopened.input.selectionStart, 0);
    assert.equal(reopened.input.selectionEnd, 'source110'.length);
    assert.equal(ui.body().scrollTop, inlineTop);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} file search drops pending queries and detached controls when files or reviews change`, async t => {
    const ui = fixture(t, provider, searchRevision(), {search: true});
    await ui.navigate(ui.review(41));
    const old = await openFind(ui, ui.workspace(), ui.body());
    const listenerCount = ui.window.listeners.get('keydown').length;
    old.input.value = 'source220';
    await old.input.fire('input'); // Leave a real debounce pending while a different file disposes this search.
    await ui.open(paths[1]);
    const current = await openFind(ui, ui.workspace(), ui.body(), {metaKey: true});
    await findText(t, ui, current, 'newOnly');
    await new Promise(resolve => setTimeout(resolve, 140));
    ui.clock.flush();
    assert.equal(current.input.value, 'newOnly');
    assert.equal(current.count.textContent, '1 / 1');
    assert.equal(old.bar.isConnected, false);
    await ui.app.rememberFileTabs();
    const stored = structuredClone([...ui.metadata]);
    const top = ui.body().scrollTop;
    await old.next.fire('click');
    await old.close.fire('click');
    old.input.value = 'source180';
    await old.input.fire('input');
    assert.equal(current.bar.hidden, false);
    assert.equal(ui.body().scrollTop, top);
    assert.deepEqual([...ui.metadata], stored, 'Detached controls cannot save another file position.');
    await ui.navigate(ui.review(42));
    const nextReview = await openFind(ui, ui.workspace(), ui.body());
    assert.equal(nextReview.input.value, '', 'A different PR/MR has an independent active file search.');
    assert.equal(nextReview.count.textContent, '');
    assert.equal(ui.body().querySelectorAll('.file-match').length, 0);
    assert.equal(
      ui.window.listeners.get('keydown').length,
      listenerCount,
      'Replacing views removes their key listeners.',
    );
    assert.deepEqual(ui.errors, []);
  });
}

/** Reflects browser dataset camel-casing for delegated source-line controls in this fixture only. */
function installSelectionAttributes(document) {
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

/** Chooses a rendered source number through the owned viewport's delegated click handler. */
async function selectSource(ui, body, side, line, shiftKey = false) {
  const button = body
    .querySelectorAll('button')
    .find(node => node.getAttribute('aria-label') === `Select ${side ? side + ' ' : ''}line ${line}`);
  assert.ok(button, `The active file exposes selectable ${side} line ${line}.`);
  await body.fire('click', {target: button, shiftKey});
  ui.clock.flush();
}

/** Reads selection controls by visible action names, requiring the capability on old checkouts too. */
function selectionControls(scope) {
  const group = scope.querySelector('.file-selection');
  assert.ok(group, 'A loaded file exposes selection actions.');
  return {
    group,
    label: group.querySelector('.file-selection-label'),
    code: group.querySelectorAll('button').find(button => button.textContent === 'Copy code'),
    link: group.querySelectorAll('button').find(button => button.textContent === 'Copy permalink'),
    status: group.querySelector('[role="status"]'),
  };
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} plain-file selection copies blank/tabbed lines and links to the loaded commit`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    installSelectionAttributes(ui.document);
    const copied = [];
    install(t, {
      navigator: {
        clipboard: {
          writeText: async text => {
            copied.push(text);
          },
        },
      },
    });
    ui.app.fileReply = () => ['first', '\tselected source', '', 'last selected', longText].join('\n');
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    const selected = selectionControls(ui.workspace());
    await selectSource(ui, ui.body(), '', 2);
    await selectSource(ui, ui.body(), '', 4, true);
    assert.equal(selected.label.textContent, 'Lines 2–4');
    await selected.code.fire('click');
    assert.equal(copied.at(-1), '\tselected source\n\nlast selected');
    await selected.link.fire('click');
    assert.equal(copied.at(-1), `${ui.blob(mainSHA, paths[0])}#L2-${provider === 'github' ? 'L' : ''}4`);
    assert.doesNotMatch(JSON.stringify([...ui.metadata]), /selected source|last selected/);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} source selections stay independent in inline and View full and reset on file/PR changes`, async t => {
    const ui = fixture(t, provider, searchRevision(), {search: true});
    installSelectionAttributes(ui.document);
    const copied = [];
    install(t, {
      navigator: {
        clipboard: {
          writeText: async text => {
            copied.push(text);
          },
        },
      },
    });
    await ui.navigate(ui.review(41));
    // Changed lines are initially just below the virtual viewport's visible range.
    await ui.scroll(20 * 22);
    ui.clock.flush();
    const inline = selectionControls(ui.workspace());
    await selectSource(ui, ui.body(), 'Old', 21);
    await selectSource(ui, ui.body(), 'Old', 23, true);
    assert.equal(inline.label.textContent, 'Old · Lines 21–23');
    const file = ui.app.state.diff.files[0];
    await ui.settle(ui.app.showDiff({...file, path: file.filename, adds: file.additions, dels: file.deletions}));
    const modal = ui.app.view.viewer;
    const modalBody = modal.querySelector('.viewer-body');
    const full = selectionControls(modal);
    assert.equal(full.group.hidden, true);
    modalBody.scrollTop = 20 * 22;
    await modalBody.fire('scroll');
    ui.clock.flush();
    await selectSource(ui, modalBody, 'New', 21);
    assert.equal(full.label.textContent, 'New · Line 21');
    assert.equal(inline.label.textContent, 'Old · Lines 21–23');
    await full.code.fire('click');
    assert.equal(copied.at(-1), "const newOnly = 'search beacon';");
    ui.app.closeViewer();
    await inline.code.fire('click');
    assert.equal(
      copied.at(-1),
      "const oldOnly = 'search beacon';\nconst oldPair = 'old branch';\nconst removedOnly = 'gone';",
    );
    const count = copied.length;
    await full.code.fire('click');
    assert.equal(copied.length, count, 'Disposed View full actions cannot write.');
    await ui.open(paths[1]);
    assert.equal(inline.group.isConnected, false);
    assert.equal(selectionControls(ui.workspace()).group.hidden, true);
    await inline.code.fire('click');
    assert.equal(copied.length, count);
    await ui.open(paths[0]);
    assert.equal(selectionControls(ui.workspace()).group.hidden, true, 'Selection is not restored as tab metadata.');
    await selectSource(ui, ui.body(), 'New', 21);
    const previous = selectionControls(ui.workspace());
    await ui.navigate(ui.review(42));
    assert.equal(previous.group.isConnected, false);
    assert.equal(selectionControls(ui.workspace()).group.hidden, true);
    await previous.code.fire('click');
    assert.equal(copied.length, count);
    assert.deepEqual(ui.errors, []);
  });
}

/** Returns a visible tab through its path, without relying on workspace metadata internals. */
function managedTab(ui, path) {
  const tab = ui
    .workspace()
    .querySelectorAll('.file-tab')
    .find(node => node.dataset.path === path);
  assert.ok(tab, `Expected open tab ${path}`);
  return tab;
}

/** Preserves browser cancellation on the fixture's copied event so later capture listeners observe it. */
function tabMenuKey(target, key) {
  const event = keyEvent(target, key);
  const cancel = event.preventDefault;
  event.preventDefault = function () {
    this.defaultPrevented = true;
    cancel();
  };
  return event;
}

/** Delivers native drag events to the owned strip and verifies its public insertion marker. */
async function reorderTab(ui, path, target, after = false) {
  const strip = ui.workspace().querySelector('.file-tabs');
  const source = managedTab(ui, path);
  const destination = managedTab(ui, target);
  assert.equal(source.getAttribute('draggable'), 'true', 'Open tabs expose native drag reordering.');
  destination.getBoundingClientRect = () => ({left: 100, width: 100, bottom: 30});
  const dataTransfer = {setData() {}};
  await strip.fire('dragstart', {target: source, dataTransfer});
  await strip.fire('dragover', {target: destination, clientX: after ? 190 : 110, dataTransfer});
  assert.equal(destination.getAttribute('data-drag-position'), after ? 'after' : 'before');
  await ui.settle(strip.fire('drop', {target: destination, dataTransfer}));
  assert.equal(destination.getAttribute('data-drag-position'), null);
}

/** Opens the actual menu by pointer or keyboard and exposes its labelled items. */
async function tabMenu(ui, path, keyboard = false) {
  const strip = ui.workspace().querySelector('.file-tabs');
  const tab = managedTab(ui, path);
  const name = tab.querySelector('.file-tab-name');
  name.focus();
  await strip.fire(
    keyboard ? 'keydown' : 'contextmenu',
    keyboard ? {target: name, key: 'F10', shiftKey: true} : {target: name, clientX: 1000, clientY: 760},
  );
  const menu = ui.workspace().querySelector('[role="menu"]');
  assert.ok(menu && !menu.hidden, 'File tabs expose their owned context menu.');
  return menu;
}

/** Invokes a labelled menu action, waiting for its save and any resulting file render. */
async function tabAction(ui, path, label) {
  const menu = await tabMenu(ui, path);
  const item = menu.querySelectorAll('[role="menuitem"]').find(node => node.textContent === label);
  assert.ok(item && !item.disabled, `Expected enabled ${label} tab action`);
  await ui.settle(menu.fire('click', {target: item}));
}

/** Uses the recovery action after the strip has intentionally become empty. */
async function recoverTab(ui) {
  const recovery = ui.workspace().querySelector('.file-tab-recovery');
  assert.ok(recovery && !recovery.hidden, 'All-closed workspaces retain a compact recovery action.');
  const button = recovery.querySelector('button');
  assert.equal(button.textContent, 'Reopen closed file');
  button.focus();
  await ui.settle(button.fire('click'));
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} tab management drag preserves active source/search and persists Code and review order`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    await ui.navigate(ui.root);
    for (const path of paths) await ui.open(path);
    await ui.open(paths[0]);
    const find = await openFind(ui, ui.workspace(), ui.body());
    await findText(t, ui, find, 'line150');
    const body = ui.body();
    const top = body.scrollTop;
    const requests = ui.files.length;
    await reorderTab(ui, paths[2], paths[0]);
    assert.deepEqual(ui.selection(), {paths: [paths[2], paths[0], paths[1]], active: paths[0]});
    assert.equal(ui.body(), body, 'Reordering retains the owned viewport.');
    assert.equal(find.input.value, 'line150');
    assert.equal(find.count.textContent, '1 / 1');
    assert.equal(body.scrollTop, top);
    assert.equal(ui.files.length, requests, 'Reordering does not fetch file contents.');
    await ui.branch('feature');
    assert.deepEqual(ui.selection().paths, [paths[2], paths[0], paths[1]]);
    await ui.branch('main');
    assert.equal(ui.body().scrollTop, top);
    await ui.reload();
    assert.deepEqual(ui.selection().paths, [paths[2], paths[0], paths[1]]);
    await ui.navigate(ui.review(41));
    await ui.open(paths[1]);
    await reorderTab(ui, paths[0], paths[1], true);
    assert.deepEqual(ui.selection().paths, [paths[1], paths[0]]);
    await ui.navigate(ui.review(42));
    assert.deepEqual(ui.selection().paths, [paths[0]]);
    await ui.navigate(ui.review(41));
    assert.deepEqual(ui.selection().paths, [paths[1], paths[0]]);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} tab management bulk close and reopen restore visual slots and saved positions`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    ui.app.fileReply = () =>
      longText
        .split('\n')
        .map(line => line + ' '.repeat(150))
        .join('\n');
    await ui.navigate(ui.root);
    for (const [index, path] of paths.entries()) {
      await ui.open(path);
      await ui.scroll((index + 1) * 440, 25 * index);
    }
    await tabAction(ui, paths[0], 'Close right');
    assert.deepEqual(ui.selection(), {paths: [paths[0]], active: paths[0]});
    await tabAction(ui, paths[0], 'Reopen closed file');
    assert.deepEqual(ui.selection(), {paths: [paths[0], paths[2]], active: paths[2]});
    assert.equal(ui.body().scrollTop, 1320);
    assert.equal(ui.body().scrollLeft, 50);
    await tabAction(ui, paths[2], 'Reopen closed file');
    assert.deepEqual(ui.selection(), {paths, active: paths[1]});
    assert.equal(ui.body().scrollTop, 880);
    await tabAction(ui, paths[1], 'Close others');
    assert.deepEqual(ui.selection(), {paths: [paths[1]], active: paths[1]});
    await tabAction(ui, paths[1], 'Close all');
    const recovery = ui.workspace().querySelector('.file-tab-recovery');
    assert.equal(recovery.hidden, false);
    assert.equal(ui.workspace().querySelector('.file-tab-body'), null);
    await recoverTab(ui);
    assert.equal(ui.selection().active, paths[1]);
    assert.equal(ui.body().scrollTop, 880);
    await tabAction(ui, paths[1], 'Reopen closed file');
    await tabAction(ui, paths[2], 'Reopen closed file');
    assert.deepEqual(ui.selection().paths, paths);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} tab management all-closed recovery survives main replacement but resets after navigation and reload`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await tabAction(ui, paths[0], 'Close all');
    ui.replaceMain();
    await ui.drain();
    assert.equal(ui.workspace().querySelector('.file-tab-recovery').hidden, false);
    await recoverTab(ui);
    assert.equal(ui.selection().active, paths[0]);
    await tabAction(ui, paths[0], 'Close all');
    await ui.reload();
    const host = ui.document.getElementById('codetree-file-workspace');
    assert.ok(!host || host.hidden, 'Closed history is not persisted across page reload.');
    await ui.open(paths[0]);
    const menu = await tabMenu(ui, paths[0]);
    assert.equal(
      menu.querySelectorAll('button').find(node => node.textContent === 'Reopen closed file').disabled,
      true,
    );
    await ui.close(paths[0]);
    await ui.navigate(ui.review(41));
    const reviewMenu = await tabMenu(ui, paths[0]);
    assert.equal(
      reviewMenu.querySelectorAll('button').find(node => node.textContent === 'Reopen closed file').disabled,
      true,
    );
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} tab management menu keyboard clamps, takes Escape priority and retains focus through recovery`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await ui.open(paths[1]);
    const find = await openFind(ui, ui.workspace(), ui.body());
    await findText(t, ui, find, 'line15');
    ui.workspace().querySelector('[role="menu"]').getBoundingClientRect = () => ({width: 220, height: 140});
    let menu = await tabMenu(ui, paths[0], true);
    const event = tabMenuKey(ui.document.activeElement, 'Escape');
    await ui.window.fire('keydown', event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(menu.hidden, true);
    assert.equal(find.bar.hidden, false, 'The tab menu consumes Escape before viewer Find.');
    assert.equal(ui.document.activeElement.getAttribute('aria-label'), paths[0]);
    menu = await tabMenu(ui, paths[0]);
    assert.ok(Number.parseFloat(menu.style.left) <= 796);
    assert.ok(Number.parseFloat(menu.style.top) <= 620);
    await ui.window.fire('keydown', keyEvent(ui.document.activeElement, 'End'));
    assert.equal(ui.document.activeElement.textContent, 'Close all', 'Keyboard navigation skips disabled Reopen.');
    await ui.settle(ui.window.fire('keydown', keyEvent(ui.document.activeElement, 'Enter')));
    assert.equal(ui.workspace().querySelector('.file-tab-recovery').hidden, false);
    assert.equal(ui.document.activeElement.textContent, 'Reopen closed file');
    await recoverTab(ui);
    assert.equal(ui.document.activeElement.getAttribute('aria-label'), paths[1]);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} tab management metadata failures preserve viewport, tabs and retryable closed history`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    await ui.navigate(ui.root);
    for (const path of paths) await ui.open(path);
    const body = ui.body();
    await ui.scroll(990, 30);
    const before = ui.selection();
    ui.app.fileTabsReply = async () => {
      throw new Error('Tab save failed');
    };
    await reorderTab(ui, paths[2], paths[0]);
    assert.deepEqual(ui.selection(), before);
    assert.equal(ui.body(), body);
    await tabAction(ui, paths[1], 'Close all');
    assert.deepEqual(ui.selection(), before);
    assert.equal(ui.body(), body);
    assert.equal(body.scrollTop, 990);
    ui.app.fileTabsReply = undefined;
    await ui.close(paths[2]);
    ui.app.fileTabsReply = async () => {
      throw new Error('Reopen save failed');
    };
    await tabAction(ui, paths[0], 'Reopen closed file');
    assert.deepEqual(ui.selection().paths, paths.slice(0, 2));
    ui.app.fileTabsReply = undefined;
    await tabAction(ui, paths[0], 'Reopen closed file');
    assert.equal(ui.selection().active, paths[2]);
    assert.equal(ui.body().scrollTop, 990);
    assert.deepEqual(ui.errors, ['Tab save failed', 'Tab save failed', 'Reopen save failed']);
  });

  test(`${provider} tab management waits for a pending open and cannot override newer file intent`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await ui.open(paths[1]);
    const gate = deferred();
    let blocked = true;
    ui.app.fileTabsReply = message => {
      if (blocked && message.value.active === paths[2]) {
        blocked = false;
        return gate.promise;
      }
    };
    const opening = ui.app.openFileTab({path: paths[2]});
    await ui.drain(2);
    const menu = await tabMenu(ui, paths[0]);
    const closing = menu.fire('click', {
      target: menu.querySelectorAll('button').find(node => node.textContent === 'Close others'),
    });
    await ui.drain(2);
    gate.resolve();
    await ui.settle(Promise.all([opening, closing]));
    assert.deepEqual(ui.selection(), {paths: [paths[0]], active: paths[0]});
    const stale = deferred();
    blocked = true;
    ui.app.fileTabsReply = message => {
      if (blocked && !message.value.paths.length) {
        blocked = false;
        return stale.promise;
      }
    };
    const allMenu = await tabMenu(ui, paths[0]);
    const closeAll = allMenu.fire('click', {
      target: allMenu.querySelectorAll('button').find(node => node.textContent === 'Close all'),
    });
    await ui.drain(2);
    await ui.open(paths[1]);
    stale.resolve();
    await ui.settle(closeAll);
    assert.equal(ui.selection().active, paths[1]);
    assert.deepEqual(ui.selection().paths, paths.slice(0, 2));
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} tab management drops stale menu and drag state on navigation and disposal`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await ui.open(paths[1]);
    const menu = await tabMenu(ui, paths[0]);
    const old = menu.querySelectorAll('button').find(node => node.textContent === 'Close all');
    await ui.navigate(ui.review(41));
    assert.equal(menu.hidden, true);
    await menu.fire('click', {target: old});
    assert.deepEqual(ui.selection().paths, [paths[0]]);
    const strip = ui.workspace().querySelector('.file-tabs');
    const tab = managedTab(ui, paths[0]);
    await strip.fire('dragstart', {target: tab});
    await ui.window.fire('dragend');
    assert.equal(tab.classList.contains('dragging'), false);
    ui.app.dispose();
    assert.equal(strip.listeners.get('drop').length, 0);
    assert.equal(menu.listeners.get('click').length, 0);
    assert.equal(ui.window.listeners.get('dragend').length, 0);
    assert.equal(ui.window.listeners.get('keydown')?.length || 0, 0);
  });
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} tab management close can supersede a slow replacement file render`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    for (const path of paths) await ui.open(path);
    const gate = deferred();
    ui.app.fileReply = message => (message.path === paths[1] ? gate.promise : undefined);
    const menu = await tabMenu(ui, paths[1]);
    const replacing = menu.fire('click', {
      target: menu.querySelectorAll('button').find(node => node.textContent === 'Close others'),
    });
    await ui.drain(3);
    assert.deepEqual(ui.selection(), {paths: [paths[1]], active: paths[1]});
    await tabAction(ui, paths[1], 'Close all');
    assert.equal(ui.workspace().querySelector('.file-tab-recovery').hidden, false);
    gate.resolve(longText);
    await ui.settle(replacing);
    assert.deepEqual(ui.selection().paths, []);
    assert.equal(
      ui.workspace().querySelector('.file-tab-body'),
      null,
      'The late render cannot resurrect a closed file.',
    );
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} tab management reorder preserves an in-flight Quick Open source-line intent`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await ui.open(paths[2]);
    const gate = deferred();
    ui.app.fileReply = message => (message.path === paths[1] ? gate.promise : undefined);
    const opening = ui.app.openFileTab({path: paths[1], line: 180});
    await ui.drain(3);
    await reorderTab(ui, paths[2], paths[0]);
    assert.deepEqual(ui.selection().paths, [paths[2], paths[0], paths[1]]);
    gate.resolve(longText);
    await ui.settle(opening);
    assert.equal(ui.selection().active, paths[1]);
    assert.equal(ui.body().scrollTop, 179 * 22);
    assert.equal(ui.files.length, 3, 'Drop reuses the already-started file request.');
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} tab management closed history is bounded and ordinary reopen removes duplicates`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    const closedPaths = Array.from({length: 34}, (_, index) => `src/closed-${index}.js`);
    for (const path of closedPaths) {
      await ui.settle(ui.app.openFileTab({path}));
      await ui.close(path);
    }
    await recoverTab(ui);
    assert.equal(ui.selection().active, closedPaths.at(-1));
    await ui.settle(ui.app.openFileTab({path: closedPaths.at(-2)}));
    await tabAction(ui, closedPaths.at(-1), 'Reopen closed file');
    assert.equal(
      ui.selection().active,
      closedPaths.at(-3),
      'Ordinary opening removes its duplicate from closed history.',
    );
    for (let index = 3; index < 32; index++) await tabAction(ui, ui.selection().active, 'Reopen closed file');
    assert.equal(ui.selection().paths.length, 32);
    assert.ok(!ui.selection().paths.includes(closedPaths[0]) && !ui.selection().paths.includes(closedPaths[1]));
    const menu = await tabMenu(ui, ui.selection().active);
    assert.equal(
      menu.querySelectorAll('button').find(node => node.textContent === 'Reopen closed file').disabled,
      true,
    );
    assert.deepEqual(ui.errors, []);
  });
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} tab management account changes discard closed history and stale pending menu saves`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await ui.open(paths[1]);
    await ui.close(paths[0]);
    const gate = deferred();
    let blocked = true;
    ui.app.fileTabsReply = message => {
      if (blocked && !message.value.paths.length) {
        blocked = false;
        return gate.promise;
      }
    };
    const menu = await tabMenu(ui, paths[1]);
    const closing = menu.fire('click', {
      target: menu.querySelectorAll('button').find(node => node.textContent === 'Close all'),
    });
    await ui.drain(2);
    ui.app.suspendFileTabs();
    ui.app.fileTabsAccount = 'second-account';
    ui.app.fileTabsReply = undefined;
    await ui.settle(ui.app.loadPage(true));
    await ui.open(paths[0]);
    gate.resolve();
    await ui.settle(closing);
    await ui.drain();
    assert.deepEqual(ui.selection(), {paths: [paths[0]], active: paths[0]});
    const current = await tabMenu(ui, paths[0]);
    assert.equal(
      current.querySelectorAll('button').find(node => node.textContent === 'Reopen closed file').disabled,
      true,
    );
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} tab management keeps separate commit orders and restores canonical split positions after close`, async t => {
    const ui = fixture(t, provider, searchRevision(), {search: true});
    const commit = sha => `${ui.root}${provider === 'gitlab' ? '/-' : ''}/commit/${sha}`;
    await ui.navigate(commit('e'.repeat(40)));
    await ui.open(paths[1]);
    await reorderTab(ui, paths[0], paths[1], true);
    assert.deepEqual(ui.selection().paths, [paths[1], paths[0]]);
    await ui.navigate(commit('f'.repeat(40)));
    assert.deepEqual(ui.selection().paths, [paths[0]]);
    await ui.navigate(commit('e'.repeat(40)));
    assert.deepEqual(ui.selection().paths, [paths[1], paths[0]]);
    await ui.navigate(ui.review(41));
    await diffLayout(ui, ui.workspace(), 'Side-by-side');
    await paneScroll(ui, diffPanes(ui.body())[0], 110 * 22, 0);
    await ui.close(paths[0]);
    await recoverTab(ui);
    assert.deepEqual(panePositions(ui.body()), [
      {top: 110 * 22, left: 0},
      {top: 110 * 22, left: 0},
    ]);
    await diffLayout(ui, ui.workspace(), 'Unified');
    assert.equal(ui.body().scrollTop, 112 * 22, 'Closed history keeps canonical source coordinates.');
    assert.deepEqual(ui.errors, []);
  });
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} tab management new review is usable while an old scope metadata save remains pending`, async t => {
    const ui = fixture(t, provider);
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    const gate = deferred();
    let blocked = true;
    ui.app.fileTabsReply = (message, context) => {
      if (blocked && context.kind !== 'pull' && !message.value.paths.length) {
        blocked = false;
        return gate.promise;
      }
    };
    const oldMenu = await tabMenu(ui, paths[0]);
    const oldClosing = oldMenu.fire('click', {
      target: oldMenu.querySelectorAll('button').find(node => node.textContent === 'Close all'),
    });
    await ui.drain(2);
    await ui.navigate(ui.review(42));
    assert.deepEqual(ui.selection().paths, [paths[0]]);
    await tabAction(ui, paths[0], 'Close all');
    assert.equal(ui.workspace().querySelector('.file-tab-recovery').hidden, false);
    gate.resolve();
    await ui.settle(oldClosing);
    assert.deepEqual(ui.selection().paths, []);
    await recoverTab(ui);
    assert.equal(ui.selection().active, paths[0]);
    assert.deepEqual(ui.errors, []);
  });
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} tab management menu dismisses on palette focus transfer without stealing the new focus`, async t => {
    const ui = fixture(t, provider, undefined, {search: true, quickOpen: true});
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    await ui.open(paths[1]);
    const menu = await tabMenu(ui, paths[0], true);
    const items = menu.querySelectorAll('button');
    items[1].focus();
    await menu.fire('focusout', {target: items[0], relatedTarget: items[1]});
    assert.equal(menu.hidden, false, 'Moving between menu items retains the same menu.');
    await ui.window.fire('keydown', keyEvent(items[1], 'p', {ctrlKey: true, isTrusted: true}));
    const palette = ui.app.view.shadow.querySelector('.quick-open');
    assert.equal(palette.open, true);
    const paletteInput = palette.querySelector('input');
    await menu.fire('focusout', {target: items[1], relatedTarget: paletteInput});
    assert.equal(menu.hidden, true, 'Entering another dialog dismisses the old tab menu.');
    assert.equal(ui.document.activeElement, paletteInput, 'Dismissal leaves the new focus owner untouched.');
    await ui.window.fire('keydown', keyEvent(paletteInput, 'Escape', {isTrusted: true}));
    assert.equal(palette.open, false);
    ui.body().focus();
    await ui.window.fire('keydown', tabMenuKey(ui.body(), 'Escape'));
    assert.equal(menu.hidden, true);
    const reopened = await tabMenu(ui, paths[0]);
    assert.equal(reopened.hidden, false, 'Focus dismissal does not disable later menu actions.');
    await ui.settle(
      reopened.fire('click', {
        target: reopened.querySelectorAll('button').find(node => node.textContent === 'Close others'),
      }),
    );
    assert.deepEqual(ui.selection(), {paths: [paths[0]], active: paths[0]});
    assert.deepEqual(ui.errors, []);
  });
}

/** Requires the visible Outline control before accessing its new loaded-view bridge on a baseline checkout. */
function fileOutline(scope) {
  const toggle = scope.querySelector('.file-outline-toggle');
  assert.ok(toggle, 'Loaded file tabs expose their compact Outline control.');
  return {toggle, panel: scope.querySelector('.file-outline-panel')};
}

/** Builds a complete unequal renamed diff with declaration names in both exact revisions. */
function outlineRevision() {
  const prefix = Array.from({length: 50}, (_, index) => `// context ${index}`);
  const removed = ['function oldOnly() {}', 'function oldExtra() {}'];
  const added = ['function newOnly() {}'];
  const suffix = Array.from({length: 150}, (_, index) => `// tail ${index}`);
  return {
    before: [...prefix, ...removed, ...suffix].join('\n'),
    after: [...prefix, ...added, ...suffix].join('\n'),
    file: {
      status: 'renamed',
      previous_filename: 'src/old.js',
      additions: 1,
      deletions: 2,
      patch: ['@@ -51,2 +51,1 @@', ...removed.map(line => '-' + line), ...added.map(line => '+' + line)].join('\n'),
    },
  };
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} Outline plain-file navigation retains Find and positions while models follow branch/account scope`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    ui.app.fileReply = message =>
      Array.from({length: 260}, (_, index) =>
        index === 149
          ? 'function onlyTarget() {}'
          : index === 180
            ? 'class ServiceTarget {}'
            : `// ${message.path} context ${index}`,
      ).join('\n');
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    const controls = fileOutline(ui.workspace());
    assert.equal(controls.panel.hidden, true);
    const model = ui.app.getFileTabSymbols();
    assert.equal(model.filePath, paths[0]);
    assert.equal(model.path, paths[0]);
    assert.equal(model.source.sha, mainSHA);
    assert.equal(model.side, 'new');
    assert.equal(model.diff, false);
    const find = await openFind(ui, ui.workspace(), ui.body());
    await findText(t, ui, find, 'ServiceTarget');
    const requests = ui.files.length;
    controls.toggle.focus();
    await controls.toggle.fire('click');
    const target = model.symbols.find(symbol => symbol.name === 'onlyTarget');
    assert.ok(target);
    assert.equal(model.go(target), true);
    ui.clock.flush();
    assert.equal(ui.body().scrollTop, 149 * 22);
    assert.equal(ui.document.activeElement, ui.body());
    assert.equal(find.input.value, 'ServiceTarget');
    assert.equal(find.count.textContent, '1 / 1');
    assert.equal(ui.files.length, requests, 'Opening Outline and following a symbol reuse loaded text.');
    assert.ok(ui.body().querySelectorAll('.code-row').length < 50);
    await ui.open(paths[1]);
    assert.equal(model.current(), false);
    assert.equal(model.go(target), false);
    await ui.open(paths[0]);
    assert.equal(ui.body().scrollTop, 149 * 22);
    fileOutline(ui.workspace());
    assert.equal(findControls(ui.workspace()).bar.hidden, true);
    const restored = ui.app.getFileTabSymbols();
    await ui.branch('feature');
    fileOutline(ui.workspace());
    assert.equal(restored.current(), false);
    assert.equal(ui.app.getFileTabSymbols().source.sha, featureSHA);
    await ui.branch('main');
    fileOutline(ui.workspace());
    assert.equal(ui.body().scrollTop, 149 * 22);
    const beforeAccount = ui.app.getFileTabSymbols();
    ui.app.fileTabsAccount = 'other-outline-account';
    await ui.settle(ui.app.loadPage(true));
    assert.notEqual(
      ui.app.getFileTabSymbols(),
      beforeAccount,
      'A native file route loads a fresh account-scoped model.',
    );
    assert.equal(beforeAccount.current(), false);
    assert.doesNotMatch(
      JSON.stringify([...ui.metadata]),
      /onlyTarget|ServiceTarget/,
      'Workspace metadata stores positions, not symbols or file text.',
    );
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Outline actual file tabs and View full retain independent source sides in both layouts`, async t => {
    const ui = fixture(t, provider, outlineRevision(), {search: true});
    await ui.navigate(ui.review(41));
    const inline = fileOutline(ui.workspace());
    const find = await openFind(ui, ui.workspace(), ui.body());
    await findText(t, ui, find, 'oldOnly');
    inline.toggle.focus();
    await inline.toggle.fire('click');
    const old = inline.panel
      .querySelector('.file-outline-revision')
      .querySelectorAll('button')
      .find(button => button.textContent === 'Old');
    old.focus();
    await old.fire('click');
    const inlineModel = ui.app.getFileTabSymbols();
    assert.equal(inlineModel.side, 'old');
    assert.equal(inlineModel.path, 'src/old.js');
    assert.equal(inlineModel.go(inlineModel.symbols.find(symbol => symbol.name === 'oldExtra')), true);
    assert.equal(ui.body().scrollTop, 51 * 22);
    const file = ui.app.state.diff.files[0];
    await ui.settle(ui.app.showDiff({...file, path: file.filename, adds: file.additions, dels: file.deletions}));
    const modal = ui.app.view.viewer;
    fileOutline(modal);
    const modalModel = ui.app.getViewerSymbols();
    assert.equal(modalModel.side, 'new');
    assert.equal(modalModel.path, paths[0]);
    assert.equal(ui.app.getFileTabSymbols().side, 'old');
    const requests = ui.files.length;
    assert.equal(modalModel.go(modalModel.symbols.find(symbol => symbol.name === 'newOnly')), true);
    assert.equal(modal.querySelector('.viewer-body').scrollTop, 52 * 22);
    assert.equal(ui.body().scrollTop, 51 * 22);
    await diffLayout(ui, modal, 'Side-by-side');
    assert.equal(inlineModel.current(), true);
    assert.equal(modalModel.current(), true);
    assert.deepEqual(panePositions(modal), [
      {top: 50 * 22, left: 0},
      {top: 50 * 22, left: 0},
    ]);
    assert.deepEqual(panePositions(ui.body()), [
      {top: 51 * 22, left: 0},
      {top: 51 * 22, left: 0},
    ]);
    assert.equal(ui.files.length, requests);
    assert.equal(find.input.value, 'oldOnly');
    assert.equal(find.count.textContent, '1 / 1');
    ui.app.showComments({...file, path: file.filename, comments: []});
    assert.equal(ui.app.getViewerSymbols(), null);
    assert.equal(modalModel.current(), false);
    assert.equal(ui.app.getFileTabSymbols(), inlineModel);
    ui.app.closeViewer();
    await ui.open(paths[1]);
    await ui.open(paths[0]);
    assert.equal(
      ui.app.getFileTabSymbols().side,
      'new',
      'A newly loaded tab starts with its own default Outline revision.',
    );
    await diffLayout(ui, ui.workspace(), 'Unified');
    assert.equal(ui.body().scrollTop, 51 * 22);
    assert.equal(inlineModel.current(), false);
    assert.equal(inlineModel.go(inlineModel.symbols[0]), false);
    assert.deepEqual(ui.errors, []);
  });

  test(`${provider} Outline inline bridge remains null for loading/error and invalidates disposed file models`, async t => {
    const ui = fixture(t, provider, undefined, {search: true});
    ui.app.fileReply = () => 'function firstTarget() {}\n' + longText;
    await ui.navigate(ui.root);
    await ui.open(paths[0]);
    fileOutline(ui.workspace());
    const old = ui.app.getFileTabSymbols();
    const gate = deferred();
    ui.app.fileReply = () => gate.promise;
    const loading = ui.app.openFileTab({path: paths[1]});
    await ui.drain(3);
    assert.equal(ui.app.getFileTabSymbols(), null);
    assert.equal(old.current(), false);
    assert.equal(old.go(old.symbols[0]), false);
    gate.resolve('// empty outline');
    await ui.settle(loading);
    fileOutline(ui.workspace());
    assert.equal(ui.app.getFileTabSymbols().symbols.length, 0);
    ui.app.fileReply = () => {
      throw Object.assign(new Error('Not found'), {status: 404});
    };
    await ui.open(paths[0]);
    assert.equal(ui.app.getFileTabSymbols(), null);
    assert.match(ui.body().textContent, /File not found/);
    await ui.navigate(ui.review(42));
    assert.equal(old.current(), false);
    ui.app.dispose();
    assert.equal(ui.app.getFileTabSymbols(), null);
    assert.equal(ui.window.listeners.get('resize')?.length || 0, 0);
    assert.equal(ui.window.listeners.get('keydown')?.length || 0, 0);
  });
}
