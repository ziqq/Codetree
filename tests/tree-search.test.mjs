/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Path-search regressions through the production tree model, including regex and literal search.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {flatten, makeTree} from '../src/shared/tree.js';

const paths = [
  'src/nested/main.dart',
  'src/Screen.SWIFT',
  'src/helper.js',
  'test/widget_test.dart',
  'docs/file[1].md',
  'docs/a b.md',
  'Документы/Файл.md',
];

for (const [query, expected] of [
  ['\\.(dart|swift)$', ['src/nested/main.dart', 'src/Screen.SWIFT', 'test/widget_test.dart']],
  ['^src/.*\\.dart$', ['src/nested/main.dart']],
  ['^docs/file\\[1\\]\\.md$', ['docs/file[1].md']],
  ['^документы/файл\\.md$', ['Документы/Файл.md']],
  ['^docs/a b\\.md$', ['docs/a b.md']],
  ['^', paths],
]) {
  test(`regex tree search matches full paths with ${query}`, () => {
    const tree = makeTree(paths.map(path => ({path, type: 'blob'})));
    const rows = flatten(tree, new Set(), query, false, true);
    assert.deepEqual(
      rows
        .filter(node => node.type !== 'tree')
        .map(node => node.path)
        .sort(),
      [...expected].sort(),
    );
  });
}

test('regex tree search retains ancestors without changing saved expansion or tree data', () => {
  const tree = makeTree(paths.map(path => ({path, type: 'blob'})));
  const expanded = new Set(['docs']);
  const rows = flatten(tree, expanded, '^src/nested/main\\.dart$', false, true);
  assert.deepEqual(
    rows.map(node => node.path),
    ['src', 'src/nested', 'src/nested/main.dart'],
  );
  assert.deepEqual([...expanded], ['docs']);
  assert.equal(tree.nodes.size, 13);
  assert.equal(tree.nodes.get('docs').children.length, 2);
});

test('regex tree search with an empty pattern respects collapsed folders', () => {
  const tree = makeTree(paths.map(path => ({path, type: 'blob'})));
  const rows = flatten(tree, new Set(['docs']), '', false, true);
  assert.deepEqual(
    rows.filter(node => node.type !== 'tree').map(node => node.path),
    ['docs/a b.md', 'docs/file[1].md'],
  );
  assert.deepEqual(
    rows.filter(node => node.type === 'tree').map(node => node.path),
    ['docs', 'src', 'test', 'Документы'],
  );
});

test('regex tree search combines unviewed marks with matching files under collapsed ancestors', () => {
  const tree = makeTree(paths.map(path => ({path, type: 'blob', viewed: path === 'src/Screen.SWIFT'})));
  const rows = flatten(tree, new Set(), '\\.(dart|swift)$', true, true);
  assert.deepEqual(
    rows.map(node => node.path),
    ['src', 'src/nested', 'src/nested/main.dart', 'test', 'test/widget_test.dart'],
  );
  assert.equal(tree.nodes.get('src/Screen.SWIFT').viewed, true);
});

test('regex tree search leaves literal metacharacters, case folding and whitespace trimming unchanged when off', () => {
  const tree = makeTree(paths.map(path => ({path, type: 'blob'})));
  const rows = flatten(tree, new Set(), ' FILE[1].MD ');
  assert.deepEqual(
    rows.map(node => node.path),
    ['docs', 'docs/file[1].md'],
  );
});
