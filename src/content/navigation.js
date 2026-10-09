/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Page navigation, reactive repository header, tabs and Refresh.
 * Page roots release repository resources; request generations still reject stale replies.
 */

import {repoURL} from '../shared/routes.js';
import {makeTree} from '../shared/tree.js';
import {el} from './dom.js';
import {currentContext, providerName} from './page.js';
import {batch, createAlive, createRenderEffect, createRoot, getOwner, on, onCleanup, runWithOwner} from './reactive.js';

/** Creates navigation actions and the repository-header binding. */
export function createNavigation(app) {
  const {state} = app;

  /** Disposes the previous page, resets the view in one batch and loads the new repository. */
  async function loadPage(force = false) {
    if (!app.uiReady) return;
    const context = currentContext(state);
    const url = location.href;
    if (!force && url === app.lastURL) return;
    app.lastURL = url;
    const epoch = ++state.epoch;
    state.viewGeneration++;
    state.refreshGeneration++;
    state.branchGeneration++;
    app.disposePage?.();
    runWithOwner(app.owner, () =>
      createRoot(dispose => {
        app.disposePage = dispose;
        app.pageOwner = getOwner();
        app.pageAlive = createAlive();
        onCleanup(() => app.loadingFolders.clear());
        onCleanup(() => app.closeBranches());
        onCleanup(() => app.clearHeaderButtons());
        onCleanup(() => app.closeViewer());
      }),
    );
    const alive = app.pageAlive;
    const current = () => alive() && epoch === state.epoch;
    batch(() => {
      state.context = context;
      state.info = null;
      state.diff = null;
      state.branches = null;
      state.filesLoading = true;
      state.filesError = '';
      state.viewLoading = false;
      state.viewError = '';
      state.entries = [];
      state.tree = makeTree([]);
      state.expanded = new Set();
      state.searchText = '';
      state.query = '';
      state.mode = context?.kind === 'pull' || context?.kind === 'commit' ? 'changes' : 'files';
      state.tab = 'files';
      state.selected = '';
      state.focus = 0;
      state.lazy = false;
      state.loadingAll = false;
      app.updateTree();
    });
    if (!context) return;
    app.scheduleHeaderButtons();
    try {
      const [publicData, info] = await Promise.all([
        app.rpc('STATE').then(value => {
          if (current())
            batch(() => {
              state.public = value;
              state.preferences = value.preferences;
            });
          return value;
        }),
        app.rpc('INIT'),
      ]);
      if (!current()) return;
      batch(() => {
        state.public = publicData;
        state.preferences = publicData.preferences;
        state.info = info;
        state.selected = info.path || '';
      });
      await app.loadFiles(epoch);
    } catch (error) {
      if (!current()) return;
      batch(() => {
        state.filesLoading = false;
        state.filesError = error.message;
      });
    }
  }

  /** Renders header data from one consistent context/info/public snapshot. */
  function updateHeader() {
    const {repository, tabButtons, branchLabel, branchButton, accountSelect, bookmarkButton} = app.view;
    const context = state.context;
    if (!context) {
      repository?.replaceChildren();
      branchButton.disabled = true;
      return;
    }
    repository.replaceChildren(
      el('a', {class: 'repo-name', href: repoURL(context), title: `${context.owner}/${context.repo}`}, [
        el('small', {text: `${context.owner} / `}),
        document.createTextNode(context.repo),
      ]),
    );
    tabButtons.pulls.querySelector('span').textContent =
      context.provider === 'gitlab' ? 'Merge requests' : 'Pull requests';
    if (state.info?.repository.private) repository.append(el('span', {class: 'privacy', text: 'Private'}));
    branchLabel.textContent = state.info?.ref || 'Branch';
    branchButton.disabled = !state.info;
    accountSelect.replaceChildren(el('option', {value: 'auto', text: `Auto · ${providerName(context)} account`}));
    for (const account of state.public?.accounts || []) {
      if (account.origin === context.origin)
        accountSelect.append(
          el('option', {
            value: account.id,
            text: account.label === account.login ? account.login : `${account.label} · ${account.login}`,
          }),
        );
    }
    accountSelect.value = state.public?.selectedAccounts[context.origin] || 'auto';
    accountSelect.title = state.info?.account
      ? `API account: ${state.info.account}`
      : 'Public access · add a token in Settings for private repositories';
    bookmarkButton.classList.toggle(
      'active',
      (state.public?.bookmarks || []).some(item => item.url === location.href),
    );
  }

  /** Switches tabs and resets search without copying Files status into list status. */
  async function selectTab(tab) {
    const epoch = state.epoch;
    const generation = (state.viewGeneration = (state.viewGeneration || 0) + 1);
    const alive = app.pageAlive || (() => true);
    batch(() => {
      state.tab = tab;
      state.searchText = '';
      state.query = '';
      state.viewError = '';
      state.viewLoading = tab === 'bookmarks';
      state.focus = 0;
    });
    app.view.body.scrollTop = 0;
    if (tab === 'pulls') await app.loadPulls();
    else if (tab === 'bookmarks') {
      try {
        const publicData = await app.rpc('STATE');
        if (!alive() || epoch !== state.epoch || generation !== state.viewGeneration || state.tab !== tab) return;
        batch(() => {
          state.public = publicData;
          state.loading = false;
        });
      } catch (error) {
        if (alive() && epoch === state.epoch && generation === state.viewGeneration && state.tab === tab)
          batch(() => {
            state.loading = false;
            state.error = error.message;
          });
      }
    }
  }

  /** Clears caches and reloads only if the page, tab, mode and view remain current. */
  async function refresh() {
    const epoch = state.epoch;
    const tab = state.tab;
    const mode = state.mode;
    const viewGeneration = state.viewGeneration;
    const alive = app.pageAlive || (() => true);
    const generation = (state.refreshGeneration = (state.refreshGeneration || 0) + 1);
    const current = () =>
      alive() &&
      epoch === state.epoch &&
      generation === state.refreshGeneration &&
      viewGeneration === state.viewGeneration &&
      tab === state.tab &&
      mode === state.mode;
    try {
      await app.rpc('REFRESH');
      if (!current()) return;
      state.branches = null;
      state.branchGeneration = (state.branchGeneration || 0) + 1;
      app.closeBranches();
      if (tab === 'pulls') await app.loadPulls();
      else if (tab === 'bookmarks') {
        const publicData = await app.rpc('STATE');
        if (!current()) return;
        batch(() => {
          state.public = publicData;
          state.loading = false;
          state.error = '';
        });
      } else {
        const info = await app.rpc('INIT');
        if (!current()) return;
        state.info = info;
        await app.loadFiles(epoch);
      }
    } catch (error) {
      if (!current()) return;
      batch(() => {
        if (tab === 'files') {
          state.filesLoading = false;
          state.filesError = error.message;
        }
        state.loading = false;
        state.error = error.message;
      });
    }
  }
  createRenderEffect(on([() => state.context, () => state.info, () => state.public], updateHeader), undefined, {
    name: 'repository header',
  });
  return {loadPage, updateHeader, selectTab, refresh};
}
