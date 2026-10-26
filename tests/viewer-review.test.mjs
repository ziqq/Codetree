/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Viewed-and-next regressions through the production View full modal.
 * Controlled broker replies verify ordering and stale-view ownership; fixture
 * geometry does not prove installed-browser or authenticated provider behavior.
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
import {installViewerSearchDOM} from './helpers/viewer-search.mjs';

const directory = await mkdtemp(join(tmpdir(), 'codetree-viewer-review-'));
const modulePath = join(directory, 'content.mjs');
await writeFile(modulePath, await bundle());
const content = await import(pathToFileURL(modulePath));
await rm(directory, {recursive: true, force: true});
const {createRoot, createState, getOwner, untrackActions, withOwner} = content;
const baseSHA = 'a'.repeat(40);
const headSHA = 'b'.repeat(40);
const paths = ['src/zebra.txt', 'docs/alpha.txt', 'src/middle.txt'];

/** Creates exact complete revisions with a valid replacement patch for each listed file. */
function revision(path) {
  return {
    before: `old ${path}\nshared context\n`,
    after: `new ${path}\nshared context\n`,
    node: {
      path,
      type: 'blob',
      status: 'modified',
      adds: 1,
      dels: 1,
      patch: `@@ -1,2 +1,2 @@\n-old ${path}\n+new ${path}\n shared context`,
    },
  };
}

/** Owns one deferred broker acknowledgement without replacing production handlers. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return {promise, resolve, reject};
}

/** Installs the real modal and captures exact FILE and VIEWED requests. */
function fixture(
  t,
  {provider = 'github', mode = provider === 'github' ? 'github' : 'local', viewed = {}, delayedClose = false} = {},
) {
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
  const closeEvents = [];
  viewer.close = () => {
    viewer.open = false;
    if (delayedClose) closeEvents.push(() => viewer.fire('close'));
    else void viewer.fire('close');
  };
  /** Delivers the queued native close event after intervening broker microtasks. */
  async function flushClose() {
    for (const event of closeEvents.splice(0)) await event();
  }
  document.body.append(viewer);
  const files = paths.map(revision);
  const requests = [];
  const writes = [];
  let pageAlive = true;
  const app = createRoot(dispose => {
    const state = createState();
    const origin = provider === 'github' ? 'https://github.com' : 'https://gitlab.com';
    state.context = {origin, provider, owner: 'sample', repo: 'repo', kind: 'pull', number: 1};
    const source = sha => ({origin, provider, owner: 'sample', repo: 'repo', sha});
    state.diff = {
      base: source(baseSHA),
      head: source(headSHA),
      files: files.map(({node}) => ({...node, filename: node.path, additions: node.adds, deletions: node.dels})),
      viewedMode: mode,
      viewed: {...viewed},
    };
    const app = {
      owner: getOwner(),
      state,
      dispose,
      pageAlive: () => pageAlive,
      view: {viewer},
      run: callback => withOwner(callback),
      diffURL: async () =>
        `${origin}/sample/repo/${provider === 'github' ? 'pull/1/files' : '-/merge_requests/1/diffs'}`,
      async rpc(type, message) {
        requests.push({type, message});
        if (type === 'VIEWED') {
          const response = deferred();
          writes.push({...response, message});
          return response.promise;
        }
        assert.equal(type, 'FILE');
        const file = files.find(({node}) => node.path === message.path);
        assert.ok(file, `the requested file is listed: ${message.path}`);
        return message.source.sha === baseSHA ? file.before : file.after;
      },
    };
    Object.assign(app, untrackActions(content.createViewer(app)));
    return app;
  });
  t.after(app.dispose);
  return {app, files, viewer, writes, requests, clock, flushClose, expire: () => (pageAlive = false)};
}

/** Requires the public review UI, so the pre-feature version fails on visible behavior. */
function controls(ui) {
  const group = ui.viewer.querySelector('[aria-label="File review"]');
  assert.ok(group, 'View full exposes Viewed and next-unviewed review controls');
  assert.equal(group.hidden, false);
  const control = group.querySelector('button');
  assert.ok(control, 'the review action is a button');
  return {group, control, status: group.querySelector('[role="status"]')};
}

