/**
 * Full-file diff and review-comment viewer in a modal dialog.
 *
 * Each opened view gets a generation number; closing the dialog, opening
 * another file or navigating invalidates replies for the previous view.
 *
 * @module content/viewer/viewer
 */
import {lines, fullDiff} from '../../shared/diff.js';
import {button, el, empty} from '../dom.js';
import {providerName} from '../page.js';
import {tokenize} from './syntax.js';

/** Converts a diff file to a tree node shape used by the viewer. */
export function diffNode(file) {
  return {...file, path: file.filename, type: 'blob', adds: file.additions, dels: file.deletions};
}

/** Creates the viewer feature: `closeViewer`, `isCurrent`, `viewerShell`, `showDiff` and `showComments`. */
export function createViewer(app) {
  const {state, run} = app;
  const {viewer} = app.view;
  let generation = 0;
  viewer.addEventListener('close', () => {
    generation++;
  });

  /** Closes the dialog and invalidates its pending work. */
  function closeViewer() {
    generation++;
    if (viewer.open) viewer.close();
  }

  /** Whether [shell] is still the open view. */
  function isCurrent(shell) {
    return shell.generation === generation;
  }

  /**
   * Opens the dialog with an empty layout for a new view.
   *
   * @returns {{actions: Element, body: Element, bottom: Element, generation: number}}
   */
  function viewerShell(title, subtitle, label = 'Full-file diff') {
    generation++;
    viewer.setAttribute('aria-label', label);
    const heading = el('div', {class: 'viewer-heading'}, [el('strong', {text: title}), el('small', {text: subtitle})]);
    const actions = el('div', {class: 'viewer-actions'}, [button('close', 'Close viewer', () => viewer.close())]);
    const viewerBody = el('div', {class: 'viewer-body'});
    const bottom = el('div', {class: 'viewer-bottom'});
    viewer.replaceChildren(
      el('div', {class: 'viewer-inner'}, [el('div', {class: 'viewer-header'}, [heading, actions]), viewerBody, bottom]),
    );
    if (!viewer.open) viewer.showModal();
    return {actions, body: viewerBody, bottom, generation};
  }

  /**
   * Shows a whole changed file with highlighted changes and both line numbers.
   *
   * Both revisions are loaded at the exact request revisions and validated
   * against the patch. Rows are virtualized; syntax highlighting is skipped
   * above its token budget. Previous/next cover every changed file.
   */
  async function showDiff(node) {
    const diff = state.diff;
    if (!diff) return;
    const shell = viewerShell(
      node.path,
      `${diff.base.sha?.slice(0, 7) || 'empty'} → ${diff.head.sha.slice(0, 7)} · full-file context`,
    );
    shell.body.replaceChildren(
      empty('Loading file revisions', `Fetching the complete text from ${providerName(state.context)}…`, 'refresh'),
    );
    const originalURL = await app.diffURL(node);
    shell.actions.prepend(
      el('a', {
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
      const [before, after] = await Promise.all([
        node.status === 'added' || !diff.base.sha
          ? ''
          : app.rpc('FILE', {source: diff.base, path: node.previous_filename || node.path}),
        node.status === 'removed' ? '' : app.rpc('FILE', {source: diff.head, path: node.path}),
      ]);
      if (!isCurrent(shell)) return;
      if (lines(before).length + lines(after).length > 100000)
        throw new Error(
          `This file exceeds the 100,000 combined line text-preview limit. Open it on ${providerName(state.context)}.`,
        );
      const rows = fullDiff(before, after, node.patch);
      const current = () => isCurrent(shell);
      const [oldSyntax, newSyntax] = await Promise.all([
        tokenize(before, node.previous_filename || node.path, current),
        tokenize(after, node.path, current),
      ]);
      if (!current()) return;
      if (oldSyntax.limited || newSyntax.limited) {
        oldSyntax.lines = [];
        newSyntax.lines = [];
      }
      const rowHeight = Math.max(22, state.preferences.fontSize + 8);
      const code = el('div', {class: 'code-spacer'});
      code.style.height = `${rows.length * rowHeight}px`;
      const maxLength = rows.reduce((max, row) => Math.max(max, row.text.length), 0);
      code.style.width = `${Math.max(600, 128 + Math.min(4000, maxLength) * state.preferences.fontSize * 0.65)}px`;
      let frame = 0;
      const draw = () => {
        frame = 0;
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
      };
      shell.body.replaceChildren(code);
      shell.body.addEventListener(
        'scroll',
        () => {
          if (!frame) frame = requestAnimationFrame(draw);
        },
        {passive: true},
      );
      shell.bottom.prepend(
        el('span', {class: 'adds', text: `+${node.adds}`}),
        el('span', {class: 'dels', text: `−${node.dels}`}),
        el('span', {text: `${rows.length} lines · UTF-8`}),
      );
      if (oldSyntax.limited || newSyntax.limited)
        shell.bottom.append(el('span', {text: 'Syntax limit reached · plain text'}));
      if (before.endsWith('\n') !== after.endsWith('\n') || before.includes('\r\n') !== after.includes('\r\n'))
        shell.bottom.append(el('span', {text: 'Line-ending / final newline changed'}));
      draw();
    } catch (error) {
      if (isCurrent(shell)) shell.body.replaceChildren(empty('Text preview unavailable', error.message, 'diff'));
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
  return {closeViewer, isCurrent, viewerShell, showDiff, showComments};
}
