/* Repository/changes tree loading, lazy folders and remembered expansion. */
import {makeTree} from '../../shared/tree.js';

export function createFiles(app) {
  const {state} = app;
  const expansionMemory = new Map(); const loadingFolders = new Map();

  function expansionKey() { return `${state.context?.origin}/${state.context?.owner}/${state.context?.repo}:${state.info?.ref}:${state.mode}`; }
  function rememberExpansion() { expansionMemory.set(expansionKey(), new Set(state.expanded)); }
  async function loadFiles(epoch = state.epoch) {
    const mode = state.mode; const generation = ++state.filesGeneration;
    const current = () => epoch === state.epoch && generation === state.filesGeneration;
    loadingFolders.clear(); state.loadingAll = false;
    state.filesLoading = true; state.filesError = '';
    if (state.tab === 'files') { state.loading = true; state.error = ''; }
    app.render();
    try {
      if (mode === 'changes') {
        const diff = await app.rpc('DIFF');
        if (!current()) return;
        state.diff = diff;
        await app.prepareHeaderButtons(diff, epoch);
        if (!current()) return;
        const grouped = new Map();
        for (const comment of diff.comments) {
          if (!grouped.has(comment.path)) grouped.set(comment.path, []);
          grouped.get(comment.path).push(comment);
        }
        state.entries = diff.files.map(file => ({...file, path: file.filename, type: 'blob', comments: grouped.get(file.filename) || [], viewed: diff.viewed[file.filename] === 'VIEWED'}));
        state.lazy = false;
      } else {
        const result = state.info.treeSha ? await app.rpc('TREE', {sha: state.info.treeSha}) : {entries: [], lazy: false};
        if (!current()) return;
        state.entries = result.entries; state.lazy = result.lazy;
      }
      state.tree = makeTree(state.entries);
      state.expanded = expansionMemory.get(expansionKey()) || new Set();
      if (mode === 'changes' && !state.expanded.size) {
        for (const node of state.tree.nodes.values()) if (node.type === 'tree' && node.path) state.expanded.add(node.path);
      }
      let path = state.selected;
      while (path.includes('/')) { path = path.slice(0, path.lastIndexOf('/')); state.expanded.add(path); }
      if (mode === 'files') {
        while (current()) {
          const folders = Array.from(state.tree.nodes.values()).filter(node => node.type === 'tree' && !node.loaded && state.expanded.has(node.path)).slice(0, 4);
          if (!folders.length) break;
          await Promise.all(folders.map(loadFolder));
        }
        if (!current()) return;
      }
      state.filesLoading = false;
      if (state.tab === 'files') { state.loading = false; app.view.body.scrollTop = 0; }
      app.render();
    } catch (error) {
      if (current()) {
        state.filesLoading = false; state.filesError = error.message;
        if (state.tab === 'files') { state.loading = false; state.error = error.message; }
        app.render();
      }
    }
  }
  async function toggleFolder(node) {
    const epoch = state.epoch; const generation = state.filesGeneration;
    if (state.expanded.has(node.path)) state.expanded.delete(node.path);
    else { state.expanded.add(node.path); if (!node.loaded) await loadFolder(node); }
    if (epoch !== state.epoch || generation !== state.filesGeneration) return;
    rememberExpansion(); app.updateTree();
  }
  async function loadFolder(node) {
    if (node.loaded || loadingFolders.has(node.path)) return loadingFolders.get(node.path);
    const epoch = state.epoch; const generation = state.filesGeneration;
    const promise = app.rpc('TREE', {sha: state.context.provider === 'gitlab' ? state.info.commitSha : node.sha, path: node.path, recursive: false, lazyChildren: true}).then(result => {
      if (epoch !== state.epoch || generation !== state.filesGeneration) return;
      const parent = state.entries.find(entry => entry.path === node.path); if (parent) parent.loaded = true;
      const known = new Set(state.entries.map(entry => entry.path));
      for (const entry of result.entries) {
        const path = `${node.path}/${entry.path}`;
        if (!known.has(path)) state.entries.push({...entry, path});
      }
      state.tree = makeTree(state.entries); app.updateTree();
    }).finally(() => { if (loadingFolders.get(node.path) === promise) loadingFolders.delete(node.path); });
    loadingFolders.set(node.path, promise); return promise;
  }
  async function loadAllFolders() {
    if (state.loadingAll) return;
    const epoch = state.epoch; const generation = state.filesGeneration;
    const current = () => epoch === state.epoch && generation === state.filesGeneration;
    state.loadingAll = true; app.render();
    try {
      while (current()) {
        const folders = Array.from(state.tree.nodes.values()).filter(node => node.type === 'tree' && !node.loaded).slice(0, 4);
        if (!folders.length) { state.lazy = false; break; }
        await Promise.all(folders.map(loadFolder));
      }
    } finally { if (current()) { state.loadingAll = false; app.render(); } }
  }
  return {expansionMemory, loadingFolders, expansionKey, rememberExpansion, loadFiles, toggleFolder, loadFolder, loadAllFolders};
}
