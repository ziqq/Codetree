/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned, viewport-clamped context menu for in-page file tabs.
 */

import {el} from '../dom.js';
import {listen} from '../reactive-dom.js';
import {onCleanup} from '../reactive.js';

/** Creates one delegated tab menu; item actions belong to the captured workspace operation. */
export function createTabMenu(shadow) {
  const menu = el('div', {class: 'file-tab-menu', role: 'menu', 'aria-label': 'File tab actions', hidden: ''});
  shadow.append(menu);
  let live = true;
  let trigger;
  let select;

  /** Closes menu state, optionally returning keyboard focus to its still-connected tab. */
  function close(focus = false) {
    menu.hidden = true;
    select = undefined;
    if (focus && trigger?.isConnected) trigger.focus({preventScroll: true});
  }

  /** Opens explicit items beside a pointer or tab, clamping measured bounds to the current viewport. */
  function open(items, action, target, x, y) {
    if (!live) return;
    trigger = target;
    select = action;
    menu.replaceChildren(
      ...items.map(item =>
        el('button', {
          type: 'button',
          class: 'small-button',
          role: 'menuitem',
          tabindex: '-1',
          'data-action': item.id,
          text: item.label,
          disabled: item.disabled ? '' : undefined,
        }),
      ),
    );
    menu.hidden = false;
    const anchor = target?.getBoundingClientRect?.() || {left: 8, bottom: 8};
    const bounds = menu.getBoundingClientRect?.() || {};
    const width = window.innerWidth || document.documentElement?.clientWidth || 1024;
    const height = window.innerHeight || document.documentElement?.clientHeight || 768;
    menu.style.left = `${Math.max(8, Math.min(x ?? anchor.left, width - (bounds.width || 220) - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y ?? anchor.bottom, height - (bounds.height || items.length * 32 + 12) - 8))}px`;
    Array.from(menu.querySelectorAll('button'))
      .find(button => !button.disabled)
      ?.focus({preventScroll: true});
  }

  /** Invokes a menu action once; metadata failures are reported by its normal owned action wrapper. */
  function activate(button) {
    if (!live || menu.hidden || !button || button.disabled) return;
    const action = select;
    close(true);
    return action?.(button.dataset.action);
  }

  listen(menu, 'click', event => activate(event.target.closest?.('[role="menuitem"]')));
  listen(menu, 'focusout', event => {
    if (!menu.contains(event.relatedTarget)) close();
  });
  listen(
    window,
    'keydown',
    event => {
      if (menu.hidden || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
        return;
      const focused = shadow.activeElement || document.activeElement;
      if (!menu.contains(focused)) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape', 'Tab'].includes(event.key)) return;
      if (event.key === 'Tab') {
        close(true);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        close(true);
        return;
      }
      const items = Array.from(menu.querySelectorAll('button')).filter(button => !button.disabled);
      if (event.key === 'Enter') {
        return activate(focused);
      }
      const index = items.indexOf(focused);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus({preventScroll: true});
    },
    true,
  );
  listen(shadow, 'pointerdown', event => {
    if (!menu.contains(event.target)) close();
  });
  listen(
    window,
    'pointerdown',
    event => {
      if (!(event.composedPath?.() || [event.target]).includes(shadow.host)) close();
    },
    true,
  );
  listen(window, 'resize', () => close());
  listen(window, 'scroll', () => close(), true);
  onCleanup(() => {
    live = false;
    close();
    menu.remove();
  });
  return {open, close};
}
