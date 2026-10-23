/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Bounded, virtualized file contents shared by in-page tabs and the diff dialog.
 *
 * Changed files use exact source revisions and validated patches. The caller
 * owns the shell and supplies a liveness check to cancel stale highlighting
 * and rendering when a tab, page or dialog is replaced.
 */

import {lines, fullDiff} from '../../shared/diff.js';
import {el} from '../dom.js';
import {providerName} from '../page.js';
import {createRenderEffect, on, onCleanup, runWithOwner} from '../reactive.js';
import {listen, requestFrame} from '../reactive-dom.js';
import {tokenize} from './syntax.js';

/**
 * Loads and renders both exact revisions of a changed file.
 *
 * The patch must describe the complete revisions, with at most 100,000
 * combined lines. Highlighting falls back to plain text for both revisions
 * when either exceeds the token budget.
 *
 * @param {object} app The content feature context.
 * @param {{actions: Element, body: Element, bottom: Element, owner: object}} shell Owned viewport and footer.
 * @param {object} node A changed file in tree-node form.
 * @param {object} diff The request's exact base and head revisions.
 * @param {() => boolean} current Whether this render still owns the shell.
 */
export async function renderDiffFile(app, shell, node, diff, current) {
  const [before, after] = await Promise.all([
    node.status === 'added' || !diff.base.sha
      ? ''
      : app.rpc('FILE', {source: diff.base, path: node.previous_filename || node.path}),
    node.status === 'removed' ? '' : app.rpc('FILE', {source: diff.head, path: node.path}),
  ]);
  if (!current()) return;
  if (lines(before).length + lines(after).length > 100000)
    throw new Error(
      `This file exceeds the 100,000 combined line text-preview limit. Open it on ${providerName(app.state.context)}.`,
    );
  const rows = fullDiff(before, after, node.patch);
  const [oldSyntax, newSyntax] = await Promise.all([
    tokenize(before, node.previous_filename || node.path, current),
    tokenize(after, node.path, current),
  ]);
  if (!current()) return;
  if (oldSyntax.limited || newSyntax.limited) {
    oldSyntax.lines = [];
    newSyntax.lines = [];
  }
  renderRows(app, shell, rows, oldSyntax, newSyntax, current, true);
  shell.bottom.prepend(
    el('span', {class: 'adds', text: `+${node.adds}`}),
    el('span', {class: 'dels', text: `−${node.dels}`}),
    el('span', {text: `${rows.length} lines · UTF-8`}),
  );
  if (oldSyntax.limited || newSyntax.limited)
    shell.bottom.append(el('span', {text: 'Syntax limit reached · plain text'}));
  if (before.endsWith('\n') !== after.endsWith('\n') || before.includes('\r\n') !== after.includes('\r\n'))
    shell.bottom.append(el('span', {text: 'Line-ending / final newline changed'}));
}

/**
 * Renders repository text that the caller has already loaded at its revision.
 *
 * Plain files have only current line numbers and the same 100,000-line,
 * syntax-token and viewport limits as changed files.
 *
 * @param {object} app The content feature context.
 * @param {{body: Element, bottom: Element, owner: object}} shell Owned viewport and footer.
 * @param {string} path The repository path used for highlighting.
 * @param {string} text The complete file text.
 * @param {() => boolean} current Whether this render still owns the shell.
 */
export async function renderTextFile(app, shell, path, text, current) {
  if (!current()) return;
  const fileLines = lines(text);
  if (fileLines.length > 100000)
    throw new Error(
      `This file exceeds the 100,000 line text-preview limit. Open it on ${providerName(app.state.context)}.`,
    );
  const rows = fileLines.map((text, index) => ({type: 'context', text, oldLine: null, newLine: index + 1}));
  const syntax = await tokenize(text, path, current);
  if (!current()) return;
  if (syntax.limited) syntax.lines = [];
  renderRows(app, shell, rows, {lines: []}, syntax, current);
  shell.bottom.prepend(el('span', {text: `${rows.length} lines · UTF-8`}));
  if (syntax.limited) shell.bottom.append(el('span', {text: 'Syntax limit reached · plain text'}));
}

/**
 * Pairs each contiguous change block without crossing unchanged context.
 * Rows remain references to the validated unified diff; empty sides are gaps,
 * not invented source lines. The index maps keep scroll metadata in unified coordinates.
 */
