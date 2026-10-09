/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 */

/** Bundles the content factories with the same generated icon data as the shipped extension. */
import {build} from 'esbuild';
import {fileIconsModule} from '../../scripts/file-icons.mjs';
import {root} from '../../scripts/build.mjs';

/** One reactive runtime shared by every factory and assertion in the fixture. */
export const source = `
export * from './src/content/reactive.js';
export * from './src/content/reactive-dom.js';
export * from './src/content/state.js';
export * from './src/content/sidebar/view.js';
export * from './src/content/sidebar/tree.js';
export * from './src/content/sidebar/files.js';
export * from './src/content/sidebar/pulls.js';
export * from './src/content/sidebar/bookmarks.js';
export * from './src/content/sidebar/render.js';
export * from './src/content/navigation.js';
export * from './src/content/native/header-buttons.js';
export * from './src/content/viewer/viewer.js';
export * from './src/shared/tree.js';
`;

/** Builds a browser-compatible module without altering source files or runtime dependencies. */
export async function bundle() {
  const result = await build({
    stdin: {contents: source, resolveDir: root},
    bundle: true,
    write: false,
    format: 'esm',
    target: 'chrome116',
    plugins: [
      {
        name: 'fixture-icons',
        setup(builder) {
          builder.onResolve({filter: /^virtual:file-icons$/}, () => ({path: 'icons', namespace: 'fixture'}));
          builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: fileIconsModule(), loader: 'js'}));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}
