/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Landing page assembly and language selection, run against the real
 * `scripts/landing.mjs` (Vite and Nunjucks) and `landing/src/main.ts`.
 */

import assert from 'node:assert/strict';
import {transform} from 'esbuild';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {buildLanding} from '../scripts/landing.mjs';

const root = resolve(import.meta.dirname, '..');
const {code: script} = await transform(await readFile(resolve(root, 'landing/src/main.ts'), 'utf8'), {
  loader: 'ts',
  format: 'iife',
});

test('landing builds both locales with localized links and fingerprinted shared assets', async t => {
  const outdir = await mkdtemp(join(tmpdir(), 'codetree-landing-'));
  t.after(() => rm(outdir, {recursive: true, force: true}));
  const files = await buildLanding(outdir);
  for (const page of ['index.html', 'privacy.html', 'ru/index.html', 'ru/privacy.html']) {
    assert.ok(files.includes(page), page);
  }
  assert.ok(
    files.every(path => !/(?:^|\/)(?:manifest\.json|CNAME|.*\.(?:njk|scss|mjs|ts|md|zip))$/.test(path)),
    files.join(', '),
  );
  assert.ok(files.every(path => path.startsWith('assets/') || !path.includes('/') || path.startsWith('ru/')));

  const ru = await readFile(join(outdir, 'ru/index.html'), 'utf8');
  assert.match(ru, /^<!doctype html>\n<html lang="ru">/);
  assert.match(ru, /<link rel="canonical" href="https:\/\/codetree\.ustinoff\.dev\/ru\/" \/>/);
  assert.match(ru, /href="\/ru\/privacy\.html\?lang=ru"/);
  assert.match(ru, /<option value="ru" selected>Русский<\/option>/);
  assert.doesNotMatch(ru, /\{[{%#]/);
  const policy = await readFile(join(outdir, 'privacy.html'), 'utf8');
  assert.match(policy, /<h1>Privacy<\/h1>/);
  assert.match(policy, /codetree\.landing\.language/);
  for (const page of ['index.html', 'ru/index.html']) {
    const html = await readFile(join(outdir, page), 'utf8');
    assert.match(
      html,
      /href="https:\/\/chromewebstore\.google\.com\/detail\/codetree\/omfcokfhgbjklkbkbhfadefpolbndjba"/,
    );
    assert.match(html, /<script type="module"[^>]*src="\/assets\/[^"]+\.js"/);
  }

  const dark = await readFile(resolve(root, 'docs/store/screenshots/dark/1-github-tree.png'));
  const darkAsset = files.find(
    path => /^assets\/1-github-tree-[\w-]+\.png$/.test(path) && ru.includes(`srcset="/${path}"`),
  );
  assert.ok(darkAsset, 'dark screenshot is referenced by its fingerprinted path');
  assert.deepEqual(await readFile(join(outdir, darkAsset)), dark);
});

/**
 * Runs the landing script for [href] on a page in [pageLanguage] and returns
 * the redirect target (or null) plus the bound language picker.
 */
function load(href, {pageLanguage = 'en', saved = null, languages = ['en-US'], storage = true} = {}) {
  const url = new URL(href);
  const stored = new Map(saved ? [['codetree.landing.language', saved]] : []);
  const navigation = {replaced: null, assigned: null};
  const listeners = {};
  const picker = {
    value: '',
    addEventListener: (type, listener) => (listeners[type] = listener),
  };
  const ready = [];
  const localStorage = {
    getItem: key => {
      if (!storage) throw new Error('blocked');
      return stored.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (!storage) throw new Error('blocked');
      stored.set(key, value);
    },
  };
  runInNewContext(script, {
    URL,
    String,
    localStorage,
    navigator: {languages},
    location: {
      href: url.href,
      pathname: url.pathname,
      hash: url.hash,
      replace: target => (navigation.replaced = String(target)),
      assign: target => (navigation.assigned = String(target)),
    },
    document: {
      readyState: 'loading',
      documentElement: {lang: pageLanguage},
      getElementById: id => (id === 'landing-language' ? picker : null),
      addEventListener: (type, listener) => type === 'DOMContentLoaded' && ready.push(listener),
    },
  });
  ready.forEach(listener => listener());
  return {navigation, picker, listeners, stored};
}

test('landing language: explicit, then saved, then page, then browser language', () => {
  const site = 'https://codetree.ustinoff.dev/';
  assert.equal(load(site, {languages: ['ru-RU', 'en']}).navigation.replaced, `${site}ru/?lang=ru`);
  assert.equal(load(`${site}?lang=en`, {languages: ['ru-RU']}).navigation.replaced, null);
  assert.equal(load(site, {saved: 'en', languages: ['ru-RU']}).navigation.replaced, null);
  assert.equal(
    load(`${site}privacy.html#sync`, {saved: 'ru'}).navigation.replaced,
    `${site}ru/privacy.html?lang=ru#sync`,
  );
  assert.equal(load(`${site}ru/`, {pageLanguage: 'ru', languages: ['en-US']}).navigation.replaced, null);
  assert.equal(
    load(`${site}ru/privacy.html?lang=en`, {pageLanguage: 'ru'}).navigation.replaced,
    `${site}privacy.html?lang=en`,
  );
  assert.equal(load(site, {saved: 'de', languages: ['de-DE', 'fr']}).navigation.replaced, null);
  assert.equal(load(site, {storage: false, languages: ['ru']}).navigation.replaced, `${site}ru/?lang=ru`);
});

test('landing language picker saves the choice and keeps the current page', () => {
  const site = 'https://codetree.ustinoff.dev/';
  const page = load(`${site}privacy.html`);
  assert.equal(page.picker.value, 'en');
  page.picker.value = 'ru';
  page.listeners.change();
  assert.equal(page.stored.get('codetree.landing.language'), 'ru');
  assert.equal(page.navigation.assigned, `${site}ru/privacy.html?lang=ru`);

  const blocked = load(`${site}ru/`, {pageLanguage: 'ru', storage: false});
  blocked.picker.value = 'en';
  assert.doesNotThrow(() => blocked.listeners.change());
  assert.equal(blocked.navigation.assigned, `${site}?lang=en`);
});
