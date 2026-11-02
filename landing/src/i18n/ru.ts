/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Russian landing strings; keep them equivalent to `en.ts`. The extension UI
 * is English, so feature and control names stay untranslated.
 */

import type {Translation} from './types.ts';
export default {
  label: 'Русский',
  meta: {
    index: {
      title: 'Codetree — дерево кода для GitHub и GitLab',
      description:
        'Codetree — расширение браузера для навигации и ревью репозиториев GitHub и GitLab в виде дерева кода. Без бэкенда, аналитики и аккаунта.',
    },
    privacy: {
      title: 'Политика конфиденциальности — Codetree',
      description:
        'Как Codetree обращается с данными репозиториев, локальным хранилищем, синхронизацией браузера, сетевыми запросами и разрешениями.',
    },
  },
  nav: {
    label: 'Основная навигация',
    language: 'Язык',
    home: 'Главная',
    privacy: 'Конфиденциальность',
    support: 'Поддержка',
  },
  hero: {
    eyebrow: 'Расширение браузера для GitHub и GitLab',
    title: 'Репозиторий в виде дерева кода.',
    lead: 'Просматривайте файлы, переключайте ветки, проводите ревью pull и merge requests и открывайте изменённый файл целиком, не покидая страницу.',
    body: 'Codetree работает локально в Chrome и Chromium и обращается напрямую к хостингу репозитория. Аккаунт Codetree, подписка и бэкенд не нужны.',
    download: 'Установить в Chrome',
    guide: 'Инструкция по установке',
    alt: 'Боковая панель Codetree с деревом файлов репозитория на странице GitHub',
    caption:
      'Codetree 0.3.1 на публичных страницах GitHub и GitLab без аккаунта. Интерфейс расширения на английском; скриншоты следуют теме браузера.',
  },
  features: {
    label: 'Возможности',
    items: [
      {
        title: 'Навигация',
        text: 'Дерево файлов репозитория с поиском файлов и папок, клавиатурной навигацией, переключением веток и неограниченными локальными закладками.',
      },
      {
        title: 'Ревью',
        text: 'Дерево изменённых файлов для PR, MR и коммитов, комментарии ревью, отметки Viewed и фильтры вроде Requested from me.',
      },
      {
        title: 'Файлы целиком',
        text: 'View full в заголовках файлов показывает изменённый файл полностью: с подсветкой изменений и номерами строк обеих ревизий.',
      },
    ],
  },
  gallery: {
    label: 'Другие скриншоты',
    items: [
      {
        image: '3-github-full-file',
        alt: 'Диалог View full с полным изменённым файлом в pull request на GitHub',
        caption: 'View full в pull request на GitHub.',
      },
      {
        image: '4-gitlab-changes',
        alt: 'Дерево изменённых файлов merge request на GitLab',
        caption: 'Изменённые файлы merge request на GitLab.',
      },
    ],
  },
  data: {
    eyebrow: 'Ваши данные',
    title: 'Напрямую к хостингу репозитория.',
    paragraphs: [
      'У Codetree нет бэкенда, аналитики, рекламы и телеметрии. Запросы идут из браузера напрямую в GitHub, GitLab или указанный вами HTTPS-сервер. Токены хранятся в доверенном хранилище расширения и не передаются веб-страницам.',
      'Поддерживаются GitHub.com, GitHub Enterprise Server, GitLab.com и self-managed GitLab по HTTPS. Необязательная синхронизация браузера переносит только настройки и закладки.',
      'Codetree читает репозитории и ревью. Расширение не отправляет ревью, не публикует комментарии, не выполняет merge и не изменяет файлы.',
    ],
    link: 'Политика конфиденциальности →',
  },
  policy: {
    title: 'Конфиденциальность',
    source: 'Исходный текст политики',
  },
  footer: {
    developer: 'Разработчик — Антон Устинов.',
    privacy: 'Политика конфиденциальности',
  },
} satisfies Translation;
