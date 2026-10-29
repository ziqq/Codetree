/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned Quick Open palette over loaded files or the current file's symbols, with page-local recent paths.
 * Search never fetches folders or stores source text, history or queries.
 */

import {linePermalink} from '../shared/line-links.js';
import {compareQuickOpenMatches, parseQuickOpenQuery, quickOpenScore} from '../shared/quick-open.js';
import {icon} from '../shared/icons.js';
import {button, el} from './dom.js';
import {listen} from './reactive-dom.js';
import {createRenderEffect, on, onCleanup, withOwner} from './reactive.js';

/** Maximum retained recent paths and visible results, independent of repository size. */
const maxRecent = 20;
const maxResults = 50;

/**
 * Adds the page-owned file palette and its shortcut without sharing sidebar filters.
 *
 * @param {object} app Content feature context, including file-tab and native navigation actions.
 * @returns {{openQuickOpen: Function, closeQuickOpen: Function, rememberQuickOpenFile: Function}} Palette actions.
 */
export function createQuickOpen(app) {
  const {state} = app;
  const input = el('input', {
    type: 'search',
    placeholder: 'Find a file… path:120 or @symbol',
    'aria-label': 'Quick Open file',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': 'codetree-quick-open-results',
    maxlength: '1024',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const results = el('div', {
    class: 'quick-open-results',
    id: 'codetree-quick-open-results',
    role: 'listbox',
    'aria-label': 'Matching files',
  });
  const notice = el('div', {class: 'quick-open-notice', hidden: ''});
  const status = el('div', {class: 'quick-open-status', role: 'status', 'aria-live': 'polite'});
  const close = button('close', 'Close Quick Open', () => closeQuickOpen(), 'small-button');
  const dialog = el('dialog', {class: 'quick-open', 'aria-label': 'Quick Open'}, [
    el('div', {class: 'quick-open-inner'}, [
      el('div', {class: 'quick-open-header'}, [el('strong', {text: 'Quick Open'}), close]),
      el('div', {class: 'searchbar quick-open-search'}, [icon('search'), input]),
      el('div', {
        class: 'quick-open-hint',
        text: 'File name or path:line · @ finds symbols in this file · Enter opens · Ctrl/Cmd-click opens a new tab',
      }),
      notice,
      results,
      status,
    ]),
  ]);
  app.view.shadow.append(dialog);
  let live = true;
  let generation = 0;
  let scanGeneration = 0;
  let timer;
  let scanning = false;
  let scanPromise;
  let recent = [];
  let matches = [];
  let active = 0;
  let total = 0;
  let parsed = {query: ''};
  let pending;
  let activationError = '';
  let previousFocus;
  let symbolModel;
  let symbolModal = false;

  /** Reports the captured source honestly; an open dialog never falls back to an inline file. */
  function symbolIssue() {
    if (!symbolModel)
      return symbolModal
        ? 'Symbols are unavailable for the current View full content.'
        : 'Open a file to search its symbols.';
    if (!symbolModel.current()) return 'This file or revision changed. Reopen Quick Open to search its symbols.';
    if (!symbolModel.supported) return 'Symbol search is not supported for this file type.';
    return '';
  }

  /** Labels the exact selected source, including an old name and any parser truncation. */
  function symbolContext() {
    if (!symbolModel) return '';
    const {path, filePath, diff, side, source, limited} = symbolModel;
    return `${path}${path !== filePath ? ` (${filePath})` : ''} · ${diff ? `${side === 'old' ? 'Old' : 'New'} · ` : ''}${source?.sha?.slice(0, 7) || 'Revision unavailable'}${limited ? ' · Analysis limit reached; symbols may be incomplete.' : ''}`;
  }

  /** Reflects a count or actionable failure without interpreting provider text as HTML. */
  function feedback(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  /** Invalidates scans and activations without canceling the user's already-started navigation. */
  function invalidate() {
    generation++;
    scanGeneration++;
    clearTimeout(timer);
    scanning = false;
    scanPromise = undefined;
    pending = undefined;
    activationError = '';
    input.setAttribute('aria-busy', 'false');
  }

  /** Returns only complete loaded file entries, deduplicating by repository-relative path. */
  function loadedFiles() {
    return new Map(state.entries.filter(node => node.type === 'blob').map(node => [node.path, node]));
  }

  /** Keeps keyboard selection on the input while exposing the active listbox option. */
  function select(index, reveal = true) {
    active = Math.max(0, Math.min(index, matches.length - 1));
    const options = Array.from(results.querySelectorAll('.quick-open-result'));
    for (const [index, option] of options.entries()) option.setAttribute('aria-selected', String(index === active));
    const option = options[active];
    if (option) {
      input.setAttribute('aria-activedescendant', option.id);
      if (reveal) option.scrollIntoView?.({block: 'nearest'});
    } else input.removeAttribute('aria-activedescendant');
  }

  /** Renders at most the visible result bound; all handlers remain delegated to the owned list. */
  function render() {
    const symbols = parsed.mode === 'symbols';
    const issue = symbols ? symbolIssue() : '';
    results.replaceChildren(
      ...matches.map((node, index) =>
        el(
          'button',
          {
            type: 'button',
            class: 'quick-open-result',
            id: `codetree-quick-open-result-${index}`,
            role: 'option',
            tabindex: '-1',
            'data-index': index,
            'aria-selected': String(index === active),
            'aria-label': symbols
              ? `${node.symbol.name} · ${node.symbol.kind}${node.symbol.container ? ` · ${node.symbol.container}` : ''} · line ${node.symbol.line}`
              : node.path,
            disabled: pending ? '' : undefined,
          },
          [
            el('span', {class: 'quick-open-name', text: symbols ? node.symbol.name : node.path.split('/').pop()}),
            el('span', {
              class: 'quick-open-path',
              text: symbols
                ? `${node.symbol.kind}${node.symbol.container ? ` · ${node.symbol.container}` : ''} · line ${node.symbol.line}`
                : node.path,
            }),
          ],
        ),
      ),
    );
    if (!matches.length)
      results.append(
        el('div', {
          class: 'quick-open-empty',
          text: parsed.error
            ? 'Check the path and line number.'
            : issue
              ? issue
              : scanning
                ? symbols
                  ? 'Searching current-file symbols…'
                  : 'Searching loaded files…'
                : symbols
                  ? parsed.query
                    ? 'No symbols match in this file.'
                    : 'No symbols found in this file.'
                  : parsed.query
                    ? 'No loaded files match.'
                    : 'No recent files. Type a file name to search.',
        }),
      );
    select(active, false);
    if (parsed.error) feedback(parsed.error, true);
    else if (issue) feedback(issue, true);
    else if (activationError) feedback(activationError, true);
    else if (pending) feedback('Opening file…');
    else if (scanning) feedback(symbols ? 'Searching current-file symbols…' : 'Searching loaded files…');
    else if (symbols)
      feedback(
        `${total} ${total === 1 ? 'symbol' : 'symbols'}${total > maxResults ? ` · first ${maxResults} shown` : ''}`,
      );
    else
      feedback(
        `${total} ${parsed.query ? (total === 1 ? 'match' : 'matches') : total === 1 ? 'recent file' : 'recent files'}${total > maxResults ? ` · first ${maxResults} shown` : ''}`,
      );
  }

  /** Scans loaded paths in yielding chunks, rejecting obsolete query/page work before publishing. */
  async function scan(request) {
    const found = [];
    if (!parsed.error) {
      if (parsed.mode === 'symbols') {
        if (!symbolIssue()) {
          let count = 0;
          for (const symbol of symbolModel.symbols) {
            const nameScore = parsed.query ? quickOpenScore(symbol.name, parsed.query) : [];
            const qualified = `${symbol.container ? `${symbol.container}.` : ''}${symbol.name}`;
            const containerScore = !nameScore && symbol.container ? quickOpenScore(qualified, parsed.query) : null;
            const score = nameScore
              ? [0, ...nameScore, symbol.line]
              : containerScore
                ? [1, ...containerScore, symbol.line]
                : null;
            if (score) found.push({symbol, score, path: qualified});
            if (++count % 256 === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
              if (!live || !dialog.open || request !== scanGeneration) return;
            }
          }
          if (parsed.query) found.sort(compareQuickOpenMatches);
        }
        if (symbolIssue()) found.length = 0;
      } else if (!parsed.query) {
        const files = loadedFiles();
        for (const path of recent) if (files.has(path)) found.push(files.get(path));
      } else {
        let count = 0;
        for (const node of loadedFiles().values()) {
          const score = quickOpenScore(node.path, parsed.query);
          if (score) found.push({...node, score});
          if (++count % 256 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (!live || !dialog.open || request !== scanGeneration) return;
          }
        }
        found.sort(compareQuickOpenMatches);
      }
    }
    if (!live || !dialog.open || request !== scanGeneration) return;
    total = found.length;
    matches = found.slice(0, maxResults);
    active = 0;
    scanning = false;
    input.setAttribute('aria-busy', String(Boolean(pending)));
    render();
  }

  /** Starts one owned scan, retaining its promise so immediate Enter can await the same work. */
  function startScan(request) {
    if (!live || !dialog.open || request !== scanGeneration) return Promise.resolve();
    scanPromise = scan(request);
    return scanPromise;
  }

  /** Debounces matching without altering source loading or the sidebar's own search/filter state. */
  function schedule(immediate = false) {
    if (!live || !dialog.open) return;
    clearTimeout(timer);
    const request = ++scanGeneration;
    scanning = true;
    scanPromise = undefined;
    parsed = parseQuickOpenQuery(input.value.slice(0, 1024));
    const symbols = parsed.mode === 'symbols';
    input.setAttribute('aria-label', symbols ? 'Quick Open symbol' : 'Quick Open file');
    results.setAttribute('aria-label', symbols ? 'Matching symbols' : 'Matching files');
    matches = [];
    active = total = 0;
    results.replaceChildren();
    input.removeAttribute('aria-activedescendant');
    notice.hidden = symbols ? !symbolModel : !state.lazy;
    notice.textContent = symbols
      ? symbolContext()
      : state.lazy
        ? 'Search covers loaded files only. Load more folders from the tree to include them.'
        : '';
    input.setAttribute('aria-busy', 'true');
    feedback(
      parsed.error || activationError || (symbols ? 'Searching current-file symbols…' : 'Searching loaded files…'),
      Boolean(parsed.error || activationError),
    );
    if (immediate || parsed.error || !parsed.query) void startScan(request);
    else
      timer = setTimeout(
        withOwner(() => startScan(request)),
        80,
      );
  }

  /** Opens or refocuses the palette, retaining the current local query until its scope changes. */
  function openQuickOpen() {
    if (!live || !state.context) return;
    invalidate();
    symbolModal = Boolean(app.view.viewer.open);
    symbolModel = (symbolModal ? app.getViewerSymbols?.() : app.getFileTabSymbols?.()) || null;
    if (!dialog.open) {
      previousFocus = app.view.shadow.activeElement || document.activeElement;
      dialog.showModal();
    }
    input.setAttribute('aria-expanded', 'true');
    input.focus();
    input.select();
    schedule(true);
  }

  /** Closes only this palette; Escape restores its prior focus while successful opens focus the file tab. */
  function closeQuickOpen(restoreFocus = true) {
    if (!live) return;
    invalidate();
    symbolModel = null;
    symbolModal = false;
    if (dialog.open) dialog.close();
    input.setAttribute('aria-expanded', 'false');
    if (restoreFocus && previousFocus?.isConnected) {
      if (previousFocus.id === 'codetree-file-workspace') app.focusFileTab?.();
      else previousFocus.focus?.({preventScroll: true});
    }
  }

  /** Adds a successful current-scope file open to the bounded, memory-only recent list. */
  function rememberQuickOpenFile(path) {
    if (!live || !state.context || typeof path !== 'string' || !loadedFiles().has(path)) return;
    recent = [path, ...recent.filter(value => value !== path)].slice(0, maxRecent);
    if (dialog.open && !pending) schedule(true);
  }

  /** Resolves an explicit source-line browser-tab request without guessing a moving branch or fork. */
  function sourceLink(node, line) {
    const context = state.context;
    const diff = state.mode === 'changes' ? state.diff : null;
    if (diff) {
      const file = diff.files.find(file => file.filename === node.path);
      if (!file) return null;
      const old = file.status === 'removed';
      return linePermalink(
        context,
        old ? diff.base : diff.head,
        old ? file.previous_filename || node.path : node.path,
        line,
      );
    }
    const source =
      context.provider === 'gitlab'
        ? {project: `${context.owner}/${context.repo}`, sha: state.info?.commitSHA}
        : {owner: context.owner, repo: context.repo, sha: state.info?.commitSHA};
    return linePermalink(context, source, node.path, line);
  }

  /** Opens a chosen file and publishes completion only while the same palette/page still owns the request. */
  async function activate(index, newTab = false) {
    if (!live || !dialog.open || pending || parsed.error) return;
    const node = matches[index];
    if (parsed.mode === 'symbols') {
      if (!node) return;
      const issue = symbolIssue();
      if (issue) {
        matches = [];
        total = 0;
        activationError = issue;
        render();
        return;
      }
      if (newTab) {
        const url = linePermalink(state.context, symbolModel.source, symbolModel.path, node.symbol.line);
        if (!url) {
          activationError = 'A link to this exact source revision is unavailable. Open the symbol here instead.';
          render();
          return;
        }
        window.open(url, '_blank', 'noopener');
        activationError = '';
        render();
        return;
      }
      const model = symbolModel;
      closeQuickOpen(false);
      if (!model.go(node.symbol)) {
        openQuickOpen();
        activationError = 'This symbol is no longer available. Reopen Quick Open to search the current file.';
        render();
      }
      return;
    }
    if (!node || !loadedFiles().has(node.path)) return;
    const request = {
      generation,
      epoch: state.epoch,
      files: state.filesGeneration,
      context: state.context,
      mode: state.mode,
    };
    const current = () =>
      live &&
      dialog.open &&
      pending === request &&
      generation === request.generation &&
      state.epoch === request.epoch &&
      state.filesGeneration === request.files &&
      state.context === request.context &&
      state.mode === request.mode;
    pending = request;
    activationError = '';
    input.setAttribute('aria-busy', 'true');
    render();
    try {
      if (newTab) {
        if (parsed.line) {
          const url = sourceLink(node, parsed.line);
          if (!url) throw new Error('A link to this exact source revision is unavailable. Open the file here instead.');
          window.open(url, '_blank', 'noopener');
        } else await app.openFile(node, true);
        if (current()) {
          pending = undefined;
          input.setAttribute('aria-busy', 'false');
          render();
        }
        return;
      }
      await app.openFileTab({path: node.path, ...(parsed.line ? {line: parsed.line} : {})});
      if (!current()) return;
      closeQuickOpen(false);
      if (app.view.viewer.open) app.closeViewer();
      app.focusFileTab?.();
    } catch (error) {
      if (!current()) return;
      pending = undefined;
      input.setAttribute('aria-busy', String(scanning));
      activationError = error?.message || 'Could not open this file. Try again.';
      render();
    } finally {
      // A refresh can invalidate only the file generation while leaving this palette open.
      if (live && dialog.open && pending === request) {
        pending = undefined;
        input.setAttribute('aria-busy', 'false');
        schedule(true);
      }
    }
  }

  /** Finishes an unstarted debounce or yielding scan before Enter opens its current result. */
  async function openActive() {
    if (pending) return;
    const request = generation;
    while (scanning) {
      if (!live || !dialog.open || request !== generation) return;
      clearTimeout(timer);
      await (scanPromise || startScan(scanGeneration));
    }
    if (live && dialog.open && request === generation) await activate(active);
  }

  /** Routes palette shortcuts ahead of the underlying viewer while leaving native editors alone. */
  function keydown(event) {
    if (!live || !event.isTrusted || event.defaultPrevented || event.isComposing || event.getModifierState('AltGraph'))
      return;
    const editing = [app.view.shadow.activeElement, document.activeElement, ...event.composedPath()].some(
      node => node !== input && (node?.matches?.('input,textarea,select') || node?.isContentEditable),
    );
    if (editing) return;
    const command = event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey;
    if (command && event.key.toLowerCase() === 'p') {
      if (event.repeat || !state.context) return;
      event.preventDefault();
      event.stopPropagation();
      openQuickOpen();
      return;
    }
    if (!dialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!['Escape', 'Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const focused = app.view.shadow.activeElement || document.activeElement;
    if (event.key !== 'Escape' && focused !== input && !results.contains(focused)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') closeQuickOpen();
    else if (!pending) {
      if (event.key === 'Enter') void openActive();
      else
        select(
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? matches.length - 1
              : active + (event.key === 'ArrowDown' ? 1 : -1),
        );
    }
  }

  listen(window, 'keydown', keydown, true);
  listen(input, 'input', event => {
    invalidate();
    if (event.isComposing) {
      matches = [];
      results.replaceChildren();
      input.removeAttribute('aria-activedescendant');
      feedback('Composing query…');
    } else schedule();
  });
  listen(input, 'compositionend', () => schedule());
  listen(results, 'click', event => {
    const result = event.target.closest?.('.quick-open-result');
    if (!result || !results.contains(result) || event.altKey || event.defaultPrevented) return;
    event.preventDefault();
    const index = Number(result.dataset.index);
    select(index, false);
    input.focus();
    void activate(index, Boolean(event.ctrlKey || event.metaKey));
  });
  listen(dialog, 'cancel', event => {
    event.preventDefault();
    closeQuickOpen();
  });
  listen(dialog, 'close', () => {
    if (dialog.open) return;
    invalidate();
    symbolModel = null;
    symbolModal = false;
    input.setAttribute('aria-expanded', 'false');
  });
  createRenderEffect(
    on(
      [
        () => state.context,
        () => state.mode,
        () => state.public?.selectedAccounts?.[state.context?.origin] || 'auto',
        () => state.info?.account || '',
      ],
      (values, previous) => {
        if (!previous || values.every((value, index) => value === previous[index])) return;
        recent = [];
        input.value = '';
        closeQuickOpen(false);
      },
    ),
  );
  createRenderEffect(on([() => state.entries, () => state.lazy], () => schedule(true)));
  onCleanup(() => {
    closeQuickOpen(false);
    live = false;
    dialog.remove();
  });
  return {openQuickOpen, closeQuickOpen, rememberQuickOpenFile};
}
