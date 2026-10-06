/**
 * Mutable sidebar state.
 *
 * Asynchronous replies are applied only if the state still describes the
 * request that started them. Counters identify each request generation:
 *
 * - `epoch`: the page; increments on every navigation.
 * - `filesGeneration`: tree loads and mode switches.
 * - `viewGeneration`: tab switches and request-list loads.
 * - `refreshGeneration`: Refresh.
 * - `branchGeneration`: branch-list loads.
 *
 * @module content/state
 */
import {defaults} from '../shared/preferences.js';
import {makeTree} from '../shared/tree.js';

/**
 * Returns the initial state of a sidebar.
 *
 * `files*` fields keep the tree-loading status while another tab is shown;
 * `loading`/`error` describe the visible tab.
 *
 * @returns {Object}
 */
export function createState() {
  return {
    epoch: 0, filesGeneration: 0, viewGeneration: 0, refreshGeneration: 0, branchGeneration: 0,
    filesLoading: false, filesError: '', context: null, info: null, preferences: {...defaults}, public: null,
    tab: 'files', mode: 'files', query: '', filter: 'all', entries: [], tree: makeTree([]),
    expanded: new Set(), flat: [], lazy: false, loading: false, error: '', diff: null,
    branches: null, pulls: [], totalPulls: 0, loadingAll: false, selected: '', focus: 0,
  };
}
