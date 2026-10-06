/**
 * Full-file diff reconstruction: LF/CRLF handling, added/deleted files and
 * rejection of mismatched or truncated patches.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {fullDiff} from '../src/shared/diff.js';

for (const [name, sourceEnding, patchEnding] of [
  ['LF', '\n', '\n'],
  ['CRLF', '\r\n', '\r\n'],
  ['CRLF source / LF patch', '\r\n', '\n'],
]) {
  test(`full-file diff validates ${name} context, removals and additions`, () => {
    const before = ['unchanged', 'old', 'tail', ''].join(sourceEnding);
    const after = ['unchanged', 'new', 'tail', ''].join(sourceEnding);
    const patch = ['@@ -1,3 +1,3 @@', ' unchanged', '-old', '+new', ' tail'].join(patchEnding);
    const rows = fullDiff(before, after, patch);
    assert.deepEqual(
      Array.from(rows, row => [row.type, row.text, row.oldLine, row.newLine]),
      [
        ['context', 'unchanged', 1, 1],
        ['removed', 'old', 2, null],
        ['added', 'new', null, 2],
        ['context', 'tail', 3, 3],
      ],
    );
  });
}

test('CRLF normalization preserves patch mismatch and truncation rejection', () => {
  assert.throws(() => fullDiff('old\r\n', 'new\r\n', '@@ -1 +1 @@\r\n-wrong\r\n+new'), /does not match/);
  assert.throws(() => fullDiff('old\r\n', 'new\r\n', '@@ -1 +1 @@\r\n-old'), /incomplete patch/);
  assert.throws(() => fullDiff('old\r\n', 'new\r\n', ''), /complete text patch/);
});

test('full-file diff handles added/deleted files, final newline and literal carriage returns', () => {
  assert.equal(fullDiff('', 'new\r\n', '@@ -0,0 +1 @@\r\n+new')[0].type, 'added');
  assert.equal(fullDiff('old\r\n', '', '@@ -1 +0,0 @@\r\n-old')[0].type, 'removed');
  assert.equal(fullDiff('old', 'new', '@@ -1 +1 @@\r\n-old\r\n+new\r\n\\ No newline at end of file')[1].text, 'new');
  assert.equal(fullDiff('a\rb\n', 'a\rc\n', '@@ -1 +1 @@\n-a\rb\n+a\rc')[1].text, 'a\rc');
});
