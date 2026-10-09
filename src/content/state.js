/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
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
 */

import {defaults} from '../shared/preferences.js';
import {makeTree} from '../shared/tree.js';
import {createSetSignal, createSignal} from './reactive.js';
import {createDelayed} from './reactive-dom.js';

/** View values use accessors; request generations, entries, tree and focus stay imperative. */
const viewFields = [
  'context',
  'info',
  'preferences',
  'public',
  'tab',
  'mode',
  'searchText',
  'filter',
  'flat',
  'lazy',
  'filesLoading',
  'filesError',
  'viewLoading',
  'viewError',
  'diff',
  'pulls',
  'loadingAll',
  'selected',
];

/**
 * Returns the initial state of a sidebar.
 *
 * Files status is stored once. `loading`/`error` select Files or list status
 * without copying it when tabs switch. `query` debounces `searchText`.
 *
 * @returns {Object}
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
    searchText: '',
    filter: 'all',
    entries: [],
    tree: makeTree([]),
    expanded: new Set(),
    flat: [],
    lazy: false,
    viewLoading: false,
    viewError: '',
    diff: null,
    branches: null,
    pulls: [],
    loadingAll: false,
    selected: '',
    focus: 0,
  };
  for (const key of viewFields) {
    const [get, set] = createSignal(state[key], {
      name: key,
      equals: key === 'preferences' ? samePreferences : Object.is,
    });
    Object.defineProperty(state, key, {get, set, enumerable: true});
  }
  const [get, set] = createSetSignal(state.expanded, {name: 'expanded'});
  Object.defineProperty(state, 'expanded', {get, set, enumerable: true});
  const query = createDelayed(() => state.searchText, 100, '');
  Object.defineProperty(state, 'query', {get: query, set: query.set, enumerable: true});
  for (const [key, files, view] of [
    ['loading', 'filesLoading', 'viewLoading'],
    ['error', 'filesError', 'viewError'],
  ])
    Object.defineProperty(state, key, {
      get: () => (state.tab === 'files' ? state[files] : state[view]),
      set: value => {
        state[state.tab === 'files' ? files : view] = value;
      },
      enumerable: true,
    });
  return state;
}

/** Normalized preferences contain scalar values; equal broker echoes need no new layout. */
function samePreferences(previous, next) {
  return (
    Object.keys(previous).length === Object.keys(next).length &&
    Object.keys(next).every(key => previous[key] === next[key])
  );
}
