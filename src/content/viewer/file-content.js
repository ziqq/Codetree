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
import {runWithOwner} from '../reactive.js';
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
 * @param {{body: Element, bottom: Element, owner: object}} shell Owned viewport and footer.
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
  renderRows(app, shell, rows, oldSyntax, newSyntax, current);
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

/** Installs an owned, virtualized viewport for validated diff or plain-text rows. */
function renderRows(app, shell, rows, oldSyntax, newSyntax, current) {
  let rowHeight = Math.max(22, app.state.preferences.fontSize + 8);
  const code = el('div', {class: 'code-spacer'});
  code.style.height = `${rows.length * rowHeight}px`;
  const maxLength = rows.reduce((max, row) => Math.max(max, row.text.length), 0);
  code.style.width = `${Math.max(600, 128 + Math.min(4000, maxLength) * app.state.preferences.fontSize * 0.65)}px`;
  let frame = 0;

  /** Replaces only rows around the visible scroll position while this shell is live. */
  function draw() {
    frame = 0;
    if (!current()) return;
    const start = Math.max(0, Math.floor(shell.body.scrollTop / rowHeight) - 6);
    const end = Math.min(rows.length, start + Math.ceil(shell.body.clientHeight / rowHeight) + 14);
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index++) {
      const row = rows[index];
      const text = el('span', {class: 'line-text'});
      let position = 0;
      const tokens = row.type === 'removed' ? oldSyntax.lines[row.oldLine - 1] : newSyntax.lines[row.newLine - 1];
      for (const token of tokens || []) {
        text.append(
          document.createTextNode(row.text.slice(position, token.start)),
          el('span', {class: `syntax-${token.type}`, text: row.text.slice(token.start, token.end)}),
        );
        position = token.end;
      }
      text.append(document.createTextNode(row.text.slice(position)));
      const element = el('div', {class: `code-row ${row.type}`}, [
        el('span', {class: 'line-number', text: row.oldLine || ''}),
        el('span', {class: 'line-number', text: row.newLine || ''}),
        el('span', {class: 'line-sign', text: row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' '}),
        text,
      ]);
      element.style.top = `${index * rowHeight}px`;
      fragment.append(element);
    }
    code.replaceChildren(fragment);
  }

  /** Applies live font metrics without moving the logical line at the top of the viewport. */
  function relayout() {
    if (!current()) return;
    const line = shell.body.scrollTop / rowHeight;
    rowHeight = Math.max(22, app.state.preferences.fontSize + 8);
    code.style.height = `${rows.length * rowHeight}px`;
    code.style.width = `${Math.max(600, 128 + Math.min(4000, maxLength) * app.state.preferences.fontSize * 0.65)}px`;
    shell.body.scrollTop = line * rowHeight;
    draw();
  }

  shell.relayout = relayout;
  shell.body.replaceChildren(code);
  runWithOwner(shell.owner, () =>
    listen(
      shell.body,
      'scroll',
      () => {
        if (!frame) frame = requestFrame(draw);
      },
      {passive: true},
    ),
  );
  draw();
}
