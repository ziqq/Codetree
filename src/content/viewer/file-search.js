/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned literal search and line-navigation toolbar over complete viewer rows, independent of DOM virtualization.
 * Matches use original UTF-16 offsets, retain syntax spans and never leave the viewer.
 */

import {button, el} from '../dom.js';
import {listen} from '../reactive-dom.js';
import {onCleanup, withOwner} from '../reactive.js';
import {icon} from '../../shared/icons.js';
import {createFileLine} from './file-line.js';

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
 * @param {{draw: Function, reveal: Function, row: Function, go: Function}} viewport Virtual viewport adapters.
 * @param {Function} current Whether this shell still owns its contents.
 * @param {boolean} diff Whether the file has old and new source line numbers.
 * @returns {{ranges: Function, active: Function}} Visible-row highlight accessors.
 */
export function createFileSearch(app, shell, rows, viewport, current, diff = false) {
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
  const symbol = icon('search');
  const label = el('span', {class: 'viewer-line-label', text: 'Line', hidden: ''});
  const field = el('div', {class: 'searchbar viewer-find-field'}, [symbol, label, input, count]);
  const line = createFileLine(rows, viewport, current, diff, input, closeSearch);
  const bar = el('div', {class: 'viewer-find', role: 'search', hidden: ''}, [
    line.revisions,
    field,
    previous,
    next,
    close,
    line.status,
  ]);
  const toggle = button('search', 'Find in file (Ctrl/Cmd+F)', openSearch, 'viewer-find-toggle small-button');
  toggle.title = 'Find in file (Ctrl/Cmd+F) · Go to line (Ctrl/Cmd+G)';
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
  let lineMode = false;
  let query = '';

  /** Shows the active mode in one persistent input, retaining the separate literal search query. */
  function mode(value) {
    lineMode = value;
    line.revisions.hidden = !value || !diff;
    label.hidden = !value;
    symbol.style.display = value ? 'none' : '';
    count.hidden = previous.hidden = next.hidden = close.hidden = value;
    field.classList.toggle('viewer-line-field', value);
    bar.setAttribute('role', value ? 'group' : 'search');
    bar.setAttribute('aria-label', value ? 'Go to line' : 'Find in file');
    input.setAttribute('maxlength', value ? '7' : '1024');
    input.setAttribute('aria-busy', 'false');
    if (value) input.setAttribute('inputmode', 'numeric');
    else {
      line.clear();
      input.removeAttribute('inputmode');
      input.placeholder = 'Find in file';
      input.setAttribute('aria-label', 'Find in file');
      input.value = query;
    }
  }

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
    const wasHidden = bar.hidden || lineMode;
    mode(false);
    bar.hidden = false;
    toggle.hidden = true;
    input.focus();
    input.select();
    if (wasHidden) schedule();
  }

  /** Closes search before a modal Escape can close the underlying diff dialog. */
  function closeSearch(focus = true) {
    if (!live || !current()) return;
    bar.hidden = true;
    toggle.hidden = false;
    reset();
    mode(false);
    update();
    viewport.draw();
    if (focus) shell.body.focus();
  }

  /** Exchanges the search field for line entry without widening the viewer toolbar. */
  function openLine() {
    if (!live || !current()) return;
    if (!lineMode) query = input.value;
    reset();
    update();
    viewport.draw();
    mode(true);
    bar.hidden = false;
    toggle.hidden = true;
    line.open();
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
    if (lineMode) {
      line.update();
      return;
    }
    query = input.value.slice(0, 1024);
    reset();
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
    const command = event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey;
    const key = event.key.toLowerCase();
    if (command && (key === 'f' || key === 'g')) {
      if (event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === 'f') openSearch();
      else openLine();
    } else if (!bar.hidden && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
      } else if (event.key === 'Enter' && focused === input) {
        event.preventDefault();
        event.stopPropagation();
        if (lineMode) line.submit();
        else select(active + (event.shiftKey ? -1 : 1));
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
