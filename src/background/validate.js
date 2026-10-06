/* Request identifier validation for API paths. */
import {pathURL} from '../shared/routes.js';

export function number(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid pull request number.');
  return value;
}
export function sha(value) {
  if (!/^[a-f\d]{7,40}$/i.test(value || '')) throw new Error('Invalid commit or tree SHA.');
  return value;
}
export function filePath(value) {
  if (typeof value !== 'string' || !value || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid file path.');
  return pathURL(value);
}
