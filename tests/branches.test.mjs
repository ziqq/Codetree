/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Branch navigation through production menu buttons and broker-like resolved file metadata.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {createBranches} from '../src/content/sidebar/branches.js';
import {dom, install} from './helpers/dom.mjs';

/** Creates a real branch menu with observable navigation and deliberately different selected/file paths. */
function branchMenu(t, provider, kind = 'blob') {
  const {document} = dom();
  const origin = provider === 'github' ? 'https://github.example.com' : 'https://gitlab.example.com';
  const owner = provider === 'github' ? 'sample' : 'team/nested';
  const root = `${origin}/${owner}/repo`;
  const prefix = `${root}${provider === 'gitlab' ? '/-' : ''}`;
  const assigned = [];
  const location = new URL(root);
  location.assign = url => assigned.push(url);
  install(t, {document, location});
  const requests = [];
  const app = {
    state: {
      context: {origin, provider, owner, repo: 'repo', kind, tail: 'release/2026/10/src/a b#?%.js'},
      info: {ref: 'release/2026/10', path: 'src/a b#?%.js', repository: {default_branch: 'main'}},
      selected: 'different/selected.js',
      branches: [{name: 'feature/review'}],
    },
    view: {
      branchButton: document.createElement('button'),
      branchSearch: document.createElement('input'),
      branchList: document.createElement('div'),
      branchPopover: {hidden: true},
    },
    rpc(type) {
      requests.push(type);
      throw new Error('Branch selection must not request file existence or contents.');
    },
  };
  Object.assign(app, createBranches(app));
  app.renderBranches();
  return {app, assigned, requests, prefix};
}

for (const provider of ['github', 'gitlab']) {
  for (const kind of ['blob', 'blame', 'raw']) {
    test(`${provider} ${kind} branch selection preserves the resolved file with slash-containing refs`, async t => {
      const {app, assigned, requests, prefix} = branchMenu(t, provider, kind);
      const button = app.view.branchList.querySelector('button');
      assert.equal(button.textContent, 'feature/review');
      await button.fire('click');
      assert.deepEqual(assigned, [`${prefix}/blob/feature%2Freview/src/a%20b%23%3F%25.js`]);
      assert.equal(new URL(assigned[0]).hash, '', 'a hash in the filename is not a line anchor');
      assert.equal(new URL(assigned[0]).search, '', 'a question mark in the filename is not a query');
      assert.deepEqual(requests, [], 'selection delegates missing-file handling to the provider page');
    });
  }

  test(`${provider} non-file pages keep branch-root navigation instead of a selected review file`, async t => {
    const {app, assigned, requests, prefix} = branchMenu(t, provider);
    const button = app.view.branchList.querySelector('button');
    for (const kind of ['repo', 'tree', 'pull', 'commit']) {
      app.state.context = {...app.state.context, kind};
      await button.fire('click');
      assert.equal(assigned.at(-1), `${prefix}/tree/feature%2Freview`, kind);
    }
    assert.equal(assigned.length, 4);
    assert.deepEqual(requests, []);
  });

  test(`${provider} file pages with unresolved metadata fall back to the branch root`, async t => {
    const {app, assigned, requests, prefix} = branchMenu(t, provider);
    const button = app.view.branchList.querySelector('button');
    const info = app.state.info;
    for (const value of [{...info, path: ''}, {...info, path: undefined}, null]) {
      app.state.info = value;
      await button.fire('click');
      assert.equal(assigned.at(-1), `${prefix}/tree/feature%2Freview`);
    }
    assert.equal(assigned.length, 3);
    assert.deepEqual(requests, []);
  });

  test(`${provider} branch selection encodes Unicode file and branch names once`, async t => {
    const {app, assigned, requests, prefix} = branchMenu(t, provider);
    app.state.info.path = 'docs/файл.js';
    app.state.branches = [{name: 'fix/путь'}];
    app.renderBranches();
    await app.view.branchList.querySelector('button').fire('click');
    assert.deepEqual(assigned, [`${prefix}/blob/fix%2F%D0%BF%D1%83%D1%82%D1%8C/docs/%D1%84%D0%B0%D0%B9%D0%BB.js`]);
    assert.deepEqual(requests, []);
  });
}
