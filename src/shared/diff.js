/**
 * Reconstructs a full-file diff from two file revisions and their patch.
 *
 * Every patch line is checked against both revisions, so a truncated,
 * mismatched or reordered patch is rejected instead of being shown as a
 * complete diff.
 *
 * @module shared/diff
 */

/**
 * Splits text into lines, treating CRLF as LF and ignoring the final newline.
 *
 * @param {string} text File contents.
 * @returns {Array<string>}
 */
export function lines(text) {
  if (!text) return [];
  const result = text.replace(/\r\n/g, '\n').split('\n');
  if (result.at(-1) === '') result.pop();
  return result;
}

/**
 * Merges the unchanged context of [base] and [head] with the hunks of [patch].
 *
 * Without a patch the files must be identical, added or deleted;
 * otherwise the provider omitted the patch and the diff is unavailable.
 *
 * @param {string} base The old revision text (empty for added files).
 * @param {string} head The new revision text (empty for deleted files).
 * @param {string} patch The unified diff hunks returned by the provider.
 * @returns {Array<{type: 'context'|'added'|'removed', text: string, oldLine: ?number, newLine: ?number}>}
 * @throws {Error} If the patch does not exactly describe the two revisions.
 */
export function fullDiff(base, head, patch) {
  const before = lines(base);
  const after = lines(head);
  const rows = [];
  let oldIndex = 0;
  let newIndex = 0;
  const push = (type, text) => {
    if (
      typeof text !== 'string' ||
      (type !== 'added' && oldIndex >= before.length) ||
      (type !== 'removed' && newIndex >= after.length) ||
      rows.length >= before.length + after.length
    ) {
      throw new Error('The patch exceeds these file revisions.');
    }
    const oldLine = type === 'added' ? null : ++oldIndex;
    const newLine = type === 'removed' ? null : ++newIndex;
    if ((oldLine && before[oldLine - 1] !== text) || (newLine && after[newLine - 1] !== text))
      throw new Error('The patch does not match these file revisions.');
    rows.push({type, text, oldLine, newLine});
  };
  if (!patch) {
    if (base === head) {
      for (const text of before) push('context', text);
      return rows;
    }
    if (!before.length) {
      for (const text of after) push('added', text);
      return rows;
    }
    if (!after.length) {
      for (const text of before) push('removed', text);
      return rows;
    }
    throw new Error('The server did not return a complete text patch. Use the original diff.');
  }
  let hunk = null;
  const finish = () => {
    if (hunk && (hunk.old !== hunk.expectedOld || hunk.new !== hunk.expectedNew))
      throw new Error('The server returned an incomplete patch.');
  };
  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match) {
      finish();
      const oldStart = Number(match[1]);
      const newStart = Number(match[3]);
      const expectedOld = Number(match[2] ?? 1);
      const expectedNew = Number(match[4] ?? 1);
      const startOld = oldStart - (expectedOld ? 1 : 0);
      const startNew = newStart - (expectedNew ? 1 : 0);
      if (
        ![oldStart, newStart, expectedOld, expectedNew].every(Number.isSafeInteger) ||
        startOld < 0 ||
        startNew < 0 ||
        startOld > before.length ||
        startNew > after.length ||
        expectedOld > before.length - startOld ||
        expectedNew > after.length - startNew
      ) {
        throw new Error('The patch range exceeds these file revisions.');
      }
      if (startOld < oldIndex || startNew < newIndex) throw new Error('Invalid patch ordering.');
      while (oldIndex < startOld) push('context', before[oldIndex]);
      if (newIndex !== startNew) throw new Error('The patch positions do not match these revisions.');
      hunk = {old: 0, new: 0, expectedOld, expectedNew};
    } else if (hunk && !line.startsWith('\\')) {
      if (line.startsWith(' ')) {
        push('context', line.slice(1));
        hunk.old++;
        hunk.new++;
      } else if (line.startsWith('-')) {
        push('removed', line.slice(1));
        hunk.old++;
      } else if (line.startsWith('+')) {
        push('added', line.slice(1));
        hunk.new++;
      } else if (line !== '') throw new Error('Invalid text patch.');
    }
  }
  finish();
  while (oldIndex < before.length) push('context', before[oldIndex]);
  if (newIndex !== after.length) throw new Error('The server returned a truncated patch.');
  return rows;
}
