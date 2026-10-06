/* Idempotent "View full" buttons in native GitHub/GitLab diff file headers. */
import {icon} from '../../shared/icons.js';
import {route} from '../../shared/routes.js';
import {el, empty} from '../dom.js';
import {providerName} from '../page.js';
import {diffNode} from '../viewer/viewer.js';

export function createHeaderButtons(app) {
  const {state, run} = app;
  let fullViewPaths = new Map(); let headerFrame = 0;

  function clearHeaderButtons() {
    fullViewPaths.clear(); document.querySelectorAll('.code-tree-view-full').forEach(button => button.remove());
  }
  async function prepareHeaderButtons(diff, epoch) {
    const paths = new Map();
    await Promise.all(diff.files.map(async file => {
      for (const path of [file.filename, file.previous_filename].filter(Boolean)) {
        paths.set(path, file);
        if (state.context.provider === 'github') {
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
          paths.set('diff-' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), file);
        }
      }
    }));
    if (epoch !== state.epoch || state.diff !== diff) return;
    fullViewPaths = paths;
    document.querySelectorAll('.code-tree-view-full').forEach(button => button.remove());
    injectHeaderButtons();
  }
  function injectHeaderButtons() {
    if (!['pull', 'commit'].includes(state.context?.kind)) return;
    const epoch = state.epoch;
    const cards = new Set(document.querySelectorAll('[id^="diff-"][role="region"], [id^="diff-"].file, .file[data-path], .diffcard[data-path], article.rd-diff-file, .diff-file, .file-holder'));
    if (state.context.provider === 'github') {
      for (const header of document.querySelectorAll('[class*="DiffFileHeader-module__diff-file-header"]')) {
        const card = header.closest('[role="region"]'); if (card) cards.add(card);
      }
    }
    for (const card of cards) {
      let path = card.getAttribute('data-path') || card.getAttribute('data-file-path') || card.querySelector('[data-file-path]')?.getAttribute('data-file-path');
      if (!path && state.context.provider === 'gitlab') {
        const link = card.querySelector('.rd-diff-file-link[href], .file-title-name[href]');
        if (link) {
          const target = route(new URL(link.getAttribute('href'), location.href).href, 'gitlab');
          if (target?.kind === 'blob') path = target.tail.slice(target.tail.indexOf('/') + 1);
        }
      }
      const file = fullViewPaths.get(path) || fullViewPaths.get(card.id);
      if (!path) path = file?.filename;
      if (!path) continue;
      const header = card.querySelector('[class*="DiffFileHeader-module__diff-file-header"], .rd-diff-file-header, .file-header, .diffhead');
      if (!header || header.querySelector('.code-tree-view-full')) continue;
      const actions = header.querySelector('.rd-diff-file-info, .file-actions') || (header.className.includes('DiffFileHeader-module__') ? header.lastElementChild : header);
      const filename = file?.filename || path;
      const binary = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|ttf|otf|woff2?|pdf|zip|gz|7z|rar|mp[34]|mov|ogg|wav|wasm|exe|dll|so|dylib)$/i.test(filename);
      const full = el('button', {type: 'button', class: 'code-tree-view-full', 'aria-label': `View full file: ${filename}`,
        title: binary ? 'Binary file: text preview unavailable' : 'See the whole file with its changes · Codetree', disabled: binary ? '' : null,
        onClick: event => { event.preventDefault(); event.stopPropagation(); if (epoch === state.epoch) run(() => showHeaderDiff(filename, card.id))(); }}, [icon('eye'), document.createTextNode('View full')]);
      card.setAttribute('data-code-tree-file', filename);
      if (actions === header) header.insertBefore(full, header.querySelector('.view') || null);
      else actions.prepend(full);
    }
  }
  async function showHeaderDiff(path, cardId) {
    const file = fullViewPaths.get(path) || fullViewPaths.get(cardId);
    if (file && state.diff) { await app.showDiff(diffNode(file)); return; }
    const shell = app.viewerShell(path, 'Full-file preview'); const epoch = state.epoch;
    shell.body.replaceChildren(empty('Loading file revisions', `Loading this review from ${providerName(state.context)}…`, 'refresh'));
    try {
      const diff = await app.rpc('DIFF');
      if (epoch !== state.epoch || !app.isCurrent(shell)) return;
      state.diff = diff; await prepareHeaderButtons(diff, epoch);
      if (epoch !== state.epoch || !app.isCurrent(shell)) return;
      const matched = fullViewPaths.get(path) || fullViewPaths.get(cardId);
      if (!matched) throw new Error('This file is not in the current review. Refresh the page and try again.');
      await app.showDiff(diffNode(matched));
    } catch (error) {
      if (epoch !== state.epoch || !app.isCurrent(shell)) return;
      shell.body.replaceChildren(empty('Full-file preview unavailable', error.message, 'account'));
      shell.bottom.prepend(el('button', {type: 'button', text: 'Connect account in Settings', onClick: run(() => app.rpc('OPTIONS'))}),
        el('button', {type: 'button', text: 'Retry', onClick: run(() => showHeaderDiff(path, cardId))}));
    }
  }
  function scheduleHeaderButtons() {
    if (!headerFrame) headerFrame = requestAnimationFrame(() => {
      headerFrame = 0; app.positionHandle();
      if (['pull', 'commit'].includes(state.context?.kind)) injectHeaderButtons();
    });
  }
  return {clearHeaderButtons, prepareHeaderButtons, scheduleHeaderButtons};
}
