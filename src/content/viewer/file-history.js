/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Bounded Back/Forward navigation history shared by the inline workspace and View full.
 *
 * Entries hold only metadata: an owner-defined key (the revision scope the
 * position belongs to), a repository path and a canonical unified-row
 * position. No source text, persistence or Sync is involved. Traversal
 * returns a target without moving the pointer; owners commit it only after
 * the target has actually been restored, so failed or stale loads leave the
 * history unchanged.
 */

import {button, el} from '../dom.js';

/** Maximum retained entries per history; the oldest entry is dropped first. */
export const maxNavigationHistory = 50;

/**
 * Whether two locations are the same file in the same revision scope.
 *
 * @param {{key: string, path: string}} [first]
 * @param {{key: string, path: string}} [second]
 * @returns {boolean}
 */
function sameFile(first, second) {
  return Boolean(first && second) && first.key === second.key && first.path === second.path;
}

/**
 * Whether two locations are the same file at the same canonical pixel row. Horizontal
 * offsets are ignored so a sideways scroll does not create a separate point.
 *
 * @param {{key: string, path: string, position: {top: number}}} [first]
 * @param {{key: string, path: string, position: {top: number}}} [second]
 * @returns {boolean}
 */
function sameLocation(first, second) {
  return sameFile(first, second) && Math.round(first.position.top) === Math.round(second.position.top);
}

/**
 * Copies only the metadata fields of a location.
 *
 * @param {{key: string, path: string, position: {top: number, left: number}}} location
 * @returns {{key: string, path: string, position: {top: number, left: number}}}
 */
function copy(location) {
  return {
    key: location.key,
    path: location.path,
    position: {top: location.position?.top || 0, left: location.position?.left || 0},
  };
}

/**
 * Creates one bounded in-memory navigation history.
 *
 * The pointer names the last committed location. Back and Forward always step to
 * the neighbouring entry, even when the viewer has left the pointer without
 * recording (for example after closing a tab or a failed load).
 *
 * @param {number} [limit=maxNavigationHistory] Maximum retained entries.
 */
export function createNavigationHistory(limit = maxNavigationHistory) {
  let entries = [];
  let index = -1;

  /** Drops the oldest entries above the bound while keeping the pointer on the same entry. */
  function bound() {
    const excess = entries.length - limit;
    if (excess <= 0) return;
    entries = entries.slice(excess);
    index = Math.max(0, index - excess);
  }

  /** Appends a location after the pointer unless it equals the current entry. */
  function push(location) {
    if (sameLocation(entries[index], location)) {
      entries[index].position = copy(location).position;
      return;
    }
    entries.push(copy(location));
    index = entries.length - 1;
  }

  /**
   * Records an explicit navigation. The departure point updates the current
   * entry when it is the same file, otherwise it is added; the forward branch
   * is discarded and the destination is added unless it equals the current entry.
   *
   * @param {object|null} from The location left behind, or null when none was loaded.
   * @param {object|null} to The location reached, or null when its load failed.
   */
  function visit(from, to) {
    entries = entries.slice(0, index + 1);
    if (from) {
      if (sameFile(entries[index], from)) entries[index].position = copy(from).position;
      else push(from);
    }
    if (to) push(to);
    bound();
  }

  /**
   * Finds the nearest accepted entry in one direction without moving the pointer.
   * Steps start from the entry showing the current file: the pointer, or a
   * neighbour reached without recording (for example by Retry after a failed
   * Back). That entry first receives the latest position.
   *
   * @param {number} direction -1 for Back, 1 for Forward.
   * @param {object|null} current The viewer's present location, if loaded.
   * @param {(entry: object) => boolean} [accept] Rejects entries from another revision scope.
   * @param {boolean} [save=true] Whether to store the present position in the current entry.
   * @returns {{index: number, entry: object}|null}
   */
  function find(direction, current, accept = () => true, save = true) {
    if (index < 0) return null;
    const base = [index, index - 1, index + 1].find(offset => sameFile(entries[offset], current)) ?? index;
    if (save && sameFile(entries[base], current)) entries[base].position = copy(current).position;
    let target = base + direction;
    while (target >= 0 && target < entries.length) {
      if (accept(entries[target]) && !sameLocation(entries[target], current))
        return {index: target, entry: copy(entries[target])};
      target += direction;
    }
    return null;
  }

  return {
    visit,
    /** Returns the previous accepted entry, saving the current position; see `find`. */
    back: (current, accept) => find(-1, current, accept),
    /** Returns the next accepted entry, saving the current position; see `find`. */
    forward: (current, accept) => find(1, current, accept),
    /** Whether Back has an accepted target from `current`, without changing any entry. */
    canBack: (current, accept) => Boolean(find(-1, current, accept, false)),
    /** Whether Forward has an accepted target from `current`, without changing any entry. */
    canForward: (current, accept) => Boolean(find(1, current, accept, false)),
    /**
     * Moves the pointer after a target was restored; ignores indexes removed meanwhile.
     *
     * @param {{index: number, entry: object}} target A result of `back` or `forward`.
     * @returns {boolean} Whether the pointer moved.
     */
    commit(target) {
      if (!sameFile(entries[target.index], target.entry)) return false;
      index = target.index;
      return true;
    },
    /** Discards every entry. */
    clear() {
      entries = [];
      index = -1;
    },
    /** Returns a metadata snapshot for diagnostics and tests. */
    get entries() {
      return entries.map(copy);
    },
    /** The committed pointer, or -1 when empty. */
    get index() {
      return index;
    },
  };
}

/**
 * Builds the owned Back/Forward toolbar group. The Forward arrow is the Back
 * arrow rotated, matching the previous/next file controls of View full.
 *
 * @param {() => void} back Back click handler.
 * @param {() => void} forward Forward click handler.
 * @returns {{element: HTMLElement, back: HTMLButtonElement, forward: HTMLButtonElement}}
 */
export function createHistoryControls(back, forward) {
  const backButton = button('arrow', 'Back', back, 'viewer-history-back');
  const forwardButton = button('arrow', 'Forward', forward, 'viewer-history-forward');
  backButton.title = 'Back (navigation history)';
  forwardButton.title = 'Forward (navigation history)';
  forwardButton.children[0].style.transform = 'rotate(180deg)';
  backButton.disabled = forwardButton.disabled = true;
  const element = el('div', {class: 'viewer-history', role: 'group', 'aria-label': 'Navigation history'}, [
    backButton,
    forwardButton,
  ]);
  return {element, back: backButton, forward: forwardButton};
}
