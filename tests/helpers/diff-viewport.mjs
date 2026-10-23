/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Deterministic geometry for diff scrolling tests, not a browser layout engine.
 */

/**
 * Adds bounded viewport geometry to the DOM fixture. Spacer dimensions come
 * from rendered styles, while visible text contributes ten pixels per column
 * with four-column tabs, matching the stylesheet's tab size. Unequal split
 * widths expose synchronization that incorrectly assumes identical viewports.
 * All descriptors remain configurable for stylesheet-loading fixtures.
 */
export function installDiffViewport(document) {
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const node = createElement(tag);
    let top = 0;
    let left = 0;
    let width;
    let height = 290;
    Object.defineProperties(node, {
      clientWidth: {
        configurable: true,
        get() {
          return (
            width ??
            (this.getAttribute('aria-label') === 'Old revision'
              ? 360
              : this.getAttribute('aria-label') === 'New revision'
                ? 400
                : 800)
          );
        },
        set(value) {
          width = value;
        },
      },
      clientHeight: {
        configurable: true,
        get() {
          return height;
        },
        set(value) {
          height = value;
        },
      },
      scrollWidth: {
        configurable: true,
        get() {
          if (this.classList.contains('code-spacer')) {
            const textWidth = Math.max(
              0,
              ...this.querySelectorAll('.line-text').map(text => {
                let columns = 0;
                for (const character of text.textContent) columns += character === '\t' ? 4 - (columns % 4) : 1;
                return columns * 10 + 100;
              }),
            );
            return Math.max(Number.parseFloat(this.style.width) || 0, this.parent?.clientWidth || 0, textWidth);
          }
          const spacer = this.children.find(child => child.classList.contains('code-spacer'));
          return Math.max(this.clientWidth, spacer?.scrollWidth || 0);
        },
      },
      scrollHeight: {
        configurable: true,
        get() {
          const spacer = this.children.find(child => child.classList.contains('code-spacer'));
          return Math.max(this.clientHeight, Number.parseFloat(spacer?.style.height) || 0);
        },
      },
      scrollTop: {
        configurable: true,
        get() {
          return Math.min(top, Math.max(0, this.scrollHeight - this.clientHeight));
        },
        set(value) {
          top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
        },
      },
      scrollLeft: {
        configurable: true,
        get() {
          return Math.min(left, Math.max(0, this.scrollWidth - this.clientWidth));
        },
        set(value) {
          left = Math.max(0, Math.min(value, this.scrollWidth - this.clientWidth));
        },
      },
    });
    return node;
  };
}
