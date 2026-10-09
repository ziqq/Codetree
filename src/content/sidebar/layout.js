/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Sidebar placement, theme, code font and page padding.
 */

import pageStyles from 'virtual:page-styles';
import {fontFamilies, preferences} from '../../shared/preferences.js';
import {isDark} from '../page.js';
import {createRenderEffect, on, onCleanup} from '../reactive.js';
import {listen} from '../reactive-dom.js';

/** Native Rouge token classes in GitLab's active code-theme stylesheet. */
const gitlabTokens = {
  comment: 'c1',
  keyword: 'k',
  heading: 'gh',
  tag: 'nt',
  string: 's',
  number: 'm',
  constant: 'kc',
  type: 'nc',
  function: 'nf',
  property: 'na',
  builtin: 'bp',
  annotation: 'nd',
  operator: 'o',
  punctuation: 'p',
};

/** Creates the layout feature: `layout`, `updateTheme`, `positionHandle`, `setPreferences` and `updateCodeColors`. */
export function createLayout(app) {
  const {state} = app;
  const {host, pageStyle, panel, handle, resize, toastBox, pinButton, closeButton, searchHint} = app.view;
  let nativeSidebar = null;
  const nativeSidebarObserver = new ResizeObserver(positionHandle);
  onCleanup(() => nativeSidebarObserver.disconnect());
  listen(
    document,
    'load',
    event => {
      if (state.context?.provider === 'gitlab' && event.target instanceof HTMLLinkElement) updateCodeColors();
    },
    {capture: true},
  );

  /**
   * Applies the preferences and theme to the sidebar and the page.
   *
   * A pinned, open sidebar pads the page so that it does not cover the
   * content; a custom code font also applies to the provider's code views.
   */
  function layout() {
    const prefs = state.preferences;
    const available = app.uiReady && Boolean(state.context);
    host.style.visibility = app.uiReady ? 'visible' : 'hidden';
    host.dataset.theme = isDark() ? 'dark' : 'light';
    host.dataset.icons = prefs.iconTheme;
    host.dataset.provider = state.context?.provider || 'github';
    host.style.setProperty('--panel-width', `${prefs.width}px`);
    host.style.setProperty('--code-font', fontFamilies[prefs.fontFamily]);
    host.style.setProperty('--code-size', `${prefs.fontSize}px`);
    host.style.setProperty('--diff-row-height', `${Math.max(22, prefs.fontSize + 8)}px`);
    panel.dataset.dock = prefs.dock;
    handle.dataset.dock = prefs.dock;
    resize.dataset.dock = prefs.dock;
    toastBox.dataset.dock = prefs.dock;
    panel.hidden = !available || !prefs.open;
    handle.hidden = !available || prefs.open;
    resize.hidden = !available || !prefs.open;
    positionHandle();
    pinButton.classList.toggle('active', prefs.pinned);
    pinButton.setAttribute('aria-pressed', String(prefs.pinned));
    const closeLabel = `Close sidebar${prefs.toggleShortcut ? ` · ${prefs.toggleShortcut}` : ''}`;
    closeButton.title = closeLabel;
    closeButton.setAttribute('aria-label', closeLabel);
    searchHint.textContent = prefs.searchShortcut.split(',')[0];
    const padding = available && prefs.open && prefs.pinned ? prefs.width : 0;
    const fontStyle =
      available && (prefs.fontFamily !== 'default' || prefs.fontSize !== 12)
        ? `.blob-code,.blob-code-inner,.react-code-text,[data-testid="code-cell"],pre code,.rd-line-text,.line_content,.blob-content pre{font-family:${fontFamilies[prefs.fontFamily]}!important;font-size:${prefs.fontSize}px!important;}`
        : '';
    const text = `@media(min-width:800px){body{padding-${prefs.dock}:${padding}px!important;}}${fontStyle}
      ${pageStyles}`;
    if (pageStyle.textContent !== text) pageStyle.textContent = text;
    app.requestTreeRender?.();
  }

  /**
   * Applies a page theme change: the light/dark palette and GitLab's code colors.
   *
   * Code colors are read only here, on page changes, on stylesheet loads and
   * when the viewer opens, because each read inserts probe elements into the
   * page and forces a style recalculation; preference writes, such as every
   * step of a resize drag, only lay out.
   */
  function updateTheme() {
    layout();
    updateCodeColors();
  }

  /** Reads GitLab's active native code styles; the closed viewer cannot inherit page selectors. */
  function updateCodeColors() {
    const gitlab = state.context?.provider === 'gitlab';
    const source = gitlab
      ? document.querySelector('.code-syntax-highlight-theme, .diff-file .code, .diff-table.code, .rd-diff-file .code')
      : null;
    const probe = gitlab ? document.createElement('span') : null;
    if (probe) {
      probe.className = source ? '' : 'code-syntax-highlight-theme';
      if (!source) probe.style.color = 'var(--code-text-color)';
      probe.hidden = true;
      probe.setAttribute('aria-hidden', 'true');
    }
    const tokens = Object.entries(gitlabTokens).map(([type, className]) => {
      const token = probe ? document.createElement('span') : null;
      if (token) {
        token.className = className;
        probe.append(token);
      }
      return [type, token];
    });
    if (gitlab) (source || document.body || document.documentElement).append(probe);
    try {
      const colors = gitlab ? getComputedStyle(source || probe) : null;
      for (const name of [
        'background',
        'text-color',
        'new-diff-background-color',
        'old-diff-background-color',
        'new-diff-line-number-background-color',
        'old-diff-line-number-background-color',
      ]) {
        const value = colors?.getPropertyValue(`--code-${name}`).trim();
        if (value) host.style.setProperty(`--native-code-${name}`, value);
        else host.style.removeProperty(`--native-code-${name}`);
      }
      for (const [type, token] of tokens) {
        const style = gitlab ? getComputedStyle(token) : null;
        for (const [property, name] of [
          ['color', `--native-syntax-${type}`],
          ['font-style', `--syntax-${type}-font-style`],
          ['font-weight', `--syntax-${type}-font-weight`],
        ]) {
          if (style) host.style.setProperty(name, style.getPropertyValue(property));
          else host.style.removeProperty(name);
        }
      }
    } finally {
      probe?.remove();
    }
  }

  /** Moves the collapsed edge handle beside GitHub's left navigation drawer when it is open. */
  function positionHandle() {
    const sidebar =
      state.context?.provider === 'github' ? document.querySelector('[aria-label="Issues sidebar navigation"]') : null;
    if (sidebar !== nativeSidebar) {
      if (nativeSidebar) nativeSidebarObserver.unobserve(nativeSidebar);
      nativeSidebar = sidebar;
      if (sidebar) nativeSidebarObserver.observe(sidebar);
    }
    const rect = sidebar?.getBoundingClientRect();
    const offset =
      state.preferences.dock === 'left' &&
      rect?.width > 0 &&
      rect.height > 0 &&
      rect.left >= -1 &&
      rect.left < Math.max(1, handle.getBoundingClientRect().width) &&
      rect.right < innerWidth / 2
        ? Math.ceil(Math.max(0, rect.right))
        : 0;
    host.style.setProperty('--handle-offset', `${offset}px`);
  }

  /**
   * Applies preferences immediately and saves them in the service worker.
   *
   * @param {Object} value Changed preference fields.
   */
  async function setPreferences(value) {
    state.preferences = preferences({...state.preferences, ...value});
    await app.rpc('PREFERENCES', {value});
  }
  createRenderEffect(on([() => state.preferences, () => state.context, () => app.uiReady], layout), undefined, {
    name: 'sidebar layout',
  });
  createRenderEffect(
    on(() => state.context, updateCodeColors),
    undefined,
    {name: 'native code colors'},
  );
  return {layout, positionHandle, setPreferences, updateTheme, updateCodeColors};
}
