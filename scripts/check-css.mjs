/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Validates the extension stylesheets without a full CSS linter.
 *
 * Checks syntax and seven rule categories against MDN data plus the
 * compatibility names in `css-compatibility.json`: unknown properties,
 * functions, pseudo-classes and pseudo-elements, invalid values, and
 * vendor-specific names outside the allowlist.
 *
 * Usage: `node scripts/check-css.mjs`.
 */

import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {ident, lexer, tokenize, tokenTypes} from 'css-tree';
import mdn from 'mdn-data';
import {compileStyles} from './styles.mjs';

const require = createRequire(import.meta.url);
const compatibility = require('./css-compatibility.json');
const functions = new Set(require('css-functions-list/index.json'));
const properties = new Set([...Object.keys(mdn.css.properties), ...compatibility.properties]);
const pseudoClasses = new Set([
  ...Object.keys(mdn.css.selectors)
    .filter(value => /^:[^:]/.test(value))
    .map(value => value.slice(1).replace(/\(\)$/, '')),
  ...compatibility.pseudoClasses,
]);
const pseudoElements = new Set([
  ...Object.keys(mdn.css.selectors)
    .filter(value => value.startsWith('::'))
    .map(value => value.slice(2).replace(/\(\)$/, '')),
  ...compatibility.pseudoElements,
]);
const legacyElements = new Set(['after', 'before', 'first-letter', 'first-line']);
const pageClasses = new Set(compatibility.pageClasses);
const scrollbarClasses = new Set(compatibility.scrollbarClasses);
const scrollbarElements = new Set(compatibility.scrollbarElements);
const vendorPrefix = /^-\w+-/;
for (const name of ['first', 'left', 'right']) pseudoClasses.delete(name);
for (const name of ['matches', 'nth-column', 'nth-last-column']) pseudoClasses.add(name);
for (const name of ['content', 'shadow']) pseudoElements.add(name);

/**
 * Returns the problems found in a stylesheet.
 *
 * @param {string} source The CSS text.
 * @param {string} [filename='stylesheet.css'] Name used in messages.
 * @returns {Array<{line: number, column: number, rule: string, message: string}>}
 */
export function checkCSS(source, filename = 'stylesheet.css') {
  const errors = [];
  const report = (node, rule, message) =>
    errors.push({rule, message, line: node.source?.start?.line || 1, column: node.source?.start?.column || 1});
  let root;
  try {
    root = postcss.parse(source, {from: filename});
  } catch (error) {
    return [{rule: 'syntax', message: error.reason || error.message, line: error.line || 1, column: error.column || 1}];
  }

  function checkBlock(node) {
    if (node.type !== 'root' && node.nodes && !node.nodes.length) report(node, 'block-no-empty', 'Empty CSS block.');
    if (!node.nodes) return;
    const declaredProperties = new Set();
    for (const child of node.nodes) {
      if (child.type !== 'decl') continue;
      const property = child.prop.toLowerCase();
      if (property.startsWith('--') || property === 'src') continue;
      if (declaredProperties.has(property))
        report(child, 'declaration-block-no-duplicate-properties', `Duplicate property: ${child.prop}.`);
      declaredProperties.add(property);
    }
  }
  checkBlock(root);
  root.walk(checkBlock);

  root.walkDecls(node => {
    const property = node.prop.toLowerCase();
    const descriptors =
      node.parent.type === 'atrule' ? lexer.getAtrule(node.parent.name.toLowerCase())?.descriptors : null;
    const custom = property.startsWith('--');
    if (
      !custom &&
      !vendorPrefix.test(property) &&
      !Object.hasOwn(descriptors || {}, property) &&
      !properties.has(property) &&
      !lexer.getProperty(property)
    )
      report(node, 'property-no-unknown', `Unknown property: ${node.prop}.`);
    let blockDepth = 0;
    let urlDepth = 0;
    tokenize(node.value, (type, start, end) => {
      const value = node.value.slice(start, end);
      if (custom && type === tokenTypes.LeftCurlyBracket) blockDepth++;
      if (custom && type === tokenTypes.RightCurlyBracket) blockDepth--;
      if (
        type === tokenTypes.Hash &&
        !urlDepth &&
        !/^(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(ident.decode(value.slice(1)))
      )
        report(node, 'color-no-invalid-hex', `Invalid hex color: ${value}.`);
      if (urlDepth && type === tokenTypes.LeftParenthesis) urlDepth++;
      if (urlDepth && type === tokenTypes.RightParenthesis) urlDepth--;
      if (type !== tokenTypes.Function) return;
      const name = ident.decode(value.slice(0, -1)).toLowerCase();
      if (urlDepth || name.endsWith('url')) urlDepth++;
      if (blockDepth) return;
      if (!name.startsWith('--') && !functions.has(name))
        report(node, 'function-no-unknown', `Unknown function: ${name}.`);
    });
  });

  function scrollbarContext(pseudo, node) {
    let nesting = false;
    for (let previous = pseudo.prev(); previous; previous = previous.prev()) {
      if (previous.type === 'combinator') return false;
      if (previous.type === 'nesting') nesting = true;
      if (previous.type === 'pseudo' && previous.value.startsWith('::'))
        return scrollbarElements.has(previous.value.toLowerCase().slice(2));
    }
    if (!nesting) return false;
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.type !== 'rule' || !ancestor.selector.includes('::')) continue;
      let found = false;
      selectorParser(selectors =>
        selectors.walkPseudos(value => {
          if (value.value.startsWith('::') && scrollbarElements.has(value.value.toLowerCase().slice(2))) found = true;
        }),
      ).processSync(ancestor.selector);
      if (found) return true;
    }
    return false;
  }

  function checkSelector(source, node, page = false) {
    try {
      selectorParser(selectors =>
        selectors.walkPseudos(pseudo => {
          const element = pseudo.value.startsWith('::');
          const name = ident.decode(pseudo.value.slice(element ? 2 : 1)).toLowerCase();
          if ((!page && vendorPrefix.test(name)) || (!element && name.startsWith('--'))) return;
          const known = element
            ? pseudoElements.has(name)
            : page
              ? pageClasses.has(name)
              : pseudoClasses.has(name) ||
                legacyElements.has(name) ||
                (scrollbarClasses.has(name) && scrollbarContext(pseudo, node));
          if (!known)
            report(
              node,
              element ? 'selector-pseudo-element-no-unknown' : 'selector-pseudo-class-no-unknown',
              `Unknown pseudo-selector: ${pseudo.value}.`,
            );
        }),
      ).processSync(source);
    } catch (error) {
      report(node, 'syntax', error.message);
    }
  }
  root.walkRules(node => checkSelector(node.selector, node));
  root.walkAtRules('page', node => checkSelector(node.params, node, true));
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [file, {css, source}] of Object.entries(compileStyles())) {
    const errors = checkCSS(css, file);
    for (const error of errors)
      console.error(`${source} → ${file}:${error.line}:${error.column} ${error.rule}: ${error.message}`);
    if (errors.length) process.exitCode = 1;
  }
  if (!process.exitCode) console.log('Compiled SCSS and checked CSS syntax and seven stylesheet rules.');
}
