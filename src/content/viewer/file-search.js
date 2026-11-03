/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned literal search and line-navigation toolbar over complete viewer rows, independent of DOM virtualization.
 * Matches use original UTF-16 offsets, retain syntax spans and never leave the viewer. Match case, Whole word
 * and the diff revision scope belong to one viewer instance and are never stored.
 */

import {button, el} from '../dom.js';
import {listen} from '../reactive-dom.js';
import {onCleanup, withOwner} from '../reactive.js';
import {icon} from '../../shared/icons.js';
import {createFileLine} from './file-line.js';

/** Bounds retained match metadata even when a short query occurs throughout a large file. */
const maxMatches = 10000;

/**
 * Characters that continue a word for Whole word: Unicode letters, combining marks, decimal digits and connector
 * punctuation such as `_`. Evaluated with the `u` flag, so astral letters count as one code point.
 */
const wordCharacter = '[\\p{L}\\p{M}\\p{Nd}\\p{Pc}]';

/** Diff revision scopes in display order; a row is eligible when it has the named source line. */
const scopes = [
  ['both', 'Both'],
  ['newLine', 'New'],
  ['oldLine', 'Old'],
];

/**
 * Builds a literal search pattern. Whole word checks only the characters adjacent to a match, regardless of
 * whether the query itself starts or ends with a word character, so `(foo` matches in `x (foo)` but not `x(foo)`.
 *
 * @param {string} query The literal query.
 * @param {{matchCase: boolean, wholeWord: boolean}} options Current matching options.
 * @returns {RegExp} A global Unicode pattern.
 */
function searchPattern(query, {matchCase, wholeWord}) {
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = wholeWord ? `(?<!${wordCharacter})${literal}(?!${wordCharacter})` : literal;
  return new RegExp(source, matchCase ? 'gu' : 'giu');
}

/**
 * Adds a find bar to one loaded file. The modal takes shortcut priority over
 * the inline workspace; native editors keep their own Ctrl/Cmd+F behavior.
 * Context rows are searched once and share their ranges in both split panes.
 * Diffs can restrict matches to rows of the New or Old revision; alignment gaps are never rows.
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
  const options = {matchCase: false, wholeWord: false};
  const optionGroup = el('div', {
    class: 'viewer-find-group viewer-find-options',
    role: 'group',
    'aria-label': 'Search options',
  });
  const optionButtons = [
    ['matchCase', 'Match case', 'Aa', 'viewer-find-case'],
    ['wholeWord', 'Whole word', 'ab', 'viewer-find-word'],
  ].map(([name, label, text, className]) => {
    const control = el('button', {type: 'button', class: className, text, title: label, 'aria-label': label});
    listen(
      control,
      'click',
      choose(() => {
        options[name] = !options[name];
      }),
    );
    optionGroup.append(control);
    return [name, control];
  });
  let scope = 'both';
  const scopeGroup = diff
    ? el('div', {class: 'viewer-find-group viewer-find-scope', role: 'group', 'aria-label': 'Search revision'})
    : null;
  const scopeButtons = [];
  if (diff)
    for (const [value, text] of scopes) {
      const control = el('button', {
        type: 'button',
        text,
        title: `Search ${text === 'Both' ? 'both revisions' : `the ${text} revision`}`,
      });
      listen(
        control,
        'click',
        choose(() => {
          scope = value;
        }),
      );
      scopeGroup.append(control);
      scopeButtons.push([value, control]);
    }
  const populated = {
    oldLine: rows.some(row => row.oldLine),
    newLine: rows.some(row => row.newLine),
  };
  const bar = el('div', {class: 'viewer-find', role: 'search', hidden: ''}, [
    line.revisions,
    ...(scopeGroup ? [scopeGroup] : []),
    field,
    optionGroup,
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
  let started = false;
  let pending = 0;
  const run = withOwner((text, request) => scan(text, request));

  /** Whether the selected diff revision has no source rows, so no query can match. */
  function emptyScope() {
    return scope !== 'both' && !populated[scope];
  }

  /** Reflects option and scope state on the toggle buttons. */
  function pressed() {
    for (const [name, control] of optionButtons) control.setAttribute('aria-pressed', String(options[name]));
    for (const [value, control] of scopeButtons) control.setAttribute('aria-pressed', String(scope === value));
  }

  /**
   * Wraps an option or scope change: the current query is scanned again at once under a new generation,
   * so obsolete debounces and yielding scans cannot publish, and focus returns to the shared input.
   */
  function choose(apply) {
    return () => {
      if (!live || !current()) return;
      apply();
      pressed();
      if (!lineMode) schedule(undefined, true);
      input.focus();
    };
  }

  /** Shows the active mode in one persistent input, retaining the separate literal search query. */
  function mode(value) {
    lineMode = value;
    line.revisions.hidden = !value || !diff;
    label.hidden = !value;
    symbol.style.display = value ? 'none' : '';
    count.hidden = previous.hidden = next.hidden = close.hidden = optionGroup.hidden = value;
    if (scopeGroup) scopeGroup.hidden = value;
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
    count.textContent = emptyScope()
      ? `${scope === 'oldLine' ? 'Old' : 'New'} revision is empty`
      : searching
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
    timer = undefined;
    ranges = new Map();
    matches = [];
    active = -1;
    limited = searching = started = false;
    pending = 0;
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

  /**
   * Starts the current query's scan before its debounce when Enter needs a result. Enter after publication
   * steps normally; otherwise the published selection honors Enter (first match at or below the viewport)
   * or Shift+Enter (the match before it).
   */
  function flush(step) {
    if (!searching) {
      select(active + step);
      return;
    }
    pending = step;
    if (started) return;
    clearTimeout(timer);
    timer = undefined;
    started = true;
    run(query, generation);
  }

  /** Scans literal matches with the current options and scope in bounded chunks; stale scans cannot publish. */
  async function scan(query, request) {
    const pattern = searchPattern(query, options);
    const side = scope === 'both' ? null : scope;
    const found = [];
    const indexed = new Map();
    let clipped = false;
    let scanned = 0;
    scanRows: for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      pattern.lastIndex = 0;
      let match;
      while ((!side || row[side]) && (match = pattern.exec(row.text))) {
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
    const index = Math.max(
      0,
      matches.findIndex(match => match.row >= top),
    );
    const step = pending;
    pending = 0;
    if (matches.length) select(step < 0 ? index - 1 : index);
    else {
      update();
      viewport.draw();
    }
  }

  /**
   * Debounces input and invalidates old highlights immediately, including while composing text.
   * Option and scope changes pass `immediate` to scan without waiting for the debounce.
   */
  function schedule(event, immediate = false) {
    if (!live || !current()) return;
    if (lineMode) {
      line.update();
      return;
    }
    query = input.value.slice(0, 1024);
    reset();
    searching = Boolean(query) && !emptyScope();
    update();
    viewport.draw();
    if (!searching || event?.isComposing) return;
    const request = generation;
    if (immediate) {
      started = true;
      run(query, request);
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      started = true;
      run(query, request);
    }, 120);
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
        else flush(event.shiftKey ? -1 : 1);
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
  pressed();
  update();
  return {ranges: row => ranges.get(row) || [], active: () => matches[active]};
}
