/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/**
 * Viewed marks through the bundled service worker (`build/background.js`) with
 * mocked GitHub/GitLab APIs: a mark is written only for the head revision that
 * fresh request metadata still reports, and only for files in the request.
 */
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {buildExtension} from '../scripts/build.mjs';

// Run the shipped service-worker bundle, built exactly as the extension package builds it.
const built = mkdtempSync(join(tmpdir(), 'codetree-viewed-'));
await buildExtension(built);
const worker = readFileSync(join(built, 'background.js'), 'utf8');
rmSync(built, {recursive: true, force: true});

const headA = 'a'.repeat(40);
const headB = 'b'.repeat(40);
const base = 'c'.repeat(40);
const file = 'src/file.js';

function broker(provider, native = false) {
  const origin = `https://${provider}.com`;
  const context = {origin, provider, owner: 'sample', repo: 'repo', kind: 'pull', number: 42};
  const store = native ? {accounts: [{id: 'test', origin, login: 'developer', token: 'synthetic-test'}]} : {};
  let head = headA;
  let now = Date.now();
  let mutations = 0;
  let metadataReads = 0;
  let listener;
  const event = {addListener() {}};
  const chrome = {
    storage: {
      local: {
        async setAccessLevel() {},
        async get() {
          return structuredClone(store);
        },
        async set(value) {
          Object.assign(store, value);
        },
      },
    },
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      onMessage: {
        addListener(value) {
          listener = value;
        },
      },
      onInstalled: event,
      onStartup: event,
    },
    permissions: {onRemoved: event},
    action: {onClicked: event},
  };
  const fetch = async (input, options) => {
    const path = new URL(input).pathname;
    let data;
    if (path.endsWith('/graphql')) {
      const {query} = JSON.parse(options.body);
      if (query.startsWith('mutation')) {
        mutations++;
        data = {data: {markFileAsViewed: {clientMutationId: null}}};
      } else data = {data: {repository: {pullRequest: {files: {nodes: [], pageInfo: {hasNextPage: false}}}}}};
    } else if (path.endsWith('/pulls/42')) {
      metadataReads++;
      const repo = {owner: {login: 'sample'}, name: 'repo'};
      data = {head: {sha: head, repo}, base: {sha: base, repo}, changed_files: 1, node_id: 'PR_test', title: 'Test'};
    } else if (path.endsWith('/merge_requests/42')) {
      metadataReads++;
      data = {
        diff_refs: {head_sha: head, base_sha: base},
        source_project_id: 1,
        target_project_id: 1,
        changes_count: '1',
        title: 'Test',
      };
    } else if (path.endsWith('/files')) data = [{filename: file, status: 'modified'}];
    else if (path.endsWith('/diffs')) data = [{new_path: file, old_path: file, diff: ''}];
    else if (path.endsWith('/comments') || path.endsWith('/discussions')) data = [];
    else if (path.includes('/compare/')) data = {merge_base_commit: {sha: base}};
    else throw new Error(`Unexpected API request: ${path}`);
    return new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}});
  };
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const sandbox = vm.createContext({
    chrome,
    fetch,
    URL,
    AbortSignal,
    TextDecoder,
    Uint8Array,
    crypto: webcrypto,
    Date: Clock,
  });
  vm.runInContext(worker, sandbox);
  const send = (type, values = {}) =>
    new Promise(resolve =>
      listener({type, context, ...values}, {url: `${origin}/sample/repo/pull/42`, tab: {id: 1}}, resolve),
    );
  return {
    send,
    store,
    advance() {
      head = headB;
    },
    expire() {
      now += 20000;
    },
    get mutations() {
      return mutations;
    },
    get metadataReads() {
      return metadataReads;
    },
  };
}

for (const [provider, native] of [
  ['github', false],
  ['github', true],
  ['gitlab', false],
]) {
  const name = `${provider} ${native ? 'synchronized' : 'local'} Viewed`;
  for (const expired of [false, true]) {
    test(`${name} rejects an advanced head with ${expired ? 'expired' : 'cached'} metadata`, async () => {
      const api = broker(provider, native);
      assert.equal((await api.send('DIFF')).ok, true);
      const reads = api.metadataReads;
      api.advance();
      if (expired) api.expire();
      const result = await api.send('VIEWED', {path: file, headSha: headA, viewed: true});
      assert.equal(result.ok, false);
      assert.match(result.error, /changed.*Refresh/);
      assert.equal(api.mutations, 0);
      assert.equal(api.store.localViewed, undefined);
      assert.ok(api.metadataReads > reads, 'cached metadata must not bypass a fresh head check');
    });
  }
  test(`${name} accepts matching revisions and supports unmarking`, async () => {
    const api = broker(provider, native);
    const marked = await api.send('VIEWED', {path: file, headSha: headA, viewed: true});
    assert.equal(marked.ok, true);
    assert.equal(marked.value.state, 'VIEWED');
    const unmarked = await api.send('VIEWED', {path: file, headSha: headA, viewed: false});
    assert.equal(unmarked.ok, true);
    assert.equal(unmarked.value.state, 'UNVIEWED');
    if (native) assert.equal(api.mutations, 2);
    else {
      const [key] = Object.keys(api.store.localViewed);
      assert.ok(key.endsWith(`:${headA}`));
      assert.equal(api.store.localViewed[key][file], 'UNVIEWED');
    }
  });
  test(`${name} rejects missing revisions and paths outside the request`, async () => {
    const api = broker(provider, native);
    assert.equal((await api.send('VIEWED', {path: file, viewed: true})).ok, false);
    assert.equal((await api.send('VIEWED', {path: 'unrelated.js', headSha: headA, viewed: true})).ok, false);
    assert.equal(api.mutations, 0);
    assert.equal(api.store.localViewed, undefined);
  });
}
