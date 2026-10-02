(() => {
  'use strict';
  if (document.getElementById('code-tree-extension')) return;
  const C = globalThis.CodeTree;
  const state = {
    epoch: 0, filesGeneration: 0, context: null, info: null, preferences: {...C.defaults}, public: null,
    tab: 'files', mode: 'files', query: '', filter: 'all', entries: [], tree: C.makeTree([]),
    expanded: new Set(), flat: [], lazy: false, loading: false, error: '', diff: null,
    branches: null, pulls: [], totalPulls: 0, loadingAll: false, selected: '', focus: 0,
  };
  let lastURL = ''; let renderFrame = 0; let toastTimer; let hoverTimer; let queryTimer;
  let viewerGeneration = 0; let resizeStart = null;
  let headerFrame = 0; let fullViewPaths = new Map();
  const expansionMemory = new Map(); const loadingFolders = new Map();
  const host = document.createElement('div');
  host.id = 'code-tree-extension';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
  const shadow = host.attachShadow({mode: 'open'});
  const sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = chrome.runtime.getURL('sidebar.css');
  shadow.append(sheet);
  const pageStyle = document.createElement('style'); pageStyle.id = 'code-tree-page-style';
  document.documentElement.append(host, pageStyle);

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) {
      if (value == null) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key === 'onClick') node.addEventListener('click', value);
      else if (key === 'value') node.value = value;
      else node.setAttribute(key, String(value));
    }
    node.append(...children); return node;
  }
  function button(name, label, callback, className = '') {
    return el('button', {type: 'button', class: `icon-button ${className}`, title: label, 'aria-label': label, onClick: callback}, [C.icon(name)]);
  }
  async function rpc(type, value = {}) {
    const response = await chrome.runtime.sendMessage({type, context: state.context, ...value});
    if (!response?.ok) throw new Error(response?.error || 'The extension was reloaded. Refresh this repository page.');
    return response.value;
  }
  function toast(text) {
    toastBox.textContent = text; toastBox.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastBox.hidden = true; }, 6000);
  }
  function run(callback) { return (...args) => Promise.resolve().then(() => callback(...args)).catch(error => toast(error.message)); }
  function meta(name) { return document.querySelector(`meta[name="${name}"]`)?.content || ''; }
  function refHint() {
    for (const script of document.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
      try {
        const payload = JSON.parse(script.textContent).payload;
        const route = payload?.codeViewRepoRoute || payload?.codeViewBlobRoute;
        if (route?.refInfo?.name) return route.refInfo.name;
        if (payload?.refInfo?.name) return payload.refInfo.name;
      } catch { /* Other embedded payloads may not be valid repository route data. */ }
    }
    return '';
  }
  function currentContext() {
    const provider = state.public?.hosts?.find(host => host.origin === location.origin)?.provider || (location.hostname === 'gitlab.com' ? 'gitlab' : 'github');
    if (provider === 'gitlab' && document.body?.dataset.page?.startsWith('groups:')) return null;
    const context = C.route(location.href, provider);
    if (!C.pageVisible(location.href, context, state.preferences)) return null;
    return {...context, viewer: provider === 'gitlab' ? document.body?.dataset.currentUserUsername || '' : meta('user-login') || meta('octolytics-actor-login'), refHint: refHint()};
  }
  function providerName() { return state.context?.provider === 'gitlab' ? 'GitLab' : 'GitHub'; }
  function requestName() { return state.context?.provider === 'gitlab' ? 'merge request' : 'pull request'; }
  function isDark() {
    if (document.documentElement.classList.contains('gl-dark') || document.body?.classList.contains('gl-dark')) return true;
    if (document.documentElement.classList.contains('gl-light') || document.body?.classList.contains('gl-light')) return false;
    const mode = document.documentElement.getAttribute('data-color-mode');
    return mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function layout() {
    const prefs = state.preferences; const available = Boolean(state.context);
    host.dataset.theme = isDark() ? 'dark' : 'light'; host.dataset.icons = prefs.iconTheme;
    host.dataset.provider = state.context?.provider || 'github';
    host.style.setProperty('--panel-width', `${prefs.width}px`);
    host.style.setProperty('--code-font', C.fontFamilies[prefs.fontFamily]);
    host.style.setProperty('--code-size', `${prefs.fontSize}px`);
    host.style.setProperty('--diff-row-height', `${Math.max(22, prefs.fontSize + 8)}px`);
    panel.dataset.dock = prefs.dock; handle.dataset.dock = prefs.dock; resize.dataset.dock = prefs.dock;
    panel.hidden = !available || !prefs.open; handle.hidden = !available || prefs.open;
    resize.hidden = !available || !prefs.open;
    pinButton.classList.toggle('active', prefs.pinned); pinButton.setAttribute('aria-pressed', String(prefs.pinned));
    const closeLabel = `Close sidebar${prefs.toggleShortcut ? ` · ${prefs.toggleShortcut}` : ''}`;
    closeButton.title = closeLabel; closeButton.setAttribute('aria-label', closeLabel);
    searchHint.textContent = prefs.searchShortcut.split(',')[0];
    const padding = available && prefs.open && prefs.pinned ? prefs.width : 0;
    const fontStyle = available && (prefs.fontFamily !== 'default' || prefs.fontSize !== 12)
      ? `.blob-code,.blob-code-inner,.react-code-text,[data-testid="code-cell"],pre code,.rd-line-text,.line_content,.blob-content pre{font-family:${C.fontFamilies[prefs.fontFamily]}!important;font-size:${prefs.fontSize}px!important;}` : '';
    pageStyle.textContent = `@media(min-width:800px){body{padding-${prefs.dock}:${padding}px!important;}}${fontStyle}
      .code-tree-view-full{display:inline-flex;align-items:center;gap:5px;flex-shrink:0;white-space:nowrap;cursor:pointer;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:4px 9px;border:1px solid var(--borderColor-default,var(--gl-border-color-default,#8b949e55));border-radius:6px;background:var(--bgColor-muted,var(--gl-background-color-subtle,#6e768112));color:inherit;margin-inline:4px;line-height:18px}
      .code-tree-view-full:hover{border-color:var(--fgColor-accent,var(--gl-text-color-link,#58a6ff))}.code-tree-view-full:focus-visible{outline:2px solid var(--fgColor-accent,var(--gl-focus-ring-outer-color,#58a6ff));outline-offset:2px}.code-tree-view-full:disabled{opacity:.5;cursor:default}.code-tree-view-full .icon{height:15px;width:15px}`;
    requestTreeRender();
  }
  async function setPreferences(value) {
    state.preferences = C.preferences({...state.preferences, ...value}); layout();
    await rpc('PREFERENCES', {value});
  }
  const panel = el('aside', {class: 'panel', 'aria-label': 'Code Tree'});
  const pinButton = button('pin', 'Pin sidebar in this window', run(async () => {
    state.preferences.pinned = await rpc('WINDOW_PIN', {pinned: !state.preferences.pinned});
    await setPreferences({open: true});
  }));
  const closeButton = button('close', 'Close sidebar', run(() => setPreferences({open: false})));
  const brandbar = el('div', {class: 'brandbar'}, [C.icon('tree'), el('span', {class: 'brand', text: 'Code Tree'}), pinButton,
    closeButton]);
  const repository = el('div', {class: 'repository'});
  const branchLabel = el('span', {class: 'branch-label', text: 'Loading branch…'});
  const branchButton = el('button', {type: 'button', class: 'branch-button', 'aria-label': 'Switch branch', 'aria-expanded': 'false'}, [C.icon('branch'), branchLabel, C.icon('chevron', 'chevron')]);
  const branchSearch = el('input', {type: 'search', placeholder: 'Find a branch…', 'aria-label': 'Search branches'});
  const branchList = el('div', {class: 'branch-list'});
  const branchPopover = el('div', {class: 'popover', hidden: '', 'aria-label': 'Branches'}, [branchSearch, branchList]);
  const branchbar = el('div', {class: 'branchbar'}, [branchButton, branchPopover]);
  const tabs = el('div', {class: 'tabs', role: 'tablist', 'aria-label': 'Sidebar sections'});
  const tabButtons = {};
  for (const [id, label, name] of [['files', 'Files', 'code'], ['pulls', 'Pull requests', 'pr'], ['bookmarks', 'Bookmarks', 'bookmark']]) {
    const tab = el('button', {type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false', onClick: run(() => selectTab(id))}, [C.icon(name), el('span', {text: label})]);
    tabButtons[id] = tab; tabs.append(tab);
  }
  const search = el('input', {type: 'search', placeholder: 'Find a file…', 'aria-label': 'Search files and folders'});
  const searchHint = el('span', {class: 'keyhint'});
  const searchbar = el('div', {class: 'searchbar'}, [C.icon('search'), search, searchHint]);
  const toolbar = el('div', {class: 'toolbar'});
  const notice = el('div', {class: 'notice', role: 'status', 'aria-live': 'polite'});
  const body = el('div', {class: 'body', role: 'tabpanel', 'aria-label': 'Files'});
  const spacer = el('div', {class: 'tree-spacer', role: 'tree', 'aria-label': 'Repository file tree'});
  const accountSelect = el('select', {class: 'account-select', 'aria-label': 'Repository account'});
  const dockButton = button('dock', 'Move sidebar to the other side', run(() => setPreferences({dock: state.preferences.dock === 'left' ? 'right' : 'left'})));
  const bookmarkButton = button('bookmark', 'Bookmark this page', run(bookmarkCurrent));
  const footer = el('div', {class: 'footer'}, [C.icon('account'), accountSelect, el('span', {class: 'separator'}), bookmarkButton, dockButton,
    button('settings', 'Settings', run(() => rpc('OPTIONS')))]);
  panel.append(brandbar, repository, branchbar, tabs, searchbar, toolbar, notice, body, footer);
  const handle = el('button', {type: 'button', class: 'handle', 'aria-label': 'Open Code Tree', onClick: run(() => setPreferences({open: true}))}, [C.icon('chevron'), el('span', {text: 'Code Tree'}), el('span', {class: 'handle-grip', 'aria-hidden': 'true'})]);
  const resize = el('div', {class: 'resize', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize sidebar', tabindex: '0'});
  const toastBox = el('div', {class: 'toast', role: 'status', hidden: ''});
  const viewer = el('dialog', {class: 'viewer', 'aria-label': 'Full-file diff'});
  shadow.append(panel, handle, resize, toastBox, viewer);

  function closeBranches() { branchPopover.hidden = true; branchButton.setAttribute('aria-expanded', 'false'); }
  branchButton.addEventListener('click', run(async () => {
    if (!branchPopover.hidden) { closeBranches(); return; }
    branchPopover.hidden = false; branchButton.setAttribute('aria-expanded', 'true');
    branchSearch.value = ''; branchList.replaceChildren(el('div', {class: 'empty', text: 'Loading branches…'})); branchSearch.focus();
    const epoch = state.epoch;
    try {
      const branches = state.branches || await rpc('BRANCHES');
      if (epoch !== state.epoch) return;
      state.branches = branches; renderBranches();
    } catch (error) { if (epoch === state.epoch) branchList.replaceChildren(el('div', {class: 'empty', text: error.message})); }
  }));
  function renderBranches() {
    const query = branchSearch.value.toLowerCase();
    const list = (state.branches || []).filter(branch => branch.name.toLowerCase().includes(query));
    branchList.replaceChildren();
    for (const branch of list) {
      const item = el('button', {type: 'button', class: 'branch-item', onClick: () => {
        location.assign(C.treeURL(state.context, branch.name));
      }}, [branch.name === state.info?.ref ? C.icon('check') : C.icon('branch'), el('span', {text: branch.name})]);
      if (branch.name === state.info?.repository.default_branch) item.append(el('small', {class: 'default-tag', text: 'default'}));
      branchList.append(item);
    }
    if (!list.length) branchList.append(el('div', {class: 'empty', text: 'No matching branches.'}));
  }
  branchSearch.addEventListener('input', renderBranches);
  shadow.addEventListener('click', event => { if (!branchbar.contains(event.target)) closeBranches(); });
  search.addEventListener('input', () => {
    clearTimeout(queryTimer); queryTimer = setTimeout(() => {
      state.query = search.value; state.focus = 0; body.scrollTop = 0; render();
    }, 100);
  });
  accountSelect.addEventListener('change', run(async () => {
    await rpc('SELECT_ACCOUNT', {origin: state.context.origin, id: accountSelect.value});
    await loadPage(true);
  }));
  handle.addEventListener('mouseenter', () => {
    if (!state.preferences.pinned) { state.preferences.open = true; layout(); }
  });
  panel.addEventListener('mouseenter', () => clearTimeout(hoverTimer));
  panel.addEventListener('mouseleave', () => {
    if (!state.preferences.pinned && !viewer.open && branchPopover.hidden) hoverTimer = setTimeout(() => {
      if (!panel.contains(shadow.activeElement)) { state.preferences.open = false; layout(); }
    }, 250);
  });
  resize.addEventListener('pointerdown', event => {
    resizeStart = {x: event.clientX, width: state.preferences.width}; resize.setPointerCapture(event.pointerId); event.preventDefault();
  });
  resize.addEventListener('pointermove', event => {
    if (!resizeStart) return;
    const delta = (event.clientX - resizeStart.x) * (state.preferences.dock === 'left' ? 1 : -1);
    state.preferences.width = Math.max(240, Math.min(600, resizeStart.width + delta)); layout();
  });
  resize.addEventListener('pointerup', run(async () => { if (resizeStart) { resizeStart = null; await setPreferences({width: state.preferences.width}); } }));
  resize.addEventListener('pointercancel', () => { resizeStart = null; });
  resize.addEventListener('keydown', run(async event => {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); const delta = event.key === 'ArrowRight' ? 16 : -16;
      await setPreferences({width: state.preferences.width + delta * (state.preferences.dock === 'left' ? 1 : -1)});
    }
  }));
  function expansionKey() { return `${state.context?.origin}/${state.context?.owner}/${state.context?.repo}:${state.info?.ref}:${state.mode}`; }
  function rememberExpansion() { expansionMemory.set(expansionKey(), new Set(state.expanded)); }
  async function loadPage(force = false) {
    const context = currentContext(); const url = location.href;
    if (!force && url === lastURL) return;
    lastURL = url; const epoch = ++state.epoch;
    viewerGeneration++; if (viewer.open) viewer.close();
    fullViewPaths.clear(); document.querySelectorAll('.code-tree-view-full').forEach(button => button.remove());
    closeBranches(); loadingFolders.clear();
    state.context = context; state.info = null; state.diff = null; state.branches = null;
    state.loading = true; state.error = ''; state.entries = []; state.tree = C.makeTree([]); state.flat = [];
    state.query = ''; search.value = ''; state.mode = context?.kind === 'pull' || context?.kind === 'commit' ? 'changes' : 'files';
    state.tab = 'files'; state.selected = ''; state.focus = 0; state.lazy = false; state.loadingAll = false;
    layout(); if (!context) return;
    scheduleHeaderButtons();
    render();
    try {
      const [publicData, info] = await Promise.all([rpc('STATE').then(value => {
        if (epoch === state.epoch) { state.public = value; state.preferences = value.preferences; updateHeader(); layout(); }
        return value;
      }), rpc('INIT')]);
      if (epoch !== state.epoch) return;
      state.public = publicData; state.preferences = publicData.preferences; state.info = info;
      state.selected = info.path || ''; updateHeader(); layout();
      await loadFiles(epoch);
    } catch (error) {
      if (epoch !== state.epoch) return;
      state.loading = false; state.error = error.message; updateHeader(); render();
    }
  }
  function updateHeader() {
    const context = state.context;
    repository.replaceChildren();
    if (!context) return;
    repository.append(el('a', {class: 'repo-name', href: C.repoURL(context), title: `${context.owner}/${context.repo}`}, [el('small', {text: `${context.owner} / `}), document.createTextNode(context.repo)]));
    tabButtons.pulls.querySelector('span').textContent = context.provider === 'gitlab' ? 'Merge requests' : 'Pull requests';
    if (state.info?.repository.private) repository.append(el('span', {class: 'privacy', text: 'Private'}));
    branchLabel.textContent = state.info?.ref || 'Branch'; branchButton.disabled = !state.info;
    accountSelect.replaceChildren(el('option', {value: 'auto', text: `Auto · ${providerName()} account`}));
    for (const account of state.public?.accounts || []) {
      if (account.origin === context.origin) accountSelect.append(el('option', {value: account.id, text: account.label === account.login ? account.login : `${account.label} · ${account.login}`}));
    }
    accountSelect.value = state.public?.selectedAccounts[context.origin] || 'auto';
    accountSelect.title = state.info?.account ? `API account: ${state.info.account}` : 'Public access · add a token in Settings for private repositories';
    bookmarkButton.classList.toggle('active', (state.public?.bookmarks || []).some(item => item.url === location.href));
  }
  async function loadFiles(epoch = state.epoch) {
    const mode = state.mode; const generation = ++state.filesGeneration;
    const current = () => epoch === state.epoch && generation === state.filesGeneration;
    loadingFolders.clear(); state.loadingAll = false;
    state.loading = true; state.error = ''; render();
    try {
      if (mode === 'changes') {
        const diff = await rpc('DIFF');
        if (!current()) return;
        state.diff = diff;
        await prepareHeaderButtons(diff, epoch);
        if (!current()) return;
        const grouped = new Map();
        for (const comment of diff.comments) {
          if (!grouped.has(comment.path)) grouped.set(comment.path, []);
          grouped.get(comment.path).push(comment);
        }
        state.entries = diff.files.map(file => ({...file, path: file.filename, type: 'blob', comments: grouped.get(file.filename) || [], viewed: diff.viewed[file.filename] === 'VIEWED'}));
        state.lazy = false;
      } else {
        const result = state.info.treeSha ? await rpc('TREE', {sha: state.info.treeSha}) : {entries: [], lazy: false};
        if (!current()) return;
        state.entries = result.entries; state.lazy = result.lazy;
      }
      state.tree = C.makeTree(state.entries);
      state.expanded = expansionMemory.get(expansionKey()) || new Set();
      if (mode === 'changes' && !state.expanded.size) {
        for (const node of state.tree.nodes.values()) if (node.type === 'tree' && node.path) state.expanded.add(node.path);
      }
      let path = state.selected;
      while (path.includes('/')) { path = path.slice(0, path.lastIndexOf('/')); state.expanded.add(path); }
      state.loading = false; body.scrollTop = 0; render();
    } catch (error) { if (current()) { state.loading = false; state.error = error.message; render(); } }
  }
  async function selectTab(tab) {
    state.tab = tab; state.query = ''; search.value = ''; state.error = ''; body.scrollTop = 0;
    if (tab === 'pulls') await loadPulls();
    else if (tab === 'bookmarks') {
      state.public = await rpc('STATE'); updateHeader(); render();
    } else render();
  }
  async function loadPulls() {
    const epoch = state.epoch; const filter = state.filter;
    state.loading = true; state.error = ''; render();
    try {
      const result = await rpc('PULLS', {filter});
      if (epoch !== state.epoch || filter !== state.filter) return;
      state.pulls = result.pulls; state.totalPulls = result.total; state.loading = false; render();
    } catch (error) { if (epoch === state.epoch && filter === state.filter) { state.loading = false; state.error = error.message; render(); } }
  }
  async function refresh() {
    const epoch = state.epoch;
    await rpc('REFRESH');
    if (epoch !== state.epoch) return;
    if (state.tab === 'pulls') await loadPulls();
    else if (state.tab === 'bookmarks') {
      const publicData = await rpc('STATE');
      if (epoch !== state.epoch) return;
      state.public = publicData; render();
    } else {
      const info = await rpc('INIT');
      if (epoch !== state.epoch) return;
      state.info = info; updateHeader(); await loadFiles(epoch);
    }
  }
  function diffNode(file) {
    return {...file, path: file.filename, type: 'blob', adds: file.additions, dels: file.deletions};
  }
  async function prepareHeaderButtons(diff, epoch) {
    const paths = new Map();
    await Promise.all(diff.files.map(async file => {
      for (const path of [file.filename, file.previous_filename].filter(Boolean)) {
        paths.set(path, file);
        if (state.context.provider === 'github') {
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
          paths.set('diff-' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), file);
        }
      }
    }));
    if (epoch !== state.epoch || state.diff !== diff) return;
    fullViewPaths = paths;
    document.querySelectorAll('.code-tree-view-full').forEach(button => button.remove());
    injectHeaderButtons();
  }
  function injectHeaderButtons() {
    if (!['pull', 'commit'].includes(state.context?.kind)) return;
    const epoch = state.epoch;
    const cards = new Set(document.querySelectorAll('[id^="diff-"][role="region"], [id^="diff-"].file, .file[data-path], .diffcard[data-path], article.rd-diff-file, .diff-file, .file-holder'));
    if (state.context.provider === 'github') {
      for (const header of document.querySelectorAll('[class*="DiffFileHeader-module__diff-file-header"]')) {
        const card = header.closest('[role="region"]'); if (card) cards.add(card);
      }
    }
    for (const card of cards) {
      let path = card.getAttribute('data-path') || card.getAttribute('data-file-path') || card.querySelector('[data-file-path]')?.getAttribute('data-file-path');
      if (!path && state.context.provider === 'gitlab') {
        const link = card.querySelector('.rd-diff-file-link[href], .file-title-name[href]');
        if (link) {
          const route = C.route(new URL(link.getAttribute('href'), location.href).href, 'gitlab');
          if (route?.kind === 'blob') path = route.tail.slice(route.tail.indexOf('/') + 1);
        }
      }
      const file = fullViewPaths.get(path) || fullViewPaths.get(card.id);
      if (!path) path = file?.filename;
      if (!path) continue;
      const header = card.querySelector('[class*="DiffFileHeader-module__diff-file-header"], .rd-diff-file-header, .file-header, .diffhead');
      if (!header || header.querySelector('.code-tree-view-full')) continue;
      const actions = header.querySelector('.rd-diff-file-info, .file-actions') || (header.className.includes('DiffFileHeader-module__') ? header.lastElementChild : header);
      const filename = file?.filename || path;
      const binary = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|ttf|otf|woff2?|pdf|zip|gz|7z|rar|mp[34]|mov|ogg|wav|wasm|exe|dll|so|dylib)$/i.test(filename);
      const full = el('button', {type: 'button', class: 'code-tree-view-full', 'aria-label': `View full file: ${filename}`,
        title: binary ? 'Binary file: text preview unavailable' : 'See the whole file with its changes · Code Tree', disabled: binary ? '' : null,
        onClick: event => { event.preventDefault(); event.stopPropagation(); if (epoch === state.epoch) run(() => showHeaderDiff(filename, card.id))(); }}, [C.icon('eye'), document.createTextNode('View full')]);
      card.setAttribute('data-code-tree-file', filename);
      if (actions === header) header.insertBefore(full, header.querySelector('.view') || null);
      else actions.prepend(full);
    }
  }
  async function showHeaderDiff(path, cardId) {
    const file = fullViewPaths.get(path) || fullViewPaths.get(cardId);
    if (file && state.diff) { await showDiff(diffNode(file)); return; }
    const shell = viewerShell(path, 'Full-file preview'); const epoch = state.epoch;
    shell.body.replaceChildren(empty('Loading file revisions', `Loading this review from ${providerName()}…`, 'refresh'));
    try {
      const diff = await rpc('DIFF');
      if (epoch !== state.epoch || shell.generation !== viewerGeneration) return;
      state.diff = diff; await prepareHeaderButtons(diff, epoch);
      if (epoch !== state.epoch || shell.generation !== viewerGeneration) return;
      const matched = fullViewPaths.get(path) || fullViewPaths.get(cardId);
      if (!matched) throw new Error('This file is not in the current review. Refresh the page and try again.');
      await showDiff(diffNode(matched));
    } catch (error) {
      if (epoch !== state.epoch || shell.generation !== viewerGeneration) return;
      shell.body.replaceChildren(empty('Full-file preview unavailable', error.message, 'account'));
      shell.bottom.prepend(el('button', {type: 'button', text: 'Connect account in Settings', onClick: run(() => rpc('OPTIONS'))}),
        el('button', {type: 'button', text: 'Retry', onClick: run(() => showHeaderDiff(path, cardId))}));
    }
  }
  function scheduleHeaderButtons() {
    if (['pull', 'commit'].includes(state.context?.kind) && !headerFrame) headerFrame = requestAnimationFrame(() => { headerFrame = 0; injectHeaderButtons(); });
  }
  function renderToolbar() {
    toolbar.replaceChildren();
    if (state.tab === 'files') {
      if (['pull', 'commit'].includes(state.context?.kind)) {
        const select = el('select', {'aria-label': 'File tree mode'}, [el('option', {value: 'files', text: 'Repository files'}), el('option', {value: 'changes', text: state.context.kind === 'pull' ? `${state.context.provider === 'gitlab' ? 'MR !' : 'PR #'}${state.context.number} changes` : 'Commit changes'})]);
        select.value = state.mode; select.addEventListener('change', run(async () => { rememberExpansion(); state.mode = select.value; await loadFiles(); })); toolbar.append(select);
      } else toolbar.append(el('span', {class: 'toolbar-title', text: state.lazy ? 'Loaded repository files' : 'Repository files'}));
      const files = state.flat.filter(node => node.type !== 'tree').length;
      toolbar.append(el('span', {class: 'count', text: String(state.query ? files : state.entries.filter(entry => entry.type !== 'tree').length)}));
      toolbar.append(button('collapse', 'Collapse folders', () => { state.expanded.clear(); rememberExpansion(); updateTree(); }));
    } else if (state.tab === 'pulls') {
      const select = el('select', {'aria-label': `Filter ${requestName()}s`});
      for (const [value, label] of [['all', `All open ${requestName()}s`], ['awaiting', 'Requested from me'], ['reviewed', 'Reviewed by me'], ['changes', 'Changes requested'], ['approved', 'Approved'], ['unreviewed', 'No reviews']]) select.append(el('option', {value, text: label}));
      select.value = state.filter; select.addEventListener('change', run(async () => { state.filter = select.value; await loadPulls(); })); toolbar.append(select, el('span', {class: 'count', text: String(state.pulls.length)}));
    } else toolbar.append(el('span', {class: 'toolbar-title', text: 'Saved on this browser'}), el('span', {class: 'count', text: String(state.public?.bookmarks.length || 0)}));
    toolbar.append(button('refresh', 'Refresh sidebar', run(refresh)));
  }
  function empty(title, text, icon = 'search') {
    return el('div', {class: 'empty'}, [C.icon(icon), el('strong', {text: title}), el('span', {text})]);
  }
  function render() {
    for (const [id, tab] of Object.entries(tabButtons)) tab.setAttribute('aria-selected', String(id === state.tab));
    body.setAttribute('aria-label', state.tab === 'pulls' ? `${providerName()} ${requestName()}s` : state.tab === 'bookmarks' ? 'Bookmarks' : 'Files');
    search.placeholder = state.tab === 'pulls' ? `Find a ${requestName()}…` : state.tab === 'bookmarks' ? 'Find a bookmark…' : 'Find a file…';
    search.setAttribute('aria-label', state.tab === 'pulls' ? `Search ${requestName()}s` : state.tab === 'bookmarks' ? 'Search bookmarks' : 'Search files and folders');
    notice.replaceChildren(); notice.className = 'notice';
    if (state.tab === 'files' && !state.loading && !state.error) updateTree(false);
    renderToolbar();
    if (state.loading) {
      const node = empty(`Loading from ${providerName()}`, 'Fetching repository data…', 'refresh'); node.classList.add('loading'); body.replaceChildren(node); return;
    }
    if (state.error) {
      const node = empty('Could not load this view', state.error, 'file');
      node.append(el('button', {class: 'small-button', text: 'Retry', onClick: run(refresh)}), el('button', {class: 'small-button', text: 'Open settings', onClick: run(() => rpc('OPTIONS'))})); body.replaceChildren(node); return;
    }
    if (state.tab === 'files') {
      if (state.lazy) {
        notice.append(document.createTextNode('Folders load as you open them. Search currently includes loaded files. '));
        notice.append(el('button', {type: 'button', text: state.loadingAll ? 'Loading all folders…' : 'Load all folders for search', onClick: run(loadAllFolders), disabled: state.loadingAll ? '' : null}));
      }
      if (state.mode === 'changes' && state.diff) {
        if (state.diff.viewedMode === 'local') notice.append(document.createTextNode('Viewed marks are local to this browser. '));
        for (const warning of state.diff.warnings) notice.append(el('div', {text: warning}));
      }
      if (!state.flat.length) body.replaceChildren(empty(state.query ? 'No matching files' : 'No files', state.query ? 'Try a different file or folder name.' : 'This repository has no files to display.', 'folder'));
      else { if (!body.contains(spacer)) body.replaceChildren(spacer); requestTreeRender(); }
    } else if (state.tab === 'pulls') renderPulls();
    else renderBookmarks();
  }
  function updateTree(shouldRender = true) {
    state.flat = C.flatten(state.tree, state.expanded, state.query);
    state.focus = Math.min(state.focus, Math.max(0, state.flat.length - 1));
    spacer.style.height = `${state.flat.length * 29}px`;
    if (shouldRender) render();
  }
  function requestTreeRender() {
    if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; renderTreeRows(); });
  }
  body.addEventListener('scroll', requestTreeRender, {passive: true});
  function highlight(label, query) {
    const span = el('span', {class: 'file-label'}); const index = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (index === -1) span.textContent = label;
    else span.append(document.createTextNode(label.slice(0, index)), el('mark', {text: label.slice(index, index + query.length)}), document.createTextNode(label.slice(index + query.length)));
    return span;
  }
  function renderTreeRows() {
    if (state.tab !== 'files' || state.loading || state.error || !body.contains(spacer)) return;
    const start = Math.max(0, Math.floor(body.scrollTop / 29) - 6);
    const end = Math.min(state.flat.length, start + Math.ceil(body.clientHeight / 29) + 14);
    const focusedPath = shadow.activeElement?.closest?.('.tree-row')?.dataset.path;
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index++) {
      const node = state.flat[index]; const folder = node.type === 'tree';
      const row = el('div', {class: `tree-row${node.path === state.selected ? ' selected' : ''}${node.viewed ? ' viewed' : ''}`, role: 'treeitem', 'aria-level': node.depth, 'aria-label': node.path, tabindex: index === state.focus ? '0' : '-1', 'data-path': node.path, title: node.previous_filename ? `${node.previous_filename} → ${node.path}` : node.path});
      row.style.top = `${index * 29}px`; row.style.setProperty('--indent', `${9 + (node.depth - 1) * 14}px`);
      if (folder) {
        row.setAttribute('aria-expanded', String(Boolean(state.query) || state.expanded.has(node.path)));
        row.append(el('button', {type: 'button', class: 'disclosure', 'aria-label': `Toggle folder: ${node.path}`, onClick: event => {
          event.stopPropagation(); state.focus = index; run(() => toggleFolder(node))();
        }}, [C.icon('chevron')]));
      }
      else row.append(el('span', {class: 'spacer'}));
      const kind = folder ? 'folder' : C.fileKind(node.path); row.append(C.icon(kind, 'file-icon')); row.lastChild.classList.add(`kind-${kind}`);
      row.append(highlight(node.name, state.query));
      if (state.mode === 'changes') {
        if (node.status) row.append(el('span', {class: `file-status ${node.status}`, text: ({added: 'A', removed: 'D', renamed: 'R', modified: 'M'})[node.status] || node.status[0].toUpperCase()}));
        if (node.commentCount) {
          const count = node.commentCount;
          if (count) row.append(el('button', {type: 'button', class: 'comments-count', title: `${count} comments`, 'aria-label': `Comments on ${node.path}`, onClick: event => { event.stopPropagation(); showComments(node); }}, [C.icon('comment'), document.createTextNode(String(count))]));
        }
        if (node.adds || node.dels) row.append(el('span', {class: 'file-stats'}, [el('span', {class: 'adds', text: node.adds ? `+${node.adds}` : ''}), el('span', {class: 'dels', text: node.dels ? `−${node.dels}` : ''})]));
        if (!folder) {
          const full = button('diff', `Full-file diff: ${node.path}`, event => { event.stopPropagation(); run(() => showDiff(node))(); }, 'row-action'); row.append(full);
          if (state.diff?.viewedMode !== 'none') {
            const context = state.context; const headSha = state.diff.head.sha;
            const epoch = state.epoch; const generation = state.filesGeneration;
            const checkbox = el('input', {type: 'checkbox', class: 'viewed-checkbox', 'aria-label': `Mark ${node.path} as viewed`, title: state.diff?.viewedMode === 'github' ? 'Viewed on GitHub' : 'Viewed locally'}); checkbox.checked = Boolean(node.viewed);
            checkbox.addEventListener('click', event => event.stopPropagation());
            checkbox.addEventListener('change', run(async () => {
              const viewed = checkbox.checked; checkbox.disabled = true;
              try {
                const result = await rpc('VIEWED', {context, headSha, path: node.path, viewed});
                if (epoch !== state.epoch || generation !== state.filesGeneration || state.diff?.head.sha !== headSha) return;
                node.viewed = result.state === 'VIEWED';
                const entry = state.entries.find(entry => entry.path === node.path); if (entry) entry.viewed = node.viewed;
                requestTreeRender();
              } catch (error) { checkbox.checked = Boolean(node.viewed); throw error; }
              finally { checkbox.disabled = false; }
            })); row.append(checkbox);
          }
        }
      }
      row.addEventListener('click', run(async () => { state.focus = index; if (folder) { if (state.preferences.folderClick) await toggleFolder(node); else row.focus(); } else await openFile(node); }));
      row.addEventListener('keydown', run(event => treeKey(event, node, index)));
      fragment.append(row);
    }
    spacer.replaceChildren(fragment);
    if (focusedPath) spacer.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`)?.focus({preventScroll: true});
  }
  async function treeKey(event, node, index) {
    if (event.target !== event.currentTarget) return;
    let next = index;
    if (event.key === 'ArrowDown') next++;
    else if (event.key === 'ArrowUp') next--;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = state.flat.length - 1;
    else if (event.key === 'ArrowRight' && node.type === 'tree') { event.preventDefault(); if (!state.expanded.has(node.path)) await toggleFolder(node); else next++; }
    else if (event.key === 'ArrowLeft') {
      if (node.type === 'tree' && state.expanded.has(node.path)) { event.preventDefault(); await toggleFolder(node); return; }
      const parent = node.path.slice(0, Math.max(0, node.path.lastIndexOf('/'))); next = state.flat.findIndex(item => item.path === parent);
    } else if (event.key === 'Enter') { event.preventDefault(); if (node.type === 'tree') await toggleFolder(node); else await openFile(node); return; }
    else return;
    event.preventDefault(); state.focus = Math.max(0, Math.min(state.flat.length - 1, next));
    const top = state.focus * 29;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (top + 29 > body.scrollTop + body.clientHeight) body.scrollTop = top + 29 - body.clientHeight;
    renderTreeRows(); spacer.querySelector(`[data-path="${CSS.escape(state.flat[state.focus].path)}"]`)?.focus({preventScroll: true});
  }
  async function toggleFolder(node) {
    const epoch = state.epoch; const generation = state.filesGeneration;
    if (state.expanded.has(node.path)) state.expanded.delete(node.path);
    else { state.expanded.add(node.path); if (!node.loaded) await loadFolder(node); }
    if (epoch !== state.epoch || generation !== state.filesGeneration) return;
    rememberExpansion(); updateTree();
  }
  async function loadFolder(node) {
    if (node.loaded || loadingFolders.has(node.path)) return loadingFolders.get(node.path);
    const epoch = state.epoch; const generation = state.filesGeneration;
    const promise = rpc('TREE', {sha: state.context.provider === 'gitlab' ? state.info.commitSha : node.sha, path: node.path, recursive: false, lazyChildren: true}).then(result => {
      if (epoch !== state.epoch || generation !== state.filesGeneration) return;
      const parent = state.entries.find(entry => entry.path === node.path); if (parent) parent.loaded = true;
      const known = new Set(state.entries.map(entry => entry.path));
      for (const entry of result.entries) {
        const path = `${node.path}/${entry.path}`;
        if (!known.has(path)) state.entries.push({...entry, path});
      }
      state.tree = C.makeTree(state.entries); updateTree();
    }).finally(() => { if (loadingFolders.get(node.path) === promise) loadingFolders.delete(node.path); });
    loadingFolders.set(node.path, promise); return promise;
  }
  async function loadAllFolders() {
    if (state.loadingAll) return;
    const epoch = state.epoch; const generation = state.filesGeneration;
    const current = () => epoch === state.epoch && generation === state.filesGeneration;
    state.loadingAll = true; render();
    try {
      while (current()) {
        const folders = Array.from(state.tree.nodes.values()).filter(node => node.type === 'tree' && !node.loaded).slice(0, 4);
        if (!folders.length) { state.lazy = false; break; }
        await Promise.all(folders.map(loadFolder));
      }
    } finally { if (current()) { state.loadingAll = false; render(); } }
  }
  async function diffURL(node) {
    const gitlab = state.context.provider === 'gitlab';
    if (state.context.kind === 'commit') return `${C.repoURL(state.context)}${gitlab ? '/-' : ''}/commit/${state.context.sha}`;
    const hash = await crypto.subtle.digest(gitlab ? 'SHA-1' : 'SHA-256', new TextEncoder().encode(node.path));
    const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    if (gitlab) return `${C.pullURL(state.context, state.context.number)}/diffs?file_path=${encodeURIComponent(node.path)}#${digest}`;
    const view = location.pathname.match(/\/pull\/\d+\/(files|changes)(?:\/|$)/)?.[1] || 'changes';
    return `${C.pullURL(state.context, state.context.number)}/${view}#diff-${digest}`;
  }
  async function openFile(node) {
    if (state.mode === 'changes') {
      const url = await diffURL(node);
      if (location.pathname === new URL(url).pathname) {
        const hash = new URL(url).hash.slice(1); const target = document.getElementById(hash) || document.querySelector(`[data-code-tree-file="${CSS.escape(node.path)}"]`) || document.querySelector(`[data-path="${CSS.escape(node.path)}"]`);
        if (target) { target.scrollIntoView({block: 'start'}); history.replaceState(null, '', url); lastURL = location.href; state.selected = node.path; requestTreeRender(); return; }
      }
      location.assign(url);
    } else location.assign(C.blobURL(state.context, state.info.ref, node.path, node.type === 'commit' ? 'tree' : 'blob'));
  }
  function renderPulls() {
    const query = state.query.toLowerCase();
    const pulls = state.pulls.filter(pull => `${pull.number} ${pull.title} ${pull.user?.login || ''}`.toLowerCase().includes(query));
    if (!pulls.length) { body.replaceChildren(empty(`No matching ${requestName()}s`, state.filter === 'all' && !state.query ? `There are no open ${requestName()}s in this repository.` : 'Try another filter or search.', 'pr')); return; }
    const list = el('div', {class: 'list'});
    for (const pull of pulls) {
      const item = el('a', {class: 'pr-item', href: C.pullURL(state.context, pull.number)}, [el('div', {class: `pr-title${pull.draft ? ' draft' : ''}`}, [C.icon('pr'), el('span', {text: pull.title})])]);
      const metadata = el('div', {class: 'pr-meta'}, [el('span', {text: `${state.context.provider === 'gitlab' ? '!' : '#'}${pull.number} · ${pull.user?.login || 'unknown'}`})]);
      if (pull.draft) metadata.append(el('span', {text: 'Draft'}));
      if (pull.decision) metadata.append(el('span', {class: `review-state${pull.decision === 'CHANGES_REQUESTED' ? ' changes' : ''}`, text: ({APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required'})[pull.decision] || pull.decision}));
      item.append(metadata); list.append(item);
    }
    body.replaceChildren(list);
  }
  async function bookmarkCurrent() {
    const existing = state.public?.bookmarks.find(item => item.url === location.href);
    const bookmarks = await rpc('BOOKMARK', existing ? {remove: existing.id} : {url: location.href, title: document.title.replace(/ [·|] (GitHub|GitLab)$/, '')});
    state.public.bookmarks = bookmarks; updateHeader(); if (state.tab === 'bookmarks') render();
    toast(existing ? 'Bookmark removed.' : 'Page bookmarked on this browser.');
  }
  function renderBookmarks() {
    const query = state.query.toLowerCase();
    const bookmarks = (state.public?.bookmarks || []).filter(item => `${item.title} ${item.url}`.toLowerCase().includes(query));
    if (!bookmarks.length) { body.replaceChildren(empty('No bookmarks yet', state.query ? 'No bookmarks match your search.' : `Use the bookmark button below to save a repository, file, issue or ${requestName()}.`, 'bookmark')); return; }
    const list = el('div', {class: 'list'});
    for (const bookmark of bookmarks) {
      const item = el('div', {class: 'bookmark-item'}, [C.icon('bookmark'), el('a', {class: 'bookmark-label', href: bookmark.url}, [el('span', {text: bookmark.title}), el('small', {text: new URL(bookmark.url).pathname})])]);
      item.append(button('close', `Remove bookmark: ${bookmark.title}`, run(async () => { state.public.bookmarks = await rpc('BOOKMARK', {remove: bookmark.id}); updateHeader(); render(); })));
      list.append(item);
    }
    body.replaceChildren(list);
  }
  function viewerShell(title, subtitle, label = 'Full-file diff') {
    viewerGeneration++; viewer.setAttribute('aria-label', label);
    const heading = el('div', {class: 'viewer-heading'}, [el('strong', {text: title}), el('small', {text: subtitle})]);
    const actions = el('div', {class: 'viewer-actions'}, [button('close', 'Close viewer', () => viewer.close())]);
    const viewerBody = el('div', {class: 'viewer-body'});
    const bottom = el('div', {class: 'viewer-bottom'});
    viewer.replaceChildren(el('div', {class: 'viewer-inner'}, [el('div', {class: 'viewer-header'}, [heading, actions]), viewerBody, bottom]));
    if (!viewer.open) viewer.showModal();
    return {actions, body: viewerBody, bottom, generation: viewerGeneration};
  }
  viewer.addEventListener('close', () => { viewerGeneration++; });
  async function showDiff(node) {
    const diff = state.diff; if (!diff) return;
    const shell = viewerShell(node.path, `${diff.base.sha?.slice(0, 7) || 'empty'} → ${diff.head.sha.slice(0, 7)} · full-file context`);
    shell.body.replaceChildren(empty('Loading file revisions', `Fetching the complete text from ${providerName()}…`, 'refresh'));
    const originalURL = await diffURL(node);
    shell.actions.prepend(el('a', {href: originalURL, text: `${providerName()} diff`, target: '_blank', rel: 'noopener noreferrer'}));
    const files = diff.files.map(diffNode); const index = files.findIndex(item => item.path === node.path);
    const previous = button('arrow', 'Previous changed file', run(() => showDiff(files[index - 1]))); previous.disabled = index <= 0;
    const next = button('arrow', 'Next changed file', run(() => showDiff(files[index + 1]))); next.firstChild.style.transform = 'rotate(180deg)'; next.disabled = index >= files.length - 1;
    shell.bottom.append(el('span', {text: `${index + 1} of ${files.length} files`}), el('span', {class: 'flex'}), previous, next);
    try {
      const [before, after] = await Promise.all([
        node.status === 'added' || !diff.base.sha ? '' : rpc('FILE', {source: diff.base, path: node.previous_filename || node.path}),
        node.status === 'removed' ? '' : rpc('FILE', {source: diff.head, path: node.path}),
      ]);
      if (shell.generation !== viewerGeneration) return;
      if (C.lines(before).length + C.lines(after).length > 100000) throw new Error(`This file exceeds the 100,000 combined line text-preview limit. Open it on ${providerName()}.`);
      const rows = C.fullDiff(before, after, node.patch);
      const current = () => shell.generation === viewerGeneration;
      const [oldSyntax, newSyntax] = await Promise.all([
        globalThis.CodeTreeSyntax.tokenize(before, node.previous_filename || node.path, current),
        globalThis.CodeTreeSyntax.tokenize(after, node.path, current),
      ]);
      if (!current()) return;
      if (oldSyntax.limited || newSyntax.limited) { oldSyntax.lines = []; newSyntax.lines = []; }
      const rowHeight = Math.max(22, state.preferences.fontSize + 8);
      const code = el('div', {class: 'code-spacer'}); code.style.height = `${rows.length * rowHeight}px`;
      const maxLength = rows.reduce((max, row) => Math.max(max, row.text.length), 0);
      code.style.width = `${Math.max(600, 128 + Math.min(4000, maxLength) * state.preferences.fontSize * .65)}px`;
      let frame = 0;
      const draw = () => {
        frame = 0; const start = Math.max(0, Math.floor(shell.body.scrollTop / rowHeight) - 6);
        const end = Math.min(rows.length, start + Math.ceil(shell.body.clientHeight / rowHeight) + 14);
        const fragment = document.createDocumentFragment();
        for (let index = start; index < end; index++) {
          const row = rows[index];
          const text = el('span', {class: 'line-text'}); let position = 0;
          const tokens = row.type === 'removed' ? oldSyntax.lines[row.oldLine - 1] : newSyntax.lines[row.newLine - 1];
          for (const token of tokens || []) {
            text.append(document.createTextNode(row.text.slice(position, token.start)), el('span', {class: `syntax-${token.type}`, text: row.text.slice(token.start, token.end)}));
            position = token.end;
          }
          text.append(document.createTextNode(row.text.slice(position)));
          const element = el('div', {class: `code-row ${row.type}`}, [el('span', {class: 'line-number', text: row.oldLine || ''}), el('span', {class: 'line-number', text: row.newLine || ''}), el('span', {class: 'line-sign', text: row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' '}), text]);
          element.style.top = `${index * rowHeight}px`; fragment.append(element);
        }
        code.replaceChildren(fragment);
      };
      shell.body.replaceChildren(code);
      shell.body.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(draw); }, {passive: true});
      shell.bottom.prepend(el('span', {class: 'adds', text: `+${node.adds}`}), el('span', {class: 'dels', text: `−${node.dels}`}), el('span', {text: `${rows.length} lines · UTF-8`}));
      if (oldSyntax.limited || newSyntax.limited) shell.bottom.append(el('span', {text: 'Syntax limit reached · plain text'}));
      if (before.endsWith('\n') !== after.endsWith('\n') || before.includes('\r\n') !== after.includes('\r\n')) shell.bottom.append(el('span', {text: 'Line-ending / final newline changed'}));
      draw();
    } catch (error) { if (shell.generation === viewerGeneration) shell.body.replaceChildren(empty('Text preview unavailable', error.message, 'diff')); }
  }
  function showComments(node) {
    const files = node.type === 'tree' ? state.entries.filter(entry => entry.path.startsWith(node.path + '/')) : [node];
    const comments = files.flatMap(file => file.comments || []);
    const shell = viewerShell(node.path, `${comments.length} inline comments`, 'File review comments');
    for (const comment of comments) {
      const metadata = el('div', {class: 'comment-meta'}, [el('strong', {text: comment.user?.login || 'unknown'}), el('span', {text: `${comment.path}${comment.line || comment.original_line ? `:${comment.line || comment.original_line}` : ''}${comment.line == null && comment.original_line ? ' · outdated' : ''}`})]);
      try { if (new URL(comment.html_url).origin === state.context.origin) metadata.append(el('a', {href: comment.html_url, text: `View on ${providerName()}`, target: '_blank', rel: 'noopener noreferrer'})); } catch { /* Keep the comment text while omitting an invalid external link. */ }
      shell.body.append(el('div', {class: 'comment-card'}, [metadata, el('div', {class: 'comment-body', text: comment.body})]));
    }
    if (!comments.length) shell.body.append(empty('No inline comments', 'There are no review comments for this file.', 'comment'));
  }
  document.addEventListener('keydown', event => {
    const editing = event.composedPath().some(node => node instanceof Element && (node.matches('input,textarea,select') || node.isContentEditable));
    if (!state.context || editing || event.repeat || event.isComposing || event.getModifierState('AltGraph')) return;
    if (C.shortcutMatches(state.preferences.toggleShortcut, event)) { event.preventDefault(); run(() => setPreferences({open: !state.preferences.open}))(); }
    else if (C.shortcutMatches(state.preferences.searchShortcut, event)) { event.preventDefault(); run(async () => { await setPreferences({open: true}); search.focus(); })(); }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'TOGGLE') run(() => setPreferences({open: !state.preferences.open}))();
    if (message.type === 'WINDOW_PIN_CHANGED') { state.preferences.pinned = message.pinned; layout(); }
  });
  const themeObserver = new MutationObserver(layout);
  themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['class', 'data-color-mode', 'data-dark-theme', 'data-light-theme']});
  if (document.body) {
    themeObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
    new MutationObserver(scheduleHeaderButtons).observe(document.body, {childList: true, subtree: true});
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', layout);
  window.addEventListener('resize', requestTreeRender, {passive: true});
  window.addEventListener('popstate', run(() => loadPage()));
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end']) document.addEventListener(event, run(() => loadPage()));
  setInterval(() => { if (location.href !== lastURL) run(() => loadPage())(); }, 1000);
  run(async () => { state.public = await rpc('STATE'); state.preferences = state.public.preferences; await loadPage(); })();
})();
