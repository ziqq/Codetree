/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Builds the public landing page for GitHub Pages: one Vite build per locale
 * (`landing/vite.config.ts`), merged so the default locale is at the root
 * and others under `/<locale>/`. Fingerprinted assets and public files of
 * every locale are shared at the root; identical names must have identical bytes.
 *
 * After merging, every local `href`, `src`, `srcset` and CSS `url()` must
 * resolve to a published file, and plain `http:` resources are rejected.
 *
 * Usage: `node scripts/landing.mjs [--outdir <directory>]` (default `dist/landing`).
 */

import {cp, mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build, loadConfigFromFile} from 'vite';
/** Published locale order; the first locale is served at the site root. */
const locales = ['en', 'ru'];
const defaultLocale = locales[0];

/** Repository root. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Returns every file below [directory] as `/`-separated relative paths, sorted. */
async function list(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true, recursive: true})) {
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in landing output: ${entry.name}`);
    if (entry.isFile()) files.push(relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'));
  }
  return files.sort();
}

/** Returns the local references of an HTML or CSS file, without query strings or fragments. */
function references(path, text) {
  const values = [];
  if (path.endsWith('.html')) {
    for (const match of text.matchAll(/\s(?:href|src)="([^"]*)"/g)) values.push(match[1]);
    for (const match of text.matchAll(/\ssrcset="([^"]*)"/g)) {
      values.push(...match[1].split(',').map(item => item.trim().split(/\s+/)[0]));
    }
  }
  for (const match of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) values.push(match[1]);
  return values
    .filter(value => value && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value))
    .map(value => value.split(/[?#]/)[0]);
}

/**
 * Copies one locale build into [outdir]: pages under [prefix], assets and
 * public files shared at the root. A different file with the same name fails.
 */
async function merge(build, outdir, prefix) {
  for (const path of await list(build)) {
    const target = prefix && path.endsWith('.html') ? `${prefix}/${path}` : path;
    const destination = resolve(outdir, target);
    const existing = await readFile(destination).catch(() => null);
    const data = await readFile(resolve(build, path));
    if (existing && !existing.equals(data)) throw new Error(`Conflicting landing file: ${target}`);
    if (!existing) await cp(resolve(build, path), destination);
  }
}

/** Requires every local reference in the published HTML/CSS to resolve to a published file. */
async function validate(outdir) {
  const files = await list(outdir);
  const published = new Set(files);
  for (const path of files) {
    if (!/\.(?:html|css)$/.test(path)) continue;
    const text = await readFile(resolve(outdir, path), 'utf8');
    if (/\b(?:href|src|srcset)="http:|url\(\s*['"]?http:/i.test(text)) throw new Error(`Insecure resource in ${path}`);
    for (const reference of references(path, text)) {
      const base = reference.startsWith('/') ? outdir : dirname(resolve(outdir, path));
      let target = relative(
        outdir,
        resolve(base, `.${reference.startsWith('/') ? '' : '/'}${decodeURIComponent(reference)}`),
      );
      target = target.split(sep).join('/');
      if (reference.endsWith('/') || reference === '.') target = target ? `${target}/index.html` : 'index.html';
      if (target.startsWith('..') || !published.has(target)) {
        throw new Error(`Missing landing reference in ${path}: ${reference}`);
      }
    }
  }
  return files;
}

/**
 * Builds every locale into [outdir], replacing it, and validates the result.
 * Returns the published file list.
 */
export async function buildLanding(outdir = resolve(root, 'dist/landing')) {
  const temporary = await mkdtemp(join(tmpdir(), 'codetree-landing-'));
  try {
    await rm(outdir, {recursive: true, force: true});
    for (const locale of locales) {
      const localeDir = join(temporary, locale);
      const loaded = await loadConfigFromFile(
        {command: 'build', mode: locale},
        resolve(root, 'landing/vite.config.ts'),
      );
      if (!loaded) throw new Error('Landing Vite configuration was not loaded');
      await build({
        ...loaded.config,
        build: {...loaded.config.build, outDir: localeDir},
        configFile: false,
        logLevel: 'error',
      });
      await merge(localeDir, outdir, locale === defaultLocale ? '' : locale);
    }
    return await validate(outdir);
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--outdir');
  const outdir = resolve(index > 0 ? process.argv[index + 1] : resolve(root, 'dist/landing'));
  const files = await buildLanding(outdir);
  console.log(`Landing: ${files.length} files in ${relative(process.cwd(), outdir) || '.'}`);
}
