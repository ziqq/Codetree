/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Virtualized tree rows, keyboard navigation, Viewed marks and navigation
 * to files and native diffs.
 *
 * Only the rows in the scrolled viewport (plus a small buffer) exist in
 * the DOM, so large repositories stay responsive.
 */

import {icon} from '../../shared/icons.js';
import {blobURL, pullURL, repoURL} from '../../shared/routes.js';
import {fileKind, flatten} from '../../shared/tree.js';
import {button, el, highlight} from '../dom.js';
import {fileIconElement, matchIcon} from './file-icons.js';
import {createMemo, createRenderEffect, createSignal, on, onCleanup, withOwner} from '../reactive.js';
import {requestFrame} from '../reactive-dom.js';

/** Fixed tree-row height in pixels; virtualization depends on it. */
const rowHeight = 29;

/** Creates the tree feature: `updateTree`, `requestTreeRender`, `renderTreeRows`, `diffURL` and `openFile`. */
export function createTree(app) {
  const {state, run} = app;
  const {host, shadow, body, spacer} = app.view;
  let renderFrame;
  const [treeVersion, setTreeVersion] = createSignal(0);

  /**
   * Returns the icon of a row: a file-icons glyph for Color and Monochrome,
   * or an original icon for Minimal and for files without a rule.
   */
  function nodeIcon(node, folder) {
    const theme = state.preferences.iconTheme;
    const rule = theme === 'minimal' ? null : matchIcon(node.path, folder);
    if (rule) return fileIconElement(rule, {coloured: theme === 'color', dark: host.dataset.theme === 'dark'});
    const kind = folder ? 'folder' : fileKind(node.path);
    const svg = icon(
      folder && state.expanded.has(node.path) ? 'folder-open' : kind === 'code' ? 'file-code' : kind,
      'file-icon',
    );
    svg.classList.add(`kind-${kind}`);
    return svg;
  }

  /** Recomputes the visible rows after expansion, search or data changes. */
  function updateTree() {
    setTreeVersion(value => value + 1);
  }

  /** Renders the visible rows on the next animation frame, at most once per frame. */
  const requestTreeRender = withOwner(() => {
    if (!renderFrame)
      renderFrame = requestFrame(() => {
        renderFrame = null;
        renderTreeRows();
      });
  });

  /** Renders the rows in the viewport, keeping keyboard focus on the same path. */
  function renderTreeRows() {
    if (state.tab !== 'files' || state.loading || state.error || !body.contains(spacer)) return;
    const start = Math.max(0, Math.floor(body.scrollTop / rowHeight) - 6);
    const end = Math.min(state.flat.length, start + Math.ceil(body.clientHeight / rowHeight) + 14);
    const focusedPath = shadow.activeElement?.closest?.('.tree-row')?.dataset.path;
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index++) {
      const node = state.flat[index];
      const folder = node.type === 'tree';
      const row = el('div', {
        class: `tree-row${node.path === state.selected ? ' selected' : ''}${node.viewed ? ' viewed' : ''}`,
        role: 'treeitem',
        'aria-level': node.depth,
        'aria-label': node.path,
        tabindex: index === state.focus ? '0' : '-1',
        'data-path': node.path,
        title: node.previous_filename ? `${node.previous_filename} → ${node.path}` : node.path,
      });
      row.style.top = `${index * rowHeight}px`;
      row.style.setProperty('--indent', `${9 + (node.depth - 1) * 14}px`);
      if (folder) {
        row.setAttribute('aria-expanded', String(Boolean(state.query) || state.expanded.has(node.path)));
        row.append(
          el(
            'button',
            {
              type: 'button',
              class: 'disclosure',
              'aria-label': `Toggle folder: ${node.path}`,
              onClick: event => {
                event.stopPropagation();
                state.focus = index;
                run(() => app.toggleFolder(node))();
              },
            },
            [icon('chevron')],
          ),
        );
      } else row.append(el('span', {class: 'spacer'}));
      row.append(nodeIcon(node, folder));
      row.append(highlight(node.name, state.query));
      if (state.mode === 'changes') {
        if (node.status)
          row.append(
            el('span', {
              class: `file-status ${node.status}`,
              text:
                {added: 'A', removed: 'D', renamed: 'R', modified: 'M'}[node.status] || node.status[0].toUpperCase(),
            }),
          );
        if (node.commentCount) {
          const count = node.commentCount;
          if (count)
            row.append(
              el(
                'button',
                {
                  type: 'button',
                  class: 'comments-count',
                  title: `${count} comments`,
                  'aria-label': `Comments on ${node.path}`,
                  onClick: event => {
                    event.stopPropagation();
                    app.showComments(node);
                  },
                },
                [icon('comment'), document.createTextNode(String(count))],
              ),
            );
        }
        if (node.adds || node.dels)
          row.append(
            el('span', {class: 'file-stats'}, [
              el('span', {class: 'adds', text: node.adds ? `+${node.adds}` : ''}),
              el('span', {class: 'dels', text: node.dels ? `−${node.dels}` : ''}),
            ]),
          );
        if (!folder) {
          const full = button(
            'diff',
            `Full-file diff: ${node.path}`,
            event => {
              event.stopPropagation();
              run(() => app.showDiff(node))();
            },
            'row-action',
          );
          row.append(full);
          if (state.diff?.viewedMode !== 'none') {
            const context = state.context;
            const headSHA = state.diff.head.sha;
            const epoch = state.epoch;
            const generation = state.filesGeneration;
            const alive = app.pageAlive || (() => true);
            const checkbox = el('input', {
              type: 'checkbox',
              class: 'viewed-checkbox',
              'aria-label': `Mark ${node.path} as viewed`,
              title: state.diff?.viewedMode === 'github' ? 'Viewed on GitHub' : 'Viewed locally',
            });
            checkbox.checked = Boolean(node.viewed);
            checkbox.addEventListener('click', event => event.stopPropagation());
            checkbox.addEventListener(
              'change',
              run(async () => {
                const viewed = checkbox.checked;
                checkbox.disabled = true;
                try {
                  const result = await app.rpc('VIEWED', {context, headSHA, path: node.path, viewed});
                  if (
                    !alive() ||
                    epoch !== state.epoch ||
                    generation !== state.filesGeneration ||
                    state.diff?.head.sha !== headSHA
                  )
                    return;
                  node.viewed = result.state === 'VIEWED';
                  const entry = state.entries.find(entry => entry.path === node.path);
                  if (entry) entry.viewed = node.viewed;
                  requestTreeRender();
                } catch (error) {
                  checkbox.checked = Boolean(node.viewed);
                  throw error;
                } finally {
                  checkbox.disabled = false;
                }
              }),
            );
            row.append(checkbox);
          }
        }
      }
      row.addEventListener(
        'click',
        run(async () => {
          state.focus = index;
          if (folder) {
            if (state.preferences.folderClick) await app.toggleFolder(node);
            else {
              for (const visible of spacer.querySelectorAll('.tree-row')) visible.tabIndex = visible === row ? 0 : -1;
              row.focus();
            }
          } else await openFile(node);
        }),
      );
      row.addEventListener(
        'keydown',
        run(event => treeKey(event, node, index)),
      );
      fragment.append(row);
    }
    spacer.replaceChildren(fragment);
    if (focusedPath) spacer.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`)?.focus({preventScroll: true});
  }

  /**
   * Tree keyboard navigation: arrows move and expand/collapse, Home/End jump,
   * Enter opens a file or toggles a folder.
   */
  async function treeKey(event, node, index) {
    if (event.target !== event.currentTarget) return;
    let next = index;
    if (event.key === 'ArrowDown') next++;
    else if (event.key === 'ArrowUp') next--;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = state.flat.length - 1;
    else if (event.key === 'ArrowRight' && node.type === 'tree') {
      event.preventDefault();
      if (!state.expanded.has(node.path)) await app.toggleFolder(node);
      else next++;
    } else if (event.key === 'ArrowLeft') {
      if (node.type === 'tree' && state.expanded.has(node.path)) {
        event.preventDefault();
        await app.toggleFolder(node);
        return;
      }
      const parent = node.path.slice(0, Math.max(0, node.path.lastIndexOf('/')));
      next = state.flat.findIndex(item => item.path === parent);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (node.type === 'tree') await app.toggleFolder(node);
      else await openFile(node);
      return;
    } else return;
    event.preventDefault();
    state.focus = Math.max(0, Math.min(state.flat.length - 1, next));
    const top = state.focus * rowHeight;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (top + rowHeight > body.scrollTop + body.clientHeight) body.scrollTop = top + rowHeight - body.clientHeight;
    renderTreeRows();
    spacer.querySelector(`[data-path="${CSS.escape(state.flat[state.focus].path)}"]`)?.focus({preventScroll: true});
  }

  /**
   * Returns the native diff URL of a changed file.
   *
   * GitHub anchors are `diff-<SHA-256 of the path>` and GitLab anchors the
   * SHA-1 of the path; commits link to the commit page.
   */
  async function diffURL(node) {
    const context = state.context;
    const gitlab = context.provider === 'gitlab';
    if (context.kind === 'commit') return `${repoURL(context)}${gitlab ? '/-' : ''}/commit/${context.sha}`;
    const hash = await crypto.subtle.digest(gitlab ? 'SHA-1' : 'SHA-256', new TextEncoder().encode(node.path));
    const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    if (gitlab) return `${pullURL(context, context.number)}/diffs?file_path=${encodeURIComponent(node.path)}#${digest}`;
    const view = location.pathname.match(/\/pull\/\d+\/(files|changes)(?:\/|$)/)?.[1] || 'changes';
    return `${pullURL(context, context.number)}/${view}#diff-${digest}`;
  }

  /**
   * Opens a file: scrolls to its diff when it is on the current page,
   * otherwise navigates to the diff or file view.
   */
  async function openFile(node) {
    if (state.mode === 'changes') {
      const epoch = state.epoch;
      const generation = state.filesGeneration;
      const alive = app.pageAlive || (() => true);
      const url = await diffURL(node);
      if (!alive() || epoch !== state.epoch || generation !== state.filesGeneration) return;
      if (location.pathname === new URL(url).pathname) {
        const hash = new URL(url).hash.slice(1);
        const target =
          document.getElementById(hash) ||
          document.querySelector(`[data-codetree-file="${CSS.escape(node.path)}"]`) ||
          document.querySelector(`[data-path="${CSS.escape(node.path)}"]`);
        if (target) {
          target.scrollIntoView({block: 'start'});
          history.replaceState(null, '', url);
          app.lastURL = location.href;
          state.selected = node.path;
          return;
        }
      }
      location.assign(url);
    } else location.assign(blobURL(state.context, state.info.ref, node.path, node.type === 'commit' ? 'tree' : 'blob'));
  }
  createRenderEffect(
    on([treeVersion, () => state.expanded, () => state.query], () => {
      state.flat = flatten(state.tree, state.expanded, state.query);
      state.focus = Math.min(state.focus, Math.max(0, state.flat.length - 1));
      spacer.style.height = `${state.flat.length * rowHeight}px`;
    }),
    undefined,
    {name: 'visible tree rows'},
  );
  // Rows depend on the icon theme only; other preference writes (such as every step of a resize) are laid out
  // by `layout`, which already requests the rows.
  const iconTheme = createMemo(() => state.preferences.iconTheme, undefined, {name: 'tree icon theme'});
  createRenderEffect(
    on(
      () =>
        state.tab === 'files' && !state.loading && !state.error
          ? [state.flat, state.selected, state.mode, state.diff, iconTheme()]
          : null,
      rows => {
        if (rows) requestTreeRender();
      },
    ),
    undefined,
    {name: 'tree viewport'},
  );
  onCleanup(() => renderFrame?.());

  return {updateTree, requestTreeRender, renderTreeRows, diffURL, openFile};
}
