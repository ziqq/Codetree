/* Virtualized tree rows, keyboard navigation, Viewed marks and file navigation. */
import {icon} from '../../shared/icons.js';
import {blobURL, pullURL, repoURL} from '../../shared/routes.js';
import {fileKind, flatten} from '../../shared/tree.js';
import {button, el, highlight} from '../dom.js';

const rowHeight = 29;

export function createTree(app) {
  const {state, run} = app;
  const {shadow, body, spacer} = app.view;
  let renderFrame = 0;

  function updateTree(shouldRender = true) {
    state.flat = flatten(state.tree, state.expanded, state.query);
    state.focus = Math.min(state.focus, Math.max(0, state.flat.length - 1));
    spacer.style.height = `${state.flat.length * rowHeight}px`;
    if (shouldRender) app.render();
  }
  function requestTreeRender() {
    if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; renderTreeRows(); });
  }
  function renderTreeRows() {
    if (state.tab !== 'files' || state.loading || state.error || !body.contains(spacer)) return;
    const start = Math.max(0, Math.floor(body.scrollTop / rowHeight) - 6);
    const end = Math.min(state.flat.length, start + Math.ceil(body.clientHeight / rowHeight) + 14);
    const focusedPath = shadow.activeElement?.closest?.('.tree-row')?.dataset.path;
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index++) {
      const node = state.flat[index]; const folder = node.type === 'tree';
      const row = el('div', {class: `tree-row${node.path === state.selected ? ' selected' : ''}${node.viewed ? ' viewed' : ''}`, role: 'treeitem', 'aria-level': node.depth, 'aria-label': node.path, tabindex: index === state.focus ? '0' : '-1', 'data-path': node.path, title: node.previous_filename ? `${node.previous_filename} → ${node.path}` : node.path});
      row.style.top = `${index * rowHeight}px`; row.style.setProperty('--indent', `${9 + (node.depth - 1) * 14}px`);
      if (folder) {
        row.setAttribute('aria-expanded', String(Boolean(state.query) || state.expanded.has(node.path)));
        row.append(el('button', {type: 'button', class: 'disclosure', 'aria-label': `Toggle folder: ${node.path}`, onClick: event => {
          event.stopPropagation(); state.focus = index; run(() => app.toggleFolder(node))();
        }}, [icon('chevron')]));
      }
      else row.append(el('span', {class: 'spacer'}));
      const kind = folder ? 'folder' : fileKind(node.path); row.append(icon(folder && state.expanded.has(node.path) ? 'folder-open' : kind === 'code' ? 'file-code' : kind, 'file-icon')); row.lastChild.classList.add(`kind-${kind}`);
      row.append(highlight(node.name, state.query));
      if (state.mode === 'changes') {
        if (node.status) row.append(el('span', {class: `file-status ${node.status}`, text: ({added: 'A', removed: 'D', renamed: 'R', modified: 'M'})[node.status] || node.status[0].toUpperCase()}));
        if (node.commentCount) {
          const count = node.commentCount;
          if (count) row.append(el('button', {type: 'button', class: 'comments-count', title: `${count} comments`, 'aria-label': `Comments on ${node.path}`, onClick: event => { event.stopPropagation(); app.showComments(node); }}, [icon('comment'), document.createTextNode(String(count))]));
        }
        if (node.adds || node.dels) row.append(el('span', {class: 'file-stats'}, [el('span', {class: 'adds', text: node.adds ? `+${node.adds}` : ''}), el('span', {class: 'dels', text: node.dels ? `−${node.dels}` : ''})]));
        if (!folder) {
          const full = button('diff', `Full-file diff: ${node.path}`, event => { event.stopPropagation(); run(() => app.showDiff(node))(); }, 'row-action'); row.append(full);
          if (state.diff?.viewedMode !== 'none') {
            const context = state.context; const headSha = state.diff.head.sha;
            const epoch = state.epoch; const generation = state.filesGeneration;
            const checkbox = el('input', {type: 'checkbox', class: 'viewed-checkbox', 'aria-label': `Mark ${node.path} as viewed`, title: state.diff?.viewedMode === 'github' ? 'Viewed on GitHub' : 'Viewed locally'}); checkbox.checked = Boolean(node.viewed);
            checkbox.addEventListener('click', event => event.stopPropagation());
            checkbox.addEventListener('change', run(async () => {
              const viewed = checkbox.checked; checkbox.disabled = true;
              try {
                const result = await app.rpc('VIEWED', {context, headSha, path: node.path, viewed});
                if (epoch !== state.epoch || generation !== state.filesGeneration || state.diff?.head.sha !== headSha) return;
                node.viewed = result.state === 'VIEWED';
                const entry = state.entries.find(entry => entry.path === node.path); if (entry) entry.viewed = node.viewed;
                requestTreeRender();
              } catch (error) { checkbox.checked = Boolean(node.viewed); throw error; }
              finally { checkbox.disabled = false; }
            })); row.append(checkbox);
          }
        }
      }
      row.addEventListener('click', run(async () => { state.focus = index; if (folder) { if (state.preferences.folderClick) await app.toggleFolder(node); else row.focus(); } else await openFile(node); }));
      row.addEventListener('keydown', run(event => treeKey(event, node, index)));
      fragment.append(row);
    }
    spacer.replaceChildren(fragment);
    if (focusedPath) spacer.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`)?.focus({preventScroll: true});
  }
  async function treeKey(event, node, index) {
    if (event.target !== event.currentTarget) return;
    let next = index;
    if (event.key === 'ArrowDown') next++;
    else if (event.key === 'ArrowUp') next--;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = state.flat.length - 1;
    else if (event.key === 'ArrowRight' && node.type === 'tree') { event.preventDefault(); if (!state.expanded.has(node.path)) await app.toggleFolder(node); else next++; }
    else if (event.key === 'ArrowLeft') {
      if (node.type === 'tree' && state.expanded.has(node.path)) { event.preventDefault(); await app.toggleFolder(node); return; }
      const parent = node.path.slice(0, Math.max(0, node.path.lastIndexOf('/'))); next = state.flat.findIndex(item => item.path === parent);
    } else if (event.key === 'Enter') { event.preventDefault(); if (node.type === 'tree') await app.toggleFolder(node); else await openFile(node); return; }
    else return;
    event.preventDefault(); state.focus = Math.max(0, Math.min(state.flat.length - 1, next));
    const top = state.focus * rowHeight;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (top + rowHeight > body.scrollTop + body.clientHeight) body.scrollTop = top + rowHeight - body.clientHeight;
    renderTreeRows(); spacer.querySelector(`[data-path="${CSS.escape(state.flat[state.focus].path)}"]`)?.focus({preventScroll: true});
  }
  async function diffURL(node) {
    const gitlab = state.context.provider === 'gitlab';
    if (state.context.kind === 'commit') return `${repoURL(state.context)}${gitlab ? '/-' : ''}/commit/${state.context.sha}`;
    const hash = await crypto.subtle.digest(gitlab ? 'SHA-1' : 'SHA-256', new TextEncoder().encode(node.path));
    const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    if (gitlab) return `${pullURL(state.context, state.context.number)}/diffs?file_path=${encodeURIComponent(node.path)}#${digest}`;
    const view = location.pathname.match(/\/pull\/\d+\/(files|changes)(?:\/|$)/)?.[1] || 'changes';
    return `${pullURL(state.context, state.context.number)}/${view}#diff-${digest}`;
  }
  async function openFile(node) {
    if (state.mode === 'changes') {
      const url = await diffURL(node);
      if (location.pathname === new URL(url).pathname) {
        const hash = new URL(url).hash.slice(1); const target = document.getElementById(hash) || document.querySelector(`[data-code-tree-file="${CSS.escape(node.path)}"]`) || document.querySelector(`[data-path="${CSS.escape(node.path)}"]`);
        if (target) { target.scrollIntoView({block: 'start'}); history.replaceState(null, '', url); app.lastURL = location.href; state.selected = node.path; requestTreeRender(); return; }
      }
      location.assign(url);
    } else location.assign(blobURL(state.context, state.info.ref, node.path, node.type === 'commit' ? 'tree' : 'blob'));
  }
  return {updateTree, requestTreeRender, renderTreeRows, diffURL, openFile};
}