function splitRows(rows) {
  const pairs = [];
  const unifiedToSplit = [];
  const splitToUnified = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].type === 'context') {
      unifiedToSplit[index] = pairs.length;
      splitToUnified.push(index);
      pairs.push([rows[index], rows[index]]);
      index++;
      continue;
    }
    const removed = [];
    const added = [];
    while (index < rows.length && rows[index].type !== 'context') {
      (rows[index].type === 'removed' ? removed : added).push(index++);
    }
    for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) {
      const oldIndex = removed[offset];
      const newIndex = added[offset];
      if (oldIndex !== undefined) unifiedToSplit[oldIndex] = pairs.length;
      if (newIndex !== undefined) unifiedToSplit[newIndex] = pairs.length;
      splitToUnified.push(oldIndex ?? newIndex);
      pairs.push([rows[oldIndex], rows[newIndex]]);
    }
  }
  return {pairs, unifiedToSplit, splitToUnified};
}

/** Creates one source row or an empty alignment gap, rendering syntax as text nodes only. */
function codeRow(row, side, oldSyntax, newSyntax) {
  if (!row) return el('div', {class: 'code-row diff-gap', 'aria-hidden': 'true'});
  const text = el('span', {class: 'line-text'});
  const old = side === 'old' || (side === 'unified' && row.type === 'removed');
  const tokens = old ? oldSyntax.lines[row.oldLine - 1] : newSyntax.lines[row.newLine - 1];
  let position = 0;
  for (const token of tokens || []) {
    text.append(
      document.createTextNode(row.text.slice(position, token.start)),
      el('span', {class: `syntax-${token.type}`, text: row.text.slice(token.start, token.end)}),
    );
    position = token.end;
  }
  text.append(document.createTextNode(row.text.slice(position)));
  const numbers = side === 'unified' ? [row.oldLine, row.newLine] : [old ? row.oldLine : row.newLine];
  return el('div', {class: `code-row ${row.type}`}, [
    ...numbers.map(number => el('span', {class: 'line-number', text: number || ''})),
    el('span', {class: 'line-sign', text: row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' '}),
    text,
  ]);
}

