/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/**
 * Enabled repository hosts, request contexts and account selection.
 *
 * github.com and gitlab.com are always enabled; other HTTPS origins are
 * enabled by connecting an account for them in Settings.
 *
 * @module background/hosts
 */

/**
 * Returns every enabled website origin.
 *
 * @param {Object} store The stored data.
 * @returns {Set<string>}
 */
export function origins(store) {
  return new Set([
    'https://github.com',
    'https://gitlab.com',
    ...(store.accounts || []).map(account => account.origin),
  ]);
}

/**
 * Returns the bookmarks a repository page may see.
 *
 * Local bookmarks are limited to enabled hosts when created, but Sync may
 * deliver bookmarks for hosts not connected on this device. They stay
 * stored and synced, and are shown once their host is enabled.
 *
 * @param {Array<Object>} bookmarks The stored bookmarks.
 * @param {Object} store The stored data.
 * @returns {Array<Object>}
 */
export function enabledBookmarks(bookmarks, store) {
  const enabled = origins(store);
  return (bookmarks || []).filter(item => {
    try {
      return enabled.has(new URL(item.url).origin);
    } catch {
      return false;
    }
  });
}

/**
 * Returns the provider of an origin; unknown origins are treated as GitHub.
 *
 * @param {string} origin A website origin.
 * @param {Object} store The stored data.
 * @returns {'github'|'gitlab'}
 */
export function providerFor(origin, store) {
  if (origin === 'https://github.com') return 'github';
  if (origin === 'https://gitlab.com') return 'gitlab';
  return (store.accounts || []).find(account => account.origin === origin)?.provider || 'github';
}

/**
 * Whether a branch-and-path tail or a branch hint is absent, or has no
 * empty, `.` or `..` segments. Pages send `''` when there is no tail or
 * hint. The page decodes `%2F`, so such segments could otherwise reach
 * API paths through the ref.
 *
 * @param {*} value
 * @returns {boolean}
 */
function refPath(value) {
  if (value == null || value === '') return true;
  return typeof value === 'string' && value.split('/').every(part => part && part !== '.' && part !== '..');
}

/**
 * Validates a repository context sent by a page.
 *
 * The origin must be enabled, owner and repository names must be safe
 * path segments, nested namespaces are GitLab-only, the optional signed-in
 * `viewer` must be a short string, and the provider must match the
 * configured host.
 *
 * @param {Object} value The context from the page.
 * @param {Object} store The stored data.
 * @returns {Object} The context with the configured provider.
 * @throws {Error} If the context is not acceptable.
 */
export function validateContext(value, store) {
  if (
    !value ||
    !origins(store).has(value.origin) ||
    typeof value.owner !== 'string' ||
    typeof value.repo !== 'string' ||
    !/^[\w.-]+(?:\/[\w.-]+)*$/.test(value.owner) ||
    !/^[\w.-]+$/.test(value.repo) ||
    value.owner.split('/').some(part => part === '.' || part === '..') ||
    value.repo === '.' ||
    value.repo === '..' ||
    (value.viewer != null && (typeof value.viewer !== 'string' || value.viewer.length > 255)) ||
    !refPath(value.tail) ||
    !refPath(value.refHint)
  ) {
    throw new Error('This repository host is not enabled.');
  }
  const provider = providerFor(value.origin, store);
  if ((value.provider && value.provider !== provider) || (provider === 'github' && value.owner.includes('/')))
    throw new Error('Invalid repository provider.');
  return {...value, provider};
}

/**
 * Selects the account for a request.
 *
 * An explicit selection wins; `auto` uses the account whose username
 * matches the signed-in page user, or the only account for the host.
 *
 * @param {Object} context The repository context, including `viewer`.
 * @param {Object} store The stored data.
 * @returns {?Object} The account, or `null` for anonymous access.
 */
export function accountFor(context, store) {
  const accounts = (store.accounts || []).filter(account => account.origin === context.origin);
  const selected = store.selectedAccounts?.[context.origin];
  if (selected && selected !== 'auto') return accounts.find(account => account.id === selected) || null;
  if (context.viewer)
    return accounts.find(account => account.login.toLowerCase() === context.viewer.toLowerCase()) || null;
  return accounts.length === 1 ? accounts[0] : null;
}