/** Opens one complete file and checks its heading and usable public review control. */
async function open(ui, index = 0, layout = 'Unified') {
  await ui.app.showDiff(ui.files[index].node);
  assert.equal(ui.viewer.open, true);
  assert.equal(heading(ui), paths[index]);
  assert.ok(ui.viewer.querySelector('.code-spacer'), 'View full renders the complete validated file');
  if (layout === 'Side-by-side') {
    const control = ui.viewer.querySelectorAll('button').find(node => node.textContent === layout);
    assert.ok(control, 'View full exposes Side-by-side');
    await control.fire('click');
    ui.clock.flush();
    assert.ok(ui.viewer.querySelector('[aria-label="Old revision"]'));
    assert.ok(ui.viewer.querySelector('[aria-label="New revision"]'));
  }
  return controls(ui);
}

/** Reads the current public file heading without relying on viewer generation internals. */
function heading(ui) {
  return ui.viewer.querySelector('.viewer-heading')?.querySelector('strong')?.textContent;
}

/** Returns file reads only, making unintended navigation observable. */
function reads(ui) {
  return ui.requests.filter(request => request.type === 'FILE').map(request => request.message.path);
}

/** Starts the public action while withholding its broker acknowledgement. */
function start(ui) {
  const {control} = controls(ui);
  assert.equal(control.disabled, false);
  const task = control.fire('click');
  assert.equal(control.disabled, true, 'the write disables repeat activation');
  assert.equal(control.textContent, 'Saving…');
  return task;
}

/** Confirms the latest captured write and waits for any resulting full-file navigation. */
async function confirm(ui, task, result = {state: 'VIEWED'}) {
  ui.writes.at(-1).resolve(result);
  await task;
  ui.clock.flush();
}

for (const {provider, mode, layout} of [
  {provider: 'github', mode: 'github', layout: 'Unified'},
  {provider: 'github', mode: 'local', layout: 'Side-by-side'},
  {provider: 'gitlab', mode: 'local', layout: 'Unified'},
  {provider: 'gitlab', mode: 'local', layout: 'Side-by-side'},
]) {
  test(`View full ${provider}/${mode} ${layout} waits for Viewed acknowledgement before advancing in listed order`, async t => {
    const ui = fixture(t, {provider, mode});
    const {control} = await open(ui, 0, layout);
    assert.equal(control.classList.contains('small-button'), true);
    assert.equal(control.textContent, 'Viewed & next');
    const context = ui.app.state.context;
    const diff = ui.app.state.diff;
    const task = start(ui);
    assert.equal(ui.writes.length, 1);
    assert.deepEqual(ui.writes[0].message, {context, headSHA, path: paths[0], viewed: true});
    assert.equal(heading(ui), paths[0]);
    assert.deepEqual(reads(ui), [paths[0], paths[0]], 'unconfirmed Viewed cannot start the next file fetch');
    assert.equal(diff.viewed[paths[0]], undefined);
    await confirm(ui, task, {state: 'VIEWED', mode});
    assert.equal(diff.viewed[paths[0]], 'VIEWED');
    assert.equal(ui.app.state.diff, diff, 'publishing Viewed preserves the loaded review identity');
    assert.equal(heading(ui), paths[1], 'the API list order wins over alphabetical path sorting');
    assert.deepEqual(reads(ui), [paths[0], paths[0], paths[1], paths[1]]);
    assert.equal(controls(ui).control.textContent, 'Viewed & next');
  });
}

test('View full skips viewed files and wraps to an earlier unviewed file despite sidebar filters', async t => {
  const ui = fixture(t, {viewed: {[paths[1]]: 'VIEWED'}});
  ui.app.state.searchText = 'only-matching-something-else';
  ui.app.state.query = 'only-matching-something-else';
  ui.app.state.filter = 'removed';
  ui.app.state.unviewedOnly = true;
  ui.app.state.entries = [{path: paths[2], viewed: false}];
  await open(ui, 2, 'Side-by-side');
  const task = start(ui);
  await confirm(ui, task);
  assert.equal(heading(ui), paths[0]);
  assert.equal(ui.app.state.diff.viewed[paths[1]], 'VIEWED');
  assert.deepEqual(reads(ui), [paths[2], paths[2], paths[0], paths[0]]);
});

