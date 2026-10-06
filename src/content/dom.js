/* Explicit DOM construction helpers. Server and user text is always set with textContent. */
import {icon} from '../shared/icons.js';

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
  node.append(...children); return node;
}
export function button(name, label, callback, className = '') {
  return el('button', {type: 'button', class: `icon-button ${className}`, title: label, 'aria-label': label, onClick: callback}, [icon(name)]);
}
export function empty(title, text, name = 'search') {
  return el('div', {class: 'empty'}, [icon(name), el('strong', {text: title}), el('span', {text})]);
}
export function highlight(label, query) {
  const span = el('span', {class: 'file-label'}); const index = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index === -1) span.textContent = label;
  else span.append(document.createTextNode(label.slice(0, index)), el('mark', {text: label.slice(index, index + query.length)}), document.createTextNode(label.slice(index + query.length)));
  return span;
}
