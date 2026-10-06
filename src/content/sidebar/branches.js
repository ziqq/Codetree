/* Branch switcher popover. */
import {icon} from '../../shared/icons.js';
import {treeURL} from '../../shared/routes.js';
import {el} from '../dom.js';

export function createBranches(app) {
  const {state} = app;
  const {branchButton, branchSearch, branchList, branchPopover} = app.view;

  function closeBranches() { branchPopover.hidden = true; branchButton.setAttribute('aria-expanded', 'false'); }
  async function toggleBranches() {
    if (!branchPopover.hidden) { closeBranches(); return; }
    branchPopover.hidden = false; branchButton.setAttribute('aria-expanded', 'true');
    branchSearch.value = ''; branchList.replaceChildren(el('div', {class: 'empty', text: 'Loading branches…'})); branchSearch.focus();
    const epoch = state.epoch; const generation = state.branchGeneration;
    try {
      const branches = state.branches || await app.rpc('BRANCHES');
      if (epoch !== state.epoch || generation !== state.branchGeneration) return;
      state.branches = branches; app.renderBranches();
    } catch (error) { if (epoch === state.epoch && generation === state.branchGeneration) branchList.replaceChildren(el('div', {class: 'empty', text: error.message})); }
  }
  function renderBranches() {
    const query = branchSearch.value.toLowerCase();
    const list = (state.branches || []).filter(branch => branch.name.toLowerCase().includes(query));
    branchList.replaceChildren();
    for (const branch of list) {
      const item = el('button', {type: 'button', class: 'branch-item', onClick: () => {
        location.assign(treeURL(state.context, branch.name));
      }}, [branch.name === state.info?.ref ? icon('check') : icon('branch'), el('span', {text: branch.name})]);
      if (branch.name === state.info?.repository.default_branch) item.append(el('small', {class: 'default-tag', text: 'default'}));
      branchList.append(item);
    }
    if (!list.length) branchList.append(el('div', {class: 'empty', text: 'No matching branches.'}));
  }
  return {closeBranches, toggleBranches, renderBranches};
}
