/* Mutable sidebar state. Generations reject replies that belong to an older page, view or request. */
import {defaults} from '../shared/preferences.js';
import {makeTree} from '../shared/tree.js';

export function createState() {
  return {
    epoch: 0, filesGeneration: 0, viewGeneration: 0, refreshGeneration: 0, branchGeneration: 0,
    filesLoading: false, filesError: '', context: null, info: null, preferences: {...defaults}, public: null,
    tab: 'files', mode: 'files', query: '', filter: 'all', entries: [], tree: makeTree([]),
    expanded: new Set(), flat: [], lazy: false, loading: false, error: '', diff: null,
    branches: null, pulls: [], totalPulls: 0, loadingAll: false, selected: '', focus: 0,
  };
}
