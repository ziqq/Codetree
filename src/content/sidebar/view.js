/**
 * The sidebar DOM inside a closed Shadow DOM.
 *
 * Builds the panel, edge handle, resize separator, toast and viewer
 * dialog, and binds their element-level events. Page styles and icon
 * fonts are separate `<style>` elements because they must apply to the
 * provider page itself.
 *
 * @module content/sidebar/view
 */
import {icon} from '../../shared/icons.js';
import {button, el} from '../dom.js';
import {fontFaces} from './file-icons.js';

/**
 * Creates the sidebar elements.
 *
 * @param {Object} app The shared app; needs `state` and `run`.
 * @returns {Object} Element references used by the other features.
 */
export function createView(app) {
  const {state, run} = app;
  let hoverTimer;
  let queryTimer;
  let resizeStart = null;
  const host = document.createElement('div');
  host.id = 'codetree-extension';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;visibility:hidden;';
  const shadow = host.attachShadow({mode: 'closed'});
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = chrome.runtime.getURL('sidebar.css');
  const stylesheetLoaded = new Promise((resolve, reject) => {
    sheet.addEventListener('load', resolve, {once: true});
    sheet.addEventListener('error', () => reject(new Error('Codetree styles could not load. Refresh this page.')), {
      once: true,
    });
  });
  shadow.append(sheet);
  const pageStyle = document.createElement('style');
  pageStyle.id = 'codetree-page-style';
  const iconFonts = document.createElement('style');
  iconFonts.id = 'codetree-icon-fonts';
  iconFonts.textContent = fontFaces();

  const panel = el('aside', {class: 'panel', 'aria-label': 'Codetree', hidden: ''});
  const pinButton = button(
    'pin',
    'Pin sidebar in this window',
    run(async () => {
      const pinned = await app.rpc('WINDOW_PIN', {pinned: !state.preferences.pinned});
      // The pin belongs to this window; only `open` is saved as a preference.
      state.preferences = {...state.preferences, pinned, open: true};
      await app.setPreferences({open: true});
    }),
  );
  const closeButton = button(
    'close',
    'Close sidebar',
    run(() => app.setPreferences({open: false})),
  );
  const brandbar = el('div', {class: 'brandbar'}, [
    icon('tree'),
    el('span', {class: 'brand', text: 'Codetree'}),
    pinButton,
    closeButton,
  ]);
  const repository = el('div', {class: 'repository'});
  const branchLabel = el('span', {class: 'branch-label', text: 'Loading branch…'});
  const branchButton = el(
    'button',
    {type: 'button', class: 'branch-button', 'aria-label': 'Switch branch', 'aria-expanded': 'false'},
    [icon('branch'), branchLabel, icon('chevron', 'chevron')],
  );
  const branchSearch = el('input', {type: 'search', placeholder: 'Find a branch…', 'aria-label': 'Search branches'});
  const branchList = el('div', {class: 'branch-list'});
  const branchPopover = el('div', {class: 'popover', hidden: '', 'aria-label': 'Branches'}, [branchSearch, branchList]);
  const branchbar = el('div', {class: 'branchbar'}, [branchButton, branchPopover]);
  const tabs = el('div', {class: 'tabs', role: 'tablist', 'aria-label': 'Sidebar sections'});
  const tabButtons = {};
  for (const [id, label, name] of [
    ['files', 'Files', 'code'],
    ['pulls', 'Pull requests', 'pr'],
    ['bookmarks', 'Bookmarks', 'bookmark'],
  ]) {
    const tab = el(
      'button',
      {type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false', onClick: run(() => app.selectTab(id))},
      [icon(name), el('span', {text: label})],
    );
    tabButtons[id] = tab;
    tabs.append(tab);
  }
  const search = el('input', {type: 'search', placeholder: 'Find a file…', 'aria-label': 'Search files and folders'});
  const searchHint = el('span', {class: 'keyhint'});
  const searchbar = el('div', {class: 'searchbar'}, [icon('search'), search, searchHint]);
  const toolbar = el('div', {class: 'toolbar'});
  const notice = el('div', {class: 'notice', role: 'status', 'aria-live': 'polite'});
  const body = el('div', {class: 'body', role: 'tabpanel', 'aria-label': 'Files'});
  const spacer = el('div', {class: 'tree-spacer', role: 'tree', 'aria-label': 'Repository file tree'});
  const accountSelect = el('select', {class: 'account-select', 'aria-label': 'Repository account'});
  const dockButton = button(
    'dock',
    'Move sidebar to the other side',
    run(() => app.setPreferences({dock: state.preferences.dock === 'left' ? 'right' : 'left'})),
  );
  const bookmarkButton = button(
    'bookmark',
    'Bookmark this page',
    run(() => app.bookmarkCurrent()),
  );
  const footer = el('div', {class: 'footer'}, [
    icon('account'),
    accountSelect,
    el('span', {class: 'separator'}),
    bookmarkButton,
    dockButton,
    button(
      'settings',
      'Settings',
      run(() => app.rpc('OPTIONS')),
    ),
  ]);
  panel.append(brandbar, repository, branchbar, tabs, searchbar, toolbar, notice, body, footer);
  const handle = el(
    'button',
    {
      type: 'button',
      class: 'handle',
      'aria-label': 'Open Codetree',
      hidden: '',
      onClick: run(() => app.setPreferences({open: true})),
    },
    [
      icon('chevron'),
      el('span', {class: 'handle-brand', 'aria-hidden': 'true'}, [
        el('span', {class: 'handle-initial', text: 'C'}),
        document.createTextNode('odetree'),
      ]),
      el('span', {class: 'handle-grip', 'aria-hidden': 'true'}),
    ],
  );
  const resize = el('div', {
    class: 'resize',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': 'Resize sidebar',
    tabindex: '0',
    hidden: '',
  });
  const toastBox = el('div', {class: 'toast', role: 'status', hidden: ''});
  const viewer = el('dialog', {class: 'viewer', 'aria-label': 'Full-file diff'});
  shadow.append(panel, handle, resize, toastBox, viewer);

  branchButton.addEventListener(
    'click',
    run(() => app.toggleBranches()),
  );
  branchSearch.addEventListener('input', () => app.renderBranches());
  shadow.addEventListener('click', event => {
    if (!branchbar.contains(event.target)) app.closeBranches();
  });
  search.addEventListener('input', () => {
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      state.focus = 0;
      body.scrollTop = 0;
      state.query = search.value;
    }, 100);
  });

  /** Clears the search field and the query, including a pending query from typing. */
  function clearSearch() {
    clearTimeout(queryTimer);
    search.value = '';
    state.query = '';
  }
  accountSelect.addEventListener(
    'change',
    run(async () => {
      try {
        await app.rpc('SELECT_ACCOUNT', {origin: state.context.origin, id: accountSelect.value});
      } catch (error) {
        // Show the account that is still selected.
        app.updateHeader();
        throw error;
      }
      await app.loadPage(true);
    }),
  );
  handle.addEventListener('mouseenter', () => {
    if (!state.preferences.pinned) state.preferences = {...state.preferences, open: true};
  });
  panel.addEventListener('mouseenter', () => clearTimeout(hoverTimer));
  panel.addEventListener('mouseleave', () => {
    if (!state.preferences.pinned && !viewer.open && branchPopover.hidden)
      hoverTimer = setTimeout(() => {
        if (!panel.contains(shadow.activeElement)) state.preferences = {...state.preferences, open: false};
      }, 250);
  });
  resize.addEventListener('pointerdown', event => {
    resizeStart = {x: event.clientX, width: state.preferences.width};
    resize.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  resize.addEventListener('pointermove', event => {
    if (!resizeStart) return;
    const delta = (event.clientX - resizeStart.x) * (state.preferences.dock === 'left' ? 1 : -1);
    state.preferences = {...state.preferences, width: Math.max(240, Math.min(600, resizeStart.width + delta))};
  });
  resize.addEventListener(
    'pointerup',
    run(async () => {
      if (resizeStart) {
        resizeStart = null;
        await app.setPreferences({width: state.preferences.width});
      }
    }),
  );
  resize.addEventListener('pointercancel', () => {
    resizeStart = null;
  });
  resize.addEventListener(
    'keydown',
    run(async event => {
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 16 : -16;
        await app.setPreferences({
          width: state.preferences.width + delta * (state.preferences.dock === 'left' ? 1 : -1),
        });
      }
    }),
  );
  body.addEventListener('scroll', () => app.requestTreeRender(), {passive: true});

  return {
    host,
    shadow,
    pageStyle,
    iconFonts,
    stylesheetLoaded,
    panel,
    pinButton,
    closeButton,
    repository,
    branchLabel,
    branchButton,
    branchSearch,
    branchList,
    branchPopover,
    tabButtons,
    search,
    searchHint,
    clearSearch,
    toolbar,
    notice,
    body,
    spacer,
    accountSelect,
    bookmarkButton,
    handle,
    resize,
    toastBox,
    viewer,
  };
}
