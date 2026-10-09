/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Validation of identifiers interpolated into API paths.
 */

import {pathURL} from '../shared/routes.js';

/**
 * Accepts a positive safe integer request number.
 *
 * @param {*} value
 * @returns {number}
 */
export function number(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid pull request number.');
  return value;
}

/**
 * Accepts an abbreviated or full hexadecimal commit or tree SHA.
 *
 * @param {*} value
 * @returns {string}
 */
export function sha(value) {
  if (!/^[a-f\d]{7,40}$/i.test(value || '')) throw new Error('Invalid commit or tree SHA.');
  return value;
}

/**
 * Accepts a repository path without empty, `.` or `..` segments.
 *
 * @param {*} value
 * @returns {string} The percent-encoded path.
 */
export function filePath(value) {
  if (typeof value !== 'string' || !value || value.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('Invalid file path.');
  return pathURL(value);
}
