/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Locale registry and the Nunjucks context of one locale build: strings,
 * localized page paths and SEO links. The default locale lives at the site
 * root; other locales under `/<locale>/`.
 */

import en from './i18n/en.ts';
import ru from './i18n/ru.ts';

/** Public site origin used for canonical and `hreflang` links. */
export const siteURL = 'https://codetree.ustinoff.dev';

/** Locale served at the site root. */
export const defaultLocale = 'en';

/** Dictionaries by locale code, in selector order. */
export const translations = {en, ru};

/** Supported locale codes. */
export type Locale = keyof typeof translations;
export const locales = Object.keys(translations) as Locale[];

/** Page routes relative to a locale root, by page key. */
export const routes = {index: '', privacy: 'privacy.html'};
export type Page = keyof typeof routes;

/** Returns the site-absolute path of [page] in [locale], e.g. `/ru/privacy.html`. */
export function localePath(page: Page, locale: Locale) {
  return `/${locale === defaultLocale ? '' : `${locale}/`}${routes[page]}`;
}

/**
 * Returns the template context for [locale]. Internal links carry `?lang=`
 * so the language script keeps an explicit choice without storage.
 */
export function siteData(locale: Locale) {
  if (!translations[locale]) throw new Error(`Unknown landing locale: ${locale}`);
  const link = (page: Page) => `${localePath(page, locale)}?lang=${locale}`;
  const seo = Object.fromEntries(
    (Object.keys(routes) as Page[]).map(page => [
      page,
      {
        canonical: `${siteURL}${localePath(page, locale)}`,
        xDefault: `${siteURL}${localePath(page, defaultLocale)}`,
        alternates: locales.map(code => ({hreflang: code, href: `${siteURL}${localePath(page, code)}`})),
      },
    ]),
  );
  return {
    locale,
    t: translations[locale],
    languages: locales.map(code => ({code, label: translations[code].label})),
    links: {
      home: link('index'),
      privacy: link('privacy'),
      repository: 'https://github.com/ziqq/Codetree',
      issues: 'https://github.com/ziqq/Codetree/issues',
      store: 'https://chromewebstore.google.com/detail/codetree/omfcokfhgbjklkbkbhfadefpolbndjba',
      guide: 'https://github.com/ziqq/Codetree#quick-start',
      license: 'https://github.com/ziqq/Codetree/blob/main/LICENSE',
      policySource: 'https://github.com/ziqq/Codetree/blob/main/PRIVACY.md',
    },
    seo,
  };
}