/** Installs owned virtualized viewports; switching layout reuses validated rows and syntax without fetching. */
function renderRows(app, shell, rows, oldSyntax, newSyntax, current, diff = false) {
  let rowHeight = Math.max(22, app.state.preferences.fontSize + 8);
  let split = false;
  let projection;
  let splitAnchor;
  let frame = 0;
  const code = el('div', {class: 'code-spacer'});
  const oldCode = el('div', {class: 'code-spacer'});
  const newCode = el('div', {class: 'code-spacer'});
  const oldPane = el('div', {class: 'split-diff-pane', tabindex: '0', 'aria-label': 'Old revision'}, [oldCode]);
  const newPane = el('div', {class: 'split-diff-pane', tabindex: '0', 'aria-label': 'New revision'}, [newCode]);
  const labels = el('div', {class: 'split-diff-labels'}, [el('span', {text: 'Old'}), el('span', {text: 'New'})]);
  const panes = el('div', {class: 'split-diff-panes'}, [oldPane, newPane]);
  const maxLength = rows.reduce((max, row) => Math.max(max, row.text.length), 0);

  /** Reads the visible position in canonical unified coordinates, independent of the current layout. */
  function readPosition() {
    const viewport = split ? oldPane : shell.body;
    const line = viewport.scrollTop / rowHeight;
    const index = Math.floor(line);
    const unified = split
      ? splitAnchor?.index === index
        ? splitAnchor.unified
        : (projection.splitToUnified[index] ?? 0)
      : index;
    return {top: (unified + line - index) * rowHeight, left: viewport.scrollLeft};
  }

  /** Restores a canonical position, synchronizing both revisions in split mode. */
  function restorePosition(position) {
    const line = position.top / rowHeight;
    const index = Math.floor(line);
    const target = split ? (projection.unifiedToSplit[Math.min(index, rows.length - 1)] ?? 0) : index;
    // Keep the exact source side when two unified rows share a split row, until scrolling to another row.
    splitAnchor = split ? {index: target, unified: index} : null;
    for (const viewport of split ? [oldPane, newPane] : [shell.body]) {
      viewport.scrollTop = (target + line - index) * rowHeight;
    }
    draw();
    for (const viewport of split ? [oldPane, newPane] : [shell.body]) viewport.scrollLeft = position.left;
  }

  /** Replaces only rows around the active scroll position while this shell is live. */
  function draw() {
    frame = 0;
    if (!current()) return;
    const viewport = split ? oldPane : shell.body;
    const count = split ? projection.pairs.length : rows.length;
    const start = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - 6);
    const end = Math.min(count, start + Math.ceil(viewport.clientHeight / rowHeight) + 14);
    for (const [container, side] of split
      ? [
          [oldCode, 'old'],
          [newCode, 'new'],
        ]
      : [[code, 'unified']]) {
      const fragment = document.createDocumentFragment();
      for (let index = start; index < end; index++) {
        const row = split ? projection.pairs[index][side === 'old' ? 0 : 1] : rows[index];
        const element = codeRow(row, side, oldSyntax, newSyntax);
        element.style.top = `${index * rowHeight}px`;
        fragment.append(element);
      }
      container.replaceChildren(fragment);
    }
    if (split) {
      // Tabs and wide glyphs can exceed the estimate. Equalize actual overflow before either pane scrolls.
      const overflow = Math.max(oldCode.scrollWidth - oldPane.clientWidth, newCode.scrollWidth - newPane.clientWidth);
      oldCode.style.width = `${overflow + oldPane.clientWidth}px`;
      newCode.style.width = `${overflow + newPane.clientWidth}px`;
    }
  }

  /** Keeps paired panes equally wide so horizontal and vertical scroll ranges match. */
  function sizeViewports() {
    const textWidth = Math.min(4000, maxLength) * app.state.preferences.fontSize * 0.65;
    shell.body.style.setProperty('--diff-row-height', `${rowHeight}px`);
    code.style.height = `${rows.length * rowHeight}px`;
    code.style.width = `${Math.max(600, 128 + textWidth)}px`;
    for (const container of [oldCode, newCode]) {
      container.style.height = `${(projection?.pairs.length || 0) * rowHeight}px`;
      container.style.width = `${Math.max(300, 100 + textWidth)}px`;
    }
  }

  /** Applies live font metrics without moving the source line at the top of the viewport. */
  function relayout() {
    if (!current()) return;
    const position = readPosition();
    const line = position.top / rowHeight;
    rowHeight = Math.max(22, app.state.preferences.fontSize + 8);
    sizeViewports();
    restorePosition({top: line * rowHeight, left: position.left});
  }

  shell.readPosition = readPosition;
  shell.restorePosition = restorePosition;
  shell.relayout = relayout;
  shell.body.replaceChildren(code);
  runWithOwner(shell.owner, () => {
    for (const viewport of [shell.body, oldPane, newPane]) {
      listen(
        viewport,
        'scroll',
        () => {
          if (!current() || (split ? viewport === shell.body : viewport !== shell.body)) return;
          if (split) {
            const other = viewport === oldPane ? newPane : oldPane;
            if (other.scrollTop !== viewport.scrollTop) other.scrollTop = viewport.scrollTop;
            if (other.scrollLeft !== viewport.scrollLeft) other.scrollLeft = viewport.scrollLeft;
            shell.onScroll?.();
          }
          if (!frame) frame = requestFrame(draw);
        },
        {passive: true},
      );
    }
    if (!diff) return;
    listen(window, 'resize', relayout);
    createRenderEffect(on(() => app.state.preferences.fontSize, relayout));
    const controls = el('div', {class: 'diff-layout', role: 'group', 'aria-label': 'Diff layout'});
    for (const [value, label] of [
      ['unified', 'Unified'],
      ['split', 'Side-by-side'],
    ]) {
      const control = el('button', {type: 'button', text: label, 'aria-pressed': 'false'});
      listen(control, 'click', () => {
        if (current()) app.state.diffLayout = value;
      });
      controls.append(control);
    }
    shell.actions.prepend(controls);
    onCleanup(() => controls.remove());
    createRenderEffect(
      on(
        () => app.state.diffLayout,
        value => {
          if (!current()) return;
          const position = readPosition();
          split = value === 'split';
          if (split) projection ??= splitRows(rows);
          shell.body.classList.toggle('split-diff', split);
          shell.body.replaceChildren(...(split ? [labels, panes] : [code]));
          for (const [index, control] of Array.from(controls.children).entries())
            control.setAttribute('aria-pressed', String(split === (index === 1)));
          sizeViewports();
          restorePosition(position);
          shell.onScroll?.();
        },
      ),
    );
  });
  relayout();
}
