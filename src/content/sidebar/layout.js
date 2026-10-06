/**
 * Sidebar placement, theme, code font and page padding.
 *
 * @module content/sidebar/layout
 */
import {fontFamilies, preferences} from '../../shared/preferences.js';
import {isDark} from '../page.js';

/** Creates the layout feature: `layout`, `positionHandle` and `setPreferences`. */
export function createLayout(app) {
  const {state} = app;
  const {host, pageStyle, panel, handle, resize, pinButton, closeButton, searchHint} = app.view;
  let nativeSidebar = null;
  const nativeSidebarObserver = new ResizeObserver(positionHandle);

  /**
   * Applies the preferences and theme to the sidebar and the page.
   *
   * A pinned, open sidebar pads the page so that it does not cover the
   * content; a custom code font also applies to the provider's code views.
   */
  function layout() {
    const prefs = state.preferences; const available = app.uiReady && Boolean(state.context);
    host.style.visibility = app.uiReady ? 'visible' : 'hidden';
    host.dataset.theme = isDark() ? 'dark' : 'light'; host.dataset.icons = prefs.iconTheme;
    host.dataset.provider = state.context?.provider || 'github';
    host.style.setProperty('--panel-width', `${prefs.width}px`);
    host.style.setProperty('--code-font', fontFamilies[prefs.fontFamily]);
    host.style.setProperty('--code-size', `${prefs.fontSize}px`);
    host.style.setProperty('--diff-row-height', `${Math.max(22, prefs.fontSize + 8)}px`);
    panel.dataset.dock = prefs.dock; handle.dataset.dock = prefs.dock; resize.dataset.dock = prefs.dock;
    panel.hidden = !available || !prefs.open; handle.hidden = !available || prefs.open;
    resize.hidden = !available || !prefs.open;
    positionHandle();
    pinButton.classList.toggle('active', prefs.pinned); pinButton.setAttribute('aria-pressed', String(prefs.pinned));
    const closeLabel = `Close sidebar${prefs.toggleShortcut ? ` · ${prefs.toggleShortcut}` : ''}`;
    closeButton.title = closeLabel; closeButton.setAttribute('aria-label', closeLabel);
    searchHint.textContent = prefs.searchShortcut.split(',')[0];
    const padding = available && prefs.open && prefs.pinned ? prefs.width : 0;
    const fontStyle = available && (prefs.fontFamily !== 'default' || prefs.fontSize !== 12)
      ? `.blob-code,.blob-code-inner,.react-code-text,[data-testid="code-cell"],pre code,.rd-line-text,.line_content,.blob-content pre{font-family:${fontFamilies[prefs.fontFamily]}!important;font-size:${prefs.fontSize}px!important;}` : '';
    pageStyle.textContent = `@media(min-width:800px){body{padding-${prefs.dock}:${padding}px!important;}}${fontStyle}
      .codetree-view-full{display:inline-flex;align-items:center;gap:5px;flex-shrink:0;white-space:nowrap;cursor:pointer;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:4px 9px;border:1px solid var(--borderColor-default,var(--gl-border-color-default,#8b949e55));border-radius:6px;background:var(--bgColor-muted,var(--gl-background-color-subtle,#6e768112));color:inherit;margin-inline:4px;line-height:18px}
      .codetree-view-full:hover{border-color:var(--fgColor-accent,var(--gl-text-color-link,#58a6ff))}.codetree-view-full:focus-visible{outline:2px solid var(--fgColor-accent,var(--gl-focus-ring-outer-color,#58a6ff));outline-offset:2px}.codetree-view-full:disabled{opacity:.5;cursor:default}.codetree-view-full .icon{height:15px;width:15px}`;
    app.requestTreeRender();
  }

  /** Moves the collapsed edge handle beside GitHub's left navigation drawer when it is open. */
  function positionHandle() {
    const sidebar = state.context?.provider === 'github' ? document.querySelector('[aria-label="Issues sidebar navigation"]') : null;
    if (sidebar !== nativeSidebar) {
      if (nativeSidebar) nativeSidebarObserver.unobserve(nativeSidebar);
      nativeSidebar = sidebar;
      if (sidebar) nativeSidebarObserver.observe(sidebar);
    }
    const rect = sidebar?.getBoundingClientRect();
    const offset = state.preferences.dock === 'left' && rect?.width > 0 && rect.height > 0 && rect.left >= -1 && rect.left < Math.max(1, handle.getBoundingClientRect().width) && rect.right < innerWidth / 2
      ? Math.ceil(Math.max(0, rect.right)) : 0;
    host.style.setProperty('--handle-offset', `${offset}px`);
  }

  /**
   * Applies preferences immediately and saves them in the service worker.
   *
   * @param {Object} value Changed preference fields.
   */
  async function setPreferences(value) {
    state.preferences = preferences({...state.preferences, ...value}); layout();
    await app.rpc('PREFERENCES', {value});
  }
  return {layout, positionHandle, setPreferences};
}
