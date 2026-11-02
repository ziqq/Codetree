/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Language selection for the public landing page.
 *
 * Priority: an explicit `?lang=en|ru`, then the manual choice saved in this
 * site's local storage, then the page's own language for direct `/ru/` URLs,
 * then the first supported browser language. Storage may be unavailable, so
 * every switch also carries `?lang=` and works without it.
 */

/** Local storage key for the manual language choice. */
const languageKey = 'codetree.landing.language';

/** Public site root; each locale is published below the same origin. */
const siteURL = new URL('/', location.href);

/** Language of the current static page (`en` or `ru`). */
const currentLanguage = document.documentElement.lang;

/** Current page within a language folder: the homepage or the policy. */
const page = location.pathname.endsWith('/privacy.html') ? 'privacy.html' : '';

/** Accepts only the languages shipped by this site. */
function supportedLanguage(value: string | null | undefined): value is 'en' | 'ru' {
  return value === 'en' || value === 'ru';
}

/** Returns the saved manual choice, or an empty string when absent or storage is blocked. */
function savedLanguage() {
  try {
    const value = localStorage.getItem(languageKey);
    return supportedLanguage(value) ? value : '';
  } catch {
    return '';
  }
}

/** Returns the same page in [language] with an explicit `?lang=` and the current fragment. */
function languageURL(language: 'en' | 'ru') {
  const target = new URL(`${language === 'ru' ? 'ru/' : ''}${page}`, siteURL);
  target.searchParams.set('lang', language);
  target.hash = location.hash;
  return target;
}

const explicitLanguage = new URL(location.href).searchParams.get('lang');
const browserLanguage = (navigator.languages || [navigator.language])
  .map(value => String(value).split('-')[0].toLowerCase())
  .find(supportedLanguage);
const preferredLanguage = supportedLanguage(explicitLanguage)
  ? explicitLanguage
  : savedLanguage() || (currentLanguage === 'ru' ? 'ru' : browserLanguage || 'en');

if (preferredLanguage !== currentLanguage) location.replace(languageURL(preferredLanguage));

/** Binds the language selector; a manual change is saved ahead of browser detection. */
function bindLanguagePicker() {
  const picker = document.getElementById('landing-language') as HTMLSelectElement | null;
  if (!picker) return;
  picker.value = currentLanguage;
  picker.addEventListener('change', () => {
    const language = picker.value;
    if (!supportedLanguage(language)) return;
    try {
      localStorage.setItem(languageKey, language);
    } catch {
      // The explicit `?lang=` still keeps this choice for the next page.
    }
    if (language !== currentLanguage) location.assign(languageURL(language));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindLanguagePicker, {once: true});
} else {
  bindLanguagePicker();
}
