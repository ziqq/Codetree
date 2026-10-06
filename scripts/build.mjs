/* Bundles src/ into an unpacked Manifest V3 extension. Output is deterministic for a given checkout. */
import {copyFile, mkdir, rm} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fileIconsModule, fonts, vendor} from './file-icons.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = {
  background: 'src/background/index.js',
  content: 'src/content/index.js',
  options: 'src/options/index.js',
};
const assets = {
  'manifest.json': 'src/manifest.json',
  'sidebar.css': 'src/content/sidebar.css',
  'options.html': 'src/options/options.html',
  'options.css': 'src/options/options.css',
  'icons/icon16.png': 'src/icons/icon16.png',
  'icons/icon48.png': 'src/icons/icon48.png',
  'icons/icon128.png': 'src/icons/icon128.png',
};

// Serves the icon table generated from the vendored file-icons/atom sources.
const fileIcons = {
  name: 'file-icons',
  setup(builder) {
    builder.onResolve({filter: /^virtual:file-icons$/}, () => ({path: 'file-icons', namespace: 'file-icons'}));
    builder.onLoad({filter: /.*/, namespace: 'file-icons'}, () => ({contents: fileIconsModule(), loader: 'js', resolveDir: root}));
  },
};

export async function buildExtension(outdir = resolve(root, 'build')) {
  await rm(outdir, {recursive: true, force: true});
  await build({
    absWorkingDir: root, entryPoints: entries, outdir, bundle: true,
    format: 'iife', platform: 'browser', target: 'chrome116', charset: 'utf8',
    legalComments: 'none', banner: {js: "'use strict';"}, logLevel: 'warning', plugins: [fileIcons],
  });
  const fontFiles = Object.values(fonts).map(file => [`fonts/${file}`, relative(root, resolve(vendor, 'fonts', file))]);
  for (const [name, source] of [...Object.entries(assets), ...fontFiles]) {
    await mkdir(dirname(resolve(outdir, name)), {recursive: true});
    await copyFile(resolve(root, source), resolve(outdir, name));
  }
  return outdir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--outdir');
  const outdir = await buildExtension(index > 0 ? resolve(process.argv[index + 1]) : undefined);
  console.log(`Built the unpacked extension in ${relative(root, outdir) || '.'}/.`);
}
