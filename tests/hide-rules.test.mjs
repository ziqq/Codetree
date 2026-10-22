/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * URL hide-rule regressions through shared preference validation and page visibility.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {defaults, pageVisible, preferences, validateNavigation} from '../src/shared/preferences.js';
import {route} from '../src/shared/routes.js';

/** Resolves a real provider route and checks visibility with stored preferences. */
function visible(url, hidePatterns, provider = 'github', pageScope = 'repository') {
  return pageVisible(url, route(url, provider), preferences({hidePatterns, pageScope}));
}

for (const [provider, url, rule] of [
  ['github', 'https://github.com/sample/repo/issues/42', 'regex:/(issues|discussions)(/|\\?|$)'],
  ['gitlab', 'https://gitlab.com/team/nested/repo/-/merge_requests/42/diffs', 'regex:/-/merge_requests/\\d+/diffs$'],
  ['github', 'https://git.example.com/sample/repo/pull/42/files', 'regex:^https://git\\.example\\.com/.*/pull/\\d+/'],
  ['gitlab', 'https://code.example.com/team/nested/repo/-/issues/42', 'regex:/(issues|discussions)(/|\\?|$)'],
]) {
  test(`regex hide rules match ${provider} pages on ${new URL(url).hostname}`, () => {
    assert.equal(visible(url, rule, provider), false);
    assert.equal(visible(url, '', provider), true);
  });
}

test('regex hide rules support partial matches, anchors and case-sensitive repository paths', () => {
  const url = 'https://github.com/sample/repo/tree/main/Sources';
  assert.equal(visible(url, 'regex:Sources$'), false);
  assert.equal(visible(url, 'regex:sources$'), true);
  assert.equal(visible(url, 'regex:^Sources$'), true);
  assert.equal(visible(url, 'regex:tree/(main|develop)/Sources$'), false);
});

test('regex hide rules include query parameters but exclude URL fragments', () => {
  const root = 'https://github.com/sample/repo';
  assert.equal(visible(`${root}?tab=readme&hide=1#top`, 'regex:[?&]hide=1(&|$)'), false);
  assert.equal(visible(`${root}#hide=1`, 'regex:hide=1'), true);
  assert.equal(visible(`${root}#readme`, 'regex:/sample/repo$'), false);
  assert.equal(visible(`${root}?tab=readme`, 'regex:/sample/repo$'), true);
});

test('mixed wildcard and regex rules preserve literal wildcard metacharacters and any-match behavior', () => {
  const rules = 'https://github.com/*/*/blob/main/a[1]+.js\nregex:/(issues|discussions)(/|\\?|$)';
  assert.equal(visible('https://github.com/sample/repo/blob/main/a[1]+.js', rules), false);
  assert.equal(visible('https://github.com/sample/repo/blob/main/a1.js', rules), true);
  assert.equal(visible('https://github.com/sample/repo/discussions/3', rules), false);
  assert.equal(visible('https://github.com/sample/repo/tree/main', rules), true);
  assert.equal(visible('https://github.com/sample/repo/wiki/Home', 'https://github.com/*/*/wiki*'), false);
});

test('normalized stored rules retain regex escapes and remain stable across repeated navigation', () => {
  const value = preferences({hidePatterns: '  regex:/issues/\\d+$  \n\n https://github.com/*/*/wiki* '});
  assert.equal(value.hidePatterns, 'regex:/issues/\\d+$\nhttps://github.com/*/*/wiki*');
  const restored = preferences(JSON.parse(JSON.stringify(value)));
  validateNavigation(restored);
  for (let index = 0; index < 3; index++) {
    assert.equal(visible('https://github.com/sample/repo/issues/42', restored.hidePatterns), false);
    assert.equal(visible('https://github.com/sample/repo/issues/new', restored.hidePatterns), true);
  }
});

for (const source of ['', '[', '(', '\\', 'a{2,1}']) {
  test(`invalid regex ${JSON.stringify(source)} identifies its original line before saving`, () => {
    assert.throws(
      () => validateNavigation({...defaults, hidePatterns: `https://github.com/*/*/wiki*\n\n  regex:${source}  `}),
      /Invalid regular expression on URL pattern line 3/,
    );
  });
}

test('malformed stored regex rules do not break navigation or prevent later valid rules from hiding pages', () => {
  const rules = 'regex:[\nregex:\nregex:/issues/\\d+$\nhttps://github.com/*/*/wiki*';
  assert.equal(visible('https://github.com/sample/repo/tree/main', rules), true);
  assert.equal(visible('https://github.com/sample/repo/issues/42', rules), false);
  assert.equal(visible('https://github.com/sample/repo/wiki/Home', rules), false);
});

test('regex rules retain the shared count and text-size limits', () => {
  const rules = [...Array(63).fill('https://github.com/*/*/wiki*'), 'regex:/issues/\\d+$'].join('\n');
  assert.doesNotThrow(() => validateNavigation({...defaults, hidePatterns: rules}));
  assert.throws(
    () => validateNavigation({...defaults, hidePatterns: rules + '\nregex:/discussions/'}),
    /64 URL patterns/,
  );
  assert.doesNotThrow(() => validateNavigation({...defaults, hidePatterns: 'x'.repeat(16384)}));
  assert.throws(() => validateNavigation({...defaults, hidePatterns: 'x'.repeat(16385)}), /16,384 characters/);
});

test('hide rules still compose with code-only scope and unsupported pages stay hidden', () => {
  const root = 'https://github.com/sample/repo';
  assert.equal(visible(root, 'regex:/issues', 'github', 'code'), true);
  assert.equal(visible(`${root}/issues`, 'regex:never', 'github', 'code'), false);
  assert.equal(visible(`${root}/pull/42/files`, 'regex:/pull/42/', 'github', 'code'), false);
  assert.equal(visible(`${root}/pull/43/files`, 'regex:/pull/42/', 'github', 'code'), true);
  assert.equal(visible('https://github.com/settings/profile', 'regex:never'), false);
});
