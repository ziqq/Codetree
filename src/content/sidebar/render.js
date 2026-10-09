/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Renders the active tab, its toolbar and notices.
 *
 * The rendering is bound to the state with render effects: each effect
 * reads the view fields it depends on and re-runs after one of them is
 * replaced, so handlers only write the state. Toolbar controls are created
 * once and keep keyboard focus while their values change.
 */
import {batch, createMemo, createRenderEffect, untrack} from '../../shared/reactive.js';
import {button, el, empty} from '../dom.js';
import {providerName, requestName} from '../page.js';
import {matchingBookmarks} from './bookmarks.js';
import {matchingPulls} from './pulls.js';
import {rowHeight} from './tree.js';

/** Review-state filters of the request list with their labels; `null` is replaced by the request name. */
const filters = [
  ['all', null],
  ['awaiting', 'Requested from me'],
  ['reviewed', 'Reviewed by me'],
  ['changes', 'Changes requested'],
  ['approved', 'Approved'],
  ['unreviewed', 'No reviews'],
];

/** Creates the render feature: `bindRender`. */
export function createRender(app) {
  const {state, run} = app;
  const {tabButtons, body, spacer, search, toolbar, notice} = app.view;
  const modeSelect = el('select', {'aria-label': 'File tree mode'});
  const filterSelect = el('select');
  const filesTitle = el('span', {class: 'toolbar-title'});
  const bookmarksTitle = el('span', {class: 'toolbar-title', text: 'Saved on this browser'});
  const count = el('span', {class: 'count'});
  const collapseButton = button('collapse', 'Collapse folders', () => {
    state.expanded = new Set();
    app.rememberExpansion();
  });
  const refreshButton = button(
    'refresh',
    'Refresh sidebar',
    run(() => app.refresh()),
  );
  modeSelect.addEventListener(
    'change',
    run(async () => {
      app.rememberExpansion();
      // The synchronous start of the load joins the batch, so the tab renders once.
      await batch(() => {
        state.mode = modeSelect.value;
        return app.loadFiles();
      });
    }),
  );
  filterSelect.addEventListener(
    'change',
    run(async () => {
      await batch(() => {
        state.filter = filterSelect.value;
        return app.loadPulls();
      });
    }),
  );

  /** Number of files in the tree, without folders. */
  const fileTotal = createMemo(
    () => {
      let total = 0;
      for (const node of state.tree.nodes.values()) if (node.type !== 'tree') total++;
      return total;
    },
    0,
    {name: 'fileTotal'},
  );

  /** Number of files among the visible rows. */
  const visibleFiles = createMemo(() => state.flat.filter(node => node.type !== 'tree').length, 0, {
    name: 'visibleFiles',
  });

  /** Applies the active tab to the tab buttons, the list labels and the search field. */
  function renderTabs() {
    const tab = state.tab;
    const name = requestName(state.context);
    for (const [id, button] of Object.entries(tabButtons)) button.setAttribute('aria-selected', String(id === tab));
    body.setAttribute(
      'aria-label',
      tab === 'pulls' ? `${providerName(state.context)} ${name}s` : tab === 'bookmarks' ? 'Bookmarks' : 'Files',
    );
    search.placeholder =
      tab === 'pulls' ? `Find a ${name}…` : tab === 'bookmarks' ? 'Find a bookmark…' : 'Find a file…';
    search.setAttribute(
      'aria-label',
      tab === 'pulls' ? `Search ${name}s` : tab === 'bookmarks' ? 'Search bookmarks' : 'Search files and folders',
    );
  }

  /** Fills the tree-mode and request-filter options for the current repository. */
  function renderOptions() {
    const context = state.context;
    const name = requestName(context);
    modeSelect.replaceChildren(
      el('option', {value: 'files', text: 'Repository files'}),
      el('option', {
        value: 'changes',
        text:
          context?.kind === 'pull'
            ? `${context.provider === 'gitlab' ? 'MR !' : 'PR #'}${context.number} changes`
            : 'Commit changes',
      }),
    );
    filterSelect.setAttribute('aria-label', `Filter ${name}s`);
    filterSelect.replaceChildren(
      ...filters.map(([value, label]) => el('option', {value, text: label || `All open ${name}s`})),
    );
    // New options select the first one; restore the current values without depending on them.
    untrack(() => {
      modeSelect.value = state.mode;
      filterSelect.value = state.filter;
    });
  }

  /** Shows the controls of the active tab in the toolbar. */
  function renderToolbar() {
    const tab = state.tab;
    const parts =
      tab === 'files'
        ? [['pull', 'commit'].includes(state.context?.kind) ? modeSelect : filesTitle, count, collapseButton]
        : tab === 'pulls'
          ? [filterSelect, count]
          : [bookmarksTitle, count];
    // Keep focused controls in place: only replace the toolbar when its parts change.
    if (parts.length + 1 !== toolbar.childElementCount || parts.some((part, index) => toolbar.children[index] !== part))
      toolbar.replaceChildren(...parts, refreshButton);
  }

  /** Shows the number of files, requests or bookmarks of the active tab; a search counts only the matches. */
  function renderCount() {
    count.textContent = String(
      state.tab === 'files'
        ? state.query
          ? visibleFiles()
          : fileTotal()
        : state.tab === 'pulls'
          ? matchingPulls(state).length
          : matchingBookmarks(state).length,
    );
  }

  /** The loading state and error of the active tab: the tree status on Files, the request status elsewhere. */
  function status() {
    return state.tab === 'files'
      ? {loading: state.filesLoading, error: state.filesError}
      : {loading: state.loading, error: state.error};
  }

  /**
   * Reads the fields the active tab body depends on, so the body effect
   * re-runs only for changes of the visible tab.
   */
  function bodyInputs() {
    const {loading, error} = status();
    const inputs = [state.tab, state.context, loading, error];
    if (loading || error) return inputs;
    if (state.tab === 'files')
      inputs.push(state.lazy, state.loadingAll, state.mode, state.diff, state.flat, state.query);
    else if (state.tab === 'pulls') inputs.push(state.pulls, state.query, state.filter);
    else inputs.push(state.public, state.query);
    return inputs;
  }

  /** Renders the active tab body and its notices, including loading, error and empty states. */
  function renderBody() {
    notice.replaceChildren();
    notice.className = 'notice';
    const {loading, error} = status();
    if (loading) {
      const node = empty(`Loading from ${providerName(state.context)}`, 'Fetching repository data…', 'refresh');
      node.classList.add('loading');
      body.replaceChildren(node);
      return;
    }
    if (error) {
      body.replaceChildren(
        empty('Could not load this view', error, 'file', [
          el('button', {class: 'small-button primary', text: 'Retry', onClick: run(() => app.refresh())}),
          el('button', {class: 'small-button', text: 'Open settings', onClick: run(() => app.rpc('OPTIONS'))}),
        ]),
      );
      return;
    }
    if (state.tab === 'files') {
      if (state.lazy) {
        notice.append(
          document.createTextNode('Folders load as you open them. Search currently includes loaded files. '),
        );
        notice.append(
          el('button', {
            type: 'button',
            text: state.loadingAll ? 'Loading all folders…' : 'Load all folders for search',
            onClick: run(() => app.loadAllFolders()),
            disabled: state.loadingAll ? '' : null,
          }),
        );
      }
      if (state.mode === 'changes' && state.diff) {
        if (state.diff.viewedMode === 'local')
          notice.append(document.createTextNode('Viewed marks are local to this browser. '));
        for (const warning of state.diff.warnings) notice.append(el('div', {text: warning}));
      }
      if (!state.flat.length)
        body.replaceChildren(
          empty(
            state.query ? 'No matching files' : 'No files',
            state.query ? 'Try a different file or folder name.' : 'This repository has no files to display.',
            'folder',
          ),
        );
      else {
        spacer.style.height = `${state.flat.length * rowHeight}px`;
        if (!body.contains(spacer)) body.replaceChildren(spacer);
        app.requestTreeRender();
      }
    } else if (state.tab === 'pulls') app.renderPulls();
    else app.renderBookmarks();
  }

  /** Binds the tabs, toolbar and body to the state; called once inside the app root. */
  function bindRender() {
    createRenderEffect(renderTabs, undefined, {name: 'tabs'});
    createRenderEffect(renderOptions, undefined, {name: 'options'});
    createRenderEffect(
      () => {
        modeSelect.value = state.mode;
      },
      undefined,
      {name: 'mode'},
    );
    createRenderEffect(
      () => {
        filterSelect.value = state.filter;
      },
      undefined,
      {name: 'filter'},
    );
    createRenderEffect(
      () => {
        filesTitle.textContent = state.lazy ? 'Loaded repository files' : 'Repository files';
      },
      undefined,
      {name: 'filesTitle'},
    );
    createRenderEffect(renderToolbar, undefined, {name: 'toolbar'});
    createRenderEffect(renderCount, undefined, {name: 'count'});
    createRenderEffect(
      previous => {
        const query = state.query;
        // A new search starts at the first result.
        if (query !== previous) {
          state.focus = 0;
          body.scrollTop = 0;
        }
        return query;
      },
      '',
      {name: 'queryReset'},
    );
    createRenderEffect(
      () => {
        bodyInputs();
        untrack(renderBody);
      },
      undefined,
      {name: 'body'},
    );
  }
  return {bindRender};
}
