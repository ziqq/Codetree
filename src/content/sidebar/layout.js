/**
 * Sidebar placement, theme, code font and page padding.
 *
 * @module content/sidebar/layout
 */
import pageStyles from 'virtual:page-styles';
import {fontFamilies, preferences} from '../../shared/preferences.js';
import {isDark} from '../page.js';

/** Creates the layout feature: `layout`, `positionHandle` and `setPreferences`. */
export function createLayout(app) {
  const {state} = app;
  const {host, pageStyle, panel, handle, resize, toastBox, pinButton, closeButton, searchHint} = app.view;
  let nativeSidebar = null;
  const nativeSidebarObserver = new ResizeObserver(positionHandle);

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
    updateCodeColors();
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
    pageStyle.textContent = `@media(min-width:800px){body{padding-${prefs.dock}:${padding}px!important;}}${fontStyle}
      ${pageStyles}`;
    app.requestTreeRender();
  }

  /** Reads GitLab's selected code theme without applying it to the sidebar chrome. */
  function updateCodeColors() {
    const source =
      state.context?.provider === 'gitlab'
        ? document.querySelector(
            '.code-syntax-highlight-theme, .diff-file .code, .diff-table.code, .rd-diff-file .code',
          )
        : null;
    const colors = source ? getComputedStyle(source) : null;
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
    layout();
    await app.rpc('PREFERENCES', {value});
  }
  return {layout, positionHandle, setPreferences};
}
