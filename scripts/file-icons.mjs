/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Generates the content-script icon table from the vendored file-icons/atom
 * rules (`icondb.cjs`), glyph metrics (`icons.less`), colours
 * (`colours.less`) and fonts.
 *
 * The Less sources are evaluated directly: mixins and the single nested
 * `.tree-view` override in `icons.less`, and the palette functions
 * (`lighten`, `darken`, `saturate`) and theme mixins in `colours.less`,
 * for Atom's dark and light themes. Unknown constructs fail the build
 * instead of producing wrong icons.
 */

import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require = createRequire(import.meta.url);

/** Directory of the vendored file-icons sources. */
export const vendor = resolve(import.meta.dirname, '../vendor/file-icons');

/** Icon fonts by CSS family name in `icons.less` → bundled file. */
export const fonts = Object.freeze({
  'file-icons': 'file-icons.woff2',
  FontAwesome: 'fontawesome.woff2',
  Mfizz: 'mfixx.woff2',
  Devicons: 'devopicons.woff2',
});
// Atom ships Octicons itself; the matching current Octicons SVGs replace those font glyphs.
/** Atom icon classes drawn with Octicons → current Octicons names. */
const octicons = Object.freeze({
  'binary-icon': 'file-binary',
  'book-icon': 'book',
  'checklist-icon': 'checklist',
  'code-icon': 'code',
  'database-icon': 'database',
  'gear-icon': 'gear',
  'git-commit-icon': 'git-commit',
  'git-merge-icon': 'git-merge',
  'github-icon': 'mark-github',
  'graph-icon': 'graph',
  'image-icon': 'image',
  'key-icon': 'key',
  'link-icon': 'link',
  'markdown-icon': 'markdown',
  'package-icon': 'package',
  'ruby-icon': 'ruby',
  'secret-icon': 'lock',
  'squirrel-icon': 'squirrel',
  'text-icon': 'file',
  'zip-icon': 'file-zip',
  // Atom's own Octicon classes, renamed or removed in current Octicons.
  'icon-circuit-board': 'cpu',
  'icon-file-pdf': 'file',
  'icon-file-text': 'file',
  'icon-mail': 'mail',
  'icon-paintcan': 'paintbrush',
  'icon-star': 'star',
});

