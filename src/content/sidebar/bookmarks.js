/**
 * Local bookmarks for pages on enabled repository hosts.
 *
 * Bookmarks are stored by the service worker and included in browser Sync
 * only when the user enables it.
 *
 * @module content/sidebar/bookmarks
 */
import {icon} from '../../shared/icons.js';
import {button, el, empty} from '../dom.js';
import {requestName} from '../page.js';

/** Returns the bookmarks whose title or URL contains the search query. */
export function matchingBookmarks(state) {
  const query = state.query.toLowerCase();
  return (state.public?.bookmarks || []).filter(item => `${item.title} ${item.url}`.toLowerCase().includes(query));
}

/** Creates the bookmarks feature: `bookmarkCurrent` and `renderBookmarks`. */
export function createBookmarks(app) {
  const {state, run} = app;

  /** Adds the current page as a bookmark, or removes it when already bookmarked. */
  async function bookmarkCurrent() {
    const existing = state.public?.bookmarks.find(item => item.url === location.href);
    const bookmarks = await app.rpc(
      'BOOKMARK',
      existing
        ? {remove: existing.id}
        : {url: location.href, title: document.title.replace(/ [·|] (GitHub|GitLab)$/, '')},
    );
    state.public = {...state.public, bookmarks};
    app.toast(existing ? 'Bookmark removed.' : 'Page bookmarked on this browser.');
  }

  /** Renders the bookmarks matching the search. */
  function renderBookmarks() {
    const {body} = app.view;
    const bookmarks = matchingBookmarks(state);
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
            const bookmarks = await app.rpc('BOOKMARK', {remove: bookmark.id});
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
