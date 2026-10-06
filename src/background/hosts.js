/* Enabled repository hosts, request contexts and account selection. */

export function origins(store) {
  return new Set(['https://github.com', 'https://gitlab.com', ...(store.accounts || []).map(account => account.origin)]);
}
export function providerFor(origin, store) {
  if (origin === 'https://github.com') return 'github';
  if (origin === 'https://gitlab.com') return 'gitlab';
  return (store.accounts || []).find(account => account.origin === origin)?.provider || 'github';
}
export function validateContext(value, store) {
  if (!value || !origins(store).has(value.origin) || typeof value.owner !== 'string' || typeof value.repo !== 'string' ||
      !/^[\w.-]+(?:\/[\w.-]+)*$/.test(value.owner) || !/^[\w.-]+$/.test(value.repo) ||
      value.owner.split('/').some(part => part === '.' || part === '..') || value.repo === '.' || value.repo === '..') {
    throw new Error('This repository host is not enabled.');
  }
  const provider = providerFor(value.origin, store);
  if ((value.provider && value.provider !== provider) || (provider === 'github' && value.owner.includes('/'))) throw new Error('Invalid repository provider.');
  return {...value, provider};
}
export function accountFor(context, store) {
  const accounts = (store.accounts || []).filter(account => account.origin === context.origin);
  const selected = store.selectedAccounts?.[context.origin];
  if (selected && selected !== 'auto') return accounts.find(account => account.id === selected) || null;
  if (context.viewer) return accounts.find(account => account.login.toLowerCase() === context.viewer.toLowerCase()) || null;
  return accounts.length === 1 ? accounts[0] : null;
}
