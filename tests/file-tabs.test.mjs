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

const directory = await mkdtemp(join(tmpdir(), 'codetree-file-tabs-'));
const modulePath = join(directory, 'content.mjs');
// The same suite runs against the pre-feature checkout: old tree/branch handlers
// must fail the visible behavior assertions, rather than fail an absent import.
await writeFile(
  modulePath,
  await bundle({fileTabs: existsSync(new URL('../src/content/viewer/file-tabs.js', import.meta.url))}),
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

/** Advances promise continuations without consuming the fixture's explicit stylesheet events. */
async function turn() {
  await new Promise(resolve => setImmediate(resolve));
}

/** Composes real navigation, tree, branch and workspace factories around a metadata-only RPC fixture. */
function fixture(t, provider) {
  const {document, window} = dom();
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
  const errors = [];
  let app;
  t.after(() => app?.dispose());
  let main = document.createElement('main');
  document.body.append(main);
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const node = createElement(tag);
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
          if (this.classList.contains('file-tab-body') && !this.isConnected) return 0;
          return top;
        },
        set(value) {
          if (!this.classList.contains('file-tab-body')) {
            top = value;
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
        head: source(reviewSHA),
        files: paths
          .slice(0, 2)
          .map(filename => ({filename, status: 'added', additions: 220, deletions: 0, patch: ''})),
        comments: [],
        viewed: {},
        viewedMode: 'none',
        warnings: [],
      };
    if (type === 'BRANCHES') return [{name: 'main'}, {name: 'feature'}];
    if (type === 'REFRESH') return null;
    if (type === 'FILE_TABS') {
      const key = JSON.stringify([
        context.origin,
        context.owner,
        context.repo,
        message.scope,
        message.scope === 'review' ? context.number : '',
      ]);
      if (message.value) metadata.set(key, structuredClone(message.value));
      return {...structuredClone(metadata.get(key) || {paths: [], active: '', positions: [], page: ''}), accountID: ''};
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
    files,
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
    assert.equal(globalThis.document.getElementById('codetree-file-workspace').hidden, true);
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
