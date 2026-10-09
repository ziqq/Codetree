/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/**
 * Explicit DOM construction helpers.
 *
 * Server and user text is always set with `textContent`; no HTML strings
 * are parsed.
 *
 * @module content/dom
 */
import {icon} from '../shared/icons.js';

/**
 * Creates an element.
 *
 * Options: `text` sets `textContent`, `class` the class name, `onClick` a
 * click listener and `value` the form value; other keys become
 * attributes. `null` and `undefined` options are skipped.
 *
 * @param {string} tag The tag name.
 * @param {Object} [options={}]
 * @param {Array<Node|string>} [children=[]]
 * @returns {HTMLElement}
 */
export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (value == null) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'onClick') node.addEventListener('click', value);
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, String(value));
  }
  node.append(...children);
  return node;
}

/**
 * Creates an icon-only button with an accessible label and tooltip.
 *
 * @param {string} name The icon name.
 * @param {string} label The label.
 * @param {Function} callback The click handler.
 * @param {string} [className=''] Extra classes.
 * @returns {HTMLButtonElement}
 */
export function button(name, label, callback, className = '') {
  return el(
    'button',
    {type: 'button', class: `icon-button ${className}`, title: label, 'aria-label': label, onClick: callback},
    [icon(name)],
  );
}

/** Creates the empty, loading or error state of a view, with optional action buttons below the text. */
export function empty(title, text, name = 'search', actions = []) {
  return el('div', {class: 'empty'}, [
    icon(name),
    el('strong', {text: title}),
    el('span', {text}),
    ...(actions.length ? [el('div', {class: 'empty-actions'}, actions)] : []),
  ]);
}

/** Renders [label] with the first case-insensitive match of [query] marked. */
export function highlight(label, query) {
  const span = el('span', {class: 'file-label'});
  const index = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index === -1) span.textContent = label;
  else
    span.append(
      document.createTextNode(label.slice(0, index)),
      el('mark', {text: label.slice(index, index + query.length)}),
      document.createTextNode(label.slice(index + query.length)),
    );
  return span;
}
