/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Sidebar pinning through the bundled service worker (`build/background.js`):
 * Settings edits the stored default even when it is opened in a tab, pages
 * follow that default until the window pin button chooses a pin for their
 * window, and a chosen pin stays limited to its window.
 */

import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {buildExtension} from '../scripts/build.mjs';

// Run the shipped service-worker bundle, built exactly as the extension package builds it.
const built = mkdtempSync(join(tmpdir(), 'codetree-pins-'));
await buildExtension(built);
const worker = readFileSync(join(built, 'background.js'), 'utf8');
rmSync(built, {recursive: true, force: true});

/** Starts the worker with local and session storage, and returns message senders for Settings and pages. */
function broker() {
  const local = {};
  const session = {};
  const pins = [];
  let listener;
  const event = {addListener() {}};
  const area = store => ({
    async setAccessLevel() {},
    async get(keys) {
      const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
      return structuredClone(Object.fromEntries(names.filter(key => key in store).map(key => [key, store[key]])));
    },
    async set(value) {
      Object.assign(store, structuredClone(value));
    },
    async remove(key) {
      delete store[key];
    },
  });
  const chrome = {
    storage: {local: area(local), session: area(session), onChanged: event},
    runtime: {
      id: 'test',
      getURL: path => `chrome-extension://test/${path}`,
      onMessage: {
        addListener(value) {
          listener = value;
        },
      },
      onInstalled: event,
      onStartup: event,
    },
    tabs: {
      async query({windowId}) {
        return [{id: windowId * 10, windowId}];
      },
      async sendMessage(tabID, message) {
        pins.push({tabID, ...message});
      },
    },
    permissions: {onRemoved: event},
    action: {onClicked: event},
  };
  vm.runInContext(worker, vm.createContext({chrome, URL, AbortSignal, TextDecoder, Uint8Array}));
  const send = (sender, type, values = {}) =>
    new Promise((resolve, reject) =>
      listener({type, ...values}, sender, response =>
        response?.ok ? resolve(response.value) : reject(new Error(response?.error)),
      ),
    );
  const settings = {url: 'chrome-extension://test/options.html', tab: {id: 1, windowId: 1}};
  const page = windowId => ({url: 'https://github.com/sample/repo', tab: {id: windowId * 10, windowId}});
  return {local, session, pins, send, settings, page};
}

test('Settings opened in a tab edits the stored default, not its window pin', async () => {
  const ui = broker();
  await ui.send(ui.page(1), 'WINDOW_PIN', {pinned: true});
  await ui.send(ui.settings, 'PREFERENCES', {value: {pinned: false}});
  const state = await ui.send(ui.settings, 'STATE');
  assert.equal(state.preferences.pinned, false);
  assert.equal(ui.local.preferences.pinned, false);
});

test('a window without a chosen pin follows the default after it changes', async () => {
  const ui = broker();
  assert.equal((await ui.send(ui.page(2), 'STATE')).preferences.pinned, true);
  await ui.send(ui.settings, 'PREFERENCES', {value: {pinned: false}});
  assert.equal((await ui.send(ui.page(2), 'STATE')).preferences.pinned, false);
  assert.deepEqual(ui.session.windowPins || {}, {});
});

test('the window pin button keeps its choice for that window only', async () => {
  const ui = broker();
  await ui.send(ui.settings, 'PREFERENCES', {value: {pinned: false}});
  assert.equal(await ui.send(ui.page(3), 'WINDOW_PIN', {pinned: true}), true);
  assert.deepEqual(ui.pins, [{tabID: 30, type: 'WINDOW_PIN_CHANGED', pinned: true}]);
  assert.equal((await ui.send(ui.page(3), 'STATE')).preferences.pinned, true);
  assert.equal((await ui.send(ui.page(4), 'STATE')).preferences.pinned, false);
  await ui.send(ui.settings, 'PREFERENCES', {value: {pinned: true}});
  await ui.send(ui.page(3), 'WINDOW_PIN', {pinned: false});
  assert.equal((await ui.send(ui.page(3), 'STATE')).preferences.pinned, false);
  assert.equal((await ui.send(ui.page(4), 'STATE')).preferences.pinned, true);
});

test('a page cannot change the default pin', async () => {
  const ui = broker();
  await assert.rejects(
    ui.send(ui.page(5), 'PREFERENCES', {value: {pinned: false}}),
    /Use the window pin button to change pinning in this window/,
  );
});