/** Parses a Less declaration block, expanding referenced mixins. */
function declarations(body, mixins) {
  const output = {};
  for (const part of body
    .split(';')
    .map(value => value.trim())
    .filter(Boolean)) {
    if (part.startsWith('.'))
      Object.assign(
        output,
        mixins[part.slice(1)] ||
          (() => {
            throw new Error(`Unknown icon mixin ${part}`);
          })(),
      );
    else {
      const index = part.indexOf(':');
      output[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
  }
  return output;
}

/** Returns the declarations of every `.<name>-icon:before` rule, with `content` decoded. */
function glyphs() {
  // Atom's tree-view overrides apply to this sidebar, so nested `.tree-view &{…}` blocks join their rule.
  const source = readFileSync(resolve(vendor, 'icons.less'), 'utf8')
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\.tree-view\s*&\s*\{([^{}]*)\}/g, '$1');
  const mixins = {};
  for (const [, name, body] of source.matchAll(/^\.([\w-]+)\s*\{([^{}]*)\}/gm)) {
    if (!name.endsWith('-icon')) mixins[name] = declarations(body, mixins);
  }
  const output = {};
  for (const [, name, body] of source.matchAll(/^\.([\w-]+-icon):before\s*\{([^{}]*)\}/gm)) {
    const value = declarations(body, mixins);
    const content = value.content
      .replace(/^["']|["']$/g, '')
      .replace(/\\([\da-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
    output[name] = {...value, content};
  }
  return output;
}

/** `#rrggbb` → RGB channels in [0, 1]. */
function rgb(hex) {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
}

/** RGB → [hue (degrees), saturation, lightness], as in Less. */
function hsl([red, green, blue]) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const delta = max - min;
  const saturation = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === red
      ? (green - blue) / delta + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return [hue * 60, saturation, light];
}

/** HSL → `#rrggbb`, clamping saturation and lightness like Less. */
function hex([hue, saturation, light]) {
  const clamp = value => Math.min(1, Math.max(0, value));
  saturation = clamp(saturation);
  light = clamp(light);
  const q = light < 0.5 ? light * (1 + saturation) : light + saturation - light * saturation;
  const p = 2 * light - q;
  const channel = offset => {
    let t = (hue / 360 + offset + 1) % 1;
    const value = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1 / 3)}${channel(0)}${channel(-1 / 3)}`;
}

/** Adds absolute lightness and saturation, like Less `lighten`/`darken`/`saturate`. */
const adjust = (colour, light = 0, saturation = 0) => {
  const [h, s, l] = hsl(rgb(colour));
  return hex([h, s + saturation, l + light]);
};

// Evaluates colours.less for Atom's dark (index 0) and light (index 1) colour classes.
/**
 * Evaluates `colours.less` for Atom's dark (index 0) and light (index 1) themes.
 *
 * @returns {[Object<string, ?string>, Object<string, ?string>]} Colour by class name;
 *     `null` means the class sets no colour in that theme.
 */
function colours() {
  const source = readFileSync(resolve(vendor, 'colours.less'), 'utf8')
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const variables = {};
  const percent = value => Number.parseFloat(value.startsWith('@') ? variables[value.slice(1)] : value) / 100;
  for (const [, name, value] of source.matchAll(/^@([\w-]+):\s*([^;]+);/gm)) {
    const call = /^(lighten|darken)\(@([\w-]+),\s*(@?[\w.%-]+)\)$/.exec(value);
    variables[name] = call
      ? adjust(variables[call[2]], (call[1] === 'lighten' ? 1 : -1) * percent(call[3]))
      : value.startsWith('@')
        ? variables[value.slice(1)]
        : value;
  }
  const themes = [{}, {}];
  for (const [, name, body] of source.matchAll(/^\.([\w-]+):before\s*\{\s*([^{}]*?)\s*\}/gm)) {
    let match;
    if ((match = /^color:\s*@([\w-]+);$/.exec(body))) {
      themes[0][name] = themes[1][name] = variables[match[1]];
      continue;
    }
    match = /^\.([\w-]+)\(@([\w-]+),\s*([\d.]+)%\);$/.exec(body);
    if (!match) throw new Error(`Unsupported colour rule: .${name}`);
    const [, mixin, variable, amount] = match;
    const colour = variables[variable];
    const value = Number(amount) / 100;
    if (mixin === 'brighten-if-needed') {
      themes[0][name] = adjust(colour, value, value);
      themes[1][name] = colour;
    } else if (mixin === 'brighten-grey-if-needed') {
      themes[0][name] = adjust(colour, value);
      themes[1][name] = null;
    } else if (mixin === 'darken-if-needed') {
      themes[0][name] = colour;
      themes[1][name] = adjust(colour, -value);
    } else throw new Error(`Unsupported colour mixin: ${mixin}`);
  }
  return themes;
}

/** Returns the 16-pixel SVG path data of an Octicon. */
function octiconPath(name) {
  const svg = require('@primer/octicons/build/data.json')[name]?.heights?.[16]?.path;
  const paths = [...(svg || '').matchAll(/\sd="([^"]+)"/g)].map(match => match[1]);
  if (!paths.length) throw new Error(`Missing Octicon: ${name}`);
  return paths;
}

/**
 * Returns the source of the `virtual:file-icons` module.
 *
 * Exports `fonts` (bundled font files), `glyphs` (font glyph or SVG paths
 * per icon) and the `directories` and `files` tables. Each table has
 * `rules` (`[glyph, darkColour, lightColour, pattern]` in Atom's priority
 * order) and `path` (indexes of rules matched against full paths).
 *
 * @returns {string}
 */
export function fileIconsModule() {
  const database = require(resolve(vendor, 'icondb.cjs'));
  const styles = glyphs();
  const [dark, light] = colours();
  const names = [];
  const index = new Map();
  const glyphTable = [];
  const fontNames = Object.keys(fonts);
  const glyph = name => {
    if (index.has(name)) return index.get(name);
    let value;
    if (Object.hasOwn(octicons, name)) value = {svg: octiconPath(octicons[name])};
    else {
      const style = styles[name];
      if (!style) throw new Error(`Missing icon style: ${name}`);
      const family = style['font-family'].replace(/^["']|["']$/g, '');
      if (!fontNames.includes(family)) throw new Error(`Unsupported icon font ${family} for ${name}`);
      value = {
        font: fontNames.indexOf(family),
        text: style.content,
        size: Number.parseFloat(style['font-size'] || '16'),
        top: Number.parseFloat(style.top || '0'),
        left: Number.parseFloat(style.left || '0'),
        ...(style.transform ? {transform: style.transform} : {}),
        ...(style['transform-origin'] ? {origin: style['transform-origin']} : {}),
      };
    }
    index.set(name, names.length);
    names.push(name);
    glyphTable.push(value);
    return index.get(name);
  };
  const colour = (theme, name) =>
    name == null
      ? null
      : Object.hasOwn(theme, name)
        ? theme[name]
        : (() => {
            throw new Error(`Unknown colour ${name}`);
          })();
  const table = ([icons, indexes]) => ({
    rules: icons.map(([name, colours, match]) => [
      glyph(name),
      colour(dark, colours[0]),
      colour(light, colours[1]),
      match,
    ]),
    path: indexes[2],
  });
  const directories = table(database[0]);
  const files = table(database[1]);
  const serialize = value => JSON.stringify(value);
  // Global flags would make RegExp#test stateful between files.
  const rules = ({rules: list, path}) =>
    `{rules: [\n${list
      .map(
        ([icon, darkColour, lightColour, match]) =>
          `  [${icon}, ${serialize(darkColour)}, ${serialize(lightColour)}, ${String(new RegExp(match.source, match.flags.replace('g', '')))}]`,
      )
      .join(',\n')}\n], path: ${serialize(path)}}`;
  return `// Generated from vendor/file-icons by scripts/file-icons.mjs. Do not edit.
export const fonts = ${serialize(Object.values(fonts))};
export const glyphs = ${serialize(glyphTable)};
export const directories = ${rules(directories)};
export const files = ${rules(files)};
`;
}
