/* Shared, original implementation. No Octotree source or assets. */
(() => {
  'use strict';

  const defaults = Object.freeze({
    dock: 'left', width: 304, pinned: true, open: true,
    iconTheme: 'color', fontFamily: 'default', fontSize: 12,
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
    folder: 'M3 6h6l2 2h10v12H3z',
    file: 'M5 3h9l5 5v13H5zM14 3v6h5',
    code: 'm9 8-4 4 4 4m6-8 4 4-4 4m-2-11-2 14',
    chevron: 'm9 5 7 7-7 7',
    branch: 'M6 5v13m0-6h7a5 5 0 0 0 5-5V5M3 2h6v6H3zM15 2h6v6h-6zM3 17h6v6H3z',
    pr: 'M6 7v10m0-13a3 3 0 1 0 0 .1m0 13a3 3 0 1 0 0 .1M14 4h3a3 3 0 0 1 3 3v10m-6-13 3-3m-3 3 3 3m3 10a3 3 0 1 0 0 .1',
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
    config: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
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
        if (['tree', 'blob', 'blame', 'raw'].includes(view)) { result.kind = view; result.tail = parts.slice(separator + 2).join('/'); }
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
    if (/\.(md|mdx|txt|rst)$/.test(name) || /^(license|readme)/.test(name)) return 'book';
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
        const expectedOld = Number(match[2] ?? 1); const expectedNew = Number(match[4] ?? 1);
        const startOld = Number(match[1]) - (expectedOld ? 1 : 0);
        const startNew = Number(match[3]) - (expectedNew ? 1 : 0);
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
  function preferences(value = {}) {
    return {
      dock: value.dock === 'right' ? 'right' : 'left',
      width: Math.max(240, Math.min(600, Number(value.width) || defaults.width)),
      pinned: value.pinned !== false, open: value.open !== false,
      iconTheme: ['color', 'outline', 'minimal'].includes(value.iconTheme) ? value.iconTheme : defaults.iconTheme,
      fontFamily: Object.hasOwn(fontFamilies, value.fontFamily) ? value.fontFamily : defaults.fontFamily,
      fontSize: Math.max(10, Math.min(24, Number(value.fontSize) || defaults.fontSize)),
    };
  }
  globalThis.CodeTree = Object.freeze({defaults, fontFamilies, icon, normalizeOrigin, route, repoURL, pathURL, treeURL, blobURL, pullURL, fileKind, makeTree, flatten, lines, fullDiff, preferences});
})();
