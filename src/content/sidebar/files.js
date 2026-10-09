/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Loads the repository tree or the changed files of a request, including
 * lazily loaded folders, and remembers expanded folders per repository,
 * ref and mode.
 *
 * Every load captures the epoch and `filesGeneration`; replies for an
 * older page, mode or tree are discarded.
 */
import {batch} from '../../shared/reactive.js';
import {makeTree} from '../../shared/tree.js';

/** Creates the files feature; also exposes `expansionMemory` and `loadingFolders`. */
export function createFiles(app) {
  const {state} = app;
  const expansionMemory = new Map();
  const loadingFolders = new Map();

  /** Key of the remembered expansion: host, repository, ref and mode. */
  function expansionKey() {
    return `${state.context?.origin}/${state.context?.owner}/${state.context?.repo}:${state.info?.ref}:${state.mode}`;
  }

  /**
   * Loads [folders] together and rebuilds the tree once for all of them, so
   * loading many folders does not rebuild and re-render it per folder.
   *
   * @param {Array<Object>} folders Tree nodes of unloaded folders.
   * @param {() => boolean} current Whether the load still belongs to the shown tree.
   * @throws {*} The first folder error, after the folders that loaded are in the tree.
   */
  async function loadFolders(folders, current) {
    const results = await Promise.allSettled(folders.map(node => loadFolder(node, false)));
    if (current()) state.tree = makeTree(state.entries);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }

  /** Saves the expanded folders of the current tree. */
  function rememberExpansion() {
    expansionMemory.set(expansionKey(), new Set(state.expanded));
  }

  /**
   * Loads the tree for the current mode.
   *
   * `changes` loads the request diff (and prepares the native header
   * buttons); `files` loads the repository tree and then any expanded
   * folders that are not loaded yet, four at a time.
   *
   * @param {number} [epoch=state.epoch] The page this load belongs to.
   */
  async function loadFiles(epoch = state.epoch) {
    const mode = state.mode;
    const generation = ++state.filesGeneration;
    const current = () => epoch === state.epoch && generation === state.filesGeneration;
    loadingFolders.clear();
    batch(() => {
      state.loadingAll = false;
      state.filesLoading = true;
      state.filesError = '';
    });
    try {
      let lazy = false;
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
        state.entries = diff.files.map(file => ({
          ...file,
          path: file.filename,
          type: 'blob',
          comments: grouped.get(file.filename) || [],
          viewed: diff.viewed[file.filename] === 'VIEWED',
        }));
      } else {
        const result = state.info.treeSHA
          ? await app.rpc('TREE', {sha: state.info.treeSHA})
          : {entries: [], lazy: false};
        if (!current()) return;
        state.entries = result.entries;
        lazy = result.lazy;
      }
      const tree = makeTree(state.entries);
      const expanded = new Set(expansionMemory.get(expansionKey()));
      if (mode === 'changes' && !expanded.size) {
        for (const node of tree.nodes.values()) if (node.type === 'tree' && node.path) expanded.add(node.path);
      }
      let path = state.selected;
      while (path.includes('/')) {
        path = path.slice(0, path.lastIndexOf('/'));
        expanded.add(path);
      }
      // The tab still shows the loading state, so the new tree is not rendered until it is complete.
      batch(() => {
        state.lazy = lazy;
        state.tree = tree;
        state.expanded = expanded;
      });
      if (mode === 'files') {
        while (current()) {
          const folders = Array.from(state.tree.nodes.values())
            .filter(node => node.type === 'tree' && !node.loaded && state.expanded.has(node.path))
            .slice(0, 4);
          if (!folders.length) break;
          await loadFolders(folders, current);
        }
        if (!current()) return;
      }
      if (state.tab === 'files') app.view.body.scrollTop = 0;
      state.filesLoading = false;
    } catch (error) {
      if (current())
        batch(() => {
          state.filesLoading = false;
          state.filesError = error.message;
        });
    }
  }

  /** Expands or collapses a folder, loading its children first if needed. */
  async function toggleFolder(node) {
    const epoch = state.epoch;
    const generation = state.filesGeneration;
    if (state.expanded.has(node.path)) {
      const expanded = new Set(state.expanded);
      expanded.delete(node.path);
      state.expanded = expanded;
    } else {
      // Expand after the children are loaded, so the folder never shows as open and empty.
      if (!node.loaded) await loadFolder(node);
      if (epoch !== state.epoch || generation !== state.filesGeneration) return;
      state.expanded = new Set(state.expanded).add(node.path);
    }
    rememberExpansion();
  }

  /**
   * Loads the children of a lazy folder once; concurrent calls share the request.
   *
   * GitHub folders load by tree SHA, GitLab folders by path at the commit.
   *
   * @param {Object} node The folder node.
   * @param {boolean} [rebuild=true] Rebuild the tree after the reply; `false`
   *     when the caller rebuilds it once for several folders.
   */
  async function loadFolder(node, rebuild = true) {
    if (node.loaded || loadingFolders.has(node.path)) return loadingFolders.get(node.path);
    const epoch = state.epoch;
    const generation = state.filesGeneration;
    const promise = app
      .rpc('TREE', {
        sha: state.context.provider === 'gitlab' ? state.info.commitSHA : node.sha,
        path: node.path,
        recursive: false,
        lazyChildren: true,
      })
      .then(result => {
        if (epoch !== state.epoch || generation !== state.filesGeneration) return;
        const parent = state.entries.find(entry => entry.path === node.path);
        if (parent) parent.loaded = true;
        const known = new Set(state.entries.map(entry => entry.path));
        for (const entry of result.entries) {
          const path = `${node.path}/${entry.path}`;
          if (!known.has(path)) state.entries.push({...entry, path});
        }
        if (rebuild) state.tree = makeTree(state.entries);
      })
      .finally(() => {
        if (loadingFolders.get(node.path) === promise) loadingFolders.delete(node.path);
      });
    loadingFolders.set(node.path, promise);
    return promise;
  }

  /** Loads every lazy folder, four at a time, so search covers the whole repository. */
  async function loadAllFolders() {
    if (state.loadingAll) return;
    const epoch = state.epoch;
    const generation = state.filesGeneration;
    const current = () => epoch === state.epoch && generation === state.filesGeneration;
    state.loadingAll = true;
    try {
      while (current()) {
        const folders = Array.from(state.tree.nodes.values())
          .filter(node => node.type === 'tree' && !node.loaded)
          .slice(0, 4);
        if (!folders.length) {
          state.lazy = false;
          break;
        }
        await loadFolders(folders, current);
      }
    } finally {
      if (current()) state.loadingAll = false;
    }
  }
  return {
    expansionMemory,
    loadingFolders,
    expansionKey,
    rememberExpansion,
    loadFiles,
    toggleFolder,
    loadFolder,
    loadAllFolders,
  };
}
