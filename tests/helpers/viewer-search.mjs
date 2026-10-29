/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Search-specific focus, keyboard and source-text geometry for content fixtures.
 */

/** Counts visible columns from rendered source text, with the viewer's four-column tabs. */
function columns(text) {
  let width = 0;
  for (const character of text) width += character === '\t' ? 4 - (width % 4) : 1;
  return width;
}

/** Collects the rendered text before a descendant without using the search query or match metadata. */
export function precedingText(root, target) {
  let text = '';
  let found = false;
  /** Visits source leaves in DOM order, stopping at the requested rendered mark. */
  function visit(node) {
    if (node === target) found = true;
    if (found) return;
    if (!node.children.length) text += node.textContent;
    else for (const child of node.children) visit(child);
  }
  visit(root);
  return text;
}

/**
 * Extends only this document's fixture elements with the browser APIs used by
 * file search. Geometry comes from actual rendered text and scroll positions;
 * it deliberately does not model fonts, browser layout or native selection.
 * Install after installDiffViewport so its bounded scroll dimensions remain in use.
 */
export function installViewerSearchDOM(document) {
  const createElement = document.createElement.bind(document);
  /** Adds search APIs to one element, including elements already created by dom(). */
  function extend(node) {
    Object.defineProperty(node, 'firstChild', {configurable: true, get: () => node.children[0] || null});
    node.getRootNode = () => {
      let root = node;
      while (root.parent) root = root.parent;
      return root.host ? root : document;
    };
    node.select = () => {
      node.selectionStart = 0;
      node.selectionEnd = node.value.length;
    };
    node.matches = selector =>
      selector.split(',').some(part => {
        const tokens = part.trim().match(/\[[^\]]+\]|[.#][\w-]+|^[\w-]+/g) || [];
        return (
          tokens.length > 0 &&
          tokens.every(token => {
            if (token.startsWith('.')) return node.classList.contains(token.slice(1));
            if (token.startsWith('#')) return node.id === token.slice(1);
            const attribute = token.match(/^\[([^=]+)="(.*)"\]$/);
            return attribute ? node.getAttribute(attribute[1]) === attribute[2] : node.tagName === token.toUpperCase();
          })
        );
      });
    node.getBoundingClientRect = () => {
      const viewport = node.closest('.split-diff-pane') || node.closest('.viewer-body') || node;
      const origin = viewport.getAttribute('aria-label') === 'New revision' ? 360 : 0;
      const line = node.closest('.line-text');
      const prefix = line ? precedingText(line, node) : '';
      const left = origin + (line ? 100 + columns(prefix) * 10 - viewport.scrollLeft : 0);
      const width = line ? (columns(prefix + node.textContent) - columns(prefix)) * 10 : viewport.clientWidth;
      const row = node.closest('.code-row');
      const top = row ? Number.parseFloat(row.style.top) - viewport.scrollTop : 0;
      return {left, right: left + width, top, bottom: top + 22, width, height: 22};
    };
    return node;
  }
  document.createElement = tag => extend(createElement(tag));
  extend(document.body);
}

/**
 * Creates a keyboard event delivered through window.fire('keydown', event).
 * Its observable cancellation fields survive the base fixture's event copy.
 */
export function keyEvent(target, key, modifiers = {}) {
  const event = {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    propagationStopped: false,
    ...modifiers,
    composedPath() {
      const path = [];
      for (let node = target; node; node = node.parent || node.host) path.push(node);
      return path;
    },
    getModifierState(name) {
      return name === 'AltGraph' && Boolean(modifiers.altGraph);
    },
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.propagationStopped = true;
    },
  };
  return event;
}
