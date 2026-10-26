/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * In-page file tabs with browser-tab/account/repository-scoped metadata.
 * Code paths survive branch changes; positions belong to a branch or an
 * exact review revision. Only metadata reaches trusted session storage.
 * File text lives in the current view and is discarded on every switch.
 */

import {blobURL, treeURL} from '../../shared/routes.js';
import {maxFileTabs, maxFileTabPositions} from '../../shared/file-tabs.js';
import {button, el, empty} from '../dom.js';
import {providerName} from '../page.js';
import {createRoot, getOwner, onCleanup, runWithOwner, withOwner} from '../reactive.js';
import {listen} from '../reactive-dom.js';
import {diffNode} from './viewer.js';
import {renderDiffFile, renderTextFile} from './file-content.js';
import {createFileReview} from './file-review.js';

/** Creates the inline workspace and its navigation, persistence and theme actions. */
export function createFileTabs(app) {
  const {state, run} = app;
  const host = el('div', {id: 'codetree-file-workspace', hidden: ''});
  host.style.display = 'none';
  const shadow = host.attachShadow({mode: 'closed'});
  const tabs = el('div', {class: 'file-tabs', role: 'tablist', 'aria-label': 'Open files'});
  const heading = el('strong');
  const revision = el('small');
  const native = el('a', {class: 'small-button', target: '_blank', rel: 'noopener noreferrer'});
  const actions = el('div', {class: 'viewer-actions'}, [native]);
  const frame = el('section', {class: 'file-workspace', 'aria-label': 'Codetree file workspace'}, [
    tabs,
    el('div', {class: 'viewer-header'}, [el('div', {class: 'viewer-heading'}, [heading, revision]), actions]),
  ]);
  shadow.append(frame);
  let sheet;
  let stylesheetLoaded;
  let resolveStyles;
  let snapshot;
  let shell;
  let disposeContent;
  let generation = 0;
  let opening = 0;
  let pendingOpen;
  let contentReady = false;
  let waitingForMount = false;
  let saveTimer;
  let positionRef = '';
  let renderedPath = '';
  const tabControls = new Map();
  const unavailable = new Set();

  /** Reloads the linked sheet on reattachment; detached shadow links lose their applied layout in Chromium. */
  function reloadStyles() {
    const previous = resolveStyles;
    sheet?.remove();
    sheet = el('link', {rel: 'stylesheet', href: chrome.runtime.getURL('sidebar.css')});
    stylesheetLoaded = new Promise((resolve, reject) => {
      resolveStyles = resolve;
      sheet.addEventListener('load', resolve, {once: true});
      sheet.addEventListener('error', () => reject(new Error('File tab styles could not load. Refresh the page.')), {
        once: true,
      });
    });
    stylesheetLoaded.catch(() => {});
    shadow.prepend(sheet);
    // An awaiting render follows the replacement promise instead of waiting on a detached link.
    previous?.();
  }

  /** Copies visual preferences and provider syntax variables without reading native styles again. */
  function updateFileTabTheme() {
    const source = app.view.host;
    host.dataset.theme = source.dataset.theme;
    host.dataset.provider = source.dataset.provider;
    const properties = new Set(Array.from(source.style).filter(name => name.startsWith('--')));
    for (const name of Array.from(host.style))
      if (name.startsWith('--') && !properties.has(name)) host.style.removeProperty(name);
    for (const name of properties) {
      const value = source.style.getPropertyValue(name);
      if (host.style.getPropertyValue(name) !== value) host.style.setProperty(name, value);
    }
    shell?.relayout?.();
  }

  /** Idempotently reattaches our own host after a provider replaces its main container. */
  function mountFileTabs() {
    if (!snapshot || !snapshot.value.paths.length || !state.context) return;
    if (location.href !== app.lastURL) {
      capturePosition();
      contentReady = false;
      host.style.display = 'none';
      return;
    }
    const target = document.querySelector('main') || document.querySelector('[role="main"]');
    if (target && host.parentElement !== target) {
      const restore = Boolean(shell) || waitingForMount;
      capturePosition();
      contentReady = false;
      waitingForMount = false;
      if (restore) generation++;
      reloadStyles();
      target.prepend(host);
      if (restore) run(renderActiveFile)();
    }
  }

  /** Captures the current branch/revision position only after real content has finished loading. */
  function capturePosition() {
    if (
      !snapshot ||
      !shell ||
      !contentReady ||
      !host.isConnected ||
      host.style.display === 'none' ||
      !snapshot.value.paths.includes(renderedPath) ||
      unavailable.has(renderedPath)
    )
      return;
    const {positions} = snapshot.value;
    const position = shell.readPosition?.() || {top: shell.body.scrollTop, left: shell.body.scrollLeft};
    snapshot.value.positions = positions
      .filter(position => position.path !== renderedPath || position.ref !== positionRef)
      .concat({ref: positionRef, path: renderedPath, ...position})
      .slice(-maxFileTabPositions);
  }

  /** Saves a captured workspace, never allowing a later route/account to change its scope. */
  async function rememberFileTabs() {
    clearTimeout(saveTimer);
    capturePosition();
    const saved = snapshot;
    if (!saved) return;
    // A scroll save must follow an in-flight open's publication, not overwrite it with the old active path.
    while (pendingOpen && snapshot === saved) await pendingOpen;
    const {context, scope, accountID, value} = saved;
    await app.rpc('FILE_TABS', {context, scope, accountID, value: structuredClone(value)});
  }

  /** Discards text and listeners on navigation while allowing an already-sent metadata save to finish. */
  function suspendFileTabs() {
    rememberFileTabs().catch(() => {});
    generation++;
    disposeContent?.();
    disposeContent = null;
    shell = null;
    for (const node of Array.from(frame.children))
      if (node.classList.contains('viewer-body') || node.classList.contains('viewer-bottom')) node.remove();
    snapshot = null;
    waitingForMount = false;
    unavailable.clear();
    resolveStyles?.();
    host.hidden = true;
    host.style.display = 'none';
    host.remove();
  }

  /** Renders open-path controls; missing files remain closable and keyboard-accessible. */
  function renderTabs() {
    const focused = shadow.activeElement?.closest('.file-tab')?.dataset.path;
    tabs.replaceChildren();
    tabControls.clear();
    for (const path of snapshot?.value.paths || []) {
      const selected = path === snapshot.value.active;
      const tab = el('div', {
        'data-path': path,
        class: `file-tab${selected ? ' active' : ''}${unavailable.has(path) ? ' unavailable' : ''}`,
      });
      const control = el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(selected),
        'aria-controls': 'codetree-file-content',
        'aria-label': path,
        title: unavailable.has(path) ? `${path} · unavailable at this revision` : path,
        class: 'file-tab-name',
        text: path.split('/').pop(),
        onClick: run(() => openFileTab({path})),
      });
      control.addEventListener(
        'keydown',
        run(async event => {
          const paths = snapshot?.value.paths || [];
          const index = paths.indexOf(path);
          const target =
            event.key === 'ArrowLeft'
              ? paths[index - 1]
              : event.key === 'ArrowRight'
                ? paths[index + 1]
                : event.key === 'Home'
                  ? paths[0]
                  : event.key === 'End'
                    ? paths.at(-1)
                    : '';
          if (!target) return;
          event.preventDefault();
          await openFileTab({path: target});
          tabControls.get(target)?.focus();
        }),
      );
      tabControls.set(path, control);
      tab.append(
        control,
        button(
          'close',
          `Close file tab: ${path}`,
          run(() => closeFileTab(path)),
          'file-tab-close',
        ),
      );
      tabs.append(tab);
    }
    if (focused) (tabControls.get(focused) || tabControls.get(snapshot?.value.active))?.focus();
    host.hidden = !snapshot?.value.paths.length;
    host.style.display = host.hidden ? 'none' : 'block';
    updateFileTabTheme();
    mountFileTabs();
  }

  /** Closes one path, choosing its adjacent tab and releasing its saved positions. */
  async function closeFileTab(path) {
    if (!snapshot) return;
    const currentSnapshot = snapshot;
    const epoch = state.epoch;
    capturePosition();
    const value = snapshot.value;
    const index = value.paths.indexOf(path);
    const wasActive = value.active === path;
    value.paths = value.paths.filter(item => item !== path);
    value.positions = value.positions.filter(position => position.path !== path);
    if (wasActive) {
      generation++;
      disposeContent?.();
      disposeContent = null;
      shell = null;
      contentReady = false;
      for (const node of Array.from(frame.children))
        if (node.classList.contains('viewer-body') || node.classList.contains('viewer-bottom')) node.remove();
      value.active = value.paths[Math.min(index, value.paths.length - 1)] || '';
    }
    await rememberFileTabs();
    if (snapshot !== currentSnapshot || epoch !== state.epoch) return;
    renderTabs();
    if (wasActive && value.active) await renderActiveFile();
  }

  /** Opens or focuses a path without changing the provider URL or hijacking modified browser clicks. */
  async function openFileTab(node) {
    const epoch = state.epoch;
    if (!snapshot) await loadFileTabs();
    if (epoch !== state.epoch) return;
    if (!snapshot || !state.info) throw new Error('Wait for the repository to finish loading.');
    const currentSnapshot = snapshot;
    const request = ++opening;
    const render = generation;
    capturePosition();
    const previous = snapshot.value;
    const paths = previous.paths;
    const existing = paths.includes(node.path);
    if (!existing && paths.length >= maxFileTabs)
      throw new Error(`Close a file tab before opening another (maximum ${maxFileTabs}).`);
    const value = {...previous, paths: existing ? paths : [...paths, node.path], active: node.path};
    clearTimeout(saveTimer);
    let completeOpen;
    const pending = new Promise(resolve => {
      completeOpen = resolve;
    });
    pendingOpen = pending;
    try {
      // Keep the rendered tab current if saving fails, so its review action can report and retry navigation.
      await app.rpc('FILE_TABS', {...currentSnapshot, value: structuredClone(value)});
      if (
        snapshot !== currentSnapshot ||
        epoch !== state.epoch ||
        request !== opening ||
        render !== generation ||
        snapshot.value !== previous ||
        previous.paths !== paths
      )
        return;
      snapshot.value = {...value, positions: previous.positions};
    } finally {
      if (pendingOpen === pending) pendingOpen = null;
      completeOpen();
    }
    state.selected = node.path;
    renderTabs();
    await renderActiveFile();
  }

  /** Restores the code workspace when a branch is selected from either Code or review pages. */
  async function selectFileBranch(ref) {
    const context = state.context;
    const epoch = state.epoch;
    await rememberFileTabs();
    const value = await app.rpc('FILE_TABS', {context, scope: 'code'});
    if (epoch !== state.epoch) return;
    const path =
      value.active || (!value.page && ['blob', 'blame', 'raw'].includes(context.kind) ? state.info?.path : '');
    location.assign(path ? blobURL(context, ref, path) : treeURL(context, ref));
  }

  /** Loads metadata after current repository/tree data, preserving paths through branch changes and Refresh. */
  async function loadFileTabs() {
    const context = state.context;
    const info = state.info;
    if (!context || !info || state.filesLoading) return;
    const epoch = state.epoch;
    const filesGeneration = state.filesGeneration;
    const load = ++generation;
    const saved = rememberFileTabs();
    disposeContent?.();
    shell = null;
    await saved;
    if (load !== generation || epoch !== state.epoch || filesGeneration !== state.filesGeneration) return;
    const scope = ['pull', 'commit'].includes(context.kind) ? 'review' : 'code';
    const value = await app.rpc('FILE_TABS', {context, scope});
    if (load !== generation || epoch !== state.epoch || filesGeneration !== state.filesGeneration) return;
    const page = JSON.stringify([context.kind, info.ref, info.path || '']);
    const samePage = value.page === page;
    const firstVisit = !value.page;
    snapshot = {
      context,
      scope,
      accountID: value.accountID,
      value: {paths: value.paths, active: value.active, positions: value.positions, page},
    };
    unavailable.clear();
    const path = scope === 'code' && ['blob', 'blame', 'raw'].includes(context.kind) ? info.path : '';
    if (path && !samePage) {
      if (!snapshot.value.paths.includes(path) && snapshot.value.paths.length < maxFileTabs)
        snapshot.value.paths.push(path);
      if (snapshot.value.paths.includes(path)) snapshot.value.active = path;
    }
    if (firstVisit && !snapshot.value.paths.length && scope === 'review' && state.diff?.files.length) {
      const first = state.diff.files[0].filename;
      snapshot.value.paths = [first];
      snapshot.value.active = first;
    }
    // A root/tree page restores existing tabs but does not invent a default code file.
    if (!snapshot.value.active && snapshot.value.paths.length) snapshot.value.active = snapshot.value.paths[0];
    if (scope === 'code' && state.mode === 'files' && !state.lazy)
      for (const path of snapshot.value.paths) if (!state.tree.nodes.has(path)) unavailable.add(path);
    renderTabs();
    if (!snapshot.value.active) return;
    await rememberFileTabs();
    if (load !== generation || epoch !== state.epoch) return;
    state.selected = snapshot.value.active;
    await renderActiveFile();
  }

  /** Renders exact-revision text/diff in one owned shell; old replies never enter another tab or page. */
  async function renderActiveFile() {
    if (!snapshot?.value.active) return;
    const activeSnapshot = snapshot;
    const path = snapshot.value.active;
    const context = state.context;
    const info = state.info;
    const diff = snapshot.scope === 'review' ? state.diff : null;
    const render = ++generation;
    const epoch = state.epoch;
    state.selected = path;
    capturePosition();
    disposeContent?.();
    contentReady = false;
    const current = () =>
      render === generation && epoch === state.epoch && snapshot === activeSnapshot && snapshot.value.active === path;
    try {
      // Mount before waiting for the linked sheet; detached stylesheet links do not load in Chromium.
      renderTabs();
      if (!current()) return;
      if (!host.isConnected) {
        waitingForMount = true;
        return;
      }
      shell = runWithOwner(app.pageOwner || app.owner, () =>
        createRoot(dispose => {
          disposeContent = dispose;
          const body = el('div', {
            id: 'codetree-file-content',
            class: 'viewer-body file-tab-body',
            role: 'tabpanel',
            'aria-label': path,
            tabindex: '0',
          });
          const bottom = el('div', {class: 'viewer-bottom'});
          return {actions, body, bottom, owner: getOwner()};
        }),
      );
      for (const node of Array.from(frame.children))
        if (node.classList.contains('viewer-body') || node.classList.contains('viewer-bottom')) node.remove();
      frame.append(shell.body, shell.bottom);
      renderedPath = path;
      heading.textContent = path;
      positionRef = snapshot.scope === 'code' ? info.ref : `${diff?.base.sha || ''}:${diff?.head.sha || ''}`;
      revision.textContent = diff
        ? `${diff.base.sha?.slice(0, 7) || 'empty'} → ${diff.head.sha.slice(0, 7)} · full-file diff`
        : `${info.ref} · ${info.commitSHA?.slice(0, 7) || 'empty'} · read only`;
      native.textContent = `View on ${providerName(context)}`;
      native.classList.toggle('viewer-native-accent', Boolean(diff) && context.provider === 'github');
      native.removeAttribute('href');
      shell.body.replaceChildren(empty('Loading file', 'Loading this file at the selected revision…', 'refresh'));
      let styles;
      do {
        styles = stylesheetLoaded;
        await styles;
        if (!current()) return;
      } while (styles !== stylesheetLoaded);
      app.updateCodeColors?.();
      const file = diff?.files.find(file => file.filename === path);
      const url = diff ? await app.diffURL({path}) : blobURL(context, info.ref, path);
      if (!current()) return;
      native.href = url;
      if (file) await renderDiffFile(app, shell, diffNode(file), diff, current);
      else {
        if (!diff && !info.commitSHA) throw new Error('This branch has no commit to display.');
        const source =
          diff?.head ||
          (context.provider === 'gitlab'
            ? {project: `${context.owner}/${context.repo}`, sha: info.commitSHA}
            : {owner: context.owner, repo: context.repo, sha: info.commitSHA});
        const text = await app.rpc('FILE', {context, source, path});
        if (!current()) return;
        await renderTextFile(app, shell, path, text, current);
      }
      if (!current()) return;
      if (file)
        runWithOwner(shell.owner, () =>
          createFileReview(
            app,
            shell,
            diffNode(file),
            diff,
            current,
            path => openFileTab({path}),
            () => opening,
          ),
        );
      unavailable.delete(path);
      contentReady = true;
      const position = snapshot.value.positions.find(
        position => position.path === path && position.ref === positionRef,
      );
      const savedPosition = {top: position?.top || 0, left: position?.left || 0};
      if (shell.restorePosition) shell.restorePosition(savedPosition);
      else {
        shell.body.scrollTop = savedPosition.top;
        shell.body.scrollLeft = savedPosition.left;
      }
      shell.relayout?.();
      shell.onScroll = runWithOwner(shell.owner, () =>
        withOwner(() => {
          if (!current()) return;
          capturePosition();
          clearTimeout(saveTimer);
          saveTimer = setTimeout(
            withOwner(() =>
              rememberFileTabs().catch(error => {
                if (current()) app.toast(error.message);
              }),
            ),
            150,
          );
        }),
      );
      runWithOwner(shell.owner, () => listen(shell.body, 'scroll', shell.onScroll, {passive: true}));
      renderTabs();
    } catch (error) {
      if (!current()) return;
      contentReady = false;
      const missing = error.status === 404;
      if (missing) unavailable.add(path);
      const actions = [
        el('button', {type: 'button', class: 'small-button', text: 'Retry', onClick: run(renderActiveFile)}),
      ];
      if (
        missing &&
        snapshot.scope === 'code' &&
        info.repository.default_branch &&
        info.repository.default_branch !== info.ref
      )
        actions.push(
          el('button', {
            type: 'button',
            class: 'small-button',
            text: `Open in ${info.repository.default_branch}`,
            onClick: run(() => selectFileBranch(info.repository.default_branch)),
          }),
        );
      shell?.body.replaceChildren(
        empty(
          missing ? (diff ? 'File revision not found' : `File not found in ${info.ref}`) : 'Text preview unavailable',
          error.message,
          'file-code',
          actions,
        ),
      );
      renderTabs();
    }
  }

  // Last-chance metadata only; never wait for a response during document teardown.
  listen(window, 'pagehide', () => rememberFileTabs().catch(() => {}));
  onCleanup(suspendFileTabs);
  return {
    loadFileTabs,
    openFileTab,
    selectFileBranch,
    rememberFileTabs,
    suspendFileTabs,
    mountFileTabs,
    updateFileTabTheme,
  };
}
