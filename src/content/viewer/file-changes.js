/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned change-block navigation over validated, virtualized diff rows.
 * Unified source boundaries also identify blocks in the paired split layout.
 */

import {button, el} from '../dom.js';
import {onCleanup} from '../reactive.js';

/**
 * Adds cyclic previous/next navigation for contiguous additions and removals.
 * A selected block stays current while visible, including when scrolling is
 * clamped near the end of a file or several blocks fit in one viewport.
 *
 * @param {object} shell The owned diff shell.
 * @param {Array<object>} rows Complete, validated unified diff rows.
 * @param {{range: Function, project: Function, reveal: Function}} viewport Layout-aware row adapters.
 * @param {Function} current Whether this render still owns the shell.
 * @returns {{update: Function}} A viewport refresh callback.
 */
export function createFileChanges(shell, rows, viewport, current) {
  const blocks = [];
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].type === 'context') continue;
    const start = index;
    while (index + 1 < rows.length && rows[index + 1].type !== 'context') index++;
    blocks.push({start, end: index + 1});
  }
  let active = -1;
  let live = true;
  const count = el('span', {class: 'diff-changes-count', role: 'status', 'aria-live': 'polite'});
  const previous = button('chevron', 'Previous change block', () => select(-1), 'diff-changes-previous');
  const next = button('chevron', 'Next change block', () => select(1), 'diff-changes-next');
  const controls = el('div', {class: 'diff-changes', role: 'group', 'aria-label': 'Change blocks'}, [
    el('span', {class: 'diff-changes-label', text: 'Changes'}),
    count,
    previous,
    next,
  ]);
  shell.actions.prepend(controls);
  previous.disabled = next.disabled = !blocks.length;

  /** Tests a block's exclusive boundaries in the current visual row coordinates. */
  function visible(index, range) {
    const block = blocks[index];
    return block && viewport.project(block.start) < range.end && viewport.project(block.end) > range.start;
  }

  /** Follows scrolling without scanning every change block on each animation frame. */
  function update() {
    if (!live || !current()) return;
    const range = viewport.range();
    if (!visible(active, range)) {
      let low = 0;
      let high = blocks.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (viewport.project(blocks[middle].start) <= range.start) low = middle + 1;
        else high = middle;
      }
      active = low - 1;
      if (!visible(active, range) && visible(low, range)) active = low;
    }
    const text = `${active + 1} / ${blocks.length}`;
    if (count.textContent !== text) {
      count.textContent = text;
      count.setAttribute('aria-label', `Change block ${active + 1} of ${blocks.length}`);
    }
  }

  /** Reveals the selected source block through the renderer, including off-screen rows. */
  function select(direction) {
    if (!live || !current() || !blocks.length) return;
    update();
    active =
      active < 0 ? (direction > 0 ? 0 : blocks.length - 1) : (active + direction + blocks.length) % blocks.length;
    viewport.reveal(blocks[active].start);
  }

  onCleanup(() => {
    live = false;
    controls.remove();
  });
  return {update};
}
