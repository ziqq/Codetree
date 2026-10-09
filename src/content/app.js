/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Composes the sidebar and binds page-level events.
 *
 * Features are factories `createX(app)` that receive one shared `app`
 * object and return their functions, which are merged into `app`.
 * Features call each other only through `app` at run time, so a test can
 * create a single feature with stubs for the rest.
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
import {
  batch,
  catchError,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  untrackActions,
  withOwner,
} from './reactive.js';
import {listen} from './reactive-dom.js';

/**
 * Creates the sidebar, inserts it into the page and loads the current page.
 *
 * `app` holds `state`, `view` (the DOM), the helpers `rpc`, `toast` and
 * `run`, `lastURL`, `uiReady` and every feature function.
 */
export function mount() {
  return createRoot(dispose => {
    const app = {lastURL: '', dispose};
    return catchError(
      () => {
        app.owner = getOwner();
        app.state = createState();
        const {state} = app;
        const [uiReady, setUIReady] = createSignal(false, {name: 'uiReady'});
        Object.defineProperty(app, 'uiReady', {get: uiReady, set: setUIReady});
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
          if (!response?.ok)
            throw new Error(response?.error || 'The extension was reloaded. Refresh this repository page.');
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
        app.run = callback => {
          const handler = withOwner(callback);
          return (...args) =>
            Promise.resolve()
              .then(() => handler(...args))
              .catch(error => app.toast(error.message));
        };
        app.view = createView(app);
        for (const factory of [
          createLayout,
          createFiles,
          createTree,
          createBranches,
          createPulls,
          createBookmarks,
          createRender,
          createNavigation,
          createViewer,
          createHeaderButtons,
        ]) {
          Object.assign(app, untrackActions(factory(app)));
        }
        const {run} = app;
        const {host, shadow, pageStyle, iconFonts, search, stylesheetLoaded} = app.view;
        document.documentElement.append(host, pageStyle, iconFonts);

        // Global shortcuts are ignored while typing, composing text or using AltGr.
        listen(document, 'keydown', event => {
          if (!event.isTrusted) return;
          const editing = [shadow.activeElement, ...event.composedPath()].some(
            node => node instanceof Element && (node.matches('input,textarea,select') || node.isContentEditable),
          );
          if (!state.context || editing || event.repeat || event.isComposing || event.getModifierState('AltGraph'))
            return;
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
        const onMessage = withOwner(message => {
          if (message.type === 'TOGGLE') run(() => app.setPreferences({open: !state.preferences.open}))();
          if (message.type === 'WINDOW_PIN_CHANGED') {
            if (state.preferences.pinned !== message.pinned)
              state.preferences = {...state.preferences, pinned: message.pinned};
          }
        });
        chrome.runtime.onMessage.addListener(onMessage);
        onCleanup(() => chrome.runtime.onMessage.removeListener(onMessage));
        // Follow provider theme switches and re-insert header buttons after page updates.
        const themeObserver = new MutationObserver(withOwner(app.layout));
        onCleanup(() => themeObserver.disconnect());
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-color-mode', 'data-dark-theme', 'data-light-theme'],
        });
        if (document.head)
          themeObserver.observe(document.head, {
            attributes: true,
            subtree: true,
            attributeFilter: ['href', 'media', 'disabled'],
          });
        if (document.body) {
          themeObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
          const headersObserver = new MutationObserver(app.scheduleHeaderButtons);
          headersObserver.observe(document.body, {childList: true, subtree: true});
          onCleanup(() => headersObserver.disconnect());
        }
        listen(matchMedia('(prefers-color-scheme: dark)'), 'change', app.layout);
        listen(
          window,
          'resize',
          () => {
            app.positionHandle();
            app.requestTreeRender();
          },
          {passive: true},
        );
        // GitHub and GitLab navigate without full reloads; every route change reloads the sidebar.
        listen(
          window,
          'popstate',
          run(() => app.loadPage()),
        );
        for (const event of ['turbo:load', 'turbo:render', 'pjax:end'])
          listen(
            document,
            event,
            run(() => app.loadPage()),
          );
        const navigationTimer = setInterval(
          withOwner(() => {
            if (location.href !== app.lastURL) run(() => app.loadPage())();
          }),
          1000,
        );
        onCleanup(() => clearInterval(navigationTimer));
        onCleanup(() => clearTimeout(toastTimer));
        onCleanup(() => app.disposePage?.());
        onCleanup(() => {
          host.remove();
          pageStyle.remove();
          iconFonts.remove();
        });
        run(async () => {
          const [publicData] = await Promise.all([app.rpc('STATE'), stylesheetLoaded]);
          batch(() => {
            state.public = publicData;
            state.preferences = publicData.preferences;
            app.uiReady = true;
          });
          await app.loadPage();
        })();
        return app;
      },
      error => app.toast(error.message),
    );
  });
}
