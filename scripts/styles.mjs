/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/** Compiles the extension's SCSS with the same options for builds and CSS validation. */
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compile} from 'sass';

/** Repository root, independent of the caller's current directory. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Runtime stylesheet names and their SCSS entry points; page.css is embedded in content.js. */
const entries = {
  'sidebar.css': 'src/content/sidebar.scss',
  'options.css': 'src/options/options.scss',
  'page.css': 'src/content/page.scss',
};

/** Returns expanded CSS without source maps or absolute paths for reproducible release builds. */
export function compileStyles() {
  return Object.fromEntries(
    Object.entries(entries).map(([name, source]) => [
      name,
      {source, css: compile(resolve(root, source), {style: 'expanded', charset: false, sourceMap: false}).css + '\n'},
    ]),
  );
}
