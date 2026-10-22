/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Branch switcher popover. File pages keep their resolved path when switching branches.
 */

import {icon} from '../../shared/icons.js';
import {blobURL, treeURL} from '../../shared/routes.js';
import {el} from '../dom.js';

/** Creates the branches feature: `closeBranches`, `toggleBranches` and `renderBranches`. */
export function createBranches(app) {
  const {state} = app;
  const {branchButton, branchSearch, branchList, branchPopover} = app.view;

  /** Hides the branch popover. */
  function closeBranches() {
    branchPopover.hidden = true;
    branchButton.setAttribute('aria-expanded', 'false');
  }

  /**
   * Opens the popover and loads branches once per page and Refresh, or closes it.
   *
   * Replies for an older page or branch generation are discarded.
   */
  async function toggleBranches() {
    if (!branchPopover.hidden) {
      closeBranches();
      return;
    }
    branchPopover.hidden = false;
    branchButton.setAttribute('aria-expanded', 'true');
    branchSearch.value = '';
    branchList.replaceChildren(el('div', {class: 'empty', text: 'Loading branches…'}));
    branchSearch.focus();
    const epoch = state.epoch;
    const generation = state.branchGeneration;
    const alive = app.pageAlive || (() => true);
    try {
      const branches = state.branches || (await app.rpc('BRANCHES'));
      if (!alive() || epoch !== state.epoch || generation !== state.branchGeneration) return;
      state.branches = branches;
      app.renderBranches();
    } catch (error) {
      if (alive() && epoch === state.epoch && generation === state.branchGeneration)
        branchList.replaceChildren(el('div', {class: 'empty', text: error.message}));
    }
  }

  /** Renders matching branches; file pages keep the broker-resolved path, other pages open the branch root. */
  function renderBranches() {
    const query = branchSearch.value.toLowerCase();
    const list = (state.branches || []).filter(branch => branch.name.toLowerCase().includes(query));
    branchList.replaceChildren();
    for (const branch of list) {
      const item = el(
        'button',
        {
          type: 'button',
          class: 'branch-item',
          onClick: app.selectFileBranch
            ? app.run(() => app.selectFileBranch(branch.name))
            : () => {
                const path = ['blob', 'blame', 'raw'].includes(state.context.kind) ? state.info?.path : '';
                location.assign(path ? blobURL(state.context, branch.name, path) : treeURL(state.context, branch.name));
              },
        },
        [branch.name === state.info?.ref ? icon('check') : icon('branch'), el('span', {text: branch.name})],
      );
      if (branch.name === state.info?.repository.default_branch)
        item.append(el('small', {class: 'default-tag', text: 'default'}));
      branchList.append(item);
    }
    if (!list.length) branchList.append(el('div', {class: 'empty', text: 'No matching branches.'}));
  }
  return {closeBranches, toggleBranches, renderBranches};
}
