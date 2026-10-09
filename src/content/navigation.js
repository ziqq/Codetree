/**
 * Page navigation, repository header, tabs and Refresh.
 *
 * Every page load runs in a page root: navigation disposes the previous
 * root, which closes the viewer, removes the native header buttons, closes
 * the branch popover and forgets pending folder loads, and stops the async
 * work of the previous page in addition to its request generation.
 *
 * @module content/navigation
 */
import {batch, createAlive, createRenderEffect, createRoot, getOwner, onCleanup, untrack} from '../shared/reactive.js';
import {repoURL} from '../shared/routes.js';
import {makeTree} from '../shared/tree.js';
import {el} from './dom.js';
import {currentContext, providerName} from './page.js';

/** Creates the navigation feature: `loadPage`, `updateHeader`, `bindHeader`, `selectTab` and `refresh`. */
export function createNavigation(app) {
  const {state} = app;
  let disposePage = () => {};

  /**
   * Disposes the previous page root and creates the root of the new page;
   * its owner is `app.pageOwner`.
   *
   * @returns {() => boolean} Whether the new page is still shown.
   */
  function createPageRoot() {
    disposePage();
    return createRoot(dispose => {
      disposePage = dispose;
      app.pageOwner = getOwner();
      onCleanup(app.closeViewer);
      onCleanup(app.clearHeaderButtons);
      onCleanup(app.closeBranches);
      onCleanup(() => app.loadingFolders.clear());
      return createAlive();
    });
  }

  /**
   * Resets the sidebar for the current URL and loads its repository.
   *
   * Starts a new epoch, so replies for the previous page are ignored.
   *
   * @param {boolean} [force=false] Reload even if the URL did not change.
   */
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
    const alive = createPageRoot();
    const current = () => alive() && epoch === state.epoch;
    batch(() => {
      state.context = context;
      state.info = null;
      state.diff = null;
      state.branches = null;
      state.loading = false;
      state.error = '';
      state.filesLoading = true;
      state.filesError = '';
      state.entries = [];
      state.tree = makeTree([]);
      state.query = '';
      state.mode = context?.kind === 'pull' || context?.kind === 'commit' ? 'changes' : 'files';
      state.tab = 'files';
      state.selected = '';
      state.focus = 0;
      state.lazy = false;
      state.loadingAll = false;
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

  /** Renders the repository name, branch label, account selector and bookmark state. */
  function updateHeader() {
    const {repository, tabButtons, branchLabel, branchButton, accountSelect, bookmarkButton} = app.view;
    const context = state.context;
    repository.replaceChildren();
    if (!context) return;
    repository.append(
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

  /** Binds the header to the repository, its metadata and the public state; called once inside the app root. */
  function bindHeader() {
    createRenderEffect(
      () => {
        void [state.context, state.info, state.public];
        untrack(updateHeader);
      },
      undefined,
      {name: 'header'},
    );
  }

  /**
   * Shows the Files, Pull/Merge requests or Bookmarks tab.
   *
   * @param {'files'|'pulls'|'bookmarks'} tab
   */
  async function selectTab(tab) {
    const epoch = state.epoch;
    const generation = (state.viewGeneration = (state.viewGeneration || 0) + 1);
    app.view.body.scrollTop = 0;
    // The synchronous start of a request load joins the batch, so the new tab renders once.
    await batch(() => {
      state.tab = tab;
      state.query = '';
      // The Files tab keeps its own tree status; the other tabs load again.
      state.loading = tab !== 'files';
      state.error = '';
      if (tab === 'pulls') return app.loadPulls();
      if (tab === 'bookmarks') return loadBookmarks(epoch, generation);
    });
  }

  /** Loads the public state, including bookmarks, for the Bookmarks tab opened as view [generation]. */
  async function loadBookmarks(epoch, generation) {
    const current = () => epoch === state.epoch && generation === state.viewGeneration && state.tab === 'bookmarks';
    try {
      const publicData = await app.rpc('STATE');
      if (!current()) return;
      batch(() => {
        state.public = publicData;
        state.loading = false;
      });
    } catch (error) {
      if (current())
        batch(() => {
          state.loading = false;
          state.error = error.message;
        });
    }
  }

  /**
   * Clears the worker caches and reloads the visible tab.
   *
   * Stops if the page, tab, mode or view changes while clearing.
   */
  async function refresh() {
    const epoch = state.epoch;
    const tab = state.tab;
    const mode = state.mode;
    const viewGeneration = state.viewGeneration;
    const generation = (state.refreshGeneration = (state.refreshGeneration || 0) + 1);
    const current = () =>
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
        state.public = publicData;
      } else {
        const info = await app.rpc('INIT');
        if (!current()) return;
        state.info = info;
        app.updateHeader();
        await app.loadFiles(epoch);
      }
    } catch (error) {
      if (!current()) return;
      if (tab === 'files')
        batch(() => {
          state.filesLoading = false;
          state.filesError = error.message;
        });
      else
        batch(() => {
          state.loading = false;
          state.error = error.message;
        });
    }
  }
  return {loadPage, updateHeader, bindHeader, selectTab, refresh};
}
