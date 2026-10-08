/**
 * Page navigation, repository header, tabs and Refresh.
 *
 * @module content/navigation
 */
import {repoURL} from '../shared/routes.js';
import {makeTree} from '../shared/tree.js';
import {el} from './dom.js';
import {currentContext, providerName} from './page.js';

/** Creates the navigation feature: `loadPage`, `updateHeader`, `selectTab` and `refresh`. */
export function createNavigation(app) {
  const {state} = app;

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
    app.closeViewer();
    app.clearHeaderButtons();
    app.closeBranches();
    app.loadingFolders.clear();
    state.context = context;
    state.info = null;
    state.diff = null;
    state.branches = null;
    state.loading = true;
    state.error = '';
    state.filesLoading = true;
    state.filesError = '';
    state.entries = [];
    state.tree = makeTree([]);
    state.flat = [];
    state.query = '';
    app.view.search.value = '';
    state.mode = context?.kind === 'pull' || context?.kind === 'commit' ? 'changes' : 'files';
    state.tab = 'files';
    state.selected = '';
    state.focus = 0;
    state.lazy = false;
    state.loadingAll = false;
    app.layout();
    if (!context) return;
    app.scheduleHeaderButtons();
    app.render();
    try {
      const [publicData, info] = await Promise.all([
        app.rpc('STATE').then(value => {
          if (epoch === state.epoch) {
            state.public = value;
            state.preferences = value.preferences;
            updateHeader();
            app.layout();
          }
          return value;
        }),
        app.rpc('INIT'),
      ]);
      if (epoch !== state.epoch) return;
      state.public = publicData;
      state.preferences = publicData.preferences;
      state.info = info;
      state.selected = info.path || '';
      updateHeader();
      app.layout();
      await app.loadFiles(epoch);
    } catch (error) {
      if (epoch !== state.epoch) return;
      state.filesLoading = false;
      state.filesError = error.message;
      if (state.tab === 'files') {
        state.loading = false;
        state.error = error.message;
      }
      updateHeader();
      app.render();
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

  /**
   * Shows the Files, Pull/Merge requests or Bookmarks tab.
   *
   * @param {'files'|'pulls'|'bookmarks'} tab
   */
  async function selectTab(tab) {
    const epoch = state.epoch;
    const generation = (state.viewGeneration = (state.viewGeneration || 0) + 1);
    state.tab = tab;
    state.query = '';
    app.view.search.value = '';
    state.error = '';
    state.loading = false;
    app.view.body.scrollTop = 0;
    if (tab === 'pulls') await app.loadPulls();
    else if (tab === 'bookmarks') {
      state.loading = true;
      app.render();
      try {
        const publicData = await app.rpc('STATE');
        if (epoch !== state.epoch || generation !== state.viewGeneration || state.tab !== tab) return;
        state.public = publicData;
        state.loading = false;
        updateHeader();
        app.render();
      } catch (error) {
        if (epoch === state.epoch && generation === state.viewGeneration && state.tab === tab) {
          state.loading = false;
          state.error = error.message;
          app.render();
        }
      }
    } else {
      state.loading = Boolean(state.filesLoading);
      state.error = state.filesError || '';
      app.render();
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
        app.render();
      } else {
        const info = await app.rpc('INIT');
        if (!current()) return;
        state.info = info;
        app.updateHeader();
        await app.loadFiles(epoch);
      }
    } catch (error) {
      if (!current()) return;
      if (tab === 'files') {
        state.filesLoading = false;
        state.filesError = error.message;
      }
      state.loading = false;
      state.error = error.message;
      app.render();
    }
  }
  return {loadPage, updateHeader, selectTab, refresh};
}
