/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * File-workspace metadata through the shipped service-worker bundle.
 * Synthetic browser storage exercises scope isolation, serialized saves,
 * account changes, validation and session budgets without provider APIs.
 */

import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {buildExtension} from '../scripts/build.mjs';

const built = mkdtempSync(join(tmpdir(), 'codetree-file-tabs-'));
await buildExtension(built);
const worker = readFileSync(join(built, 'background.js'), 'utf8');
rmSync(built, {recursive: true, force: true});

/** Returns a complete metadata snapshot, with separate positions for two branches. */
function workspace(path = 'src/a.js') {
  return {
    paths: [path],
    active: path,
    positions: [
      {ref: 'main', path, top: 720, left: 48},
      {ref: 'feature', path, top: 1440, left: 96},
    ],
    page: JSON.stringify(['blob', 'main', path]),
  };
}

/** Returns a deferred reply used to hold a real storage operation at a known boundary. */
function deferred() {
  let resolve;
  const promise = new Promise(done => (resolve = done));
  return {promise, resolve};
}

/** Starts a fresh bundled broker with observable, independently keyed local/session stores. */
function broker(provider = 'github') {
  const origin = `https://${provider}.com`;
  const context = {
    provider,
    origin,
    owner: provider === 'gitlab' ? 'sample/nested' : 'sample',
    repo: 'repo',
    kind: 'repo',
  };
  const local = {};
  const session = {windowPins: {7: true}, oauthDevice: {id: 'synthetic-pending'}, unrelated: {preserve: true}};
  const event = {addListener() {}};
  let listener;
  let pausedRead;
  let observedAccountRead;
  let sessionReads = 0;

  /** Supplies the browser storage clone semantics and controllable session reads. */
  function area(store, isSession = false) {
    return {
      async setAccessLevel() {},
      async get(keys) {
        const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
        if (isSession) {
          sessionReads++;
          if (pausedRead && names.includes('fileTabs')) {
            const pause = pausedRead;
            pausedRead = null;
            pause.entered.resolve();
            await pause.release.promise;
          }
        }
        const value = structuredClone(
          Object.fromEntries(names.filter(key => key in store).map(key => [key, store[key]])),
        );
        if (!isSession && names.includes('accounts') && observedAccountRead) {
          observedAccountRead.resolve();
          observedAccountRead = null;
        }
        return value;
      },
      async set(value) {
        Object.assign(store, structuredClone(value));
      },
      async remove(key) {
        delete store[key];
      },
    };
  }

  const chrome = {
    storage: {local: area(local), session: area(session, true), sync: area({}), onChanged: event},
    runtime: {
      id: 'test',
      getURL: path => `chrome-extension://test/${path}`,
      onMessage: {addListener: value => (listener = value)},
      onInstalled: event,
      onStartup: event,
    },
    permissions: {onRemoved: event},
    action: {onClicked: event},
  };
  vm.runInContext(worker, vm.createContext({chrome, URL, AbortSignal, TextDecoder, TextEncoder, Uint8Array}));

  /** Sends a real broker message; tests may override the page, context or message type. */
  function send(values = {}, options = {}) {
    const requestContext = values.context || context;
    const sender = options.sender || {
      url: `${requestContext.origin}/${requestContext.owner}/${requestContext.repo}`,
      tab: {id: options.tabID ?? 1},
    };
    return new Promise((resolve, reject) =>
      listener({type: 'FILE_TABS', scope: 'code', context, ...values}, sender, response =>
        response?.ok ? resolve(structuredClone(response.value)) : reject(new Error(response?.error)),
      ),
    );
  }

  return {
    context,
    local,
    session,
    send,
    get sessionReads() {
      return sessionReads;
    },
    pauseNextSessionRead() {
      const pause = {entered: deferred(), release: deferred()};
      pausedRead = pause;
      return {entered: pause.entered.promise, release: pause.release.resolve};
    },
    observeNextAccountRead() {
      observedAccountRead = deferred();
      return observedAccountRead.promise;
    },
    connectAccounts() {
      local.accounts = ['alpha', 'beta'].map(id => ({id, origin, provider, login: id, token: `synthetic-${id}`}));
      local.selectedAccounts = {[origin]: 'alpha'};
    },
  };
}

