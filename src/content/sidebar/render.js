/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Reactive tab chrome, persistent toolbar controls and active-tab body.
 * Rendering stays imperative; hidden tabs do not subscribe to their data.
 */

import {button, el, empty} from '../dom.js';
import {providerName, requestName} from '../page.js';
import {batch, createMemo, createRenderEffect, on} from '../reactive.js';
import {matchingBookmarks} from './bookmarks.js';
import {matchingPulls} from './pulls.js';

/** Creates bindings once; filter/mode controls survive data and query changes. */
export function createRender(app) {
  const {state, run} = app;
  const {tabButtons, body, spacer, search, toolbar, notice} = app.view;
  const changesOption = el('option', {value: 'changes'});
  const modeSelect = el('select', {'aria-label': 'File tree mode'}, [
    el('option', {value: 'files', text: 'Repository files'}),
    changesOption,
  ]);
  modeSelect.addEventListener(
    'change',
    run(async () => {
      batch(() => {
        app.rememberExpansion();
        state.mode = modeSelect.value;
        void app.loadFiles();
      });
    }),
  );
  const filterSelect = el('select');
  const allOption = el('option', {value: 'all'});
  filterSelect.append(allOption);
  for (const [value, text] of [
    ['awaiting', 'Requested from me'],
    ['reviewed', 'Reviewed by me'],
    ['changes', 'Changes requested'],
    ['approved', 'Approved'],
    ['unreviewed', 'No reviews'],
  ])
    filterSelect.append(el('option', {value, text}));
  filterSelect.addEventListener(
    'change',
    run(() =>
      batch(() => {
        state.filter = filterSelect.value;
        void app.loadPulls();
      }),
    ),
  );
  const title = el('span', {class: 'toolbar-title'});
  const count = el('span', {class: 'count'});
  const collapse = button('collapse', 'Collapse folders', () => {
    state.expanded = new Set();
    app.rememberExpansion();
  });
  const refresh = button(
    'refresh',
    'Refresh sidebar',
    run(() => app.refresh()),
  );
  // Files matching the search, or every loaded file; both inputs are signals, so the count follows them directly.
  const fileCount = createMemo(
    () =>
      state.query
        ? state.flat.filter(node => node.type !== 'tree').length
        : state.entries.filter(entry => entry.type !== 'tree').length,
    undefined,
    {name: 'file count'},
  );
  const pulls = createMemo(() => matchingPulls(state.pulls, state.query));
  const bookmarks = createMemo(() => matchingBookmarks(state.public?.bookmarks || [], state.query));

  createRenderEffect(
    () => {
      const name = requestName(state.context);
      const tab = state.tab;
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
    },
    undefined,
    {name: 'tab chrome'},
  );
  createRenderEffect(
    () => {
      const name = requestName(state.context);
      changesOption.textContent =
        state.context?.kind === 'pull'
          ? `${state.context.provider === 'gitlab' ? 'MR !' : 'PR #'}${state.context.number} changes`
          : 'Commit changes';
      filterSelect.setAttribute('aria-label', `Filter ${name}s`);
      allOption.textContent = `All open ${name}s`;
    },
    undefined,
    {name: 'toolbar labels'},
  );
  createRenderEffect(
    on([() => state.tab, () => state.context?.kind], () => {
      toolbar.replaceChildren(
        ...(state.tab === 'files'
          ? [['pull', 'commit'].includes(state.context?.kind) ? modeSelect : title, count, collapse, refresh]
          : state.tab === 'pulls'
            ? [filterSelect, count, refresh]
            : [title, count, refresh]),
      );
    }),
    undefined,
    {name: 'toolbar structure'},
  );
  createRenderEffect(
    () => {
      modeSelect.value = state.mode;
      filterSelect.value = state.filter;
    },
    undefined,
    {name: 'toolbar selection'},
  );
  createRenderEffect(
    () => {
      title.textContent =
        state.tab === 'files' ? (state.lazy ? 'Loaded repository files' : 'Repository files') : 'Saved on this browser';
      count.textContent = String(
        state.tab === 'files' ? fileCount() : state.tab === 'pulls' ? pulls().length : bookmarks().length,
      );
    },
    undefined,
    {name: 'toolbar count'},
  );
  createRenderEffect(
    () => {
      if (search.value !== state.searchText) search.value = state.searchText;
    },
    undefined,
    {name: 'search input'},
  );
  createRenderEffect(
    () => {
      const tab = state.tab;
      const loading = state.loading;
      const error = state.error;
      notice.replaceChildren();
      notice.className = 'notice';
      if (tab !== 'files' || loading || error) return;
      if (state.lazy)
        notice.append(
          document.createTextNode('Folders load as you open them. Search currently includes loaded files. '),
          el('button', {
            type: 'button',
            text: state.loadingAll ? 'Loading all folders…' : 'Load all folders for search',
            onClick: run(() => app.loadAllFolders()),
            disabled: state.loadingAll ? '' : null,
          }),
        );
      if (state.mode === 'changes' && state.diff) {
        if (state.diff.viewedMode === 'local')
          notice.append(document.createTextNode('Viewed marks are local to this browser. '));
        for (const warning of state.diff.warnings) notice.append(el('div', {text: warning}));
      }
    },
    undefined,
    {name: 'files notice'},
  );
  createRenderEffect(
    () => {
      const tab = state.tab;
      const loading = state.loading;
      const error = state.error;
      if (loading) {
        const node = empty(`Loading from ${providerName(state.context)}`, 'Fetching repository data…', 'refresh');
        node.classList.add('loading');
        body.replaceChildren(node);
      } else if (error)
        body.replaceChildren(
          empty('Could not load this view', error, 'file', [
            el('button', {class: 'small-button primary', text: 'Retry', onClick: run(() => app.refresh())}),
            el('button', {class: 'small-button', text: 'Open settings', onClick: run(() => app.rpc('OPTIONS'))}),
          ]),
        );
      else if (tab === 'files') {
        if (!state.flat.length)
          body.replaceChildren(
            empty(
              state.query ? 'No matching files' : 'No files',
              state.query ? 'Try a different file or folder name.' : 'This repository has no files to display.',
              'folder',
            ),
          );
        else if (!body.contains(spacer)) body.replaceChildren(spacer);
      } else if (tab === 'pulls') {
        state.context;
        state.filter;
        app.renderPulls(pulls());
      } else {
        state.context;
        app.renderBookmarks(bookmarks());
      }
    },
    undefined,
    {name: 'active tab body'},
  );
  return {};
}
