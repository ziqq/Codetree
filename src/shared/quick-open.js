/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Literal path/line parsing and deterministic fuzzy ranking for Quick Open.
 */

/**
 * Separates an optional trailing source line from a filename query.
 * A colon followed by ordinary filename text stays literal.
 *
 * @param {string} value The palette input.
 * @returns {{query: string, line?: number, error?: string}} Parsed path query or actionable validation feedback.
 */
export function parseQuickOpenQuery(value) {
  const query = String(value).trim();
  const separator = query.lastIndexOf(':');
  if (separator < 0) return {query};
  const suffix = query.slice(separator + 1).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(suffix)) return {query};
  const path = query.slice(0, separator).trim();
  if (!path) return {query: '', error: 'To go to a line in the open file, use Ctrl/Cmd+G.'};
  const line = Number(suffix);
  if (!/^[1-9]\d*$/.test(suffix) || !Number.isSafeInteger(line) || line > 100000)
    return {query: path, error: 'Enter a source line from 1 to 100000 after the colon.'};
  return {query: path, line};
}

/** Measures an ordered subsequence by gaps and initial offset without building match metadata. */
function subsequence(text, query) {
  let cursor = 0;
  let first = -1;
  for (const character of query) {
    const index = text.indexOf(character, cursor);
    if (index < 0) return null;
    if (first < 0) first = index;
    cursor = index + character.length;
  }
  return [Math.max(0, cursor - first - query.length), Math.max(0, first)];
}

/**
 * Ranks exact names and contiguous prefixes ahead of sparse filename/path matches.
 * Rank tuples keep categories separate even for unusually long repository paths.
 *
 * @param {string} path A complete repository-relative file path.
 * @param {string} query The literal filename/path query without its line suffix.
 * @returns {?Array<number>} A lower-is-better rank, or null when no subsequence matches.
 */
export function quickOpenScore(path, query) {
  const text = path.toLowerCase();
  const needle = query.toLowerCase();
  if (needle.length > text.length) return null;
  const name = text.slice(text.lastIndexOf('/') + 1);
  if (text === needle) return [0, text.length];
  if (name === needle) return [1, text.length];
  if (name.startsWith(needle)) return [2, name.length, text.length];
  if (text.startsWith(needle)) return [3, text.length];
  const nameIndex = name.indexOf(needle);
  if (nameIndex >= 0) return [4, nameIndex, name.length, text.length];
  const pathIndex = text.indexOf(needle);
  if (pathIndex >= 0) return [5, pathIndex, text.length];
  const nameMatch = subsequence(name, needle);
  if (nameMatch) return [6, ...nameMatch, name.length, text.length];
  const pathMatch = subsequence(text, needle);
  return pathMatch ? [7, ...pathMatch, text.length] : null;
}

/**
 * Orders scored paths deterministically, independent of browser locale or provider order.
 *
 * @param {{path: string, score: Array<number>}} left One scored file.
 * @param {{path: string, score: Array<number>}} right Another scored file.
 * @returns {number} The usual sorting comparison result.
 */
export function compareQuickOpenMatches(left, right) {
  for (let index = 0; index < Math.max(left.score.length, right.score.length); index++) {
    const difference = (left.score[index] || 0) - (right.score[index] || 0);
    if (difference) return difference;
  }
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}
