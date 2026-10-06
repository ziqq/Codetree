/**
 * Composes the sidebar and binds page-level events.
 *
 * Features are factories `createX(app)` that receive one shared `app`
 * object and return their functions, which are merged into `app`.
 * Features call each other only through `app` at run time, so a test can
 * create a single feature with stubs for the rest.
 *
 * @module content/app
 */
import {shortcutMatches} from '../shared/preferences.js';
import {createHeaderButtons} from './native/header-buttons.js';
import {createNavigation} from './navigation.js';
import {createBookmarks} from './sidebar/bookmarks.js';
import {createBranches} from './sidebar/branches.js';
import {createFiles} from './sidebar/files.js';
import {createLayout} from './sidebar/layout.js';
import {createPulls} from './sidebar/pulls.js';
import {createRender} from './sidebar/render.js';
import {createTree} from './sidebar/tree.js';
import {createView} from './sidebar/view.js';
import {createState} from './state.js';
import {createViewer} from './viewer/viewer.js';

/**
 * Creates the sidebar, inserts it into the page and loads the current page.
 *
 * `app` holds `state`, `view` (the DOM), the helpers `rpc`, `toast` and
 * `run`, `lastURL`, `uiReady` and every feature function.
 */
export function mount() {
  const app = {state: createState(), lastURL: '', uiReady: false};
  const {state} = app;
  let toastTimer;

  /**
   * Sends a request for the current repository context to the service worker.
   *
   * @param {string} type The message type.
   * @param {Object} [value={}] Additional message fields.
   * @returns {Promise<*>} The reply value.
   * @throws {Error} With the broker's message, or a reload hint when the extension was updated.
   */
  app.rpc = async (type, value = {}) => {
    const response = await chrome.runtime.sendMessage({type, context: state.context, ...value});
    if (!response?.ok) throw new Error(response?.error || 'The extension was reloaded. Refresh this repository page.');
    return response.value;
  };

  /** Shows a status message at the bottom of the sidebar for six seconds. */
  app.toast = text => {
    const {toastBox} = app.view;
    toastBox.textContent = text;
    toastBox.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastBox.hidden = true;
    }, 6000);
  };

  /**
   * Wraps an event handler so that its errors are shown as a toast.
   *
   * @param {Function} callback A synchronous or asynchronous handler.
   * @returns {Function}
   */
  app.run =
    callback =>
    (...args) =>
      Promise.resolve()
        .then(() => callback(...args))
        .catch(error => app.toast(error.message));
  app.view = createView(app);
  Object.assign(
    app,
    createLayout(app),
    createFiles(app),
    createTree(app),
    createBranches(app),
    createPulls(app),
    createBookmarks(app),
    createRender(app),
    createNavigation(app),
    createViewer(app),
    createHeaderButtons(app),
  );
  const {run} = app;
  const {host, shadow, pageStyle, iconFonts, search, stylesheetLoaded} = app.view;
  document.documentElement.append(host, pageStyle, iconFonts);

  // Global shortcuts are ignored while typing, composing text or using AltGr.
  document.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    const editing = [shadow.activeElement, ...event.composedPath()].some(
      node => node instanceof Element && (node.matches('input,textarea,select') || node.isContentEditable),
    );
    if (!state.context || editing || event.repeat || event.isComposing || event.getModifierState('AltGraph')) return;
    if (shortcutMatches(state.preferences.toggleShortcut, event)) {
      event.preventDefault();
      run(() => app.setPreferences({open: !state.preferences.open}))();
    } else if (shortcutMatches(state.preferences.searchShortcut, event)) {
      event.preventDefault();
      run(async () => {
        await app.setPreferences({open: true});
        search.focus();
      })();
    }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'TOGGLE') run(() => app.setPreferences({open: !state.preferences.open}))();
    if (message.type === 'WINDOW_PIN_CHANGED') {
      state.preferences.pinned = message.pinned;
      app.layout();
    }
  });
  // Follow provider theme switches and re-insert header buttons after page updates.
  const themeObserver = new MutationObserver(app.layout);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-color-mode', 'data-dark-theme', 'data-light-theme'],
  });
  if (document.body) {
    themeObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
    new MutationObserver(app.scheduleHeaderButtons).observe(document.body, {childList: true, subtree: true});
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', app.layout);
  window.addEventListener(
    'resize',
    () => {
      app.positionHandle();
      app.requestTreeRender();
    },
    {passive: true},
  );
  // GitHub and GitLab navigate without full reloads; every route change reloads the sidebar.
  window.addEventListener(
    'popstate',
    run(() => app.loadPage()),
  );
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end'])
    document.addEventListener(
      event,
      run(() => app.loadPage()),
    );
  setInterval(() => {
    if (location.href !== app.lastURL) run(() => app.loadPage())();
  }, 1000);
  run(async () => {
    const [publicData] = await Promise.all([app.rpc('STATE'), stylesheetLoaded]);
    state.public = publicData;
    state.preferences = publicData.preferences;
    app.uiReady = true;
    await app.loadPage();
  })();
}
