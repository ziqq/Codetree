/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Exact-source permalink and GitLab fork namespace regressions.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {install} from './helpers/dom.mjs';

const path = new URL('../src/shared/line-links.js', import.meta.url);
const implementation = existsSync(path) ? await import(path) : {};
const sha = 'a'.repeat(40);
const github = {origin: 'https://github.example.com', provider: 'github', owner: 'page', repo: 'target'};
const gitlab = {origin: 'https://gitlab.example.com', provider: 'gitlab', owner: 'page', repo: 'target'};

/** Fails explicitly on the old capability, rather than failing module resolution on the baseline. */
function links() {
  assert.equal(typeof implementation.linePermalink, 'function', 'Exact-revision source-line permalinks are available.');
  return implementation.linePermalink;
}

test('GitHub line permalinks use the exact fork/revision and encoded source path on a custom host', () => {
  const link = links();
  const source = {owner: 'fork-owner', repo: 'fork.repo', sha};
  assert.equal(
    link(github, source, 'src/old #?.js', 3),
    `https://github.example.com/fork-owner/fork.repo/blob/${sha}/src/old%20%23%3F.js#L3`,
  );
  assert.equal(
    link(github, source, 'src/é.js', 3, 8),
    `https://github.example.com/fork-owner/fork.repo/blob/${sha}/src/%C3%A9.js#L3-L8`,
  );
});

test('GitHub Markdown permalinks request plain source before applying line anchors', () => {
  const link = links();
  assert.equal(
    link(github, {owner: 'o', repo: 'r', sha}, 'docs/Read me.MD', 12, 14),
    `https://github.example.com/o/r/blob/${sha}/docs/Read%20me.MD?plain=1#L12-L14`,
  );
  assert.equal(
    link(github, {owner: 'o', repo: 'r', sha}, 'source.js', 12),
    `https://github.example.com/o/r/blob/${sha}/source.js#L12`,
  );
});

test('GitLab line permalinks use authoritative fork namespaces and its native range syntax', () => {
  const link = links();
  assert.equal(
    link(gitlab, {project: 42, projectPath: 'fork/team/source', sha}, 'src/a b.js', 2, 7),
    `https://gitlab.example.com/fork/team/source/-/blob/${sha}/src/a%20b.js#L2-7`,
  );
  assert.equal(
    link(gitlab, {project: 'team/nested/repo', sha}, 'file.js', 1),
    `https://gitlab.example.com/team/nested/repo/-/blob/${sha}/file.js#L1`,
  );
  assert.equal(
    link(gitlab, {project: 42, sha}, 'file.js', 1),
    null,
    'Numeric IDs cannot silently fall back to the page repository.',
  );
  assert.equal(link(gitlab, {project: 42, projectPath: '../wrong', sha}, 'file.js', 1), null);
});

test('line permalinks reject moving or ambiguous sources, malformed paths, ranges and host URLs', () => {
  const link = links();
  const source = {owner: 'fork', repo: 'source', sha};
  for (const value of ['main', 'feature/branch', sha.slice(0, 7), '', null])
    assert.equal(link(github, {...source, sha: value}, 'file.js', 1), null);
  for (const value of ['', '../file.js', 'src/./file.js', '/file.js', 'src//file.js', 'file\0.js', 'file\n.js'])
    assert.equal(link(github, source, value, 1), null);
  for (const [start, end] of [
    [0, 1],
    [-1, 1],
    [3, 2],
    [1.5, 2],
    [1, Infinity],
    [1, Number.MAX_SAFE_INTEGER + 1],
  ])
    assert.equal(link(github, source, 'file.js', start, end), null);
  for (const origin of [
    'http://github.example.com',
    'https://user@github.example.com',
    'https://github.example.com/path',
    'https://github.example.com?query=1',
  ])
    assert.equal(link({...github, origin}, source, 'file.js', 1), null);
  assert.equal(link(github, {sha}, 'file.js', 1), null, 'A missing source repository is not inferred from the page.');
});

/** Runs the real GitLab adapter with exact MR refs and bounded host-client replies. */
async function gitlabDiff(t, {fork = false, project, failure = false} = {}) {
  const {handle} = await import('../src/background/providers/gitlab.js');
  const context = {...gitlab, owner: 'target/nested', repo: 'repo', kind: 'pull', number: 7};
  const request = {
    source_project_id: fork ? 20 : 10,
    target_project_id: 10,
    diff_refs: {base_sha: sha, head_sha: 'b'.repeat(40)},
  };
  const calls = [];
  const api = {
    prefix: `selection-${t.name}`,
    pages: async () => [],
    async json(url) {
      calls.push(url);
      if (url.endsWith('/merge_requests/7')) return request;
      assert.equal(url, '/projects/20');
      if (failure) throw new Error('Unavailable fork');
      return project;
    },
    async request(url) {
      calls.push(url);
      return {data: 'source content'};
    },
  };
  const result = await handle({type: 'DIFF', fresh: true}, context, api, {});
  return {result, calls, context, api, handle};
}

test('GitLab same-project MR namespaces require no extra API lookup and preserve numeric FILE requests', async t => {
  install(t, {chrome: {storage: {local: {setAccessLevel: async () => {}}}}});
  const {result, calls, context, api, handle} = await gitlabDiff(t);
  assert.equal(result.base.projectPath, 'target/nested/repo', 'Base revisions expose their exact project namespace.');
  assert.equal(result.head.projectPath, 'target/nested/repo');
  assert.equal(
    calls.some(url => url === '/projects/20'),
    false,
  );
  const text = await handle({type: 'FILE', source: result.head, path: 'src/a b.js'}, context, api, {});
  assert.equal(text, 'source content');
  assert.ok(calls.includes(`/projects/10/repository/files/src%2Fa%20b.js/raw?ref=${'b'.repeat(40)}`));
});

test('GitLab fork MR links use resolved source metadata and unavailable metadata cannot break its diff', async t => {
  install(t, {chrome: {storage: {local: {setAccessLevel: async () => {}}}}});
  const link = links();
  const resolved = await gitlabDiff(t, {fork: true, project: {id: 20, path_with_namespace: 'fork/nested/source'}});
  assert.equal(resolved.result.head.projectPath, 'fork/nested/source');
  assert.equal(
    link(gitlab, resolved.result.head, 'file.js', 9),
    `https://gitlab.example.com/fork/nested/source/-/blob/${'b'.repeat(40)}/file.js#L9`,
  );
  // Force a fresh adapter result so the failed lookup cannot reuse the resolved snapshot.
  const failed = await gitlabDiff(t, {fork: true, failure: true});
  assert.equal(failed.result.head.projectPath, null);
  assert.equal(failed.result.base.projectPath, 'target/nested/repo');
  assert.deepEqual(failed.result.files, []);
  assert.equal(link(gitlab, failed.result.head, 'file.js', 9), null);
});
