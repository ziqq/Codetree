/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * The repository tree model used by the virtualized sidebar.
 */

/**
 * Classifies a file for the Minimal icon style and as a fallback for
 * files without a file-icons rule.
 *
 * @param {string} path A repository path.
 * @returns {'image'|'license'|'markdown'|'ignore'|'json'|'config'|'code'|'file'}
 */
export function fileKind(path) {
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

/**
 * Builds a tree from flat API entries.
 *
 * Missing parent folders are created, entries with empty, `.` or `..`
 * segments are skipped, folders sort before files with natural ordering,
 * and folders aggregate the additions, deletions and comment counts of
 * their descendants.
 *
 * @param {Array<Object>} entries Entries with `path` (or `filename`), `type`
 *     and optional `additions`, `deletions`, `comments` and `loaded`.
 * @returns {{root: Object, nodes: Map<string, Object>}} The root node and every node by path.
 */
export function makeTree(entries) {
  const root = {
    path: '',
    name: '',
    type: 'tree',
    depth: 0,
    children: [],
    loaded: true,
    adds: 0,
    dels: 0,
    commentCount: 0,
  };
  const nodes = new Map([['', root]]);
  function ensure(path, type = 'tree') {
    if (nodes.has(path)) return nodes.get(path);
    const index = path.lastIndexOf('/');
    const parentPath = index === -1 ? '' : path.slice(0, index);
    const parent = ensure(parentPath);
    const node = {
      path,
      name: path.slice(index + 1),
      type,
      depth: parent.depth + 1,
      children: [],
      loaded: true,
      adds: 0,
      dels: 0,
      commentCount: 0,
      search: path.toLowerCase(),
    };
    nodes.set(path, node);
    parent.children.push(node);
    return node;
  }
  for (const entry of entries) {
    const path = entry.path || entry.filename;
    if (!path || path.split('/').some(part => !part || part === '.' || part === '..')) continue;
    const node = ensure(path, entry.type || 'blob');
    Object.assign(node, entry, {path, name: node.name, depth: node.depth});
    node.type = entry.type || 'blob';
    node.loaded = entry.loaded !== false;
    node.adds = entry.additions || 0;
    node.dels = entry.deletions || 0;
    node.commentCount = entry.comments?.length || 0;
  }
  const collator = new Intl.Collator('en', {numeric: true, sensitivity: 'base'});
  const sorted = Array.from(nodes.values()).sort((a, b) => b.depth - a.depth);
  for (const node of sorted) {
    node.children.sort(
      (a, b) => Number(b.type === 'tree') - Number(a.type === 'tree') || collator.compare(a.name, b.name),
    );
    if (node.path) {
      const parent = nodes.get(node.path.slice(0, Math.max(0, node.path.lastIndexOf('/'))));
      parent.adds += node.adds;
      parent.dels += node.dels;
      parent.commentCount += node.commentCount;
    }
  }
  return {root, nodes};
}

/**
 * Returns the visible rows of [tree] in display order.
 *
 * Without a query only children of expanded folders are visible. With a
 * query every matching node and all of its ancestors are visible,
 * regardless of expansion.
 *
 * @param {{root: Object, nodes: Map<string, Object>}} tree A tree from [makeTree].
 * @param {Set<string>} expanded Paths of expanded folders.
 * @param {string} [query=''] Case-insensitive path search.
 * @returns {Array<Object>}
 */
export function flatten(tree, expanded, query = '') {
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
