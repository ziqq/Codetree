/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned, virtualized symbol outline for exact loaded file revisions.
 * Models share the viewer's canonical row navigation without storing source text.
 */

import {el} from '../dom.js';
import {listen, requestFrame} from '../reactive-dom.js';
import {onCleanup} from '../reactive.js';

/** Distinguishes accessible panel controls when inline and modal outlines are both loaded. */
let nextOutlineID = 0;
/** Fixed item height keeps outline virtualization independent of source-code font preferences. */
const itemHeight = 28;

/**
 * Adds one compact Outline control and exposes the selected exact-revision symbol model.
 *
 * @param {object} shell Owned actions and source viewport.
 * @param {Array<object>} rows Complete validated unified rows or plain source rows.
 * @param {object} sources Exact old/new descriptors with parsed outline results.
 * @param {Function} current Whether the viewer still owns these loaded rows.
 * @param {{go: Function}} viewport Canonical unified-row navigation.
 * @param {boolean} diff Whether both revisions can be chosen.
 * @returns {{getSymbols: Function, element: HTMLElement}} The model getter and composable toolbar control.
 */
export function createFileOutline(shell, rows, sources, current, viewport, diff = false) {
  let live = true;
  let side = diff && !rows.some(row => row.newLine) ? 'old' : 'new';
  let selected = 0;
  let frame = 0;
  const panelID = `codetree-file-outline-${++nextOutlineID}`;
  const toggle = el('button', {
    type: 'button',
    class: 'small-button file-outline-toggle',
    text: 'Outline',
    'aria-expanded': 'false',
    'aria-controls': panelID,
    title: 'Symbols in this file',
  });
  const revisions = el('div', {
    class: 'viewer-line-revision file-outline-revision',
    role: 'group',
    'aria-label': 'Outline revision',
  });
  revisions.hidden = !diff;
  const sourceLabel = el('div', {class: 'file-outline-source'});
  const status = el('div', {class: 'file-outline-status', role: 'status', 'aria-live': 'polite'});
  const notice = el('div', {class: 'file-outline-notice', hidden: ''});
  const spacer = el('div', {class: 'file-outline-spacer'});
  const list = el('div', {class: 'file-outline-list', role: 'listbox', 'aria-label': 'File symbols', tabindex: '0'}, [
    spacer,
  ]);
  const panel = el(
    'div',
    {id: panelID, class: 'file-outline-panel', role: 'region', 'aria-label': 'File outline', hidden: ''},
    [revisions, sourceLabel, status, notice, list],
  );
  const group = el('div', {class: 'file-outline'}, [toggle, panel]);
  shell.actions.append(group);
  const models = {};
  for (const value of diff ? ['old', 'new'] : ['new']) {
    const revision = sources[value];
    const result = revision.outline;
    const symbols = result.symbols;
    const lineSide = value === 'old' ? 'oldLine' : 'newLine';
    models[value] = {
      filePath: sources.new.path,
      path: revision.path,
      source: revision.source,
      side: value,
      diff,
      supported: result.supported,
      limited: result.limited,
      symbols,
      current: available,
      /** Reveals only a member symbol whose one-based source line exists in this exact revision. */
      go(symbol) {
        if (!available() || !symbols.includes(symbol) || !Number.isSafeInteger(symbol?.line)) return false;
        const row = rows.findIndex(row => row[lineSide] === symbol.line);
        if (row < 0) return false;
        viewport.go(row);
        shell.body.focus({preventScroll: true});
        return true;
      },
    };
  }

  /** Whether this outline may act on its captured file and exact source rows. */
  function available() {
    return live && current();
  }

  /** Returns the currently selected revision without exposing a previous or incomplete viewer. */
  function getSymbols() {
    return available() ? models[side] : null;
  }

  /** Closes the popup without clearing its selected source revision or changing viewer position. */
  function close(focus = false) {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (focus && available()) toggle.focus({preventScroll: true});
  }

  /** Renders only the bounded visible symbol window, retaining source objects in the shared model. */
  function draw(restoreFocus = true) {
    if (!available() || panel.hidden) return;
    const focused = shell.body.getRootNode?.().activeElement || document.activeElement;
    const hadFocus = spacer.contains(focused);
    const focusedIndex = restoreFocus && hadFocus ? focused?.dataset.index : undefined;
    const model = models[side];
    const first = Math.floor(list.scrollTop / itemHeight);
    const visible = Math.ceil(Math.min(224, list.clientHeight || 224) / itemHeight);
    if (focusedIndex !== undefined)
      selected = Math.max(first, Math.min(Number(focusedIndex), first + visible - 1, model.symbols.length - 1));
    const start = Math.max(0, Math.floor(list.scrollTop / itemHeight) - 4);
    const end = Math.min(
      model.symbols.length,
      start + Math.ceil(Math.min(224, list.clientHeight || 224) / itemHeight) + 8,
    );
    // Move focus inside the retained list before removing its focused virtual row.
    if (hadFocus) list.focus({preventScroll: true});
    spacer.replaceChildren(
      ...model.symbols.slice(start, end).map((symbol, offset) => {
        const index = start + offset;
        const control = el(
          'button',
          {
            type: 'button',
            class: 'file-outline-item',
            role: 'option',
            'data-index': index,
            'aria-selected': String(index === selected),
            title: `${symbol.kind} ${symbol.container ? symbol.container + '.' : ''}${symbol.name} · line ${symbol.line}`,
          },
          [
            el('span', {class: 'file-outline-kind', text: symbol.kind}),
            el('span', {
              class: 'file-outline-name',
              text: symbol.container ? `${symbol.container}.${symbol.name}` : symbol.name,
            }),
            el('span', {class: 'file-outline-line', text: `:${symbol.line}`}),
          ],
        );
        control.style.top = `${index * itemHeight}px`;
        return control;
      }),
    );
    if (focusedIndex !== undefined)
      (
        Array.from(spacer.querySelectorAll('button')).find(control => Number(control.dataset.index) === selected) ||
        list
      ).focus({preventScroll: true});
  }

  /** Reflects supported, empty and partial extraction states for the chosen revision. */
  function update() {
    const model = models[side];
    sourceLabel.textContent = `${diff ? `${side === 'old' ? 'Old' : 'New'} · ` : ''}${model.path}`;
    status.textContent = !model.supported
      ? 'Outline is not available for this file type.'
      : model.symbols.length
        ? `${model.symbols.length} ${model.symbols.length === 1 ? 'symbol' : 'symbols'}`
        : model.limited
          ? 'No symbols found in the scanned portion.'
          : 'No symbols found.';
    notice.hidden = !model.limited;
    notice.textContent = model.limited ? 'Partial outline: a source or symbol limit was reached.' : '';
    list.hidden = !model.symbols.length;
    list.style.height = `${Math.min(224, model.symbols.length * itemHeight)}px`;
    spacer.style.height = `${model.symbols.length * itemHeight}px`;
    for (const control of Array.from(revisions.children))
      control.setAttribute('aria-pressed', String(control.dataset.side === side));
    draw();
  }

  /** Opens the bounded popup within the viewport, keeping the main toolbar unchanged. */
  function open() {
    if (!available()) return;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    update();
    const anchor = toggle.getBoundingClientRect?.() || {left: 8, bottom: 8};
    const bounds = panel.getBoundingClientRect?.() || {};
    const width = window.innerWidth || document.documentElement?.clientWidth || 1024;
    const height = window.innerHeight || document.documentElement?.clientHeight || 768;
    const panelWidth = bounds.width || 320;
    panel.style.left = `${Math.max(8, Math.min((anchor.right ?? anchor.left + panelWidth) - panelWidth, width - panelWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, height - (bounds.height || 320) - 8))}px`;
    if (models[side].symbols.length) {
      const first = Math.floor(list.scrollTop / itemHeight);
      const visible = Math.ceil(Math.min(224, list.clientHeight || 224) / itemHeight);
      select(Math.max(first, Math.min(selected, first + visible - 1)));
    } else (revisions.querySelector('button') || toggle).focus({preventScroll: true});
  }

  /** Reveals one list index for keyboard navigation without expanding retained DOM nodes. */
  function select(index) {
    const symbols = models[side].symbols;
    selected = Math.max(0, Math.min(index, symbols.length - 1));
    if (selected * itemHeight < list.scrollTop) list.scrollTop = selected * itemHeight;
    else if ((selected + 1) * itemHeight > list.scrollTop + Math.min(224, list.clientHeight || 224))
      list.scrollTop = (selected + 1) * itemHeight - Math.min(224, list.clientHeight || 224);
    draw(false);
    Array.from(spacer.querySelectorAll('button'))
      .find(control => Number(control.dataset.index) === selected)
      ?.focus({preventScroll: true});
  }

  if (diff)
    for (const [value, label] of [
      ['new', 'New'],
      ['old', 'Old'],
    ]) {
      const control = el('button', {type: 'button', text: label, 'data-side': value});
      listen(control, 'click', () => {
        if (!available()) return;
        side = value;
        selected = list.scrollTop = 0;
        update();
      });
      revisions.append(control);
    }
  listen(toggle, 'click', () => {
    if (panel.hidden) open();
    else close();
  });
  listen(list, 'click', event => {
    const control = event.target.closest?.('.file-outline-item');
    if (!available() || !control || !list.contains(control)) return;
    const model = models[side];
    if (model.go(model.symbols[Number(control.dataset.index)])) close();
  });
  listen(
    list,
    'scroll',
    () => {
      if (!frame)
        frame = requestFrame(() => {
          frame = 0;
          draw();
        });
    },
    {passive: true},
  );
  listen(
    window,
    'keydown',
    event => {
      if (!available() || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
        return;
      const focused = shell.body.getRootNode?.().activeElement || document.activeElement;
      if (!group.contains(focused)) return;
      if (panel.hidden) {
        if (focused === toggle && event.key === 'ArrowDown') {
          event.preventDefault();
          open();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (list.contains(focused) && ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const index = focused.dataset.index === undefined ? selected : Number(focused.dataset.index);
        if (event.key === 'Enter') {
          const model = models[side];
          if (model.go(model.symbols[index])) close();
        } else
          select(
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? models[side].symbols.length - 1
                : index + (event.key === 'ArrowDown' ? 1 : -1),
          );
      }
    },
    true,
  );
  listen(group, 'focusout', event => {
    if (!group.contains(event.relatedTarget)) close();
  });
  const root = shell.body.getRootNode?.();
  if (root?.addEventListener)
    listen(root, 'pointerdown', event => {
      if (!group.contains(event.target)) close();
    });
  listen(
    window,
    'pointerdown',
    event => {
      if (!(event.composedPath?.() || [event.target]).includes(root?.host) && !group.contains(event.target)) close();
    },
    true,
  );
  listen(window, 'resize', () => close());
  listen(
    window,
    'scroll',
    event => {
      if (!panel.contains(event.target)) close();
    },
    true,
  );
  onCleanup(() => {
    live = false;
    close();
    group.remove();
  });
  return {getSymbols, element: group};
}
