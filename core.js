/* Shared, original implementation. No third-party extension source or assets. */
(() => {
  'use strict';

  const defaults = Object.freeze({
    dock: 'left', width: 304, pinned: true, open: true,
    iconTheme: 'color', fontFamily: 'default', fontSize: 12,
    toggleShortcut: 'Shift+D', searchShortcut: 'Shift+S',
    pageScope: 'repository', hidePatterns: '', folderClick: true,
  });
  const fontFamilies = Object.freeze({
    default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'JetBrains Mono': '"JetBrains Mono", ui-monospace, monospace',
    'Fira Code': '"Fira Code", ui-monospace, monospace',
    'Cascadia Code': '"Cascadia Code", ui-monospace, monospace',
    'Source Code Pro': '"Source Code Pro", ui-monospace, monospace',
    Menlo: 'Menlo, ui-monospace, monospace',
    Consolas: 'Consolas, ui-monospace, monospace',
  });
  const paths = Object.freeze({
    tree: 'M5 3v14a3 3 0 0 0 3 3h7M5 8h10M15 5h5v6h-5zM15 17h5v6h-5zM2 1h6v4H2z',
    folder: 'M3 5h6l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5z',
    'folder-open': 'M3 18V5h6l2 2h8v3M3 20h16l3-10H6L3 20z',
    file: 'M5 3h9l5 5v13H5zM14 3v6h5',
    code: 'm9 8-4 4 4 4m6-8 4 4-4 4m-2-11-2 14',
    chevron: 'm9 5 7 7-7 7',
    branch: 'M6 7v10m0-5h6a6 6 0 0 0 6-6M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
    pr: 'M6 7v10m0-14a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4M15 4h2a3 3 0 0 1 3 3v10m-5-13 3-3m-3 3 3 3m2 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
    search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',
    bookmark: 'M6 3h12v19l-6-4-6 4z',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
    refresh: 'M20 11a8 8 0 1 0-2 6M20 3v8h-8',
    pin: 'm8 3 8 0-1 6 4 4H5l4-4zm4 10v8',
    close: 'm5 5 14 14M19 5 5 19',
    dock: 'M3 4h18v16H3zM9 4v16',
    external: 'M14 3h7v7m0-7-12 12M11 3H3v18h18v-8',
    collapse: 'M4 7h16M4 17h16m-12-5 4-3 4 3m-8 0 4 3 4-3',
    comment: 'M3 4h18v13H9l-6 4z',
    check: 'm5 12 4 4L20 5',
    diff: 'M5 3h14v18H5zM8 8h8m-4-3v6m-4 5h8',
    image: 'M3 3h18v18H3zm0 15 6-6 4 4 3-3 5 5M15 7h1',
    config: 'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h5',
    json: 'M5 3h9l5 5v13H5zM14 3v6h5M10 12H9v2l-1 2 1 2v2h1m4-8h1v2l1 2-1 2v2h-1',
    markdown: 'M4 3h11l5 5v13H4zM15 3v5h5M7 17v-5l2 3 2-3v5m5-5v5m-2-2 2 2 2-2',
    license: 'M5 3h9l5 5v13H5zM14 3v6h5m-7 3 3 1v3c0 2-3 3-3 3s-3-1-3-3v-3l3-1z',
    ignore: 'M5 3h9l5 5v13H5zM14 3v6h5M9 13l6 6m0-6-6 6',
    'file-code': 'M4 3h11l5 5v13H4zM15 3v5h5m-11 4-2 3 2 3m6-6 2 3-2 3m-2-6-2 6',
    book: 'M3 3h7l2 2 2-2h7v17h-7l-2 2-2-2H3zm9 2v17',
    arrow: 'm10 5-7 7 7 7M3 12h18',
    account: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-3a8 8 0 0 1 16 0v3',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  });
  function icon(name, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    if (className) svg.classList.add(className);
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[name] || paths.file);
    svg.append(path);
    return svg;
  }
  function normalizeOrigin(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
        (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash ||
        url.hostname === 'api.github.com') {
      throw new Error('Enter a GitHub or GitLab HTTPS website origin, for example https://gitlab.example.com.');
    }
    return url.origin;
  }
  function route(url, provider = 'github') {
    const parsed = new URL(url);
    let parts;
    try { parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return null; }
    if (provider === 'gitlab' || parsed.hostname === 'gitlab.com') {
      const separator = parts.indexOf('-');
      const project = separator < 0 ? parts : parts.slice(0, separator);
      if (project.length < 2 || project.some(part => !/^[\w.-]+$/.test(part)) ||
          ['users', 'groups', 'dashboard', 'explore', 'admin', 'help', 'search', 'oauth', 'profile', 'projects', 'assets'].includes(project[0])) return null;
      const result = {origin: parsed.origin, provider: 'gitlab', owner: project.slice(0, -1).join('/'), repo: project.at(-1), kind: 'repo', tail: '', path: ''};
      if (separator >= 0) {
        const view = parts[separator + 1];
        if (['tree', 'blob', 'blame', 'raw'].includes(view)) {
          result.kind = view; result.tail = parts.slice(separator + 2).join('/');
          if (parts[separator + 2]?.includes('/')) result.refHint = parts[separator + 2];
        }
        else if (view === 'merge_requests' && /^\d+$/.test(parts[separator + 2] || '')) { result.kind = 'pull'; result.number = Number(parts[separator + 2]); }
        else if (view === 'commit' && /^[a-f\d]{7,40}$/i.test(parts[separator + 2] || '')) { result.kind = 'commit'; result.sha = parts[separator + 2]; }
      }
      return result;
    }
    if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) return null;
    const reserved = new Set(['settings', 'orgs', 'users', 'login', 'signup', 'search', 'marketplace', 'features', 'topics', 'collections', 'sponsors', 'notifications', 'codespaces', 'enterprises', 'account', 'apps', 'organizations', 'site', 'explore', 'copilot']);
    if (reserved.has(parts[0])) return null;
    const result = {origin: parsed.origin, provider: 'github', owner: parts[0], repo: parts[1], kind: 'repo', tail: '', path: ''};
    if (['tree', 'blob', 'blame', 'raw'].includes(parts[2])) {
      result.kind = parts[2];
      result.tail = parts.slice(3).join('/');
    } else if (parts[2] === 'pull' && /^\d+$/.test(parts[3] || '')) {
      result.kind = 'pull'; result.number = Number(parts[3]);
    } else if (parts[2] === 'commit' && /^[a-f\d]{7,40}$/i.test(parts[3] || '')) {
      result.kind = 'commit'; result.sha = parts[3];
    }
    return result;
  }
  function repoURL(context) {
    return `${context.origin}/${pathURL(context.owner)}/${encodeURIComponent(context.repo)}`;
  }
  function pathURL(path) { return path.split('/').map(encodeURIComponent).join('/'); }
  function treeURL(context, ref) { return `${repoURL(context)}${context.provider === 'gitlab' ? '/-' : ''}/tree/${encodeURIComponent(ref)}`; }
  function blobURL(context, ref, path, type = 'blob') { return `${repoURL(context)}${context.provider === 'gitlab' ? '/-' : ''}/${type}/${encodeURIComponent(ref)}/${pathURL(path)}`; }
  function pullURL(context, number) { return `${repoURL(context)}/${context.provider === 'gitlab' ? '-/merge_requests' : 'pull'}/${number}`; }
  function fileKind(path) {
    const name = path.split('/').at(-1).toLowerCase();
    if (/\.(png|jpe?g|gif|svg|webp|ico|avif)$/.test(name)) return 'image';
    if (/^licen[cs]e(?:[.-]|$)/.test(name)) return 'license';
    if (/\.(md|mdx)$/.test(name) || /^readme(?:[.-]|$)/.test(name)) return 'markdown';
    if (name.endsWith('ignore')) return 'ignore';
    if (/\.(json|jsonc)$/.test(name)) return 'json';
    if (/\.(json|ya?ml|toml|ini|config|lock)$/.test(name) || name.startsWith('.')) return 'config';
    if (/\.(js|jsx|ts|tsx|dart|go|rs|py|rb|php|c|cpp|h|java|kt|swift|css|scss|html|sh)$/.test(name)) return 'code';
    return 'file';
  }
  function makeTree(entries) {
    const root = {path: '', name: '', type: 'tree', depth: 0, children: [], loaded: true, adds: 0, dels: 0, commentCount: 0};
    const nodes = new Map([['', root]]);
    function ensure(path, type = 'tree') {
      if (nodes.has(path)) return nodes.get(path);
      const index = path.lastIndexOf('/');
      const parentPath = index === -1 ? '' : path.slice(0, index);
      const parent = ensure(parentPath);
      const node = {path, name: path.slice(index + 1), type, depth: parent.depth + 1, children: [], loaded: true, adds: 0, dels: 0, commentCount: 0, search: path.toLowerCase()};
      nodes.set(path, node); parent.children.push(node);
      return node;
    }
    for (const entry of entries) {
      const path = entry.path || entry.filename;
      if (!path || path.split('/').some(part => !part || part === '.' || part === '..')) continue;
      const node = ensure(path, entry.type || 'blob');
      Object.assign(node, entry, {path, name: node.name, depth: node.depth});
      node.type = entry.type || 'blob';
      node.loaded = entry.loaded !== false;
      node.adds = entry.additions || 0; node.dels = entry.deletions || 0;
      node.commentCount = entry.comments?.length || 0;
    }
    const collator = new Intl.Collator('en', {numeric: true, sensitivity: 'base'});
    const sorted = Array.from(nodes.values()).sort((a, b) => b.depth - a.depth);
    for (const node of sorted) {
      node.children.sort((a, b) => Number(b.type === 'tree') - Number(a.type === 'tree') || collator.compare(a.name, b.name));
      if (node.path) {
        const parent = nodes.get(node.path.slice(0, Math.max(0, node.path.lastIndexOf('/'))));
        parent.adds += node.adds; parent.dels += node.dels; parent.commentCount += node.commentCount;
      }
    }
    return {root, nodes};
  }
  function flatten(tree, expanded, query = '') {
    const needle = query.trim().toLowerCase();
    let visible;
    if (needle) {
      visible = new Set();
      for (const node of tree.nodes.values()) {
        if (node.path && node.search.includes(needle)) {
          let path = node.path;
          while (path) {
            visible.add(path);
            const slash = path.lastIndexOf('/');
            path = slash === -1 ? '' : path.slice(0, slash);
          }
        }
      }
    }
    const output = [];
    const stack = [...tree.root.children].reverse();
    while (stack.length) {
      const node = stack.pop();
      if (visible && !visible.has(node.path)) continue;
      output.push(node);
      if (node.type === 'tree' && (needle || expanded.has(node.path))) {
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
      }
    }
    return output;
  }
  function lines(text) {
    if (!text) return [];
    const result = text.replace(/\r\n/g, '\n').split('\n');
    if (result.at(-1) === '') result.pop();
    return result;
  }
  function fullDiff(base, head, patch) {
    const before = lines(base); const after = lines(head);
    const rows = []; let oldIndex = 0; let newIndex = 0;
    const push = (type, text) => {
      if (typeof text !== 'string' || (type !== 'added' && oldIndex >= before.length) ||
          (type !== 'removed' && newIndex >= after.length) || rows.length >= before.length + after.length) {
        throw new Error('The patch exceeds these file revisions.');
      }
      const oldLine = type === 'added' ? null : ++oldIndex;
      const newLine = type === 'removed' ? null : ++newIndex;
      if ((oldLine && before[oldLine - 1] !== text) || (newLine && after[newLine - 1] !== text)) throw new Error('The patch does not match these file revisions.');
      rows.push({type, text, oldLine, newLine});
    };
    if (!patch) {
      if (base === head) { for (const text of before) push('context', text); return rows; }
      if (!before.length) { for (const text of after) push('added', text); return rows; }
      if (!after.length) { for (const text of before) push('removed', text); return rows; }
      throw new Error('The server did not return a complete text patch. Use the original diff.');
    }
    let hunk = null;
    const finish = () => {
      if (hunk && (hunk.old !== hunk.expectedOld || hunk.new !== hunk.expectedNew)) throw new Error('The server returned an incomplete patch.');
    };
    for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (match) {
        finish();
        const oldStart = Number(match[1]); const newStart = Number(match[3]);
        const expectedOld = Number(match[2] ?? 1); const expectedNew = Number(match[4] ?? 1);
        const startOld = oldStart - (expectedOld ? 1 : 0);
        const startNew = newStart - (expectedNew ? 1 : 0);
        if (![oldStart, newStart, expectedOld, expectedNew].every(Number.isSafeInteger) ||
            startOld < 0 || startNew < 0 || startOld > before.length || startNew > after.length ||
            expectedOld > before.length - startOld || expectedNew > after.length - startNew) {
          throw new Error('The patch range exceeds these file revisions.');
        }
        if (startOld < oldIndex || startNew < newIndex) throw new Error('Invalid patch ordering.');
        while (oldIndex < startOld) push('context', before[oldIndex]);
        if (newIndex !== startNew) throw new Error('The patch positions do not match these revisions.');
        hunk = {old: 0, new: 0, expectedOld, expectedNew};
      } else if (hunk && !line.startsWith('\\')) {
        if (line.startsWith(' ')) { push('context', line.slice(1)); hunk.old++; hunk.new++; }
        else if (line.startsWith('-')) { push('removed', line.slice(1)); hunk.old++; }
        else if (line.startsWith('+')) { push('added', line.slice(1)); hunk.new++; }
        else if (line !== '') throw new Error('Invalid text patch.');
      }
    }
    finish();
    while (oldIndex < before.length) push('context', before[oldIndex]);
    if (newIndex !== after.length) throw new Error('The server returned a truncated patch.');
    return rows;
  }
  function shortcuts(value) {
    if (typeof value !== 'string' || value.length > 512) throw new Error('Use at most eight shortcuts, separated by commas.');
    if (!value.trim()) return [];
    const aliases = {control: 'ctrl', command: 'meta', cmd: 'meta', option: 'alt', esc: 'escape', space: ' ', plus: '+', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright'};
    const bindings = value.split(',').map(text => {
      const parts = text.trim().toLowerCase().split('+').map(part => aliases[part.trim()] || part.trim());
      const key = parts.pop(); const modifiers = new Set(parts);
      if (!key || parts.length !== modifiers.size || parts.some(part => !['ctrl', 'meta', 'alt', 'shift', 'mod'].includes(part)) ||
          (modifiers.has('mod') && (modifiers.has('ctrl') || modifiers.has('meta'))) ||
          !(key.length === 1 || /^(?:arrow(?:up|down|left|right)|escape|enter|tab|backspace|delete|insert|home|end|pageup|pagedown|f(?:[1-9]|1\d))$/.test(key))) {
        throw new Error(`Invalid shortcut: ${text.trim()}. Use Ctrl, Cmd, Alt, Shift or Mod plus a key; write Space or Plus for those keys.`);
      }
      return {key, ctrl: modifiers.has('ctrl'), meta: modifiers.has('meta'), alt: modifiers.has('alt'), shift: modifiers.has('shift'), mod: modifiers.has('mod')};
    });
    if (bindings.length > 8) throw new Error('Use at most eight shortcuts per action.');
    return bindings;
  }
  function shortcutMatches(value, event) {
    return shortcuts(value).some(binding => binding.key === event.key.toLowerCase() && binding.alt === event.altKey && binding.shift === event.shiftKey &&
      (binding.mod ? event.ctrlKey !== event.metaKey : binding.ctrl === event.ctrlKey && binding.meta === event.metaKey));
  }
  function validateNavigation(value) {
    const toggle = shortcuts(value.toggleShortcut); const search = shortcuts(value.searchShortcut);
    for (const binding of toggle) {
      for (const ctrlKey of [false, true]) for (const metaKey of [false, true]) {
        const event = {key: binding.key, ctrlKey, metaKey, altKey: binding.alt, shiftKey: binding.shift};
        if (shortcutMatches(value.toggleShortcut, event) && search.length && shortcutMatches(value.searchShortcut, event)) throw new Error('Toggle and search shortcuts must be different.');
      }
    }
    if (typeof value.hidePatterns !== 'string' || value.hidePatterns.length > 16384 || value.hidePatterns.split('\n').filter(line => line.trim()).length > 64) {
      throw new Error('Use at most 64 URL patterns, one per line, within 16,384 characters.');
    }
  }
  function globMatch(pattern, text) {
    let index = 0; let position = 0; let star = -1; let retry = 0;
    while (position < text.length) {
      if (pattern[index] === '*') { star = index++; retry = position; }
      else if (pattern[index] === text[position]) { index++; position++; }
      else if (star >= 0) { index = star + 1; position = ++retry; }
      else return false;
    }
    while (pattern[index] === '*') index++;
    return index === pattern.length;
  }
  function pageVisible(url, context, value) {
    if (!context) return false;
    const parsed = new URL(url);
    if (value.hidePatterns.split('\n').some(pattern => pattern.trim() && globMatch(pattern.trim(), parsed.href.split('#')[0]))) return false;
    if (value.pageScope !== 'code' || context.kind !== 'repo') return true;
    const path = parsed.pathname.replace(/\/$/, ''); const root = new URL(repoURL(context)).pathname;
    return path === root || (context.provider === 'gitlab' ? ['/merge_requests', '/commits'].some(part => path === root + '/-' + part) : ['/pulls', '/commits'].some(part => path === root + part));
  }
  function preferences(value = {}) {
    let toggleShortcut = value.toggleShortcut ?? defaults.toggleShortcut; let searchShortcut = value.searchShortcut ?? defaults.searchShortcut;
    try { shortcuts(toggleShortcut); shortcuts(searchShortcut); } catch { toggleShortcut = defaults.toggleShortcut; searchShortcut = defaults.searchShortcut; }
    return {
      dock: value.dock === 'right' ? 'right' : 'left',
      width: Math.max(240, Math.min(600, Number(value.width) || defaults.width)),
      pinned: value.pinned !== false, open: value.open !== false,
      iconTheme: ['color', 'outline', 'minimal'].includes(value.iconTheme) ? value.iconTheme : defaults.iconTheme,
      fontFamily: Object.hasOwn(fontFamilies, value.fontFamily) ? value.fontFamily : defaults.fontFamily,
      fontSize: Math.max(10, Math.min(24, Number(value.fontSize) || defaults.fontSize)),
      toggleShortcut, searchShortcut,
      pageScope: value.pageScope === 'code' ? 'code' : 'repository',
      hidePatterns: typeof value.hidePatterns === 'string' ? value.hidePatterns.slice(0, 16384).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 64).join('\n') : '',
      folderClick: value.folderClick !== false,
    };
  }
  globalThis.CodeTree = Object.freeze({defaults, fontFamilies, icon, normalizeOrigin, route, repoURL, pathURL, treeURL, blobURL, pullURL, fileKind, makeTree, flatten, lines, fullDiff, preferences, shortcuts, shortcutMatches, validateNavigation, pageVisible});
})();
