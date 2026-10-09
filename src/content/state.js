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
 * View fields are backed by signals (`shared/reactive.js`): they are read
 * and written as plain properties, and the render effects of the sidebar
 * re-run after a field they read is replaced. A value mutated in place
 * notifies nobody, so view fields are always replaced (`expanded` gets a
 * new Set compared by contents, `preferences` a new object compared by
 * fields). `flat`, the visible tree rows, is
 * derived from `tree`, `expanded` and `query` and computed once per change.
 *
 * @module content/state
 */
import {defaults} from '../shared/preferences.js';
import {createMemo, createSetSignal, createSignal} from '../shared/reactive.js';
import {flatten, makeTree} from '../shared/tree.js';

/**
 * Fields that render effects depend on. Generations, `entries`, `branches`,
 * `totalPulls` and `focus` stay plain: they are read only by handlers or by
 * the virtualized row renderer.
 */
const viewFields = [
  'filesLoading',
  'filesError',
  'context',
  'info',
  'preferences',
  'public',
  'tab',
  'mode',
  'query',
  'filter',
  'tree',
  'expanded',
  'lazy',
  'loading',
  'error',
  'diff',
  'pulls',
  'loadingAll',
  'selected',
];

/**
 * Whether two objects have the same own fields and values, so an echoed
 * preference write (for example the window pin) does not lay out again.
 */
function sameFields(previous, next) {
  const keys = Object.keys(previous);
  return keys.length === Object.keys(next).length && keys.every(key => Object.is(previous[key], next[key]));
}

/**
 * Returns the initial state of a sidebar.
 *
 * `filesLoading`/`filesError` hold the status of the Files tab;
 * `loading`/`error` hold the status of the request and bookmark tabs.
 *
 * @returns {Object} The state with signal-backed view fields.
 */
export function createState() {
  const state = {
    epoch: 0,
    filesGeneration: 0,
    viewGeneration: 0,
    refreshGeneration: 0,
    branchGeneration: 0,
    filesLoading: false,
    filesError: '',
    context: null,
    info: null,
    preferences: {...defaults},
    public: null,
    tab: 'files',
    mode: 'files',
    query: '',
    filter: 'all',
    entries: [],
    tree: makeTree([]),
    expanded: new Set(),
    lazy: false,
    loading: false,
    error: '',
    diff: null,
    branches: null,
    pulls: [],
    totalPulls: 0,
    loadingAll: false,
    selected: '',
    focus: 0,
  };
  for (const key of viewFields) {
    const [get, set] =
      key === 'expanded'
        ? createSetSignal(state[key], {name: key})
        : createSignal(state[key], {name: key, equals: key === 'preferences' ? sameFields : Object.is});
    Object.defineProperty(state, key, {get, set, enumerable: true});
  }
  Object.defineProperty(state, 'flat', {
    get: createMemo(() => flatten(state.tree, state.expanded, state.query), [], {name: 'flat'}),
    enumerable: true,
  });
  return state;
}
