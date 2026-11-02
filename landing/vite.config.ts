/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Vite configuration for the landing page. HTML entries are Nunjucks
 * templates rendered with one locale's context before Vite resolves and
 * fingerprints their assets; `scripts/landing.mjs` builds every locale and
 * merges the results. `LOCALE` selects the locale for `npm run landing:dev`.
 */

import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import nunjucks from 'nunjucks';
import {defineConfig, type Plugin, type UserConfig} from 'vite';
import type {Locale} from './src/data.ts';
import {defaultLocale, locales, routes, siteData} from './src/data.ts';

/** Landing root (the directory of this file). */
const root = fileURLToPath(new URL('.', import.meta.url));

/** Nunjucks template directory. */
const templates = resolve(root, 'src/templates');

/**
 * Renders each HTML entry as a Nunjucks template with [context]. Autoescaping
 * stays on: dictionary strings are text, and only trusted template files
 * contain markup. Leading whitespace left by license comments is removed so
 * the document starts with its doctype.
 */
function renderNunjucks(context: ReturnType<typeof siteData>): Plugin {
  const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader(templates, {noCache: true}), {
    autoescape: true,
    throwOnUndefined: true,
    trimBlocks: true,
    lstripBlocks: true,
  });
  // Prefix of repository files (screenshots, icons): relative to the entry for
  // builds, which Vite fingerprints; `/@fs/` for the dev server.
  let repo = '../';
  return {
    name: 'codetree-landing-nunjucks',
    configResolved(config) {
      if (config.command === 'serve') repo = `/@fs${resolve(root, '..')}/`;
    },
    transformIndexHtml: {
      order: 'pre',
      handler: html => environment.renderString(html, {...context, repo}).trimStart(),
    },
    configureServer(server) {
      // Templates are not module graph members; reload the page when one changes.
      server.watcher.add(templates);
      server.watcher.on('change', path => {
        if (path.endsWith('.njk')) server.ws.send({type: 'full-reload'});
      });
      // The dev server renders one locale; serve `/<locale>/…` URLs from the same entries.
      const prefix = new RegExp(`^/(?:${locales.join('|')})(?=/)`);
      server.middlewares.use((request, _response, next) => {
        if (request.url) request.url = request.url.replace(prefix, '');
        next();
      });
    },
  };
}

/** Returns the Vite configuration that builds [locale] into [outDir]. */
export function landingConfig({
  locale = defaultLocale,
  outDir = resolve(root, '../dist/landing-dev'),
}: {locale?: Locale; outDir?: string} = {}): UserConfig {
  return {
    root,
    base: '/',
    publicDir: false,
    logLevel: 'warn',
    plugins: [renderNunjucks(siteData(locale))],
    build: {
      outDir,
      emptyOutDir: true,
      assetsInlineLimit: 0,
      rolldownOptions: {
        input: Object.keys(routes).map(page => resolve(root, page === 'index' ? 'index.html' : `${page}.html`)),
      },
    },
    server: {host: '127.0.0.1', port: 8087},
  };
}

export default defineConfig(({mode}) => {
  const locale = mode === 'en' || mode === 'ru' ? mode : process.env.LOCALE || defaultLocale;
  if (!locales.includes(locale as Locale)) throw new Error(`Unknown landing locale: ${locale}`);
  return landingConfig({locale: locale as Locale});
});
