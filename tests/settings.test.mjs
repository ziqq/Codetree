/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Settings preferences on a fake page: changes saved elsewhere reach the
 * form without discarding unsaved edits, a save sends only edited fields,
 * and saved fields show the stored values.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {document, Element} from './support/dom.mjs';
import {settle} from './support/sidebar.mjs';
import {preferences} from '../src/shared/preferences.js';

/** Fields of each Settings form; checkboxes are marked with `true`. */
const forms = {
  'appearance-form': {dock: false, iconTheme: false, width: false, fontSize: false, fontFamily: false, pinned: true},
  'navigation-form': {
    pageScope: false,
    hidePatterns: false,
    folderClick: true,
    toggleShortcut: false,
    searchShortcut: false,
  },
  'account-form': {provider: false, origin: false, label: false, token: false},
  'sync-form': {enabled: true},
};

const elements = new Map();
for (const [id, fields] of Object.entries(forms)) {
  const form = new Element('form');
  form.elements = {namedItem: name => (Object.hasOwn(fields, name) ? form.elements[name] : null)};
  for (const [name, checkbox] of Object.entries(fields))
    form.elements[name] = Object.assign(new Element('input'), {type: checkbox ? 'checkbox' : 'text'});
  form.requestSubmit = () => form.emit('submit');
  elements.set(id, form);
}
document.getElementById = id => {
  if (!elements.has(id)) elements.set(id, new Element('div'));
  return elements.get(id);
};

let stored = preferences({});
const messages = [];
const storageListeners = [];
globalThis.chrome = {
  runtime: {
    async sendMessage(message) {
      messages.push(message);
      if (message.type === 'STATE')
        return {ok: true, value: {preferences: stored, accounts: [], sync: {enabled: false}}};
      if (message.type === 'OAUTH_INFO') return {ok: true, value: {}};
      if (message.type === 'PREFERENCES') {
        stored = preferences({...stored, ...message.value});
        return {ok: true, value: stored};
      }
      return {ok: true, value: true};
    },
  },
  storage: {onChanged: {addListener: listener => storageListeners.push(listener)}},
  permissions: {request: async () => true},
};

await import('../src/options/index.js');
await settle();

const appearance = elements.get('appearance-form').elements;
const navigation = elements.get('navigation-form').elements;

/** Saves [values] to the stored preferences as the sidebar or Sync would. */
function changeElsewhere(values) {
  stored = preferences({...stored, ...values});
  for (const listener of storageListeners) listener({preferences: {newValue: stored}}, 'local');
}

test('saving Appearance keeps the dock changed in the sidebar and the unsaved edits of other fields', async () => {
  assert.equal(appearance.dock.value, 'left');
  appearance.fontSize.value = '15';
  changeElsewhere({dock: 'right'});
  await settle();
  assert.equal(appearance.dock.value, 'right');
  assert.equal(appearance.fontSize.value, '15');
  messages.length = 0;
  elements.get('appearance-form').requestSubmit();
  await settle();
  assert.deepEqual(messages.find(message => message.type === 'PREFERENCES').value, {fontSize: 15});
  assert.equal(stored.dock, 'right');
  assert.equal(stored.fontSize, 15);
});

test('saving Navigation shows the stored hide patterns', async () => {
  navigation.hidePatterns.value = '  /foo  \n\n  bar\n';
  elements.get('navigation-form').requestSubmit();
  await settle();
  assert.equal(stored.hidePatterns, '/foo\nbar');
  assert.equal(navigation.hidePatterns.value, '/foo\nbar');
});