test('View full Next unviewed skips an already viewed current file without another write', async t => {
  const ui = fixture(t, {viewed: {[paths[0]]: 'VIEWED', [paths[1]]: 'VIEWED'}});
  const {control} = await open(ui);
  assert.equal(control.textContent, 'Next unviewed');
  await control.fire('click');
  assert.equal(heading(ui), paths[2]);
  assert.equal(ui.writes.length, 0);
  assert.deepEqual(reads(ui), [paths[0], paths[0], paths[2], paths[2]]);
});

test('View full keeps the final file open and reports completion of the listed files only', async t => {
  const ui = fixture(t, {viewed: {[paths[0]]: 'VIEWED', [paths[1]]: 'VIEWED'}});
  ui.app.state.diff.warnings = ['GitHub returned 3 of 4 changed files. Its PR files API is limited to 3,000 files.'];
  await open(ui, 2);
  const task = start(ui);
  await confirm(ui, task);
  const {control, status} = controls(ui);
  assert.equal(heading(ui), paths[2]);
  assert.equal(ui.viewer.open, true);
  assert.equal(control.disabled, true);
  assert.equal(control.textContent, 'Next unviewed');
  assert.equal(status.textContent, 'All listed files viewed');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.deepEqual(reads(ui), [paths[2], paths[2]]);
  await control.fire('click');
  assert.equal(ui.writes.length, 1, 'even a synthetic activation cannot repeat a completed mark');
});

for (const failure of ['rejected', 'mismatched state', 'invalid mode']) {
  test(`View full ${failure} acknowledgement keeps the file unviewed and offers a safe retry`, async t => {
    const ui = fixture(t);
    await open(ui);
    const task = start(ui);
    if (failure === 'rejected') ui.writes[0].reject(new Error('Provider could not save Viewed'));
    else
      ui.writes[0].resolve({
        state: failure === 'mismatched state' ? 'UNVIEWED' : 'VIEWED',
        mode: failure === 'invalid mode' ? 'remote' : 'github',
      });
    await task;
    const {control, status} = controls(ui);
    assert.equal(heading(ui), paths[0]);
    assert.equal(ui.app.state.diff.viewed[paths[0]], undefined);
    assert.deepEqual(reads(ui), [paths[0], paths[0]]);
    assert.equal(control.disabled, false);
    assert.equal(control.textContent, 'Viewed & next');
    assert.match(status.textContent, /could not save|not confirmed/i);
    assert.equal(status.classList.contains('error'), true);
    const retry = start(ui);
    assert.equal(status.textContent, '', 'retry clears the previous provider error');
    assert.equal(ui.writes.length, 2);
    await confirm(ui, retry);
    assert.equal(heading(ui), paths[1]);
    assert.equal(ui.app.state.diff.viewed[paths[0]], 'VIEWED');
  });
}

test('View full ignores duplicate activation while the same Viewed acknowledgement is pending', async t => {
  const ui = fixture(t);
  const {control} = await open(ui);
  const task = start(ui);
  await control.fire('click');
  await control.fire('click');
  assert.equal(ui.writes.length, 1);
  assert.equal(heading(ui), paths[0]);
  await confirm(ui, task);
  assert.equal(heading(ui), paths[1]);
  assert.equal(ui.writes.length, 1);
});

test('View full accepts GitHub local fallback before advancing and retains the returned mode', async t => {
  const ui = fixture(t);
  await open(ui);
  const task = start(ui);
  await confirm(ui, task, {state: 'VIEWED', mode: 'local'});
  assert.equal(ui.app.state.diff.viewedMode, 'local');
  assert.equal(ui.app.state.diff.viewed[paths[0]], 'VIEWED');
  assert.equal(heading(ui), paths[1]);
});

