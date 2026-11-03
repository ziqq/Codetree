/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Full-file diff and review-comment viewer in a modal dialog.
 *
 * Each opened view gets a generation number; closing the dialog, opening
 * another file or navigating invalidates replies for the previous view.
 * Back/Forward history lives for one dialog lifetime and is keyed by the
 * exact base/head revisions, so a replaced diff cannot restore old entries.
 */

import {button, el, empty} from '../dom.js';
import {providerName} from '../page.js';
import {renderDiffFile} from './file-content.js';
import {createFileReview} from './file-review.js';
import {createHistoryControls, createNavigationHistory} from './file-history.js';
import {createAlive, createRoot, getOwner, onCleanup, runWithOwner} from '../reactive.js';
import {listen} from '../reactive-dom.js';

/** Converts a diff file to a tree node shape used by the viewer. */
export function diffNode(file) {
  return {...file, path: file.filename, type: 'blob', adds: file.additions, dels: file.deletions};
}

/** Creates the viewer feature: `closeViewer`, `isCurrent`, `viewerShell`, `showDiff` and `showComments`. */
export function createViewer(app) {
  const {state, run} = app;
  const {viewer} = app.view;
  let generation = 0;
  let disposeViewer;
  let activeShell;
  const history = createNavigationHistory();
  // `close` fires in a later task; if another view opened the dialog again meanwhile, the event is stale.
  listen(viewer, 'close', () => {
    if (viewer.open) return;
    generation++;
    disposeViewer?.();
    disposeViewer = null;
    activeShell = null;
    history.clear();
  });
  onCleanup(closeViewer);

  /** Closes the dialog and invalidates its pending work. */
  function closeViewer() {
    generation++;
    disposeViewer?.();
    disposeViewer = null;
    activeShell = null;
    history.clear();
    if (viewer.open) viewer.close();
  }

  /** Whether [shell] is still the open view. */
  function isCurrent(shell) {
    return viewer.open && shell.alive() && shell.generation === generation;
  }

  /**
   * Opens the dialog with an empty layout for a new view.
   *
   * @returns {{actions: Element, closeButton: HTMLButtonElement, body: Element, bottom: Element, generation: number}}
   */
  function viewerShell(title, subtitle, label = 'Full-file diff') {
    disposeViewer?.();
    return runWithOwner(app.pageOwner || app.owner, () =>
      createRoot(dispose => {
        disposeViewer = dispose;
        generation++;
        viewer.setAttribute('aria-label', label);
        const heading = el('div', {class: 'viewer-heading'}, [
          el('strong', {text: title}),
          el('small', {text: subtitle}),
        ]);
        const closeButton = button('close', 'Close viewer', () => viewer.close(), 'small-button');
        const actions = el('div', {class: 'viewer-actions'}, [closeButton]);
        const viewerBody = el('div', {class: 'viewer-body'});
        const bottom = el('div', {class: 'viewer-bottom'});
        viewer.replaceChildren(
          el('div', {class: 'viewer-inner'}, [
            el('div', {class: 'viewer-header'}, [heading, actions]),
            viewerBody,
            bottom,
          ]),
        );
        if (!viewer.open) viewer.showModal();
        activeShell = {
          actions,
          closeButton,
          body: viewerBody,
          bottom,
          generation,
          owner: getOwner(),
          alive: createAlive(),
        };
        return activeShell;
      }),
    );
  }

  /** The history scope of a diff: its exact base and head revisions. */
  function historyKey(diff) {
    return `${diff?.base.sha || ''}:${diff?.head.sha || ''}`;
  }

  /** Returns the loaded diff location of the open dialog, or null while loading, failed or showing comments. */
  function historyLocation(shell = activeShell) {
    if (!shell?.historyPath || !shell.readPosition || !isCurrent(shell)) return null;
    return {key: shell.historyKey, path: shell.historyPath, position: shell.readPosition()};
  }

  /** Accepts only entries of the diff currently loaded in the page state. */
  function accept(entry) {
    return Boolean(state.diff) && entry.key === historyKey(state.diff);
  }

  /** Re-evaluates the open shell's Back/Forward boundaries. */
  function updateHistory(shell = activeShell) {
    if (!shell?.history || !isCurrent(shell)) return;
    const current = historyLocation(shell);
    shell.history.back.disabled = !history.canBack(current, accept);
    shell.history.forward.disabled = !history.canForward(current, accept);
  }

  /**
   * Restores one history entry without recording it. Another file is opened
   * through showDiff; the pointer moves only after the stored position applied.
   */
  async function traverse(direction) {
    const shell = activeShell;
    if (!shell || !isCurrent(shell)) return;
    const current = historyLocation(shell);
    const target = direction < 0 ? history.back(current, accept) : history.forward(current, accept);
    if (!target) return updateHistory(shell);
    if (current && target.entry.path === current.path) {
      shell.restorePosition(target.entry.position);
      history.commit(target);
      return updateHistory(shell);
    }
    const file = state.diff.files.find(file => file.filename === target.entry.path);
    if (!file) {
      app.toast?.(`${target.entry.path} is no longer part of this diff.`);
      return updateHistory(shell);
    }
    await showDiff(diffNode(file), {target});
  }

  /**
   * Shows a whole changed file with highlighted changes and both line numbers.
   *
   * Both revisions are loaded at the exact request revisions and validated
   * against the patch. Rows are virtualized; syntax highlighting is skipped
   * above its token budget. Previous/next cover every changed file. A file
   * opened while the dialog is already showing a diff records a history
   * point, unless it is the Back/Forward `target` being restored.
   *
   * @param {object} node The changed file in tree-node form.
   * @param {{target?: {index: number, entry: object}}} [options] Internal history restoration.
   */
  async function showDiff(node, {target} = {}) {
    const diff = state.diff;
    if (!diff) return;
    app.updateCodeColors?.();
    const open = viewer.open;
    // A new dialog lifetime starts an empty history; the start point is recorded after it loads.
    if (!open) history.clear();
    const from = open && !target ? historyLocation() : null;
    const shell = viewerShell(
      node.path,
      `${diff.base.sha?.slice(0, 7) || 'empty'} → ${diff.head.sha.slice(0, 7)} · full-file context`,
    );
    shell.historyKey = historyKey(diff);
    shell.history = createHistoryControls(
      run(() => traverse(-1)),
      run(() => traverse(1)),
    );
    // Prepended before the native link and every file control, so Close stays last.
    shell.actions.prepend(shell.history.element);
    updateHistory(shell);
    shell.body.replaceChildren(
      empty('Loading file revisions', `Fetching the complete text from ${providerName(state.context)}…`, 'refresh'),
    );
    const originalURL = await app.diffURL(node);
    if (!isCurrent(shell)) return;
    shell.actions.prepend(
      el('a', {
        class: `small-button${state.context.provider === 'github' ? ' viewer-native-accent' : ''}`,
        href: originalURL,
        text: `${providerName(state.context)} diff`,
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
    );
    const files = diff.files.map(diffNode);
    const index = files.findIndex(item => item.path === node.path);
    const previous = button(
      'arrow',
      'Previous changed file',
      run(() => showDiff(files[index - 1])),
    );
    previous.disabled = index <= 0;
    const next = button(
      'arrow',
      'Next changed file',
      run(() => showDiff(files[index + 1])),
    );
    next.firstChild.style.transform = 'rotate(180deg)';
    next.disabled = index >= files.length - 1;
    shell.bottom.append(
      el('span', {text: `${index + 1} of ${files.length} files`}),
      el('span', {class: 'flex'}),
      previous,
      next,
    );
    try {
      await renderDiffFile(app, shell, node, diff, () => isCurrent(shell));
      if (isCurrent(shell) && shell.readPosition) {
        shell.historyPath = node.path;
        if (target) {
          shell.restorePosition(target.entry.position);
          history.commit(target);
        } else history.visit(from, historyLocation(shell));
        shell.onNavigate = position => {
          if (!isCurrent(shell)) return;
          history.visit({...historyLocation(shell), position}, historyLocation(shell));
          updateHistory(shell);
        };
        updateHistory(shell);
      }
      if (isCurrent(shell))
        runWithOwner(shell.owner, () =>
          createFileReview(
            app,
            shell,
            node,
            diff,
            () => isCurrent(shell),
            path => showDiff(diffNode(diff.files.find(file => file.filename === path))),
          ),
        );
    } catch (error) {
      shell.getSymbols = null;
      if (!isCurrent(shell)) return;
      shell.body.replaceChildren(empty('Text preview unavailable', error.message, 'diff'));
      if (target) app.toast?.(`Could not restore ${node.path}: ${error.message}`);
      else if (from) history.visit(from, null);
      updateHistory(shell);
    }
  }

  /** Shows the inline review comments of a file or of every file in a folder. */
  function showComments(node) {
    const files = node.type === 'tree' ? state.entries.filter(entry => entry.path.startsWith(node.path + '/')) : [node];
    const comments = files.flatMap(file => file.comments || []);
    const shell = viewerShell(node.path, `${comments.length} inline comments`, 'File review comments');
    for (const comment of comments) {
      const metadata = el('div', {class: 'comment-meta'}, [
        el('strong', {text: comment.user?.login || 'unknown'}),
        el('span', {
          text: `${comment.path}${comment.line || comment.original_line ? `:${comment.line || comment.original_line}` : ''}${comment.line == null && comment.original_line ? ' · outdated' : ''}`,
        }),
      ]);
      try {
        if (new URL(comment.html_url).origin === state.context.origin)
          metadata.append(
            el('a', {
              href: comment.html_url,
              text: `View on ${providerName(state.context)}`,
              target: '_blank',
              rel: 'noopener noreferrer',
            }),
          );
      } catch {
        /* Keep the comment text while omitting an invalid external link. */
      }
      shell.body.append(
        el('div', {class: 'comment-card'}, [metadata, el('div', {class: 'comment-body', text: comment.body})]),
      );
    }
    if (!comments.length)
      shell.body.append(empty('No inline comments', 'There are no review comments for this file.', 'comment'));
  }
  /** Returns symbols only for the current loaded diff; loading and comment dialogs have no symbol model. */
  function getViewerSymbols() {
    return activeShell && isCurrent(activeShell) ? activeShell.getSymbols?.() || null : null;
  }
  return {closeViewer, isCurrent, viewerShell, showDiff, showComments, getViewerSymbols};
}
