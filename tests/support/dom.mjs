/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * A minimal fake DOM for running content factories under `node --test`:
 * elements with attributes, classes, styles, children, text and events,
 * plus `document`, `location` and the `virtual:` build modules. Selectors
 * support a tag name, `.class` and `[attribute="value"]`.
 */
import {register} from 'node:module';

// The bundler serves these modules at build time; tests get empty tables.
register(
  `data:text/javascript,${encodeURIComponent(`
    const sources = {
      'virtual:file-icons': 'const table = {path: [], rules: []}; export const directories = table, files = table, fonts = [], glyphs = {};',
      'virtual:page-styles': 'export default "";',
    };
    export function resolve(specifier, context, next) {
      if (Object.hasOwn(sources, specifier))
        return {url: 'data:text/javascript,' + encodeURIComponent(sources[specifier]), shortCircuit: true};
      return next(specifier, context);
    }
  `)}`,
);

/** A text node. */
class Text {
  constructor(text) {
    this.nodeType = 3;
    this.data = String(text);
    this.parentNode = null;
  }
  get textContent() {
    return this.data;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
}

/** A container of child nodes: elements and fragments. */
class Container {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }
  get children() {
    return this.childNodes.filter(node => node instanceof Element);
  }
  get childElementCount() {
    return this.children.length;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get textContent() {
    return this.childNodes.map(node => node.textContent).join('');
  }
  set textContent(value) {
    this.replaceChildren(String(value ?? ''));
  }
  /** Inserts [nodes] before [reference], moving them from their parents; fragments insert their children. */
  insertBefore(node, reference) {
    const nodes = node instanceof Fragment ? [...node.childNodes] : [node];
    for (const child of nodes) {
      child.parentNode?.removeChild(child);
      const index = reference ? this.childNodes.indexOf(reference) : -1;
      if (index === -1) this.childNodes.push(child);
      else this.childNodes.splice(index, 0, child);
      child.parentNode = this;
    }
    return node;
  }
  append(...nodes) {
    for (const node of nodes) this.insertBefore(typeof node === 'string' ? new Text(node) : node, null);
  }
  prepend(...nodes) {
    const first = this.firstChild;
    for (const node of nodes) this.insertBefore(typeof node === 'string' ? new Text(node) : node, first);
  }
  removeChild(node) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
  }
  replaceChildren(...nodes) {
    for (const node of [...this.childNodes]) this.removeChild(node);
    this.append(...nodes);
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  /** Every descendant element in document order. */
  descendants() {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }
  querySelectorAll(selector) {
    return this.descendants().filter(node => node.matches(selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

/** A document fragment. */
class Fragment extends Container {}

/** An element with attributes, classes, inline styles, a dataset and event listeners. */
export class Element extends Container {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.scrollTop = 0;
    this.clientHeight = 0;
    this.open = false;
    const properties = new Map();
    this.style = new Proxy(
      {
        setProperty: (name, value) => properties.set(name, String(value)),
        removeProperty: name => properties.delete(name),
        getPropertyValue: name => properties.get(name) || '',
      },
      {
        get: (target, name) => (name in target ? target[name] : properties.get(name) || ''),
        set: (target, name, value) => properties.set(name, String(value)) || true,
      },
    );
    const classes = () => new Set((this.attributes.get('class') || '').split(/\s+/).filter(Boolean));
    const write = set => this.attributes.set('class', [...set].join(' '));
    this.classList = {
      contains: name => classes().has(name),
      add: (...names) => write(new Set([...classes(), ...names])),
      remove: (...names) => write(new Set([...classes()].filter(name => !names.includes(name)))),
      toggle: (name, force = !classes().has(name)) => {
        const set = classes();
        if (force) set.add(name);
        else set.delete(name);
        write(set);
        return force;
      },
    };
  }
  get className() {
    return this.attributes.get('class') || '';
  }
  set className(value) {
    this.attributes.set('class', String(value));
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-'))
      this.dataset[name.slice(5).replace(/-([a-z])/g, (match, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  /** Calls the listeners of [event] on this element; events do not bubble. */
  dispatchEvent(event) {
    Object.defineProperty(event, 'currentTarget', {value: this, configurable: true});
    if (!event.target) Object.defineProperty(event, 'target', {value: this, configurable: true});
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event);
    return true;
  }
  /** Dispatches a plain event of [type], for example `change` or `click`. */
  emit(type) {
    return this.dispatchEvent({type, stopPropagation() {}, preventDefault() {}});
  }
  click() {
    if (!this.disabled) this.emit('click');
  }
  focus() {
    document.activeElement = this;
  }
  attachShadow() {
    this.shadowRoot = Object.assign(new Fragment(), {
      activeElement: null,
      listeners: new Map(),
      addEventListener() {},
    });
    return this.shadowRoot;
  }
  getBoundingClientRect() {
    return {left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0};
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.emit('close');
  }
  closest(selector) {
    for (let current = this; current instanceof Element; current = current.parentNode)
      if (current.matches(selector)) return current;
    return null;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const match = part.trim().match(/^([a-z0-9-]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i);
      if (!match) return false;
      const [, tag, classes, attributes] = match;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const name of classes.split('.').filter(Boolean)) if (!this.classList.contains(name)) return false;
      for (const [, name, value] of attributes.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))
        if (value === undefined ? !this.hasAttribute(name) : this.getAttribute(name) !== value) return false;
      return true;
    });
  }
}

/** The fake `document`. */
export const document = {
  activeElement: null,
  body: new Element('body'),
  documentElement: new Element('html'),
  createElement: tag => new Element(tag),
  createElementNS: (namespace, tag) => Object.assign(new Element(tag), {namespaceURI: namespace}),
  createTextNode: text => new Text(text),
  createDocumentFragment: () => new Fragment(),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

globalThis.document = document;
globalThis.innerWidth = 1400;
globalThis.matchMedia = () => ({matches: false, addEventListener() {}});
globalThis.getComputedStyle = () => ({getPropertyValue: () => ''});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
};
globalThis.CSS = {escape: value => value};
globalThis.chrome = {runtime: {getURL: path => `chrome-extension://codetree/${path}`}};

/** Animation-frame callbacks waiting for `flushFrames`. */
const frames = [];
globalThis.requestAnimationFrame = callback => frames.push(callback);

/** Runs the pending animation frames, including frames they request. */
export function flushFrames() {
  while (frames.length) frames.shift()();
}
globalThis.location ??= {href: 'https://github.com/sample/repo', origin: 'https://github.com', hostname: 'github.com'};
