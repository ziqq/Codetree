/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Bounded response readers shared by the API client and OAuth flows.
 *
 * Bodies are streamed with a byte limit, so an oversized response fails
 * before it is fully buffered.
 */

/**
 * Reads a response body up to [limit] bytes.
 *
 * @param {Response} response A fetch response.
 * @param {number} limit Maximum body size in bytes.
 * @param {string} message Error message used when the limit is exceeded.
 * @returns {Promise<Uint8Array>}
 * @throws {Error} With [message] when the body is too large.
 */
export async function responseBytes(response, limit, message) {
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error(message);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw new Error(message);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Reads and parses a strict UTF-8 JSON body up to [limit] bytes.
 *
 * @param {Response} response A fetch response.
 * @param {number} [limit=32 MiB] Maximum body size in bytes.
 * @returns {Promise<*>}
 */
export async function responseJSON(response, limit = 32 * 1024 * 1024) {
  const bytes = await responseBytes(
    response,
    limit,
    'The API response exceeds the safe preview limit. Use the repository website.',
  );
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}

/**
 * Creates a checker for paginated list responses.
 *
 * Pages must be arrays of at most 100 items, with at most 10,000 items and
 * 32 MiB in total, so an unexpected server response cannot exhaust memory.
 *
 * @returns {function(Array): void} Throws when a page exceeds the budget.
 */
export function listBudget() {
  let count = 0;
  let size = 0;
  return values => {
    if (!Array.isArray(values)) throw new Error('The API returned an unexpected list response.');
    count += values.length;
    size += JSON.stringify(values).length * 2;
    if (values.length > 100 || count > 10000)
      throw new Error('The API returned more list results than requested. Use the repository website.');
    if (size > 32 * 1024 * 1024)
      throw new Error('This list exceeds the safe preview limit. Use the repository website.');
  };
}
