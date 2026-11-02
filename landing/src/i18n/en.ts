/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * English landing strings. Describe released behavior only: the site deploys
 * from `main`, while the installation button points to the Chrome Web Store.
 */

import type {Translation} from './types.ts';
export default {
  label: 'English',
  meta: {
    index: {
      title: 'Codetree — Code tree for GitHub and GitLab',
      description:
        'Codetree is a browser extension for exploring and reviewing GitHub and GitLab repositories from a code tree. No backend, analytics or account.',
    },
    privacy: {
      title: 'Privacy policy — Codetree',
      description:
        'How Codetree handles repository data, local storage, optional browser Sync, network requests and permissions.',
    },
  },
  nav: {
    label: 'Main navigation',
    language: 'Language',
    home: 'Home',
    privacy: 'Privacy',
    support: 'Support',
  },
  hero: {
    eyebrow: 'Browser extension for GitHub and GitLab',
    title: 'Your repository as a code tree.',
    lead: 'Browse files, switch branches, review pull and merge requests and open the whole changed file without leaving the page.',
    body: 'Codetree runs locally in Chrome and Chromium and talks directly to your repository host. No Codetree account, subscription or backend is required.',
    download: 'Add to Chrome',
    guide: 'Installation guide',
    alt: 'Codetree sidebar with the repository file tree on a GitHub page',
    caption:
      'Codetree 0.3.1 on public GitHub and GitLab pages without an account. Screenshots follow your browser theme.',
  },
  features: {
    label: 'Features',
    items: [
      {
        title: 'Navigate',
        text: 'Repository file tree with file and folder search, keyboard navigation, branch switching and unlimited local bookmarks.',
      },
      {
        title: 'Review',
        text: 'Changed-file trees for PRs, MRs and commits, inline review comments, Viewed marks and review filters such as Requested from me.',
      },
      {
        title: 'Read whole files',
        text: 'View full in native file headers shows the complete changed file with highlighted changes and both revision line numbers.',
      },
    ],
  },
  gallery: {
    label: 'More screenshots',
    items: [
      {
        image: '3-github-full-file',
        alt: 'View full dialog with a complete changed file on a GitHub pull request',
        caption: 'View full on a GitHub pull request.',
      },
      {
        image: '4-gitlab-changes',
        alt: 'Changed-file tree of a GitLab merge request',
        caption: 'Changed files of a GitLab merge request.',
      },
    ],
  },
  data: {
    eyebrow: 'Your data',
    title: 'Direct to your repository host.',
    paragraphs: [
      "Codetree has no backend, analytics, advertising or telemetry. Requests go directly from your browser to GitHub, GitLab or the HTTPS server you configure. Tokens stay in the extension's trusted storage and are never exposed to web pages.",
      'Works with GitHub.com, GitHub Enterprise Server, GitLab.com and self-managed GitLab over HTTPS. Optional browser Sync covers only preferences and bookmarks.',
      'Codetree reads repositories and reviews. It does not submit reviews, post comments, merge or edit files.',
    ],
    link: 'Read the privacy policy →',
  },
  policy: {
    title: 'Privacy',
    source: 'Source of this policy',
  },
  footer: {
    developer: 'Developed by Anton Ustinoff.',
    privacy: 'Privacy policy',
  },
} satisfies Translation;
