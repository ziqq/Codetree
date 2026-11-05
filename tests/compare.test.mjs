/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Branch/tag comparison regressions through provider adapters, routes and production content factories.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as routes from '../src/shared/routes.js';
import {bundle} from './helpers/content.mjs';
import {dom, frames, install} from './helpers/dom.mjs';
import {installDiffViewport} from './helpers/diff-viewport.mjs';
import {installViewerSearchDOM} from './helpers/viewer-search.mjs';

const directory = await mkdtemp(join(tmpdir(), 'codetree-compare-'));
const modulePath = join(directory, 'content.mjs');
await writeFile(modulePath, await bundle({compare: true, fileTabs: true}));
const content = await import(pathToFileURL(modulePath));
await rm(directory, {recursive: true, force: true});
const baseSHA = 'a'.repeat(40);
const headSHA = 'b'.repeat(40);
const mergeSHA = 'c'.repeat(40);
const invalidRefs = [
  '',
  '../main',
  'feature//x',
  '/main',
  'main/',
  'main..dev',
  'fork:main',
  'HEAD~1',
  'HEAD^',
  'a?b',
  'a\nb',
  'a\\b',
  'x'.repeat(513),
];

/** Returns a context with same-repository typed refs and a custom/nested host. */
function context(provider) {
  return {
    origin: `https://${provider}.example.com`,
    provider,
    owner: provider === 'gitlab' ? 'team/nested' : 'team',
    repo: 'repo',
    kind: 'compare',
    baseRef: 'refs/tags/release/1',
    headRef: 'refs/heads/feature/é',
  };
}

