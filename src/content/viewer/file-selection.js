/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned source-line selection and clipboard actions over complete viewer rows.
 * Selection follows one revision and never depends on the virtualized DOM.
 */

import {linePermalink} from '../../shared/line-links.js';
import {el} from '../dom.js';
import {listen} from '../reactive-dom.js';
import {createRenderEffect, createSignal, on, onCleanup} from '../reactive.js';

/** Native clipboard writes cannot be canceled when one viewer replaces another on this page. */
const [clipboardPending, setClipboardPending] = createSignal(false);

/**
 * Adds selection actions to one loaded file, retaining its exact source revisions.
 * Clipboard writes start only from an explicit action and cannot publish feedback
 * after the viewer or selection changes.
 *
 * @param {object} app The content feature context.
 * @param {{bottom: Element, body: HTMLElement}} shell The owned viewer footer and viewport.
 * @param {Array<object>} rows Complete plain-file or validated unified diff rows.
 * @param {{old?: object, new?: object}} sources Source descriptors and paths for each revision.
 * @param {Function} current Whether the viewer still owns these rows.
 * @param {Function} draw Repaints visible rows without changing their source coordinates.
 * @param {boolean} diff Whether both source revisions are selectable.
 * @returns {{selected: Function, choose: Function, clear: Function}} Owned selection accessors and actions.
 */
export function createFileSelection(app, shell, rows, sources, current, draw, diff = false) {
  const context = {...app.state.context};
  let live = true;
  let selection;
  let pending;
  let permalink;
  const label = el('span', {class: 'file-selection-label'});
  const link = el('button', {type: 'button', class: 'small-button', text: 'Copy permalink'});
  const code = el('button', {type: 'button', class: 'small-button', text: 'Copy code'});
  const reset = el('button', {type: 'button', class: 'small-button', text: 'Clear selection'});
  const status = el('span', {class: 'file-selection-status', role: 'status', 'aria-live': 'polite'});
  const group = el('div', {class: 'file-selection', role: 'group', 'aria-label': 'Line selection', hidden: ''}, [
    label,
    link,
    code,
    reset,
    status,
  ]);
  shell.bottom.append(group);

  /** Whether this controller may still act on its captured viewer. */
  function available() {
    return live && current();
  }

  /** Clears clipboard feedback when the selected source range changes. */
  function clearStatus() {
    status.textContent = '';
    status.classList.toggle('error', false);
  }

  /** Reflects the range and disables only clipboard actions while any viewer's native write is pending. */
  function update() {
    group.hidden = !selection;
    if (!selection) {
      label.textContent = '';
      permalink = null;
      link.disabled = code.disabled = true;
      return;
    }
    // Other footer features mount after file rendering; keep visible and keyboard order aligned.
    if (shell.bottom.children[shell.bottom.children.length - 1] !== group) shell.bottom.append(group);
    const {side, start, end} = selection;
    const range = start === end ? `Line ${start}` : `Lines ${start}–${end}`;
    label.textContent = diff ? `${side === 'oldLine' ? 'Old' : 'New'} · ${range}` : range;
    const revision = sources[side === 'oldLine' ? 'old' : 'new'];
    permalink = revision ? linePermalink(context, revision.source, revision.path, start, end) : null;
    link.disabled = !permalink || clipboardPending();
    link.title = permalink
      ? 'Copy a link to these lines at this exact revision'
      : 'A permalink is unavailable for this source revision.';
    code.disabled = clipboardPending();
    link.textContent = pending?.kind === 'link' ? 'Copying…' : 'Copy permalink';
    code.textContent = pending?.kind === 'code' ? 'Copying…' : 'Copy code';
  }

  /** Returns whether a rendered row belongs to the selected source side and range. */
  function selected(row, side) {
    if (!available() || !selection || !row) return false;
    if (side !== 'unified' && side !== (selection.side === 'oldLine' ? 'old' : 'new')) return false;
    const line = row[selection.side];
    return Number.isInteger(line) && line >= selection.start && line <= selection.end;
  }

  /** Starts a range or extends its anchor only within the same source revision. */
  function choose(side, line, extend = false) {
    if (
      !available() ||
      !['oldLine', 'newLine'].includes(side) ||
      (!diff && side === 'oldLine') ||
      !Number.isSafeInteger(line) ||
      line < 1 ||
      !rows.some(row => row[side] === line)
    )
      return;
    const anchor = extend && selection?.side === side ? selection.anchor : line;
    selection = {side, anchor, start: Math.min(anchor, line), end: Math.max(anchor, line)};
    clearStatus();
    update();
    draw();
  }

  /** Drops the range and any feedback, leaving file text and position unchanged. */
  function clear() {
    if (!available()) return;
    selection = undefined;
    clearStatus();
    update();
    draw();
  }

  /** Serializes native writes across viewers, publishing feedback only for the original owned range. */
  async function copy(kind) {
    if (!available() || !selection || clipboardPending() || (kind === 'link' && !permalink)) return;
    const operation = {selection, kind};
    const text =
      kind === 'link'
        ? permalink
        : rows
            .filter(row => row[selection.side] >= selection.start && row[selection.side] <= selection.end)
            .map(row => row.text)
            .join('\n');
    pending = operation;
    clearStatus();
    setClipboardPending(true);
    let failure = false;
    try {
      if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
    } catch {
      failure = true;
    } finally {
      pending = null;
      // Release the shared gate even if this viewer was disposed while the native operation was pending.
      setClipboardPending(false);
    }
    if (!available()) return;
    if (selection === operation.selection) {
      status.textContent = failure
        ? 'Could not copy. Focus this page and try again.'
        : kind === 'link'
          ? 'Permalink copied.'
          : 'Code copied.';
      status.classList.toggle('error', failure);
    }
    update();
  }

  listen(link, 'click', () => copy('link'));
  listen(code, 'click', () => copy('code'));
  listen(reset, 'click', () => {
    if (!available()) return;
    clear();
    shell.body.focus();
  });
  onCleanup(() => {
    live = false;
    selection = undefined;
    pending = null;
    group.remove();
  });
  createRenderEffect(on(clipboardPending, update));
  return {selected, choose, clear};
}
