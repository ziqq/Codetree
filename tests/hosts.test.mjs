/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/**
 * Request-context validation for repository pages: contexts built like the
 * content script's must pass, and branch or path segments that could reach
 * API paths must not.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {validateContext} from '../src/background/hosts.js';
import {route} from '../src/shared/routes.js';

/** Builds a context the way `content/page.js` `currentContext` does: without a branch hint it sends `''`. */
const pageContext = (url, provider, refHint = '') => ({...route(url, provider), viewer: '', refHint});

test('page contexts without a branch hint are accepted', () => {
  for (const [url, provider] of [
    ['https://github.com/octocat/Hello-World', 'github'],
    ['https://github.com/octocat/Hello-World/tree/main/src', 'github'],
    ['https://github.com/octocat/Hello-World/pull/1/files', 'github'],
    ['https://gitlab.com/gitlab-org/cli', 'gitlab'],
    ['https://gitlab.com/gitlab-org/cli/-/merge_requests/1/diffs', 'gitlab'],
  ]) {
    const context = pageContext(url, provider);
    assert.equal(context.refHint, '');
    assert.equal(validateContext(context, {}).origin, new URL(url).origin, url);
  }
  assert.equal(validateContext({...pageContext('https://github.com/o/r', 'github'), refHint: undefined}, {}).repo, 'r');
});

test('branch hints with slashes are accepted', () => {
  const context = pageContext('https://github.com/o/r/tree/feature/x/src', 'github', 'feature/x');
  assert.equal(validateContext(context, {}).refHint, 'feature/x');
});

test('empty, dot and dot-dot segments in tails and branch hints are rejected', () => {
  const base = pageContext('https://github.com/o/r', 'github');
  for (const [tail, refHint] of [
    ['../x', ''],
    ['main/../x', ''],
    ['main//a', ''],
    ['./a', ''],
    ['a', '..'],
    ['a', '/'],
    ['a', 'feature//x'],
  ])
    assert.throws(() => validateContext({...base, tail, refHint}, {}), undefined, JSON.stringify([tail, refHint]));
  // An encoded slash is decoded by the page, so `..%2Fx` arrives as a `..` segment.
  const encoded = pageContext('https://github.com/o/r/tree/..%2Fx', 'github');
  assert.throws(() => validateContext(encoded, {}));
});
