/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned literal search over complete viewer rows, independent of DOM virtualization.
 * Matches use original UTF-16 offsets, retain syntax spans and never leave the viewer.
 */

import {button, el} from '../dom.js';
import {listen} from '../reactive-dom.js';
import {onCleanup, withOwner} from '../reactive.js';
import {icon} from '../../shared/icons.js';

/** Bounds retained match metadata even when a short query occurs throughout a large file. */
const maxMatches = 10000;

/**
 * Adds a find bar to one loaded file. The modal takes shortcut priority over
 * the inline workspace; native editors keep their own Ctrl/Cmd+F behavior.
 * Context rows are searched once and share their ranges in both split panes.
 *
 * @param {object} app The content feature context.
 * @param {object} shell The owned viewer shell.
 * @param {Array<object>} rows Validated unified rows or complete plain-file rows.
 * @param {{draw: Function, reveal: Function, row: Function}} viewport Virtual viewport adapters.
 * @param {Function} current Whether this shell still owns its contents.
 * @returns {{ranges: Function, active: Function}} Visible-row highlight accessors.
 */
export function createFileSearch(app, shell, rows, viewport, current) {
  const input = el('input', {
    type: 'search',
    placeholder: 'Find in file',
    'aria-label': 'Find in file',
    maxlength: '1024',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const count = el('span', {class: 'viewer-find-count', role: 'status', 'aria-live': 'polite'});
  const previous = button('chevron', 'Previous match', () => select(active - 1), 'viewer-find-previous');
  const next = button('chevron', 'Next match', () => select(active + 1), 'viewer-find-next');
  previous.title = 'Previous match (Shift+Enter)';
  next.title = 'Next match (Enter)';
  const close = button('close', 'Close file search', closeSearch);
  const field = el('div', {class: 'searchbar viewer-find-field'}, [icon('search'), input, count]);
  const bar = el('div', {class: 'viewer-find', role: 'search', hidden: ''}, [field, previous, next, close]);
  const toggle = button('search', 'Find in file (Ctrl/Cmd+F)', openSearch, 'viewer-find-toggle small-button');
  const closeFocused = shell.closeButton?.matches(':focus');
  const tools = el('div', {class: 'viewer-tools'}, [toggle, bar]);
  // Wrap find and Close together, retaining DOM/tab order and the dialog's initial focus.
  if (shell.closeButton) tools.append(shell.closeButton);
  shell.actions.append(tools);
  if (closeFocused) shell.closeButton.focus();
  shell.body.setAttribute('tabindex', '0');
  let ranges = new Map();
  let matches = [];
  let active = -1;
  let limited = false;
  let searching = false;
  let generation = 0;
  let timer;
  let live = true;

  /** Updates the count without replacing the focused input or its selection. */
  function update() {
    count.textContent = searching
      ? 'Searching…'
      : input.value
        ? `${active + 1} / ${matches.length}${limited ? '+' : ''}`
        : '';
    count.title = limited ? `Only the first ${maxMatches.toLocaleString('en-US')} matches are listed.` : '';
    previous.disabled = next.disabled = !matches.length || searching;
    input.setAttribute('aria-busy', String(searching));
  }

  /** Cancels unpublished work and drops row ranges without changing source text. */
  function reset() {
    generation++;
    clearTimeout(timer);
    ranges = new Map();
    matches = [];
    active = -1;
    limited = searching = false;
  }

  /** Opens this viewer's bar and selects the existing local query for replacement. */
  function openSearch() {
    if (!live || !current()) return;
    const wasHidden = bar.hidden;
    bar.hidden = false;
    toggle.hidden = true;
    input.focus();
    input.select();
    if (wasHidden) schedule();
  }

  /** Closes search before a modal Escape can close the underlying diff dialog. */
  function closeSearch() {
    if (!live || !current()) return;
    bar.hidden = true;
    toggle.hidden = false;
    reset();
    update();
    viewport.draw();
    shell.body.focus();
  }

  /** Selects one retained match and lets the renderer reveal its virtual source row. */
  function select(index) {
    if (!live || !current() || !matches.length || searching) return;
    active = (index + matches.length) % matches.length;
    update();
    viewport.reveal(matches[active]);
  }

  /** Scans literal, case-insensitive matches in bounded chunks; stale queries cannot publish results. */
  async function scan(query, request) {
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    const found = [];
    const indexed = new Map();
    let clipped = false;
    let scanned = 0;
    scanRows: for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(row.text))) {
        if (found.length === maxMatches) {
          clipped = true;
          break scanRows;
        }
        const range = {row: index, start: match.index, end: match.index + match[0].length};
        found.push(range);
        if (!indexed.has(row)) indexed.set(row, []);
        indexed.get(row).push(range);
      }
      scanned += row.text.length;
      if (scanned >= 32768 || index % 256 === 255) {
        scanned = 0;
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!live || !current() || request !== generation) return;
      }
    }
    if (!live || !current() || request !== generation) return;
    matches = found;
    ranges = indexed;
    limited = clipped;
    searching = false;
    const top = viewport.row();
    const index = matches.findIndex(match => match.row >= top);
    if (matches.length) select(index < 0 ? 0 : index);
    else {
      update();
      viewport.draw();
    }
  }

  /** Debounces input and invalidates old highlights immediately, including while composing text. */
  function schedule(event) {
    if (!live || !current()) return;
    reset();
    const query = input.value.slice(0, 1024);
    searching = Boolean(query);
    update();
    viewport.draw();
    if (!query || event?.isComposing) return;
    const request = generation;
    timer = setTimeout(
      withOwner(() => scan(query, request)),
      120,
    );
  }

  /** Routes find/Enter/Escape through the active viewer, respecting closed-shadow input focus. */
  function keydown(event) {
    if (!live || !current() || event.defaultPrevented || event.isComposing || event.getModifierState('AltGraph'))
      return;
    const modal = shell.body.closest('dialog');
    if (app.view.viewer.open ? modal !== app.view.viewer : modal) return;
    const root = shell.body.getRootNode();
    const focused = root.activeElement;
    const editing = [focused, app.view.shadow?.activeElement, ...event.composedPath()].some(
      node => node !== input && (node?.matches?.('input,textarea,select') || node?.isContentEditable),
    );
    if (editing) return;
    const find = event.key.toLowerCase() === 'f' && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey;
    if (find) {
      if (event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      openSearch();
    } else if (!bar.hidden && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
      } else if (event.key === 'Enter' && focused === input) {
        event.preventDefault();
        event.stopPropagation();
        select(active + (event.shiftKey ? -1 : 1));
      }
    }
  }

  listen(input, 'input', schedule);
  listen(input, 'compositionend', schedule);
  listen(window, 'keydown', keydown, true);
  onCleanup(() => {
    live = false;
    reset();
    tools.remove();
  });
  update();
  return {ranges: row => ranges.get(row) || [], active: () => matches[active]};
}
