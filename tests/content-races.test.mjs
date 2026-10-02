import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const deferred = () => {let resolve; const promise = new Promise(value => {resolve = value;}); return {promise, resolve};};

function sidebar(rpc) {
  const sandbox = vm.createContext({URL});
  vm.runInContext(readFileSync(new URL('../core.js', import.meta.url), 'utf8'), sandbox);
  const folder = {path: 'src', type: 'tree', sha: 'a'.repeat(40), loaded: false};
  const state = {epoch: 1, filesGeneration: 0, mode: 'files', entries: [folder], selected: '', expanded: new Set(),
    context: {origin: 'https://github.com', provider: 'github', owner: 'sample', repo: 'repo'}, info: {ref: 'main', treeSha: 'b'.repeat(40)}};
  Object.assign(sandbox, {C: sandbox.CodeTree, state, rpc, loadingFolders: new Map(), expansionMemory: new Map(),
    body: {scrollTop: 0}, render() {}, updateTree() {}, async prepareHeaderButtons() {}});
  state.tree = sandbox.C.makeTree(state.entries);
  // Run the actual production functions with controlled RPC completion order.
  // DOM rendering is covered separately in the browser, not simulated here.
  for (const name of ['expansionKey', 'rememberExpansion', 'loadFiles', 'loadFolder', 'toggleFolder', 'loadAllFolders']) {
    const prefix = `^  (?:async )?function ${name}\\(`;
    const match = source.match(new RegExp(`${prefix}[^\\n]*}$`, 'm')) || source.match(new RegExp(`${prefix}[^]*?^  }`, 'm'));
    assert.ok(match, `Production function ${name} must exist`);
    vm.runInContext(match[0], sandbox);
  }
  return sandbox;
}

test('an old folder reply cannot insert repository files into the changes tree', async () => {
  const response = deferred();
  const ui = sidebar(type => type === 'DIFF' ? Promise.resolve({files: [{filename: 'changed.js'}], comments: [], viewed: {}}) : response.promise);
  const pending = ui.toggleFolder(ui.state.tree.nodes.get('src'));
  ui.state.mode = 'changes'; await ui.loadFiles();
  response.resolve({entries: [{path: 'old.js', type: 'blob'}]}); await pending;
  assert.deepEqual(Array.from(ui.state.entries, entry => entry.path), ['changed.js']);
  assert.equal(ui.state.expanded.has('src'), false);
});

test('old folder cleanup preserves a newer request for the same path after refresh', async () => {
  const old = deferred(); const fresh = deferred(); let folderCalls = 0;
  const ui = sidebar((type, value) => value.path ? (++folderCalls === 1 ? old.promise : fresh.promise) : Promise.resolve({entries: [{path: 'src', type: 'tree', loaded: false}], lazy: true}));
  const oldLoad = ui.loadFolder(ui.state.tree.nodes.get('src'));
  await ui.loadFiles();
  const newLoad = ui.loadFolder(ui.state.tree.nodes.get('src'));
  const newPending = ui.loadingFolders.get('src');
  old.resolve({entries: [{path: 'old.js', type: 'blob'}]}); await oldLoad;
  assert.equal(ui.loadingFolders.get('src'), newPending);
  assert.deepEqual(Array.from(ui.state.entries, entry => entry.path), ['src']);
  fresh.resolve({entries: [{path: 'new.js', type: 'blob'}]}); await newLoad;
  assert.deepEqual(Array.from(ui.state.entries, entry => entry.path), ['src', 'src/new.js']);
  assert.equal(ui.loadingFolders.size, 0);
});

test('loading all folders stops at a refreshed tree instead of continuing into it', async () => {
  const response = deferred(); let folderCalls = 0;
  const ui = sidebar((type, value) => {
    if (value.path) {folderCalls++; return response.promise;}
    return Promise.resolve({entries: [{path: 'next', type: 'tree', loaded: false}], lazy: true});
  });
  const pending = ui.loadAllFolders();
  await ui.loadFiles();
  response.resolve({entries: []}); await pending;
  assert.equal(folderCalls, 1); assert.equal(ui.state.loadingAll, false);
  assert.equal(ui.state.lazy, true);
  assert.deepEqual(Array.from(ui.state.entries, entry => entry.path), ['next']);
});

test('overlapping loads in the same mode keep the newest tree', async () => {
  const old = deferred(); const fresh = deferred(); let calls = 0;
  const ui = sidebar(() => ++calls === 1 ? old.promise : fresh.promise);
  const first = ui.loadFiles(); const second = ui.loadFiles();
  fresh.resolve({entries: [{path: 'new.js', type: 'blob'}], lazy: false}); await second;
  old.resolve({entries: [{path: 'old.js', type: 'blob'}], lazy: false}); await first;
  assert.deepEqual(Array.from(ui.state.entries, entry => entry.path), ['new.js']);
});