for (const provider of ['github', 'gitlab']) {
  test(`${provider} restores code paths and per-branch positions in the same browser tab`, async () => {
    const ui = broker(provider);
    assert.equal(ui.sessionReads, 0, 'workspace metadata must not load at worker startup');
    assert.deepEqual(await ui.send(), {paths: [], active: '', positions: [], page: '', accountID: ''});
    const value = workspace();
    assert.deepEqual(await ui.send({accountID: '', value}), {...value, accountID: ''});
    assert.deepEqual(await ui.send({context: {...ui.context, refHint: 'feature'}}), {...value, accountID: ''});
    assert.deepEqual(await ui.send({}, {tabID: 2}), {paths: [], active: '', positions: [], page: '', accountID: ''});
    assert.deepEqual(await ui.send({context: {...ui.context, repo: 'other'}}), {
      paths: [],
      active: '',
      positions: [],
      page: '',
      accountID: '',
    });
  });

  test(`${provider} keeps code, individual request and commit workspaces separate`, async () => {
    const ui = broker(provider);
    const review1 = {context: {...ui.context, kind: 'pull', number: 1}, scope: 'review'};
    const review2 = {context: {...ui.context, kind: 'pull', number: 2}, scope: 'review'};
    const commit = {context: {...ui.context, kind: 'commit', sha: 'a'.repeat(40)}, scope: 'review'};
    for (const [scope, path] of [
      [{}, 'code.js'],
      [review1, 'first.js'],
      [review2, 'second.js'],
      [commit, 'commit.js'],
    ])
      await ui.send({...scope, accountID: '', value: workspace(path)});
    assert.equal((await ui.send()).active, 'code.js');
    assert.equal((await ui.send(review1)).active, 'first.js');
    assert.equal((await ui.send(review2)).active, 'second.js');
    assert.equal((await ui.send(commit)).active, 'commit.js');
    assert.deepEqual((await ui.send(review1)).positions, workspace('first.js').positions);
  });

  test(`${provider} restores each selected account and rejects a caller's stale account ID`, async () => {
    const ui = broker(provider);
    ui.connectAccounts();
    assert.equal((await ui.send()).accountID, 'alpha');
    await ui.send({accountID: 'alpha', value: workspace('alpha.js')});
    await ui.send({type: 'SELECT_ACCOUNT', origin: ui.context.origin, id: 'beta'});
    assert.deepEqual(await ui.send(), {paths: [], active: '', positions: [], page: '', accountID: 'beta'});
    await assert.rejects(ui.send({accountID: 'alpha', value: workspace('leaked.js')}), /selected account changed/);
    await ui.send({accountID: 'beta', value: workspace('beta.js')});
    await ui.send({type: 'SELECT_ACCOUNT', origin: ui.context.origin, id: 'alpha'});
    assert.equal((await ui.send()).active, 'alpha.js');
    assert.equal(
      ui.session.fileTabs.some(entry => entry.value.paths.includes('leaked.js')),
      false,
    );
  });
}

test('metadata writes retain only paths, active file, route identity and scroll fields', async () => {
  const ui = broker();
  const value = workspace();
  const submitted = {
    ...value,
    text: 'raw file text',
    token: 'raw token',
    context: {owner: 'spoofed'},
    positions: value.positions.map(position => ({...position, text: 'raw line'})),
  };
  await ui.send({accountID: '', value: submitted, tabID: 500, workspaceKey: 'spoofed'});
  assert.deepEqual(await ui.send(), {...value, accountID: ''});
  assert.deepEqual(
    ui.session.fileTabs.map(entry => entry.value),
    [value],
  );
  assert.equal(JSON.stringify(ui.session.fileTabs).includes('raw'), false);
  assert.equal((await ui.send({}, {tabID: 500})).paths.length, 0, 'message tab IDs cannot replace sender identity');
});

test('metadata saves preserve window pins, pending authorization and unrelated session keys', async () => {
  const ui = broker();
  const before = structuredClone(ui.session);
  await ui.send({accountID: '', value: workspace()});
  assert.deepEqual(Object.fromEntries(Object.entries(ui.session).filter(([key]) => key !== 'fileTabs')), before);
});

test('a GET waits for an earlier save instead of restoring stale metadata', async () => {
  const ui = broker();
  const pause = ui.pauseNextSessionRead();
  const save = ui.send({accountID: '', value: workspace('saved.js')});
  await pause.entered;
  const read = ui.send();
  let finished = false;
  read.then(() => (finished = true));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  pause.release();
  await save;
  assert.equal((await read).active, 'saved.js');
});

test('an account change rejects a save already waiting behind another workspace operation', async () => {
  const ui = broker();
  ui.connectAccounts();
  await ui.send({accountID: 'alpha', value: workspace('alpha.js')});
  const pause = ui.pauseNextSessionRead();
  const blocked = ui.send();
  await pause.entered;
  const captured = ui.observeNextAccountRead();
  const pending = ui.send({accountID: 'alpha', value: workspace('stale.js')});
  await captured;
  await ui.send({type: 'SELECT_ACCOUNT', origin: ui.context.origin, id: 'beta'});
  pause.release();
  await blocked;
  await assert.rejects(pending, /selected account changed/);
  assert.equal((await ui.send()).accountID, 'beta');
  assert.equal((await ui.send()).paths.length, 0);
  await ui.send({type: 'SELECT_ACCOUNT', origin: ui.context.origin, id: 'alpha'});
  assert.equal((await ui.send()).active, 'alpha.js');
});

