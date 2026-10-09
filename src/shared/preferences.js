/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * User preferences, keyboard shortcuts and page-display rules.
 *
 * The service worker normalizes stored and synced values with
 * [preferences]; Settings and the content script use the same helpers so
 * every context accepts exactly the same values.
 */

import {repoURL} from './routes.js';

/** Default preferences used for new installations and invalid values. */
export const defaults = Object.freeze({
  dock: 'left',
  width: 304,
  pinned: true,
  open: true,
  iconTheme: 'color',
  fontFamily: 'default',
  fontSize: 12,
  toggleShortcut: 'Shift+D',
  searchShortcut: 'Shift+S',
  pageScope: 'repository',
  hidePatterns: '',
  folderClick: true,
});

/**
 * Code font choices and their CSS font stacks.
 *
 * Named fonts are never downloaded; each stack falls back to the system
 * monospace font when the named font is not installed locally.
 */
export const fontFamilies = Object.freeze({
  default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  'JetBrains Mono': '"JetBrains Mono", ui-monospace, monospace',
  'Fira Code': '"Fira Code", ui-monospace, monospace',
  'Cascadia Code': '"Cascadia Code", ui-monospace, monospace',
  'Source Code Pro': '"Source Code Pro", ui-monospace, monospace',
  Menlo: 'Menlo, ui-monospace, monospace',
  Consolas: 'Consolas, ui-monospace, monospace',
});

/**
 * Parses a comma-separated list of keyboard shortcuts.
 *
 * Each shortcut is `Modifier+…+Key`. Modifiers are `Ctrl`, `Cmd`/`Meta`,
 * `Alt`/`Option`, `Shift` and `Mod` (Ctrl on Windows/Linux, Cmd on macOS);
 * `Space` and `Plus` name those keys. A blank value disables the action.
 *
 * @param {string} value Up to eight shortcuts, e.g. `Shift+D, Mod+B`.
 * @returns {Array<{key: string, ctrl: boolean, meta: boolean, alt: boolean, shift: boolean, mod: boolean}>}
 * @throws {Error} If a shortcut is malformed or there are more than eight.
 */
export function shortcuts(value) {
  if (typeof value !== 'string' || value.length > 512)
    throw new Error('Use at most eight shortcuts, separated by commas.');
  if (!value.trim()) return [];
  const aliases = {
    control: 'ctrl',
    command: 'meta',
    cmd: 'meta',
    option: 'alt',
    esc: 'escape',
    space: ' ',
    plus: '+',
    up: 'arrowup',
    down: 'arrowdown',
    left: 'arrowleft',
    right: 'arrowright',
  };
  const bindings = value.split(',').map(text => {
    const parts = text
      .trim()
      .toLowerCase()
      .split('+')
      .map(part => aliases[part.trim()] || part.trim());
    const key = parts.pop();
    const modifiers = new Set(parts);
    if (
      !key ||
      parts.length !== modifiers.size ||
      parts.some(part => !['ctrl', 'meta', 'alt', 'shift', 'mod'].includes(part)) ||
      (modifiers.has('mod') && (modifiers.has('ctrl') || modifiers.has('meta'))) ||
      !(
        key.length === 1 ||
        /^(?:arrow(?:up|down|left|right)|escape|enter|tab|backspace|delete|insert|home|end|pageup|pagedown|f(?:[1-9]|1\d))$/.test(
          key,
        )
      )
    ) {
      throw new Error(
        `Invalid shortcut: ${text.trim()}. Use Ctrl, Cmd, Alt, Shift or Mod plus a key; write Space or Plus for those keys.`,
      );
    }
    return {
      key,
      ctrl: modifiers.has('ctrl'),
      meta: modifiers.has('meta'),
      alt: modifiers.has('alt'),
      shift: modifiers.has('shift'),
      mod: modifiers.has('mod'),
    };
  });
  if (bindings.length > 8) throw new Error('Use at most eight shortcuts per action.');
  return bindings;
}

/**
 * Whether a keyboard [event] matches any shortcut in [value].
 *
 * @param {string} value A shortcut list accepted by [shortcuts].
 * @param {KeyboardEvent|Object} event A keyboard event or an equivalent object.
 * @returns {boolean}
 */
export function shortcutMatches(value, event) {
  return shortcuts(value).some(
    binding =>
      binding.key === event.key.toLowerCase() &&
      binding.alt === event.altKey &&
      binding.shift === event.shiftKey &&
      (binding.mod
        ? event.ctrlKey !== event.metaKey
        : binding.ctrl === event.ctrlKey && binding.meta === event.metaKey),
  );
}

