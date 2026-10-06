/* Bounded response readers shared by the API client and OAuth flows. */

export async function responseBytes(response, limit, message) {
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error(message);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => {}); throw new Error(message); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function responseJSON(response, limit = 32 * 1024 * 1024) {
  const bytes = await responseBytes(response, limit, 'The API response exceeds the safe preview limit. Use the repository website.');
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}
export function listBudget() {
  let count = 0; let size = 0;
  return values => {
    if (!Array.isArray(values)) throw new Error('The API returned an unexpected list response.');
    count += values.length; size += JSON.stringify(values).length * 2;
    if (values.length > 100 || count > 10000) throw new Error('The API returned more list results than requested. Use the repository website.');
    if (size > 32 * 1024 * 1024) throw new Error('This list exceeds the safe preview limit. Use the repository website.');
  };
}
