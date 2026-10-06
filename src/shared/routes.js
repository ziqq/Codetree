/**
 * Repository routes and URLs for GitHub and GitLab.
 *
 * Pure functions shared by the service worker, the content script and
 * Settings. A *context* is the parsed route of a repository page:
 * `{origin, provider, owner, repo, kind, tail, path, number?, sha?, refHint?}`,
 * where `kind` is `repo`, `tree`, `blob`, `blame`, `raw`, `pull` or `commit`.
 *
 * @module shared/routes
 */

/**
 * Validates a repository website origin entered in Settings.
 *
 * Only bare HTTPS origins are accepted: no credentials, path, query or
 * fragment, and never the GitHub API host.
 *
 * @param {string} value A URL such as `https://gitlab.example.com`.
 * @returns {string} The normalized origin.
 * @throws {Error} If the value is not an acceptable HTTPS origin.
 */
export function normalizeOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash ||
    url.hostname === 'api.github.com'
  ) {
    throw new Error('Enter a GitHub or GitLab HTTPS website origin, for example https://gitlab.example.com.');
  }
  return url.origin;
}

/**
 * Parses a repository page URL into a context.
 *
 * GitHub paths are `/<owner>/<repo>/<view>/…`; reserved top-level paths
 * (settings, organizations, search, …) are not repositories. GitLab paths
 * may contain nested namespaces and separate the project from the view
 * with `/-/`. A `/` inside the first tail segment of a GitLab URL is kept
 * as `refHint`, because branch names may contain slashes.
 *
 * @param {string} url The page URL.
 * @param {'github'|'gitlab'} [provider='github'] Provider of the page origin.
 * @returns {?Object} The context, or `null` when the page is not a repository.
 */
export function route(url, provider = 'github') {
  const parsed = new URL(url);
  let parts;
  try {
    parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (provider === 'gitlab' || parsed.hostname === 'gitlab.com') {
    const separator = parts.indexOf('-');
    const project = separator < 0 ? parts : parts.slice(0, separator);
    if (
      project.length < 2 ||
      project.some(part => !/^[\w.-]+$/.test(part)) ||
      [
        'users',
        'groups',
        'dashboard',
        'explore',
        'admin',
        'help',
        'search',
        'oauth',
        'profile',
        'projects',
        'assets',
      ].includes(project[0])
    )
      return null;
    const result = {
      origin: parsed.origin,
      provider: 'gitlab',
      owner: project.slice(0, -1).join('/'),
      repo: project.at(-1),
      kind: 'repo',
      tail: '',
      path: '',
    };
    if (separator >= 0) {
      const view = parts[separator + 1];
      if (['tree', 'blob', 'blame', 'raw'].includes(view)) {
        result.kind = view;
        result.tail = parts.slice(separator + 2).join('/');
        if (parts[separator + 2]?.includes('/')) result.refHint = parts[separator + 2];
      } else if (view === 'merge_requests' && /^\d+$/.test(parts[separator + 2] || '')) {
        result.kind = 'pull';
        result.number = Number(parts[separator + 2]);
      } else if (view === 'commit' && /^[a-f\d]{7,40}$/i.test(parts[separator + 2] || '')) {
        result.kind = 'commit';
        result.sha = parts[separator + 2];
      }
    }
    return result;
  }
  if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) return null;
  const reserved = new Set([
    'settings',
    'orgs',
    'users',
    'login',
    'signup',
    'search',
    'marketplace',
    'features',
    'topics',
    'collections',
    'sponsors',
    'notifications',
    'codespaces',
    'enterprises',
    'account',
    'apps',
    'organizations',
    'site',
    'explore',
    'copilot',
  ]);
  if (reserved.has(parts[0])) return null;
  const result = {
    origin: parsed.origin,
    provider: 'github',
    owner: parts[0],
    repo: parts[1],
    kind: 'repo',
    tail: '',
    path: '',
  };
  if (['tree', 'blob', 'blame', 'raw'].includes(parts[2])) {
    result.kind = parts[2];
    result.tail = parts.slice(3).join('/');
  } else if (parts[2] === 'pull' && /^\d+$/.test(parts[3] || '')) {
    result.kind = 'pull';
    result.number = Number(parts[3]);
  } else if (parts[2] === 'commit' && /^[a-f\d]{7,40}$/i.test(parts[3] || '')) {
    result.kind = 'commit';
    result.sha = parts[3];
  }
  return result;
}

/**
 * Returns the repository home page URL for [context].
 *
 * @param {Object} context A repository context.
 * @returns {string}
 */
export function repoURL(context) {
  return `${context.origin}/${pathURL(context.owner)}/${encodeURIComponent(context.repo)}`;
}

/**
 * Percent-encodes every segment of a slash-separated path.
 *
 * @param {string} path A repository path or namespace.
 * @returns {string}
 */
export function pathURL(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Returns the URL of the repository root at [ref].
 *
 * @param {Object} context A repository context.
 * @param {string} ref A branch, tag or commit.
 * @returns {string}
 */
export function treeURL(context, ref) {
  return `${repoURL(context)}${context.provider === 'gitlab' ? '/-' : ''}/tree/${encodeURIComponent(ref)}`;
}

/**
 * Returns the URL of a file (`blob`) or folder (`tree`) at [ref].
 *
 * @param {Object} context A repository context.
 * @param {string} ref A branch, tag or commit.
 * @param {string} path The repository path.
 * @param {'blob'|'tree'} [type='blob'] The provider view.
 * @returns {string}
 */
export function blobURL(context, ref, path, type = 'blob') {
  return `${repoURL(context)}${context.provider === 'gitlab' ? '/-' : ''}/${type}/${encodeURIComponent(ref)}/${pathURL(path)}`;
}

/**
 * Returns the URL of a pull request (GitHub) or merge request (GitLab).
 *
 * @param {Object} context A repository context.
 * @param {number} number The request number (`iid` on GitLab).
 * @returns {string}
 */
export function pullURL(context, number) {
  return `${repoURL(context)}/${context.provider === 'gitlab' ? '-/merge_requests' : 'pull'}/${number}`;
}