test('closing View full permits its same-review acknowledgement to publish without reopening the viewer', async t => {
  const ui = fixture(t);
  const {group} = await open(ui);
  const task = start(ui);
  const close = ui.viewer.querySelector('[aria-label="Close viewer"]');
  assert.ok(close);
  await close.fire('click');
  assert.equal(ui.viewer.open, false);
  assert.equal(group.isConnected, false, 'closing disposes the review control');
  await confirm(ui, task);
  assert.equal(ui.app.state.diff.viewed[paths[0]], 'VIEWED');
  assert.equal(ui.viewer.open, false);
  assert.deepEqual(reads(ui), [paths[0], paths[0]], 'a late acknowledgement cannot fetch or reopen another file');
});

test('View full cannot reopen from a Viewed acknowledgement while its native close event is still queued', async t => {
  const ui = fixture(t, {delayedClose: true});
  const {group} = await open(ui);
  const task = start(ui);
  const close = ui.viewer.querySelector('[aria-label="Close viewer"]');
  assert.ok(close);
  await close.fire('click');
  assert.equal(ui.viewer.open, false, 'dialog.close clears open before dispatching the native close event');
  assert.equal(group.isConnected, true, 'the fixture withholds close cleanup until its queued event runs');
  await confirm(ui, task);
  assert.equal(ui.app.state.diff.viewed[paths[0]], 'VIEWED', 'the confirmed same-review mark still publishes');
  assert.deepEqual(reads(ui), [paths[0], paths[0]], 'closed dialog cannot fetch another file before its close event');
  assert.equal(ui.viewer.open, false, 'the acknowledgement cannot reopen the dismissed dialog');
  assert.equal(heading(ui), paths[0]);
  await ui.flushClose();
  assert.equal(group.isConnected, false, 'the queued close event disposes the old review controls');
  assert.equal(ui.viewer.open, false);
});

test('manual View full navigation wins over an earlier pending Viewed-and-next action', async t => {
  const ui = fixture(t);
  const {group} = await open(ui);
  const task = start(ui);
  const next = ui.viewer.querySelector('[aria-label="Next changed file"]');
  assert.ok(next);
  await next.fire('click');
  assert.equal(heading(ui), paths[1]);
  assert.equal(group.isConnected, false);
  await confirm(ui, task);
  assert.equal(ui.app.state.diff.viewed[paths[0]], 'VIEWED');
  assert.equal(heading(ui), paths[1]);
  assert.deepEqual(reads(ui), [paths[0], paths[0], paths[1], paths[1]]);
  assert.equal(ui.viewer.querySelectorAll('[aria-label="File review"]').length, 1);
});

for (const invalidation of [
  {name: 'page lifetime', change: ui => ui.expire()},
  {name: 'page epoch', change: ui => ui.app.state.epoch++},
  {name: 'file generation', change: ui => ui.app.state.filesGeneration++},
  {name: 'review context', change: ui => (ui.app.state.context = {...ui.app.state.context, number: 2})},
  {name: 'loaded review', change: ui => (ui.app.state.diff = {...ui.app.state.diff, viewed: {}})},
  {name: 'head revision', change: ui => (ui.app.state.diff.head.sha = 'c'.repeat(40))},
  {name: 'base revision', change: ui => (ui.app.state.diff.base.sha = 'd'.repeat(40))},
]) {
  test(`View full ignores a Viewed acknowledgement after its ${invalidation.name} changes`, async t => {
    const ui = fixture(t);
    await open(ui);
    const diff = ui.app.state.diff;
    const task = start(ui);
    invalidation.change(ui);
    await confirm(ui, task);
    assert.equal(diff.viewed[paths[0]], undefined, 'a stale write is not published into the captured review');
    assert.equal(ui.app.state.diff.viewed[paths[0]], undefined, 'the current review is not marked by stale work');
    assert.equal(heading(ui), paths[0]);
    assert.deepEqual(reads(ui), [paths[0], paths[0]], 'stale work cannot fetch the next changed file');
    assert.equal(ui.writes.length, 1);
  });
}
