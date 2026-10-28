/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned source-line navigation over complete, validated viewer rows.
 * Old and new line numbers map to unified rows before layout projection.
 */

import {el} from '../dom.js';
import {listen} from '../reactive-dom.js';
import {onCleanup} from '../reactive.js';

/**
 * Adds source-line mode to the viewer's existing find input; its toolbar routes keyboard actions.
 *
 * @param {Array<object>} rows Complete plain-file or validated unified diff rows.
 * @param {{go: Function}} viewport Canonical row navigation independent of layout.
 * @param {Function} current Whether the viewer still owns these rows.
 * @param {boolean} diff Whether both source revisions are available.
 * @param {HTMLInputElement} input The shared find/line field.
 * @param {Function} close Closes the field after a successful jump.
 * @returns {{revisions: HTMLElement, status: HTMLElement, open: Function, clear: Function, update: Function, submit: Function}} Owned mode controls.
 */
export function createFileLine(rows, viewport, current, diff, input, close) {
  const limits = {oldLine: 0, newLine: 0};
  for (const row of rows) {
    limits.oldLine = Math.max(limits.oldLine, row.oldLine || 0);
    limits.newLine = Math.max(limits.newLine, row.newLine || 0);
  }
  let side = 'newLine';
  let live = true;
  const status = el('span', {class: 'viewer-line-status', role: 'status', 'aria-live': 'polite'});
  const revisions = el('div', {
    class: 'viewer-line-revision',
    role: 'group',
    'aria-label': 'Line revision',
    hidden: '',
  });
  if (diff)
    for (const [value, label] of [
      ['newLine', 'New'],
      ['oldLine', 'Old'],
    ]) {
      const control = el('button', {type: 'button', text: label, 'aria-pressed': String(side === value)});
      listen(control, 'click', () => {
        if (!live || !current()) return;
        side = value;
        update();
        input.focus();
      });
      revisions.append(control);
    }

  /** Drops line-mode feedback when typing or returning to literal search. */
  function clear() {
    status.textContent = '';
    input.removeAttribute('aria-invalid');
  }

  /** Reflects the selected revision's bounds without changing the entered line. */
  function update() {
    clear();
    input.placeholder = limits[side] ? `:1–${limits[side]}` : 'Empty';
    input.setAttribute('aria-label', diff ? `${side === 'oldLine' ? 'Old' : 'New'} line number` : 'Line number');
    for (const [index, control] of Array.from(revisions.children).entries())
      control.setAttribute('aria-pressed', String(side === (index === 0 ? 'newLine' : 'oldLine')));
  }

  /** Starts explicit line mode with a prefix; ordinary find queries never reach this parser. */
  function open() {
    if (!live || !current()) return;
    update();
    input.value = ':';
    input.focus();
  }

  /** Resolves a one-based source line to its validated row, including removed old lines. */
  function submit() {
    if (!live || !current()) return;
    const text = input.value.trim().replace(/^:/, '');
    const line = Number(text);
    const index = /^[1-9]\d*$/.test(text) && line <= limits[side] ? rows.findIndex(row => row[side] === line) : -1;
    if (index < 0) {
      status.textContent = limits[side] ? `Enter a line from 1 to ${limits[side]}.` : 'This revision has no lines.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    viewport.go(index);
    close();
  }

  onCleanup(() => {
    live = false;
  });
  return {revisions, status, open, clear, update, submit};
}
