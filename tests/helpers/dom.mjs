/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Small DOM fixture for content factories; browser layout and native host selectors are not simulated.
 */

/** Element/text nodes with event handlers, focus and the selectors used by the tested factories. */
export class Node {
  /** Creates a detached node belonging to the supplied fixture document. */
  constructor(document, tag = '') {
    this.document = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {
      setProperty(key, value) {
        this[key] = value;
      },
    };
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.clientHeight = 290;
    this.className = '';
    this.classList = {
      add: (...names) => {
        this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' ');
      },
      contains: name => this.className.split(' ').includes(name),
      toggle: (name, force = !this.classList.contains(name)) => {
        this.className = this.className
          .split(' ')
          .filter(item => item !== name)
          .concat(force ? [name] : [])
          .join(' ');
        return force;
      },
    };
  }

  /** Returns all descendant text. */
  get textContent() {
    return this.children.length ? this.children.map(node => node.textContent).join('') : this.text || '';
  }
  /** Replaces descendants with plain text. */
  set textContent(value) {
    this.replaceChildren();
    this.text = String(value);
  }

  /** Applies attributes that the factories also read as DOM properties. */
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
    if (key === 'class') this.className = String(value);
    else if (key === 'tabindex') this.tabIndex = Number(value);
    else if (key.startsWith('data-')) this.dataset[key.slice(5)] = String(value);
    else if (['hidden', 'disabled'].includes(key)) this[key] = true;
    else if (['id', 'type', 'title', 'href'].includes(key)) this[key] = String(value);
  }
  /** Reads a stored attribute. */
  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }

  /** Moves nodes, expanding document fragments like the browser. */
  append(...nodes) {
    if (nodes.length && this.text) {
      const text = this.document.createTextNode(this.text);
      this.text = '';
      this.append(text);
    }
    for (let node of nodes) {
      if (typeof node === 'string') node = this.document.createTextNode(node);
      if (node.tagName === '#FRAGMENT') {
        this.append(...[...node.children]);
        continue;
      }
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  /** Moves supplied nodes before the current children. */
  prepend(...nodes) {
    const previous = [...this.children];
    this.append(...nodes);
    this.children = [...this.children.filter(node => !previous.includes(node)), ...previous];
  }
  /** Removes descendants, including focus when the focused control is removed. */
  replaceChildren(...nodes) {
    for (const node of [...this.children]) node.remove();
    this.text = '';
    this.append(...nodes);
  }
  /** Detaches this node. */
  remove() {
    if (!this.parent) return;
    if (this.contains(this.document.activeElement)) this.document.activeElement = null;
    this.parent.children = this.parent.children.filter(node => node !== this);
    this.parent = null;
  }
  /** Whether a node is in this subtree. */
  contains(node) {
    return this === node || this.children.some(child => child.contains(node));
  }
  /** Matches the simple selectors used in these fixture scenarios. */
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const attribute = selector.match(/^\[([^=]+)="(.*)"\]$/);
    if (attribute) return this.getAttribute(attribute[1]) === attribute[2];
    return this.tagName === selector.toUpperCase();
  }
  /** Returns matching descendants in DOM order. */
  querySelectorAll(selector) {
    return this.children.flatMap(node => [
      ...(node.matches(selector) ? [node] : []),
      ...node.querySelectorAll(selector),
    ]);
  }
  /** Returns the first matching descendant. */
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  /** Returns the nearest matching ancestor, including this node. */
  closest(selector) {
    return this.matches(selector) ? this : this.parent?.closest(selector) || null;
  }
  /** Focuses this element. */
  focus() {
    this.document.activeElement = this;
  }
  /** Registers an event callback. */
  addEventListener(type, callback, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({callback, options});
    this.listeners.set(type, entries);
  }
  /** Removes a registered callback. */
  removeEventListener(type, callback) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter(entry => entry.callback !== callback),
    );
  }
  /** Delivers one event and awaits async handlers for deterministic request assertions. */
  async fire(type, values = {}) {
    const event = {type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...values};
    await Promise.all(
      (this.listeners.get(type) || []).map(({callback, options}) => {
        if (options?.once) this.removeEventListener(type, callback);
        return callback(event);
      }),
    );
  }
  /** Creates the shadow-root fixture; focus is observable by tree renderers. */
  attachShadow() {
    const shadow = new Node(this.document, '#shadow');
    Object.defineProperty(shadow, 'activeElement', {get: () => this.document.activeElement});
    return shadow;
  }
}

/** Creates a document and a minimal window event target. */
export function dom() {
  const document = {
    activeElement: null,
    title: 'Fixture · GitHub',
    createElement(tag) {
      return new Node(this, tag);
    },
    createElementNS(namespace, tag) {
      const node = this.createElement(tag);
      node.namespaceURI = namespace;
      return node;
    },
    createTextNode(text) {
      const node = this.createElement('#text');
      node.textContent = text;
      return node;
    },
    createDocumentFragment() {
      return this.createElement('#fragment');
    },
    getElementById(id) {
      return this.body.querySelector(`#${id}`);
    },
    querySelector(selector) {
      return this.body.querySelector(selector);
    },
    querySelectorAll(selector) {
      return this.body.querySelectorAll(selector);
    },
  };
  document.body = document.createElement('body');
  return {document, window: document.createElement('#window')};
}

/** Installs fixture globals and restores them at the end of a test. */
export function install(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
}

/** A controlled shared animation-frame clock. */
export function frames() {
  let id = 0;
  const pending = new Map();
  return {
    pending,
    requestAnimationFrame(callback) {
      pending.set(++id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      pending.delete(id);
    },
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
  };
}