test('metadata accepts the supported open-file and position counts', async () => {
  const ui = broker();
  const paths = Array.from({length: 32}, (_, index) => `src/file${index}.js`);
  const value = {
    paths,
    active: paths.at(-1),
    page: '',
    positions: Array.from({length: 256}, (_, index) => ({
      ref: `branch${index}`,
      path: paths[index % paths.length],
      top: index,
      left: 0,
    })),
  };
  await ui.send({accountID: '', value});
  assert.deepEqual(await ui.send(), {...value, accountID: ''});
});

const invalidWorkspaces = [
  [
    'too many files',
    value => ({
      ...value,
      paths: Array.from({length: 33}, (_, index) => `file${index}.js`),
      active: 'file0.js',
      positions: [],
    }),
  ],
  ['duplicate files', value => ({...value, paths: [value.active, value.active]})],
  ['parent path segments', () => workspace('src/../private.js')],
  ['oversized paths', () => workspace('x'.repeat(4097))],
  ['active file outside open tabs', value => ({...value, active: 'other.js'})],
  ['position outside open tabs', value => ({...value, positions: [{ref: 'main', path: 'other.js', top: 0, left: 0}]})],
  ['negative scroll offsets', value => ({...value, positions: [{...value.positions[0], top: -1}]})],
  ['non-finite scroll offsets', value => ({...value, positions: [{...value.positions[0], left: Infinity}]})],
  ['excessive scroll offsets', value => ({...value, positions: [{...value.positions[0], top: 1_000_000_001}]})],
  ['oversized branch identifiers', value => ({...value, positions: [{...value.positions[0], ref: 'x'.repeat(1025)}]})],
  ['too many positions', value => ({...value, positions: Array.from({length: 257}, () => value.positions[0])})],
  ['oversized route identity', value => ({...value, page: 'x'.repeat(8193)})],
  [
    'oversized serialized metadata',
    () => {
      const paths = Array.from({length: 32}, (_, index) => `${index}/${'x'.repeat(2100)}`);
      return {paths, active: paths[0], positions: [], page: ''};
    },
  ],
];

for (const [name, invalid] of invalidWorkspaces)
  test(`metadata rejects ${name} without replacing an earlier workspace`, async () => {
    const ui = broker();
    const value = workspace();
    await ui.send({accountID: '', value});
    await assert.rejects(ui.send({accountID: '', value: invalid(value)}), /Invalid|too large/);
    assert.deepEqual(await ui.send(), {...value, accountID: ''});
  });

test('corrupt persisted metadata restores an empty workspace instead of unvalidated fields', async () => {
  const ui = broker();
  await ui.send({accountID: '', value: workspace()});
  ui.session.fileTabs[0].value = {paths: ['../secret.js'], active: '../secret.js', positions: [], text: 'raw'};
  assert.deepEqual(await ui.send(), {paths: [], active: '', positions: [], page: '', accountID: ''});
  await ui.send({accountID: '', value: workspace('recovered.js')});
  assert.equal((await ui.send()).active, 'recovered.js');
});

test('bounded workspace eviction retains the 50 most recently saved scopes', async () => {
  const ui = broker();
  for (let tabID = 1; tabID <= 51; tabID++)
    await ui.send({accountID: '', value: workspace(`file${tabID}.js`)}, {tabID});
  assert.equal(ui.session.fileTabs.length, 50);
  assert.equal((await ui.send({}, {tabID: 1})).paths.length, 0);
  assert.equal((await ui.send({}, {tabID: 2})).active, 'file2.js');
  assert.equal((await ui.send({}, {tabID: 51})).active, 'file51.js');
});

test('Settings, missing browser identities and cross-host contexts cannot access file workspaces', async () => {
  const ui = broker();
  await assert.rejects(
    ui.send({}, {sender: {url: 'chrome-extension://test/options.html', tab: {id: 1}}}),
    /own repository host/,
  );
  await assert.rejects(ui.send({}, {sender: {url: 'https://github.com/sample/repo'}}), /cannot access extension data/);
  await assert.rejects(
    ui.send({}, {sender: {url: 'https://github.com/sample/repo', tab: {}}}),
    /repository browser tab/,
  );
  await assert.rejects(
    ui.send(
      {context: {...ui.context, origin: 'https://gitlab.com', provider: 'gitlab'}},
      {sender: {url: 'https://github.com/sample/repo', tab: {id: 1}}},
    ),
    /own repository host/,
  );
  await assert.rejects(ui.send({context: {...ui.context, provider: 'gitlab'}}), /Invalid repository provider/);
  assert.equal(ui.session.fileTabs, undefined);
});

test('review metadata requires a validated request number or commit revision', async () => {
  const ui = broker();
  await assert.rejects(ui.send({scope: 'review'}), /require a pull request/);
  await assert.rejects(
    ui.send({scope: 'review', context: {...ui.context, kind: 'pull', number: 0}}),
    /Invalid pull request number/,
  );
  await assert.rejects(
    ui.send({scope: 'review', context: {...ui.context, kind: 'commit', sha: '../main'}}),
    /Invalid commit/,
  );
  assert.equal(ui.session.fileTabs, undefined);
});
