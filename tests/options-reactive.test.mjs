/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Settings regressions through the bundled entry point and synthetic broker/storage events.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {build} from 'esbuild';
import {defaults, preferences} from '../src/shared/preferences.js';
import {dom} from './helpers/dom.mjs';

const built = await build({
  entryPoints: ['src/options/index.js'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'chrome116',
});
const script = built.outputFiles[0].text;

/** Lets the entry point's bootstrap promise chain finish without real timers. */
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

/** Starts Settings with form controls, a mutable broker snapshot and owned browser events. */
async function settings(t) {
  const {document, window} = dom();
  const fields = {
    'appearance-form': ['dock', 'iconTheme', 'width', 'fontSize', 'fontFamily', 'pinned'],
    'navigation-form': ['pageScope', 'hidePatterns', 'folderClick', 'toggleShortcut', 'searchShortcut'],
    'account-form': ['provider', 'origin', 'label', 'token'],
    'sync-form': ['enabled'],
  };
  for (const [id, names] of Object.entries(fields)) {
    const form = document.createElement('form');
    form.id = id;
    const elements = {
      namedItem(name) {
        return this[name] || null;
      },
    };
    for (const name of names) {
      const field = document.createElement('input');
      field.type = ['pinned', 'folderClick', 'enabled'].includes(name) ? 'checkbox' : 'text';
      elements[name] = field;
      form.append(field);
    }
    form.elements = elements;
    document.body.append(form);
  }
  const ids = [
    'accounts',
    'account-status',
    'appearance-status',
    'connect-button',
    'font-preview',
    'sync-save',
    'sync-status',
    'oauth-github',
    'oauth-gitlab',
    'oauth-status',
    'oauth-device',
    'oauth-access',
    'oauth-cancel',
    'oauth-code',
    'oauth-note',
    'host-note',
    'github-permissions',
    'gitlab-permissions',
    'navigation-status',
    'page-error',
  ];
  for (const id of ids) {
    const node = document.createElement('div');
    node.id = id;
    document.body.append(node);
  }
  document.getElementById('account-form').elements.provider.value = 'github';
  document.getElementById('account-form').elements.origin.value = 'https://github.com';
  let snapshot = {preferences: {...defaults}, accounts: [], sync: {enabled: false}};
  const listeners = new Set();
  const requests = [];
  const timers = new Map();
  let timerID = 0;
  let syncError;
  const context = vm.createContext({
    document,
    window,
    URL,
    setTimeout(callback, delay) {
      timers.set(++timerID, {callback, delay});
      return timerID;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    chrome: {
      storage: {
        onChanged: {
          addListener(fn) {
            listeners.add(fn);
          },
          removeListener(fn) {
            listeners.delete(fn);
          },
        },
      },
      runtime: {
        async sendMessage(message) {
          requests.push(message);
          if (message.type === 'OAUTH_INFO') return {ok: true, value: {github: true, gitlab: true}};
          if (message.type === 'OAUTH_GITHUB_START')
            return {ok: true, value: {id: 'fixture', userCode: 'TEST-CODE', interval: 5}};
          if (message.type === 'OAUTH_CANCEL') return {ok: true, value: true};
          if (message.type === 'PREFERENCES') {
            snapshot = {...snapshot, preferences: preferences({...snapshot.preferences, ...message.value})};
            return {ok: true, value: snapshot.preferences};
          }
          if (message.type === 'SYNC_SETTINGS' && syncError) return {ok: false, error: syncError};
          if (message.type === 'SYNC_SETTINGS') snapshot = {...snapshot, sync: {enabled: message.enabled}};
          return {ok: true, value: snapshot};
        },
      },
    },
  });
  vm.runInContext(script, context, {filename: 'options.js'});
  t.after(() => window.fire('pagehide'));
  await settle();
  assert.equal(document.getElementById('page-error').textContent, '');
  return {
    document,
    window,
    requests,
    timers,
    listeners,
    element: id => document.getElementById(id),
    async stored(value, area = 'local') {
      snapshot = {...snapshot, preferences: preferences(value)};
      for (const listener of listeners) listener({preferences: {newValue: value}}, area);
      await settle();
    },
    failSync(error) {
      syncError = error;
    },
  };
}

test('stored sidebar/Sync appearance changes reach the form before another appearance save', async t => {
  const ui = await settings(t);
  const appearance = ui.element('appearance-form');
  await ui.stored({...defaults, width: 468, dock: 'right', fontSize: 17});
  assert.equal(appearance.elements.width.value, 468);
  assert.equal(appearance.elements.dock.value, 'right');
  assert.equal(appearance.elements.fontSize.value, 17);
  appearance.elements.iconTheme.value = 'minimal';
  await appearance.fire('submit');
  const save = ui.requests.findLast(message => message.type === 'PREFERENCES');
  assert.equal(save.value.width, 468);
  assert.equal(save.value.dock, 'right');
  assert.equal(save.value.fontSize, 17);
  assert.equal(save.value.iconTheme, 'minimal');
});

test('a preference saved elsewhere keeps unsaved edits of other fields', async t => {
  const ui = await settings(t);
  const appearance = ui.element('appearance-form');
  const navigation = ui.element('navigation-form');
  appearance.elements.fontSize.value = '16';
  navigation.elements.hidePatterns.value = '/sample/repo/wiki/*';
  await ui.stored({...defaults, width: 420});
  assert.equal(appearance.elements.width.value, 420);
  assert.equal(appearance.elements.fontSize.value, '16');
  assert.equal(navigation.elements.hidePatterns.value, '/sample/repo/wiki/*');
  await appearance.fire('submit');
  assert.equal(
    navigation.elements.hidePatterns.value,
    '/sample/repo/wiki/*',
    'an Appearance save keeps Navigation edits',
  );
});

test('navigation save displays the broker-normalized values', async t => {
  const ui = await settings(t);
  const navigation = ui.element('navigation-form');
  navigation.elements.hidePatterns.value = '  /sample/repo/issues/*  \n\n /sample/repo/pulls/* ';
  navigation.elements.toggleShortcut.value = ' shift + d ';
  navigation.elements.searchShortcut.value = ' shift + s ';
  await navigation.fire('submit');
  assert.equal(navigation.elements.hidePatterns.value, '/sample/repo/issues/*\n/sample/repo/pulls/*');
  assert.equal(navigation.elements.toggleShortcut.value, 'shift + d');
  assert.equal(navigation.elements.searchShortcut.value, 'shift + s');
  assert.match(ui.element('navigation-status').textContent, /Saved/);
});

test('an equal account/Sync snapshot preserves unsaved appearance fields and focus', async t => {
  const ui = await settings(t);
  const width = ui.element('appearance-form').elements.width;
  width.value = '399';
  width.focus();
  await ui.element('sync-form').fire('submit');
  assert.equal(width.value, '399');
  assert.equal(ui.document.activeElement, width);
  await ui.stored({...defaults});
  assert.equal(width.value, '399', 'an identical storage echo must not overwrite an unsaved edit');
});

test('unrelated storage areas are ignored and page disposal removes the storage listener', async t => {
  const ui = await settings(t);
  const width = ui.element('appearance-form').elements.width;
  await ui.stored({...defaults, width: 500}, 'sync');
  assert.equal(width.value, defaults.width);
  assert.equal(ui.listeners.size, 1);
  await ui.window.fire('pagehide');
  assert.equal(ui.listeners.size, 0);
  await ui.stored({...defaults, width: 600});
  assert.equal(width.value, defaults.width);
});

test('Sync errors survive the saving flag reset and leave controls available for retry', async t => {
  const ui = await settings(t);
  ui.failSync('Sync quota exceeded');
  await ui.element('sync-form').fire('submit');
  assert.equal(ui.element('sync-status').textContent, 'Sync quota exceeded');
  assert.equal(ui.element('sync-save').disabled, false);
  assert.equal(ui.element('sync-form').elements.enabled.disabled, false);
});

test('device cancellation and page disposal release OAuth polling timers', async t => {
  const ui = await settings(t);
  await ui.element('oauth-github').fire('click');
  assert.equal(ui.element('oauth-device').hidden, false);
  assert.equal(ui.element('oauth-code').textContent, 'TEST-CODE');
  assert.equal(ui.element('oauth-github').disabled, true);
  assert.equal(ui.timers.size, 1);
  await ui.element('oauth-cancel').fire('click');
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.element('oauth-device').hidden, true);
  assert.equal(ui.element('oauth-github').disabled, false);
  await ui.element('oauth-github').fire('click');
  await ui.window.fire('pagehide');
  assert.equal(ui.timers.size, 0);
});