/**
 * Validates the navigation preferences before they are saved.
 *
 * The toggle and search shortcuts must not overlap (with `Mod` checked
 * against both Ctrl and Cmd), and URL exclusions are limited to 64
 * non-empty lines within 16,384 characters.
 *
 * @param {Object} value Preferences with `toggleShortcut`, `searchShortcut` and `hidePatterns`.
 * @throws {Error} If the values cannot be saved.
 */
export function validateNavigation(value) {
  const toggle = shortcuts(value.toggleShortcut);
  const search = shortcuts(value.searchShortcut);
  for (const binding of toggle) {
    for (const ctrlKey of [false, true])
      for (const metaKey of [false, true]) {
        const event = {key: binding.key, ctrlKey, metaKey, altKey: binding.alt, shiftKey: binding.shift};
        if (
          shortcutMatches(value.toggleShortcut, event) &&
          search.length &&
          shortcutMatches(value.searchShortcut, event)
        )
          throw new Error('Toggle and search shortcuts must be different.');
      }
  }
  if (
    typeof value.hidePatterns !== 'string' ||
    value.hidePatterns.length > 16384 ||
    value.hidePatterns.split('\n').filter(line => line.trim()).length > 64
  ) {
    throw new Error('Use at most 64 URL patterns, one per line, within 16,384 characters.');
  }
}

/**
 * Matches [text] against a literal pattern where `*` matches any run of characters.
 *
 * Iterative backtracking keeps the cost linear in practice and avoids
 * building regular expressions from user input.
 */
function globMatch(pattern, text) {
  let index = 0;
  let position = 0;
  let star = -1;
  let retry = 0;
  while (position < text.length) {
    if (pattern[index] === '*') {
      star = index++;
      retry = position;
    } else if (pattern[index] === text[position]) {
      index++;
      position++;
    } else if (star >= 0) {
      index = star + 1;
      position = ++retry;
    } else return false;
  }
  while (pattern[index] === '*') index++;
  return index === pattern.length;
}

/**
 * Whether Codetree should appear on a page.
 *
 * Pages matching an exclusion pattern are hidden. With the `code` page
 * scope, repository pages are limited to the repository root, request
 * lists and commit lists; trees, files, requests and commits stay visible.
 *
 * @param {string} url The page URL.
 * @param {?Object} context The parsed repository context, if any.
 * @param {Object} value Normalized preferences.
 * @returns {boolean}
 */
export function pageVisible(url, context, value) {
  if (!context) return false;
  const parsed = new URL(url);
  if (
    value.hidePatterns
      .split('\n')
      .some(pattern => pattern.trim() && globMatch(pattern.trim(), parsed.href.split('#')[0]))
  )
    return false;
  if (value.pageScope !== 'code' || context.kind !== 'repo') return true;
  const path = parsed.pathname.replace(/\/$/, '');
  const root = new URL(repoURL(context)).pathname;
  return (
    path === root ||
    (context.provider === 'gitlab'
      ? ['/merge_requests', '/commits'].some(part => path === root + '/-' + part)
      : ['/pulls', '/commits'].some(part => path === root + part))
  );
}

/**
 * Normalizes stored, synced or submitted preferences.
 *
 * Unknown keys are dropped and every field is clamped to a supported
 * value. Invalid shortcut pairs fall back to the defaults together, and
 * the legacy `outline` icon style becomes `monochrome`.
 *
 * @param {Object} [value={}] Raw preferences.
 * @returns {Object} A complete preferences object.
 */
export function preferences(value = {}) {
  let toggleShortcut = value.toggleShortcut ?? defaults.toggleShortcut;
  let searchShortcut = value.searchShortcut ?? defaults.searchShortcut;
  try {
    shortcuts(toggleShortcut);
    shortcuts(searchShortcut);
  } catch {
    toggleShortcut = defaults.toggleShortcut;
    searchShortcut = defaults.searchShortcut;
  }
  return {
    dock: value.dock === 'right' ? 'right' : 'left',
    width: Math.max(240, Math.min(600, Number(value.width) || defaults.width)),
    pinned: value.pinned !== false,
    open: value.open !== false,
    iconTheme:
      value.iconTheme === 'outline'
        ? 'monochrome'
        : ['color', 'monochrome', 'minimal'].includes(value.iconTheme)
          ? value.iconTheme
          : defaults.iconTheme,
    fontFamily: Object.hasOwn(fontFamilies, value.fontFamily) ? value.fontFamily : defaults.fontFamily,
    fontSize: Math.max(10, Math.min(24, Number(value.fontSize) || defaults.fontSize)),
    toggleShortcut,
    searchShortcut,
    pageScope: value.pageScope === 'code' ? 'code' : 'repository',
    hidePatterns:
      typeof value.hidePatterns === 'string'
        ? value.hidePatterns
            .slice(0, 16384)
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .slice(0, 64)
            .join('\n')
        : '',
    folderClick: value.folderClick !== false,
  };
}
