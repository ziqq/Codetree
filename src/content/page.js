/* Reads the current GitHub/GitLab page: route, viewer, theme and provider wording. */
import {pageVisible} from '../shared/preferences.js';
import {route} from '../shared/routes.js';

export function meta(name) { return document.querySelector(`meta[name="${name}"]`)?.content || ''; }
export function refHint() {
  for (const script of document.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
    try {
      const payload = JSON.parse(script.textContent).payload;
      const value = payload?.codeViewRepoRoute || payload?.codeViewBlobRoute;
      if (value?.refInfo?.name) return value.refInfo.name;
      if (payload?.refInfo?.name) return payload.refInfo.name;
    } catch { /* Other embedded payloads may not be valid repository route data. */ }
  }
  return '';
}
export function currentContext(state) {
  const provider = state.public?.hosts?.find(host => host.origin === location.origin)?.provider || (location.hostname === 'gitlab.com' ? 'gitlab' : 'github');
  if (provider === 'gitlab' && document.body?.dataset.page?.startsWith('groups:')) return null;
  const context = route(location.href, provider);
  if (!pageVisible(location.href, context, state.preferences)) return null;
  return {...context, viewer: provider === 'gitlab' ? document.body?.dataset.currentUserUsername || '' : meta('user-login') || meta('octolytics-actor-login'), refHint: refHint() || context.refHint || ''};
}
export function providerName(context) { return context?.provider === 'gitlab' ? 'GitLab' : 'GitHub'; }
export function requestName(context) { return context?.provider === 'gitlab' ? 'merge request' : 'pull request'; }
export function isDark() {
  if (document.documentElement.classList.contains('gl-dark') || document.body?.classList.contains('gl-dark')) return true;
  if (document.documentElement.classList.contains('gl-light') || document.body?.classList.contains('gl-light')) return false;
  const mode = document.documentElement.getAttribute('data-color-mode');
  return mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}