/** Runs the real adapter with immutable synthetic API metadata, never a second implementation. */
async function adapter(t, provider, options = {}) {
  install(t, {chrome: {storage: {local: {setAccessLevel: async () => {}}}}});
  const {handle} = await import(`../src/background/providers/${provider}.js`);
  const ctx = context(provider);
  const calls = [];
  const file = {
    filename: 'new.txt',
    previous_filename: 'old.txt',
    status: 'renamed',
    patch: '@@ -1 +1 @@\n-old\n+new',
    additions: 1,
    deletions: 1,
  };
  const change = {old_path: 'old.txt', new_path: 'new.txt', renamed_file: true, diff: file.patch};
  const api = {
    prefix: t.name,
    async pages(path) {
      calls.push({path});
      if (path.endsWith('/branches')) return [{name: 'same'}, {name: 'feature/é'}];
      if (path.endsWith('/tags')) return [{name: 'same'}, {name: 'release/1'}];
      throw new Error(`Unexpected pagination: ${path}`);
    },
    async json(path, ttl, fresh) {
      calls.push({path, fresh});
      if (options.error) throw new Error('Access denied');
      if (path.includes('/commits/')) {
        const selected = decodeURIComponent(path.split('/commits/')[1].split('?')[0]);
        const id = options.badSHA ? 'main' : selected.startsWith('refs/tags/') ? baseSHA : headSHA;
        return {id, sha: id};
      }
      if (path.includes('/merge_base?')) return {id: mergeSHA};
      if (path.includes('/compare')) {
        if (provider === 'github')
          return {merge_base_commit: {sha: mergeSHA}, files: options.empty ? [] : options.files || [file]};
        return {
          diffs: options.empty ? [] : [options.omitted ? {...change, too_large: true, diff: ''} : change],
          compare_timeout: Boolean(options.timeout),
        };
      }
      throw new Error(`Unexpected metadata: ${path}`);
    },
  };
  return {ctx, api, calls, handle, load: () => handle({type: 'DIFF', fresh: true}, ctx, api, {})};
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} comparison routes round-trip typed slash/Unicode refs without colliding with PRs`, () => {
    assert.equal(typeof routes.compareURL, 'function', 'Native comparison links are supported.');
    const ctx = context(provider);
    const url = routes.compareURL(ctx, ctx.baseRef, ctx.headRef);
    const parsed = routes.route(url, provider);
    assert.equal(parsed.kind, 'compare');
    assert.equal(parsed.baseRef, ctx.baseRef);
    assert.equal(parsed.headRef, ctx.headRef);
    assert.equal(parsed.owner, ctx.owner);
    const native = routes.route(
      `${routes.repoURL(ctx)}${provider === 'gitlab' ? '/-' : ''}/compare/main...dev`,
      provider,
    );
    assert.equal(native.kind, 'compare');
    assert.equal(native.headRef, 'dev');
  });

  test(`${provider} comparison routes reject revision expressions, traversal and ambiguous separators`, () => {
    const ctx = context(provider);
    for (const value of invalidRefs) {
      const url = `${routes.repoURL(ctx)}${provider === 'gitlab' ? '/-' : ''}/compare/${encodeURIComponent(value)}...main`;
      assert.equal(routes.route(url, provider), null, value);
    }
  });

  test(`${provider} refs retain distinct branch and tag identities with equal names`, async t => {
    const ui = await adapter(t, provider);
    const refs = await ui.handle({type: 'REFS', fresh: true}, ui.ctx, ui.api, {});
    assert.deepEqual(
      refs.filter(item => item.name === 'same').map(item => item.ref),
      ['refs/heads/same', 'refs/tags/same'],
    );
    assert.equal(refs.find(item => item.name === 'release/1').type, 'tag');
    assert.equal(ui.calls.length, 2);
  });

  test(`${provider} comparisons pin selected refs and load the merge-base tree, preserving renames`, async t => {
    const ui = await adapter(t, provider);
    const diff = await ui.load();
    assert.equal(diff.base.sha, mergeSHA, 'The old text comes from the ancestor, not the diverged Base tip.');
    assert.equal(diff.head.sha, headSHA);
    assert.deepEqual(diff.comparison, {baseSHA, headSHA});
    assert.equal(diff.files[0].previous_filename, 'old.txt');
    assert.equal(diff.files[0].status, 'renamed');
    assert.equal(diff.viewedMode, 'none');
    assert.deepEqual(diff.comments, []);
    assert.ok(ui.calls.filter(call => call.path.includes('/compare')).every(call => call.path.includes(headSHA)));
    assert.ok(ui.calls.every(call => call.fresh === undefined || call.fresh === true));
    if (provider === 'gitlab') {
      assert.equal(diff.base.project, 'team/nested/repo');
      assert.ok(ui.calls.some(call => call.path.includes(`from=${mergeSHA}&to=${headSHA}&straight=true`)));
    } else assert.ok(ui.calls.some(call => call.path.endsWith(`/${baseSHA}...${headSHA}?per_page=1`)));
  });

  test(`${provider} empty comparisons return an explicit empty file list without review data`, async t => {
    const ui = await adapter(t, provider, {empty: true});
    assert.deepEqual((await ui.load()).files, []);
  });

  test(`${provider} validates both refs before making any provider request`, async t => {
    const ui = await adapter(t, provider);
    for (const value of invalidRefs) {
      await assert.rejects(ui.handle({type: 'DIFF'}, {...ui.ctx, baseRef: value}, ui.api, {}), /Invalid comparison/);
      await assert.rejects(ui.handle({type: 'DIFF'}, {...ui.ctx, headRef: value}, ui.api, {}), /Invalid comparison/);
    }
    assert.deepEqual(ui.calls, []);
  });

  test(`${provider} rejects unresolved moving commit identities rather than requesting a mixed diff`, async t => {
    const ui = await adapter(t, provider, {badSHA: true});
    await assert.rejects(ui.load(), /Invalid comparison commit SHA/);
    assert.equal(ui.calls.filter(call => call.path.includes('/compare')).length, 0);
  });

  test(`${provider} request errors remain visible rather than becoming an empty comparison`, async t => {
    const ui = await adapter(t, provider, {error: true});
    await assert.rejects(ui.load(), /Access denied/);
  });
}

test('GitHub marks the 300-file comparison boundary as potentially incomplete', async t => {
  const files = Array.from({length: 300}, (_, index) => ({filename: `${index}.txt`, status: 'modified'}));
  const ui = await adapter(t, 'github', {files});
  const diff = await ui.load();
  assert.equal(diff.files.length, 300);
  assert.ok(diff.warnings.some(warning => /300 files.*incomplete/.test(warning)));
});

test('GitLab rejects a timed-out comparison instead of displaying its partial list', async t => {
  const ui = await adapter(t, 'gitlab', {timeout: true});
  await assert.rejects(ui.load(), /timed out.*incomplete/);
});

test('GitLab preserves omitted-patch flags and warns instead of synthesizing a full diff', async t => {
  const ui = await adapter(t, 'gitlab', {omitted: true});
  const diff = await ui.load();
  assert.equal(diff.files[0].too_large, true);
  assert.equal(diff.files[0].patch, '');
  assert.ok(diff.warnings.some(warning => /patches were omitted/.test(warning)));
});

/** Controllable provider response for dialog disposal and navigation races. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}

/** Installs production viewer, picker and tree factories without browser-global state. */
function picker(t, provider = 'github') {
  let app;
  t.after(() => app?.dispose());
  const {document, window} = dom();
  installDiffViewport(document);
  installViewerSearchDOM(document);
  const clock = frames();
  const navigations = [];
  install(t, {
    document,
    window,
    chrome: {runtime: {getURL: path => `chrome-extension://fixture/${path}`}},
    location: {href: routes.repoURL(context(provider)), assign: url => navigations.push(url)},
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
  });
  app = content.createRoot(dispose => {
    const app = {
      dispose,
      owner: content.getOwner(),
      state: content.createState(),
      run: callback => callback,
      closeBranches() {},
      toast() {},
    };
    app.state.context = context(provider);
    app.state.info = {ref: 'main', repository: {default_branch: 'main'}};
    app.view = content.createView(app);
    app.view.viewer.showModal = () => {
      app.view.viewer.open = true;
    };
    app.view.viewer.close = () => {
      app.view.viewer.open = false;
      void app.view.viewer.fire('close');
    };
    document.body.append(app.view.host);
    Object.assign(app, content.createViewer(app), content.createTree(app), content.createFileTabs(app));
    if (content.createCompare) Object.assign(app, content.createCompare(app));
    app.rpc = async () => [
      {name: 'main', ref: 'refs/heads/main', type: 'branch'},
      {name: 'release/1', ref: 'refs/tags/release/1', type: 'tag'},
      {name: 'feature/é', ref: 'refs/heads/feature/é', type: 'branch'},
    ];
    return app;
  });
  return {...app, app, navigations, document};
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} picker exposes separate Base/Head branch-tag choices and only navigates on submit`, async t => {
    const ui = picker(t, provider);
    assert.equal(typeof ui.app.openCompare, 'function', 'The production comparison picker is available.');
    await ui.view.compareButton.fire('click');
    const form = ui.view.viewer.querySelector('form');
    assert.ok(form);
    const [base, head] = form.querySelectorAll('select');
    assert.equal(base.getAttribute('aria-label'), 'Base branch or tag');
    assert.equal(head.getAttribute('aria-label'), 'Head branch or tag');
    assert.equal(base.querySelectorAll('optgroup').length, 2);
    assert.equal(ui.document.activeElement, base);
    assert.deepEqual(ui.navigations, []);
    await form.fire('submit');
    const parsed = routes.route(ui.navigations[0], provider);
    assert.equal(parsed.baseRef, 'refs/tags/release/1');
    assert.equal(parsed.headRef, 'refs/heads/feature/é');
    assert.equal(ui.view.viewer.open, true, 'Only a native navigation is requested; no PR is created.');
  });

  test(`${provider} compare-tree clicks open the modal while modified clicks use pinned native comparison`, async t => {
    const ui = picker(t, provider);
    ui.state.mode = 'changes';
    ui.state.diff = {comparison: {baseSHA, headSHA}};
    const opened = [];
    ui.app.showDiff = async node => opened.push(node.path);
    const browserTabs = [];
    ui.app.openFileTab = () => assert.fail('Comparison files must not mount inline tabs.');
    ui.window = globalThis.window;
    globalThis.window.open = url => browserTabs.push(url);
    await ui.app.openFile({path: 'new.txt', type: 'blob'});
    assert.deepEqual(opened, ['new.txt']);
    await ui.app.openFile({path: 'new.txt', type: 'blob'}, true);
    const parsed = routes.route(browserTabs[0], provider);
    assert.equal(parsed.baseRef, baseSHA);
    assert.equal(parsed.headRef, headSHA);
  });

  test(`${provider} comparison routes never restore saved Code/PR inline workspaces`, async t => {
    const ui = picker(t, provider);
    const calls = [];
    ui.app.rpc = async type => {
      calls.push(type);
      throw new Error('Unexpected workspace load');
    };
    await ui.app.loadFileTabs();
    assert.deepEqual(calls, []);
    assert.equal(ui.document.querySelector('#codetree-file-workspace'), null);
  });
}

for (const stale of ['close', 'navigation', 'refresh', 'replacement']) {
  test(`comparison picker rejects late reference replies after ${stale}`, async t => {
    const ui = picker(t);
    assert.equal(typeof ui.app.openCompare, 'function', 'The production comparison picker is available.');
    const reply = deferred();
    ui.app.rpc = () => reply.promise;
    const pending = ui.app.openCompare();
    if (stale === 'close') ui.app.closeViewer();
    if (stale === 'navigation') ui.state.epoch++;
    if (stale === 'refresh') ui.state.refreshGeneration++;
    if (stale === 'replacement') ui.app.viewerShell('Another file', 'Unrelated dialog');
    reply.resolve([{name: 'main', ref: 'refs/heads/main', type: 'branch'}]);
    await pending;
    assert.equal(ui.view.viewer.querySelector('form'), null);
    assert.deepEqual(ui.navigations, []);
  });
}

test('comparison picker reports errors and retries with fresh references', async t => {
  const ui = picker(t);
  assert.equal(typeof ui.app.openCompare, 'function');
  const calls = [];
  ui.app.rpc = async (type, value) => {
    calls.push(value.fresh);
    if (calls.length === 1) throw new Error('No access');
    return [];
  };
  await ui.app.openCompare();
  assert.match(ui.view.viewer.textContent, /No access/);
  const retry = ui.view.viewer.querySelectorAll('button').find(button => button.textContent === 'Retry');
  await retry.fire('click');
  assert.deepEqual(calls, [false, true]);
  assert.match(ui.view.viewer.textContent, /No branches or tags/);
});

for (const provider of ['github', 'gitlab']) {
  test(`${provider} comparison View full renders exact renamed revisions in both layouts without review writes`, async t => {
    const broker = await adapter(t, provider);
    const diff = await broker.load();
    const ui = picker(t, provider);
    ui.state.mode = 'changes';
    ui.state.diff = diff;
    const calls = [];
    ui.app.rpc = async (type, message) => {
      calls.push({type, ...message});
      assert.equal(type, 'FILE');
      if (message.source.sha === mergeSHA) {
        assert.equal(message.path, 'old.txt');
        return 'old\n';
      }
      assert.equal(message.source.sha, headSHA);
      assert.equal(message.path, 'new.txt');
      return 'new\n';
    };
    await ui.app.openFile(content.diffNode(diff.files[0]));
    assert.equal(ui.view.viewer.open, true);
    assert.match(ui.view.viewer.textContent, /full-file context/);
    assert.match(ui.view.viewer.textContent, /old/);
    assert.match(ui.view.viewer.textContent, /new/);
    const split = ui.view.viewer.querySelectorAll('button').find(button => button.textContent === 'Side-by-side');
    assert.ok(split);
    await split.fire('click');
    assert.equal(ui.state.diffLayout, 'split');
    assert.match(ui.view.viewer.textContent, /old/);
    assert.match(ui.view.viewer.textContent, /new/);
    assert.deepEqual(
      calls.map(call => call.type),
      ['FILE', 'FILE'],
    );
    assert.equal(ui.document.querySelector('#codetree-file-workspace'), null);
    ui.app.closeViewer();
    assert.equal(ui.view.viewer.open, false);
  });
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} identical selected refs resolve once even if the branch moves between requests`, async t => {
    const ui = await adapter(t, provider, {empty: true});
    ui.ctx.headRef = ui.ctx.baseRef;
    const diff = await ui.load();
    assert.equal(ui.calls.filter(call => call.path.includes('/commits/')).length, 1);
    assert.equal(diff.comparison.baseSHA, diff.comparison.headSHA);
  });

  test(`${provider} refuses an oversized combined branch-tag picker list`, async t => {
    const ui = await adapter(t, provider);
    ui.api.pages = async () => Array.from({length: 5001}, (_, index) => ({name: `ref-${index}`}));
    await assert.rejects(ui.handle({type: 'REFS', fresh: true}, ui.ctx, ui.api, {}), /10,000/);
  });
}

test('native direct GitLab comparisons are not silently interpreted as merge-base comparisons', () => {
  assert.equal(routes.route('https://gitlab.com/team/repo/-/compare/main...dev?straight=true', 'gitlab'), null);
});
