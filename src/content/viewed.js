/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Revision-bound Viewed writes shared by the changed-file tree and file viewers.
 */

import {batch} from './reactive.js';

/** Pending writes reject duplicate updates from controls sharing one loaded diff. */
const pendingPaths = new WeakMap();

/** Captures a loaded review so delayed controls cannot mark a different page or revision. */
export function createViewedAction(app) {
  const {state} = app;
  const context = state.context;
  const diff = state.diff;
  const headSHA = diff?.head?.sha;
  const baseSHA = diff?.base?.sha;
  const epoch = state.epoch;
  const generation = state.filesGeneration;
  const alive = app.pageAlive || (() => true);

  /** Requires the captured page, loaded diff and exact source revisions to remain current. */
  function current() {
    return Boolean(
      alive() &&
      context &&
      state.context === context &&
      state.diff === diff &&
      headSHA &&
      diff.head?.sha === headSHA &&
      diff.base?.sha === baseSHA &&
      ['github', 'local'].includes(diff.viewedMode) &&
      epoch === state.epoch &&
      generation === state.filesGeneration,
    );
  }

  /** Reads a confirmed mark and subscribes viewer controls to marks published elsewhere. */
  function viewed(path) {
    void state.viewedVersion;
    return diff?.viewed?.[path] === 'VIEWED';
  }

  /** Confirms one listed file's mark before publishing it to viewer and sidebar bindings. */
  async function set(path, value) {
    if (!current()) return false;
    if (typeof value !== 'boolean' || !diff.files.some(file => file.filename === path))
      throw new Error('This file is not part of the loaded review.');
    let pending = pendingPaths.get(diff);
    if (!pending) {
      pending = new Set();
      pendingPaths.set(diff, pending);
    }
    if (pending.has(path)) throw new Error('This file already has a Viewed update in progress.');
    pending.add(path);
    try {
      const result = await app.rpc('VIEWED', {context, headSHA, path, viewed: value});
      if (!current()) return false;
      const expected = value ? 'VIEWED' : 'UNVIEWED';
      if (result?.state !== expected || (result.mode !== undefined && !['github', 'local'].includes(result.mode)))
        throw new Error('The Viewed update was not confirmed. Try again.');
      batch(() => {
        diff.viewed = {...diff.viewed, [path]: expected};
        if (result.mode !== undefined) diff.viewedMode = result.mode;
        if (state.mode === 'changes') {
          state.entries = state.entries.map(entry => (entry.path === path ? {...entry, viewed: value} : entry));
          const node = state.tree.nodes.get(path);
          if (node) {
            node.viewed = value;
            let parentPath = path;
            while (parentPath.includes('/')) {
              parentPath = parentPath.slice(0, parentPath.lastIndexOf('/'));
              const parent = state.tree.nodes.get(parentPath);
              if (!parent) break;
              parent.viewed =
                parent.loaded && parent.children.length > 0 && parent.children.every(child => child.viewed);
            }
          }
          app.updateTree?.();
        }
        // Keep the diff identity: replacing it would reload the current file and discard its position.
        state.viewedVersion++;
      });
      return true;
    } finally {
      pending.delete(path);
    }
  }

  return {current, viewed, set};
}
