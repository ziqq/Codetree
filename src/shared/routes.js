/* Repository routes and URLs. Shared, original implementation. */

export function normalizeOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash ||
      url.hostname === 'api.github.com') {
    throw new Error('Enter a GitHub or GitLab HTTPS website origin, for example https://gitlab.example.com.');
  }
  return url.origin;
}

export function route(url, provider = 'github') {
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

export function repoURL(context) {
  return `${context.origin}/${pathURL(context.owner)}/${encodeURIComponent(context.repo)}`;
}
export function pathURL(path) { return path.split('/').map(encodeURIComponent).join('/'); }
export function treeURL(context, ref) { return `${repoURL(context)}${context.provider === 'gitlab' ? '/-' : ''}/tree/${encodeURIComponent(ref)}`; }
export function blobURL(context, ref, path, type = 'blob') { return `${repoURL(context)}${context.provider === 'gitlab' ? '/-' : ''}/${type}/${encodeURIComponent(ref)}/${pathURL(path)}`; }
export function pullURL(context, number) { return `${repoURL(context)}/${context.provider === 'gitlab' ? '-/merge_requests' : 'pull'}/${number}`; }
