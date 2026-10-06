/**
 * Renders the active tab, its toolbar and notices.
 *
 * @module content/sidebar/render
 */
import {button, el, empty} from '../dom.js';
import {providerName, requestName} from '../page.js';

/** Creates the render feature: `render`. */
export function createRender(app) {
  const {state, run} = app;
  const {tabButtons, body, spacer, search, toolbar, notice} = app.view;

  /** Renders the toolbar of the active tab: tree mode or request filter, count and actions. */
  function renderToolbar() {
    toolbar.replaceChildren();
    if (state.tab === 'files') {
      if (['pull', 'commit'].includes(state.context?.kind)) {
        const select = el('select', {'aria-label': 'File tree mode'}, [el('option', {value: 'files', text: 'Repository files'}), el('option', {value: 'changes', text: state.context.kind === 'pull' ? `${state.context.provider === 'gitlab' ? 'MR !' : 'PR #'}${state.context.number} changes` : 'Commit changes'})]);
        select.value = state.mode; select.addEventListener('change', run(async () => { app.rememberExpansion(); state.mode = select.value; await app.loadFiles(); })); toolbar.append(select);
      } else toolbar.append(el('span', {class: 'toolbar-title', text: state.lazy ? 'Loaded repository files' : 'Repository files'}));
      const files = state.flat.filter(node => node.type !== 'tree').length;
      toolbar.append(el('span', {class: 'count', text: String(state.query ? files : state.entries.filter(entry => entry.type !== 'tree').length)}));
      toolbar.append(button('collapse', 'Collapse folders', () => { state.expanded.clear(); app.rememberExpansion(); app.updateTree(); }));
    } else if (state.tab === 'pulls') {
      const name = requestName(state.context);
      const select = el('select', {'aria-label': `Filter ${name}s`});
      for (const [value, label] of [['all', `All open ${name}s`], ['awaiting', 'Requested from me'], ['reviewed', 'Reviewed by me'], ['changes', 'Changes requested'], ['approved', 'Approved'], ['unreviewed', 'No reviews']]) select.append(el('option', {value, text: label}));
      select.value = state.filter; select.addEventListener('change', run(async () => { state.filter = select.value; await app.loadPulls(); })); toolbar.append(select, el('span', {class: 'count', text: String(state.pulls.length)}));
    } else toolbar.append(el('span', {class: 'toolbar-title', text: 'Saved on this browser'}), el('span', {class: 'count', text: String(state.public?.bookmarks.length || 0)}));
    toolbar.append(button('refresh', 'Refresh sidebar', run(() => app.refresh())));
  }

  /** Renders the active tab, including its loading, error and empty states. */
  function render() {
    const name = requestName(state.context);
    for (const [id, tab] of Object.entries(tabButtons)) tab.setAttribute('aria-selected', String(id === state.tab));
    body.setAttribute('aria-label', state.tab === 'pulls' ? `${providerName(state.context)} ${name}s` : state.tab === 'bookmarks' ? 'Bookmarks' : 'Files');
    search.placeholder = state.tab === 'pulls' ? `Find a ${name}…` : state.tab === 'bookmarks' ? 'Find a bookmark…' : 'Find a file…';
    search.setAttribute('aria-label', state.tab === 'pulls' ? `Search ${name}s` : state.tab === 'bookmarks' ? 'Search bookmarks' : 'Search files and folders');
    notice.replaceChildren(); notice.className = 'notice';
    if (state.tab === 'files' && !state.loading && !state.error) app.updateTree(false);
    renderToolbar();
    if (state.loading) {
      const node = empty(`Loading from ${providerName(state.context)}`, 'Fetching repository data…', 'refresh'); node.classList.add('loading'); body.replaceChildren(node); return;
    }
    if (state.error) {
      const node = empty('Could not load this view', state.error, 'file');
      node.append(el('button', {class: 'small-button', text: 'Retry', onClick: run(() => app.refresh())}), el('button', {class: 'small-button', text: 'Open settings', onClick: run(() => app.rpc('OPTIONS'))})); body.replaceChildren(node); return;
    }
    if (state.tab === 'files') {
      if (state.lazy) {
        notice.append(document.createTextNode('Folders load as you open them. Search currently includes loaded files. '));
        notice.append(el('button', {type: 'button', text: state.loadingAll ? 'Loading all folders…' : 'Load all folders for search', onClick: run(() => app.loadAllFolders()), disabled: state.loadingAll ? '' : null}));
      }
      if (state.mode === 'changes' && state.diff) {
        if (state.diff.viewedMode === 'local') notice.append(document.createTextNode('Viewed marks are local to this browser. '));
        for (const warning of state.diff.warnings) notice.append(el('div', {text: warning}));
      }
      if (!state.flat.length) body.replaceChildren(empty(state.query ? 'No matching files' : 'No files', state.query ? 'Try a different file or folder name.' : 'This repository has no files to display.', 'folder'));
      else { if (!body.contains(spacer)) body.replaceChildren(spacer); app.requestTreeRender(); }
    } else if (state.tab === 'pulls') app.renderPulls();
    else app.renderBookmarks();
  }
  return {render};
}
