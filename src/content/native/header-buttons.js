/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * "View full" buttons in native GitHub and GitLab diff file headers.
 *
 * Provider markup changes over time, so several header layouts are
 * supported (GitHub React and legacy, GitLab RapidDiffs and legacy).
 * Insertion is idempotent: re-rendered headers get exactly one button,
 * and navigation removes all of them.
 */

import {icon} from '../../shared/icons.js';
import {route} from '../../shared/routes.js';
import {el, empty} from '../dom.js';
import {providerName} from '../page.js';
import {diffNode} from '../viewer/viewer.js';
import {withOwner} from '../reactive.js';
import {requestFrame} from '../reactive-dom.js';

/** Creates the header-button feature: `clearHeaderButtons`, `prepareHeaderButtons` and `scheduleHeaderButtons`. */
export function createHeaderButtons(app) {
  const {state, run} = app;
  let fullViewPaths = new Map();
  let headerFrame;

  /** Removes every inserted button and forgets the diff files. */
  function clearHeaderButtons() {
    headerFrame?.();
    headerFrame = null;
    fullViewPaths.clear();
    document.querySelectorAll('.codetree-view-full').forEach(button => button.remove());
  }

  /**
   * Indexes the diff files by path, previous path and GitHub `diff-<SHA-256>`
   * anchor, then inserts the buttons.
   */
  async function prepareHeaderButtons(diff, epoch) {
    const context = state.context;
    const alive = app.pageAlive || (() => true);
    const paths = new Map();
    await Promise.all(
      diff.files.map(async file => {
        for (const path of [file.filename, file.previous_filename].filter(Boolean)) {
          paths.set(path, file);
          if (context.provider === 'github') {
            const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
            paths.set(
              'diff-' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''),
              file,
            );
          }
        }
      }),
    );
    if (!alive() || epoch !== state.epoch || state.diff !== diff) return;
    fullViewPaths = paths;
    document.querySelectorAll('.codetree-view-full').forEach(button => button.remove());
    injectHeaderButtons();
  }

  /**
   * Adds a button to every native file header without one.
   *
   * Known binary file types get a disabled button.
   */
  function injectHeaderButtons() {
    if (!['pull', 'commit'].includes(state.context?.kind)) return;
    const epoch = state.epoch;
    const cards = new Set(
      document.querySelectorAll(
        '[id^="diff-"][role="region"], [id^="diff-"].file, .file[data-path], .diffcard[data-path], article.rd-diff-file, .diff-file, .file-holder',
      ),
    );
    if (state.context.provider === 'github') {
      for (const header of document.querySelectorAll('[class*="DiffFileHeader-module__diff-file-header"]')) {
        const card = header.closest('[role="region"]');
        if (card) cards.add(card);
      }
    }
    for (const card of cards) {
      let path =
        card.getAttribute('data-path') ||
        card.getAttribute('data-file-path') ||
        card.querySelector('[data-file-path]')?.getAttribute('data-file-path');
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
      const header = card.querySelector(
        '[class*="DiffFileHeader-module__diff-file-header"], .rd-diff-file-header, .file-header, .diffhead',
      );
      if (!header || header.querySelector('.codetree-view-full')) continue;
      const actions =
        header.querySelector('.rd-diff-file-info, .file-actions') ||
        (header.className.includes('DiffFileHeader-module__') ? header.lastElementChild : header);
      const filename = file?.filename || path;
      const binary =
        /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|ttf|otf|woff2?|pdf|zip|gz|7z|rar|mp[34]|mov|ogg|wav|wasm|exe|dll|so|dylib)$/i.test(
          filename,
        );
      const full = el(
        'button',
        {
          type: 'button',
          class: 'codetree-view-full',
          'aria-label': `View full file: ${filename}`,
          title: binary ? 'Binary file: text preview unavailable' : 'See the whole file with its changes · Codetree',
          disabled: binary ? '' : null,
          onClick: event => {
            event.preventDefault();
            event.stopPropagation();
            if (epoch === state.epoch) run(() => showHeaderDiff(filename, card.id))();
          },
        },
        [icon('eye'), document.createTextNode('View full')],
      );
      card.setAttribute('data-codetree-file', filename);
      if (actions === header) header.insertBefore(full, header.querySelector('.view') || null);
      else actions.prepend(full);
    }
  }

  /**
   * Opens the full-file viewer from a native header.
   *
   * Works with a closed sidebar: the diff is loaded on demand, and errors
   * offer account connection and retry.
   */
  async function showHeaderDiff(path, cardID) {
    const file = fullViewPaths.get(path) || fullViewPaths.get(cardID);
    if (file && state.diff) {
      await app.showDiff(diffNode(file));
      return;
    }
    const shell = app.viewerShell(path, 'Full-file preview');
    const epoch = state.epoch;
    shell.body.replaceChildren(
      empty('Loading file revisions', `Loading this review from ${providerName(state.context)}…`, 'refresh'),
    );
    try {
      const diff = await app.rpc('DIFF');
      if (epoch !== state.epoch || !app.isCurrent(shell)) return;
      app.applyDiff(diff);
      await prepareHeaderButtons(diff, epoch);
      if (epoch !== state.epoch || !app.isCurrent(shell)) return;
      const matched = fullViewPaths.get(path) || fullViewPaths.get(cardID);
      if (!matched) throw new Error('This file is not in the current review. Refresh the page and try again.');
      await app.showDiff(diffNode(matched));
    } catch (error) {
      if (epoch !== state.epoch || !app.isCurrent(shell)) return;
      shell.body.replaceChildren(
        empty('Full-file preview unavailable', error.message, 'account', [
          el('button', {
            type: 'button',
            class: 'small-button primary',
            text: 'Open Settings',
            onClick: run(() => app.rpc('OPTIONS')),
          }),
          el('button', {
            type: 'button',
            class: 'small-button',
            text: 'Retry',
            onClick: run(() => showHeaderDiff(path, cardID)),
          }),
        ]),
      );
    }
  }

  /** Re-checks native headers on the next animation frame after page updates. */
  const scheduleHeaderButtons = withOwner(() => {
    if (!headerFrame)
      headerFrame = requestFrame(() => {
        headerFrame = null;
        app.positionHandle();
        if (['pull', 'commit'].includes(state.context?.kind)) injectHeaderButtons();
      });
  });
  return {clearHeaderButtons, prepareHeaderButtons, scheduleHeaderButtons};
}
