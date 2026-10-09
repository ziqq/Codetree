/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Local bookmarks for pages on enabled repository hosts.
 *
 * Bookmarks are stored by the service worker and included in browser Sync
 * only when the user enables it.
 */

import {icon} from '../../shared/icons.js';
import {button, el, empty} from '../dom.js';
import {requestName} from '../page.js';

/** Returns bookmarks matching their title or URL, ignoring search case. */
export function matchingBookmarks(bookmarks, query) {
  const search = query.toLowerCase();
  return bookmarks.filter(item => `${item.title} ${item.url}`.toLowerCase().includes(search));
}

/** Creates the bookmarks feature: `bookmarkCurrent` and `renderBookmarks`. */
export function createBookmarks(app) {
  const {state, run} = app;

  /** Adds the current page as a bookmark, or removes it when already bookmarked. */
  async function bookmarkCurrent() {
    const epoch = state.epoch;
    const alive = app.pageAlive || (() => true);
    const existing = state.public?.bookmarks.find(item => item.url === location.href);
    const bookmarks = await app.rpc(
      'BOOKMARK',
      existing
        ? {remove: existing.id}
        : {url: location.href, title: document.title.replace(/ [·|] (GitHub|GitLab)$/, '')},
    );
    if (alive() && epoch === state.epoch) state.public = {...state.public, bookmarks};
    // The change is saved even if another page opened meanwhile, so it is always confirmed.
    app.toast(existing ? 'Bookmark removed.' : 'Page bookmarked on this browser.');
  }

  /** Renders the bookmarks matching the search. */
  function renderBookmarks(bookmarks = matchingBookmarks(state.public?.bookmarks || [], state.query)) {
    const {body} = app.view;
    if (!bookmarks.length) {
      body.replaceChildren(
        empty(
          'No bookmarks yet',
          state.query
            ? 'No bookmarks match your search.'
            : `Use the bookmark button below to save a repository, file, issue or ${requestName(state.context)}.`,
          'bookmark',
        ),
      );
      return;
    }
    const list = el('div', {class: 'list'});
    for (const bookmark of bookmarks) {
      const item = el('div', {class: 'bookmark-item'}, [
        icon('bookmark'),
        el('a', {class: 'bookmark-label', href: bookmark.url}, [
          el('span', {text: bookmark.title}),
          el('small', {text: new URL(bookmark.url).pathname}),
        ]),
      ]);
      item.append(
        button(
          'close',
          `Remove bookmark: ${bookmark.title}`,
          run(async () => {
            const epoch = state.epoch;
            const alive = app.pageAlive || (() => true);
            const bookmarks = await app.rpc('BOOKMARK', {remove: bookmark.id});
            if (!alive() || epoch !== state.epoch) return;
            state.public = {...state.public, bookmarks};
          }),
        ),
      );
      list.append(item);
    }
    body.replaceChildren(list);
  }
  return {bookmarkCurrent, renderBookmarks};
}
