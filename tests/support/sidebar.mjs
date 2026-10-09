/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Composes the production sidebar features like `mount()` on the fake DOM,
 * with a controlled `rpc` and without page-level listeners, and opens a
 * repository page.
 */
import {document, flushFrames} from './dom.mjs';

const source = '../../src/content';

/** Feature factories in the order `mount()` creates them. */
const factories = {
  'sidebar/layout.js': 'createLayout',
  'sidebar/files.js': 'createFiles',
  'sidebar/tree.js': 'createTree',
  'sidebar/branches.js': 'createBranches',
  'sidebar/pulls.js': 'createPulls',
  'sidebar/bookmarks.js': 'createBookmarks',
  'sidebar/render.js': 'createRender',
  'navigation.js': 'createNavigation',
  'viewer/viewer.js': 'createViewer',
  'native/header-buttons.js': 'createHeaderButtons',
};

/** Waits until pending promise continuations and timers of zero delay have run. */
export async function settle() {
  for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve));
  flushFrames();
}

/**
 * Settles until [predicate] holds, for work that finishes outside the event
 * loop such as `crypto.subtle` digests.
 *
 * @param {() => boolean} predicate
 * @param {number} [timeout=5000] Milliseconds before the wait fails.
 */
export async function waitFor(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('The expected state was not reached.');
    await new Promise(resolve => setTimeout(resolve, 5));
    await settle();
  }
}

/** Default public state of a signed-out page on github.com. */
export function publicState(value = {}) {
  return {
    preferences: {
      dock: 'left',
      width: 304,
      pinned: true,
      open: true,
      iconTheme: 'minimal',
      fontFamily: 'default',
      fontSize: 12,
      toggleShortcut: 'Alt+T',
      searchShortcut: 'Alt+F',
      pageScope: 'repository',
      hidePatterns: '',
      folderClick: true,
    },
    hosts: [{origin: 'https://github.com', provider: 'github'}],
    accounts: [],
    selectedAccounts: {},
    bookmarks: [],
    ...value,
  };
}

/**
 * Creates the sidebar for [url] and loads it.
 *
 * @param {(type: string, value: Object) => Promise<*>} rpc Replies to worker messages.
 * @param {string} [url] The repository page.
 * @returns {Promise<Object>} The `app` with `toasts`.
 */
export async function createSidebar(rpc, url = 'https://github.com/sample/repo') {
  const {href, origin, hostname, pathname} = new URL(url);
  Object.assign(globalThis.location, {href, origin, hostname, pathname});
  const [{createState}, {createView}, features, reactive] = await Promise.all([
    import(`${source}/state.js`),
    import(`${source}/sidebar/view.js`),
    Promise.all(Object.entries(factories).map(async ([path, name]) => (await import(`${source}/${path}`))[name])),
    import('../../src/shared/reactive.js'),
  ]);
  const app = {state: createState(), lastURL: '', toasts: []};
  const [uiReady, setUIReady] = reactive.createSignal(false);
  Object.defineProperty(app, 'uiReady', {get: uiReady, set: setUIReady, enumerable: true});
  app.rpc = (type, value = {}) => rpc(type, value);
  app.toast = text => app.toasts.push(text);
  app.run =
    callback =>
    (...args) =>
      Promise.resolve()
        .then(() => callback(...args))
        .catch(error => app.toast(error.message));
  app.view = createView(app);
  Object.assign(app, ...features.map(create => create(app)));
  reactive.createRoot(() =>
    reactive.catchError(
      () => {
        app.bindLayout();
        app.bindHeader();
        app.bindRender();
        app.bindTree();
      },
      error => app.toast(error.message),
    ),
  );
  const {state} = app;
  const value = await rpc('STATE', {});
  reactive.batch(() => {
    state.public = value;
    state.preferences = value.preferences;
    app.uiReady = true;
  });
  await app.loadPage();
  await settle();
  return app;
}

export {document};
