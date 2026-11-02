/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * TypeScript shapes of the landing dictionaries; no runtime code.
 */

/** Metadata shared by the page title and description. */
export interface PageMeta {
  title: string;
  description: string;
}

/** Heading and body of one feature. */
export interface TextItem {
  title: string;
  text: string;
}

/** Screenshot from the existing public store captures. */
export interface GalleryItem {
  image: string;
  alt: string;
  caption: string;
}

/** Complete dictionary required by both landing locales. */
export interface Translation {
  label: string;
  meta: {index: PageMeta; privacy: PageMeta};
  nav: {label: string; language: string; home: string; privacy: string; support: string};
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    body: string;
    download: string;
    guide: string;
    alt: string;
    caption: string;
  };
  features: {label: string; items: TextItem[]};
  gallery: {label: string; items: GalleryItem[]};
  data: {eyebrow: string; title: string; paragraphs: string[]; link: string};
  policy: {title: string; source: string};
  footer: {developer: string; privacy: string};
}
