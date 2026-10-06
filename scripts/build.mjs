/**
 * Bundles `src/` into an unpacked Manifest V3 extension in `build/`.
 *
 * esbuild bundles each entry point into one classic script (no runtime
 * module loading), unminified so reviewers can read it. Static assets,
 * the vendored file-icons fonts and the manifest are copied unchanged.
 * The output is byte-for-byte reproducible for a checkout.
 *
 * Usage: `node scripts/build.mjs [--outdir <directory>]`.
 */
import {copyFile, mkdir, rm} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fileIconsModule, fonts, vendor} from './file-icons.mjs';

/** Repository root. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Bundled entry points by output name. */
const entries = {
  background: 'src/background/index.js',
  content: 'src/content/index.js',
  options: 'src/options/index.js',
};

/** Copied files: output path → source path. */
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
/** esbuild plugin serving `virtual:file-icons`, the generated icon table. */
const fileIcons = {
  name: 'file-icons',
  setup(builder) {
    builder.onResolve({filter: /^virtual:file-icons$/}, () => ({path: 'file-icons', namespace: 'file-icons'}));
    builder.onLoad({filter: /.*/, namespace: 'file-icons'}, () => ({
      contents: fileIconsModule(),
      loader: 'js',
      resolveDir: root,
    }));
  },
};

/**
 * Builds the extension into [outdir], replacing its previous contents.
 *
 * @param {string} [outdir=build/] Output directory.
 * @returns {Promise<string>} The output directory.
 */
export async function buildExtension(outdir = resolve(root, 'build')) {
  await rm(outdir, {recursive: true, force: true});
  await build({
    absWorkingDir: root,
    entryPoints: entries,
    outdir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome116',
    charset: 'utf8',
    legalComments: 'none',
    banner: {js: "'use strict';"},
    logLevel: 'warning',
    plugins: [fileIcons],
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
