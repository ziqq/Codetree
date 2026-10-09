/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Reads the current GitHub or GitLab page: its repository context, signed-in
 * user, branch hint, theme and provider wording.
 */

import {pageVisible} from '../shared/preferences.js';
import {route} from '../shared/routes.js';

/** Returns the content of a `<meta name>` tag, or an empty string. */
export function meta(name) {
  return document.querySelector(`meta[name="${name}"]`)?.content || '';
}

/**
 * Returns the branch name from GitHub's embedded page data.
 *
 * Needed for branch names containing `/`, which the URL alone cannot
 * separate from the file path.
 */
export function refHint() {
  for (const script of document.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
    try {
      const payload = JSON.parse(script.textContent).payload;
      const value = payload?.codeViewRepoRoute || payload?.codeViewBlobRoute;
      if (value?.refInfo?.name) return value.refInfo.name;
      if (payload?.refInfo?.name) return payload.refInfo.name;
    } catch {
      /* Other embedded payloads may not be valid repository route data. */
    }
  }
  return '';
}

/**
 * Returns the repository context of the current page, or `null` when
 * Codetree should not appear (no repository, group page, excluded URL).
 *
 * The signed-in username is included as `viewer` for automatic account selection.
 *
 * @param {Object} state The sidebar state (for hosts and preferences).
 * @returns {?Object}
 */
export function currentContext(state) {
  const provider =
    state.public?.hosts?.find(host => host.origin === location.origin)?.provider ||
    (location.hostname === 'gitlab.com' ? 'gitlab' : 'github');
  if (provider === 'gitlab' && document.body?.dataset.page?.startsWith('groups:')) return null;
  const context = route(location.href, provider);
  if (!pageVisible(location.href, context, state.preferences)) return null;
  return {
    ...context,
    viewer:
      provider === 'gitlab'
        ? document.body?.dataset.currentUserUsername || ''
        : meta('user-login') || meta('octolytics-actor-login'),
    refHint: refHint() || context.refHint || '',
  };
}

/** `GitLab` or `GitHub`, for user-facing text. */
export function providerName(context) {
  return context?.provider === 'gitlab' ? 'GitLab' : 'GitHub';
}

/** `merge request` or `pull request`, for user-facing text. */
export function requestName(context) {
  return context?.provider === 'gitlab' ? 'merge request' : 'pull request';
}

/** Whether the provider page currently uses a dark theme. */
export function isDark() {
  if (document.documentElement.classList.contains('gl-dark') || document.body?.classList.contains('gl-dark'))
    return true;
  if (document.documentElement.classList.contains('gl-light') || document.body?.classList.contains('gl-light'))
    return false;
  const mode = document.documentElement.getAttribute('data-color-mode');
  return mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}
