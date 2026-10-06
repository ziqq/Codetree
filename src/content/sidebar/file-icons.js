/* file-icons/atom icon matching and rendering. The table is generated at build time from vendor/file-icons. */
import {directories, files, fonts, glyphs} from 'virtual:file-icons';

const family = index => `codetree-file-icons-${index}`;
const cache = {file: new Map(), directory: new Map()};

// Same order as file-icons/atom: path-specific rules first, then every rule against the basename.
function lookup(table, path, name) {
  for (const index of table.path) if (table.rules[index][3].test(path)) return table.rules[index];
  for (const rule of table.rules) if (rule[3].test(name)) return rule;
  return null;
}

export function matchIcon(path, directory = false) {
  const store = directory ? cache.directory : cache.file;
  if (store.has(path)) return store.get(path);
  const rule = lookup(directory ? directories : files, `/${path}`, path.slice(path.lastIndexOf('/') + 1));
  if (store.size >= 4096) store.clear();
  store.set(path, rule);
  return rule;
}

// Fonts must be declared in the page document; @font-face rules inside a shadow root are ignored.
export function fontFaces() {
  return fonts.map((file, index) => `@font-face{font-family:"${family(index)}";src:url("${chrome.runtime.getURL(`fonts/${file}`)}") format("woff2");font-weight:normal;font-style:normal;font-display:block}`).join('');
}

export function fileIconElement(rule, {coloured, dark}) {
  const glyph = glyphs[rule[0]]; const colour = coloured ? rule[dark ? 1 : 2] : null;
  let node;
  if (glyph.svg) {
    node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 16 16'); node.setAttribute('fill', 'currentColor'); node.setAttribute('aria-hidden', 'true');
    for (const value of glyph.svg) {
      const path = document.createElementNS(node.namespaceURI, 'path'); path.setAttribute('d', value); node.append(path);
    }
    node.classList.add('file-icon', 'octicon');
  } else {
    node = document.createElement('span'); node.className = 'file-icon glyph'; node.setAttribute('aria-hidden', 'true');
    node.textContent = glyph.text;
    node.style.fontFamily = `"${family(glyph.font)}"`; node.style.fontSize = `${glyph.size}px`;
    if (glyph.top) node.style.top = `${glyph.top}px`;
    if (glyph.left) node.style.left = `${glyph.left}px`;
    if (glyph.transform) node.style.transform = glyph.transform;
    if (glyph.origin) node.style.transformOrigin = glyph.origin;
  }
  if (colour) node.style.color = colour;
  return node;
}
