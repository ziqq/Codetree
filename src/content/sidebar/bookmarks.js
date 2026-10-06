/* Local bookmarks for repository-host pages. */
import {icon} from '../../shared/icons.js';
import {button, el, empty} from '../dom.js';
import {requestName} from '../page.js';

export function createBookmarks(app) {
  const {state, run} = app;

  async function bookmarkCurrent() {
    const existing = state.public?.bookmarks.find(item => item.url === location.href);
    const bookmarks = await app.rpc('BOOKMARK', existing ? {remove: existing.id} : {url: location.href, title: document.title.replace(/ [·|] (GitHub|GitLab)$/, '')});
    state.public.bookmarks = bookmarks; app.updateHeader(); if (state.tab === 'bookmarks') app.render();
    app.toast(existing ? 'Bookmark removed.' : 'Page bookmarked on this browser.');
  }
  function renderBookmarks() {
    const {body} = app.view;
    const query = state.query.toLowerCase();
    const bookmarks = (state.public?.bookmarks || []).filter(item => `${item.title} ${item.url}`.toLowerCase().includes(query));
    if (!bookmarks.length) { body.replaceChildren(empty('No bookmarks yet', state.query ? 'No bookmarks match your search.' : `Use the bookmark button below to save a repository, file, issue or ${requestName(state.context)}.`, 'bookmark')); return; }
    const list = el('div', {class: 'list'});
    for (const bookmark of bookmarks) {
      const item = el('div', {class: 'bookmark-item'}, [icon('bookmark'), el('a', {class: 'bookmark-label', href: bookmark.url}, [el('span', {text: bookmark.title}), el('small', {text: new URL(bookmark.url).pathname})])]);
      item.append(button('close', `Remove bookmark: ${bookmark.title}`, run(async () => { state.public.bookmarks = await app.rpc('BOOKMARK', {remove: bookmark.id}); app.updateHeader(); app.render(); })));
      list.append(item);
    }
    body.replaceChildren(list);
  }
  return {bookmarkCurrent, renderBookmarks};
}
