import assert from 'node:assert/strict';
import test from 'node:test';
import {createNavigation} from '../src/content/navigation.js';
import {createBranches} from '../src/content/sidebar/branches.js';
import {createPulls} from '../src/content/sidebar/pulls.js';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((success, failure) => {resolve = success; reject = failure;});
  return {promise, resolve, reject};
}
// Detached elements are enough for the branch popover messages checked here.
globalThis.document ??= {createElement: () => ({setAttribute() {}, addEventListener() {}, append() {}})};

function sidebar(rpc) {
  const state = {epoch: 1, tab: 'files', filter: 'approved', branches: null, info: {ref: 'main'},
    public: {}, loading: false, error: '', pulls: [], totalPulls: 0};
  const calls = {headers: 0, files: [], branches: 0, branchMessage: ''};
  const view = {branchPopover: {hidden: true}, branchSearch: {value: '', focus() {}},
    branchList: {replaceChildren(node) {calls.branchMessage = node.textContent;}}, branchButton: {setAttribute() {}}};
  const app = {state, rpc, calls, view, run: callback => callback, render() {},
    renderBranches() {calls.branches++;}, updateHeader() {calls.headers++;},
    async loadFiles(epoch = state.epoch) {calls.files.push(epoch);},
  };
  // Execute the production handlers, controlling RPC completion rather than copying their logic.
  const {toggleBranches} = createBranches(app); const {loadPulls} = createPulls(app); const {refresh} = createNavigation(app);
  return Object.assign(app, {state, branchPopover: view.branchPopover, openBranches: toggleBranches, loadPulls, refresh,
    closeBranches() {view.branchPopover.hidden = true;}});
}

test('branches from the previous repository do not enter the current branch cache', async () => {
  const old = deferred(); let requests = 0;
  const ui = sidebar(() => ++requests === 1 ? old.promise : Promise.resolve([{name: 'current'}]));
  const pending = ui.openBranches();
  ui.state.epoch++; ui.state.branches = null; ui.branchPopover.hidden = true;
  old.resolve([{name: 'previous'}]); await pending;
  assert.equal(ui.state.branches, null); assert.equal(ui.calls.branches, 0);
  await ui.openBranches();
  assert.equal(requests, 2); assert.equal(ui.state.branches[0].name, 'current'); assert.equal(ui.calls.branches, 1);
});

test('an old branch error cannot replace the new repository branch list', async () => {
  const old = deferred(); const ui = sidebar(() => old.promise);
  const pending = ui.openBranches();
  ui.state.epoch++; ui.calls.branchMessage = 'Current branches';
  old.reject(new Error('Previous repository failed')); await pending;
  assert.equal(ui.calls.branchMessage, 'Current branches');
});

test('refresh cannot install old metadata or reload files after navigation', async () => {
  const old = deferred(); const started = deferred(); const requests = [];
  const ui = sidebar(type => {
    requests.push(type);
    if (type === 'INIT') {started.resolve(); return old.promise;}
    return Promise.resolve(true);
  });
  const pending = ui.refresh(); await started.promise;
  assert.deepEqual(requests, ['REFRESH', 'INIT']);
  ui.state.epoch++; const current = {ref: 'current'}; ui.state.info = current;
  old.resolve({ref: 'previous'}); await pending;
  assert.equal(ui.state.info, current); assert.equal(ui.calls.headers, 0); assert.equal(ui.calls.files.length, 0);
});

test('navigation during cache clearing stops refresh before another repository request', async () => {
  const old = deferred(); const requests = [];
  const ui = sidebar(type => {requests.push(type); return old.promise;});
  const pending = ui.refresh(); ui.state.epoch++;
  old.resolve(true); await pending;
  assert.deepEqual(requests, ['REFRESH']);
});

test('refresh applies current metadata and reloads the current files', async () => {
  const info = {ref: 'current'};
  const ui = sidebar(type => Promise.resolve(type === 'INIT' ? info : true));
  await ui.refresh();
  assert.equal(ui.state.info, info); assert.equal(ui.calls.headers, 1); assert.deepEqual(Array.from(ui.calls.files), [1]);
});

test('a late bookmark refresh does not replace state after navigation', async () => {
  const old = deferred(); const started = deferred();
  const ui = sidebar(type => {
    if (type === 'STATE') {started.resolve(); return old.promise;}
    return Promise.resolve(true);
  });
  ui.state.tab = 'bookmarks'; const pending = ui.refresh(); await started.promise;
  ui.state.epoch++; const current = {bookmarks: ['current']}; ui.state.public = current;
  old.resolve({bookmarks: ['previous']}); await pending;
  assert.equal(ui.state.public, current);
});

test('a failed old review filter cannot hide successful results for the current filter', async () => {
  const old = deferred();
  const ui = sidebar((type, value) => value.filter === 'approved' ? old.promise : Promise.resolve({pulls: [{number: 42}], total: 1}));
  const pending = ui.loadPulls(); ui.state.filter = 'all'; await ui.loadPulls();
  old.reject(new Error('Approval API unavailable')); await pending;
  assert.equal(ui.state.error, ''); assert.equal(ui.state.loading, false);
  assert.equal(ui.state.pulls[0].number, 42); assert.equal(ui.state.totalPulls, 1);
});

test('an error for the current review filter remains visible', async () => {
  const ui = sidebar(() => Promise.reject(new Error('Current filter unavailable')));
  await ui.loadPulls();
  assert.equal(ui.state.error, 'Current filter unavailable'); assert.equal(ui.state.loading, false);
});
