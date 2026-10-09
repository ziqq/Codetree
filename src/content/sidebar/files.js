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

import {makeTree} from '../../shared/tree.js';
import {batch, withOwner} from '../reactive.js';

/** Creates the files feature; also exposes `expansionMemory` and `loadingFolders`. */
export function createFiles(app) {
  const {state} = app;
  const expansionMemory = new Map();
  const loadingFolders = new Map();

  /** Key of the remembered expansion: host, repository, ref and mode. */
  function expansionKey() {
    return `${state.context?.origin}/${state.context?.owner}/${state.context?.repo}:${state.info?.ref}:${state.mode}`;
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
    const alive = app.pageAlive || (() => true);
    const mode = state.mode;
    const generation = ++state.filesGeneration;
    const current = () => alive() && epoch === state.epoch && generation === state.filesGeneration;
    loadingFolders.clear();
    batch(() => {
      state.loadingAll = false;
      state.filesLoading = true;
      state.filesError = '';
    });
    try {
      let entries;
      let lazy;
      let diff;
      if (mode === 'changes') {
        diff = await app.rpc('DIFF');
        if (!current()) return;
        entries = diffEntries(diff);
        lazy = false;
      } else {
        const result = state.info.treeSHA
          ? await app.rpc('TREE', {sha: state.info.treeSHA})
          : {entries: [], lazy: false};
        if (!current()) return;
        entries = result.entries;
        lazy = result.lazy;
      }
      batch(() => {
        if (diff) state.diff = diff;
        state.entries = entries;
        state.lazy = lazy;
        state.tree = makeTree(entries);
        const expanded = new Set(expansionMemory.get(expansionKey()));
        if (mode === 'changes' && !expanded.size) {
          for (const node of state.tree.nodes.values()) if (node.type === 'tree' && node.path) expanded.add(node.path);
        }
        let path = state.selected;
        while (path.includes('/')) {
          path = path.slice(0, path.lastIndexOf('/'));
          expanded.add(path);
        }
        state.expanded = expanded;
        app.updateTree();
      });
      if (diff) {
        await app.prepareHeaderButtons(diff, epoch);
        if (!current()) return;
      }
      if (mode === 'files') {
        while (current()) {
          const folders = Array.from(state.tree.nodes.values())
            .filter(node => node.type === 'tree' && !node.loaded && state.expanded.has(node.path))
            .slice(0, 4);
          if (!folders.length) break;
          const results = await Promise.all(folders.map(node => loadFolder(node, false)));
          if (!current()) return;
          mergeFolders(results);
        }
        if (!current()) return;
      }
      if (state.tab === 'files') app.view.body.scrollTop = 0;
      state.filesLoading = false;
    } catch (error) {
      if (current()) {
        batch(() => {
          state.filesLoading = false;
          state.filesError = error.message;
        });
      }
    }
  }

  /** Expands or collapses a folder, loading its children first if needed. */
  async function toggleFolder(node) {
    const epoch = state.epoch;
    const generation = state.filesGeneration;
    const expanded = new Set(state.expanded);
    if (expanded.has(node.path)) {
      expanded.delete(node.path);
      state.expanded = expanded;
    } else {
      expanded.add(node.path);
      state.expanded = expanded;
      if (!node.loaded) await loadFolder(node);
    }
    if (epoch !== state.epoch || generation !== state.filesGeneration) return;
    rememberExpansion();
  }

  /**
   * Loads the children of a lazy folder once; concurrent calls share the request.
   *
   * GitHub folders load by tree SHA, GitLab folders by path at the commit.
   */
  async function loadFolder(node, commit = true) {
    if (node.loaded || loadingFolders.has(node.path)) return loadingFolders.get(node.path);
    const epoch = state.epoch;
    const generation = state.filesGeneration;
    const alive = app.pageAlive || (() => true);
    const promise = app
      .rpc('TREE', {
        sha: state.context.provider === 'gitlab' ? state.info.commitSHA : node.sha,
        path: node.path,
        recursive: false,
        lazyChildren: true,
      })
      .then(
        withOwner(result => {
          if (!alive() || epoch !== state.epoch || generation !== state.filesGeneration) return;
          // One group of folder replies is committed together by its caller.
          return {node, entries: result.entries};
        }),
      )
      .finally(() => {
        if (loadingFolders.get(node.path) === promise) loadingFolders.delete(node.path);
      });
    loadingFolders.set(node.path, promise);
    const result = await promise;
    if (commit && result && alive() && epoch === state.epoch && generation === state.filesGeneration)
      mergeFolders([result]);
    return result;
  }

  /** Rebuilds and flattens once for a group of loaded folders, preserving concurrent additions. */
  function mergeFolders(results) {
    const entries = [...state.entries];
    const known = new Set(entries.map(entry => entry.path));
    for (const result of results.filter(Boolean)) {
      const index = entries.findIndex(entry => entry.path === result.node.path);
      if (index !== -1) entries[index] = {...entries[index], loaded: true};
      for (const entry of result.entries) {
        const path = `${result.node.path}/${entry.path}`;
        if (!known.has(path)) {
          known.add(path);
          entries.push({...entry, path});
        }
      }
    }
    batch(() => {
      state.entries = entries;
      state.tree = makeTree(entries);
      app.updateTree();
    });
  }

  /** Applies a diff and its matching Viewed/comment rows atomically, including native-header loads. */
  function applyDiff(diff) {
    batch(() => {
      state.diff = diff;
      if (state.mode !== 'changes') return;
      state.entries = diffEntries(diff);
      state.tree = makeTree(state.entries);
      state.lazy = false;
      app.updateTree();
    });
  }

  /** Builds tree entries using comments and Viewed marks from this exact diff revision. */
  function diffEntries(diff) {
    const grouped = new Map();
    for (const comment of diff.comments) {
      if (!grouped.has(comment.path)) grouped.set(comment.path, []);
      grouped.get(comment.path).push(comment);
    }
    return diff.files.map(file => ({
      ...file,
      path: file.filename,
      type: 'blob',
      comments: grouped.get(file.filename) || [],
      viewed: diff.viewed[file.filename] === 'VIEWED',
    }));
  }

  /** Loads every lazy folder, four at a time, so search covers the whole repository. */
  async function loadAllFolders() {
    if (state.loadingAll) return;
    const epoch = state.epoch;
    const generation = state.filesGeneration;
    const alive = app.pageAlive || (() => true);
    const current = () => alive() && epoch === state.epoch && generation === state.filesGeneration;
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
        const results = await Promise.all(folders.map(node => loadFolder(node, false)));
        if (!current()) return;
        mergeFolders(results);
      }
    } finally {
      if (current()) {
        state.loadingAll = false;
      }
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
    applyDiff,
  };
}
