'use strict';
importScripts('core.js');
importScripts('gitlab.js');

const C = globalThis.CodeTree;
const cache = new Map();
const pending = new Map();
let cacheBytes = 0;
let writes = Promise.resolve();
const storageReady = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});

async function readStore() {
  await storageReady;
  return chrome.storage.local.get(['preferences', 'accounts', 'selectedAccounts', 'bookmarks', 'localViewed']);
}
function writeStore(callback) {
  const result = writes.then(async () => {
    const current = await readStore();
    const update = await callback(current);
    await chrome.storage.local.set(update);
    return update;
  });
  writes = result.catch(() => {});
  return result;
}
function putCache(key, value, ttl) {
  const size = JSON.stringify(value).length * 2;
  if (size > 8 * 1024 * 1024) return;
  if (cache.has(key)) { cacheBytes -= cache.get(key).size; cache.delete(key); }
  while (cache.size && (cacheBytes + size > 12 * 1024 * 1024 || cache.size >= 80)) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).size; cache.delete(oldest);
  }
  cache.set(key, {value, expires: Date.now() + ttl, size}); cacheBytes += size;
}
function clearCache() { cache.clear(); cacheBytes = 0; }
async function memo(key, ttl, callback, fresh = false) {
  const hit = cache.get(key);
  if (!fresh && hit?.expires > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key);
  const promise = callback().then(value => { putCache(key, value, ttl); return value; }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
function origins(store) {
  return new Set(['https://github.com', 'https://gitlab.com', ...(store.accounts || []).map(account => account.origin)]);
}
function providerFor(origin, store) {
  if (origin === 'https://github.com') return 'github';
  if (origin === 'https://gitlab.com') return 'gitlab';
  return (store.accounts || []).find(account => account.origin === origin)?.provider || 'github';
}
function validateContext(value, store) {
  if (!value || !origins(store).has(value.origin) || typeof value.owner !== 'string' || typeof value.repo !== 'string' ||
      !/^[\w.-]+(?:\/[\w.-]+)*$/.test(value.owner) || !/^[\w.-]+$/.test(value.repo) ||
      value.owner.split('/').some(part => part === '.' || part === '..') || value.repo === '.' || value.repo === '..') {
    throw new Error('This repository host is not enabled.');
  }
  const provider = providerFor(value.origin, store);
  if ((value.provider && value.provider !== provider) || (provider === 'github' && value.owner.includes('/'))) throw new Error('Invalid repository provider.');
  return {...value, provider};
}
function accountFor(context, store) {
  const accounts = (store.accounts || []).filter(account => account.origin === context.origin);
  const selected = store.selectedAccounts?.[context.origin];
  if (selected && selected !== 'auto') return accounts.find(account => account.id === selected) || null;
  if (context.viewer) return accounts.find(account => account.login.toLowerCase() === context.viewer.toLowerCase()) || null;
  return accounts.length === 1 ? accounts[0] : null;
}
function client(context, store, override) {
  const account = override || accountFor(context, store);
  const origin = context.origin;
  const provider = context.provider || account?.provider || providerFor(origin, store);
  const label = provider === 'gitlab' ? 'GitLab' : 'GitHub';
  const base = provider === 'gitlab' ? `${origin}/api/v4` : origin === 'https://github.com' ? 'https://api.github.com' : `${origin}/api/v3`;
  const graph = origin === 'https://github.com' ? 'https://api.github.com/graphql' : `${origin}/api/graphql`;
  const prefix = `/${account?.id || 'anonymous'}:${origin}`;
  async function request(path, {method = 'GET', body, raw = false} = {}) {
    const url = path === '@graphql' ? graph : base + path;
    if (path !== '@graphql' && (!path.startsWith('/') || path.startsWith('//'))) throw new Error('Invalid API path.');
    const headers = {Accept: provider === 'gitlab' ? raw ? 'text/plain' : 'application/json' : raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'};
    if (account?.token) headers.Authorization = `Bearer ${account.token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(25000)});
    if (!response.ok) {
      const fail = message => { const error = new Error(message); error.status = response.status; throw error; };
      let message = '';
      try { message = (await response.json()).message || ''; } catch { /* Non-JSON errors use the status message below. */ }
      if (response.status === 401) fail(account ? `${label} rejected this token. Update the account in Settings.` : `${label} requires an account for this operation. Add a token in Settings.`);
      if ((response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') || response.status === 429) {
        const reset = Number(response.headers.get('X-RateLimit-Reset'));
        fail(`${label} API rate limit reached.${reset ? ` Resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : ''} Add an account or retry later.`);
      }
      if (response.status === 404) fail('Repository, branch, API endpoint or file not found. For a private repository, check the token permissions and organization SSO.');
      fail(`${label} API ${response.status}${message ? `: ${String(message).slice(0, 250)}` : ''}`);
    }
    if (raw) {
      if (Number(response.headers.get('Content-Length')) > 2 * 1024 * 1024) throw new Error(`This file exceeds the 2 MiB text preview limit. Open it on ${label}.`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 2 * 1024 * 1024) throw new Error(`This file exceeds the 2 MiB text preview limit. Open it on ${label}.`);
      const bytes = new Uint8Array(buffer);
      if (bytes.includes(0)) throw new Error(`Binary files cannot be shown as a text diff. Open the file on ${label}.`);
      try { return {data: new TextDecoder('utf-8', {fatal: true}).decode(bytes), next: false}; }
      catch { throw new Error(`This file is not UTF-8 text. Open the file on ${label}.`); }
    }
    return {data: await response.json(), next: /rel="next"/.test(response.headers.get('Link') || '') || Number(response.headers.get('X-Next-Page')) > 0};
  }
  async function json(path, ttl = 30000, fresh = false) {
    return memo(prefix + path, ttl, async () => (await request(path)).data, fresh);
  }
  async function pages(path, property = null) {
    const list = [];
    for (let page = 1; page <= 100; page++) {
      const {data, next} = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const values = property ? data[property] : data;
      if (!Array.isArray(values)) throw new Error(`${label} returned an unexpected list response.`);
      list.push(...values);
      if (!next) return list;
    }
    throw new Error(`This list exceeds 10,000 results. ${label} did not return a complete list.`);
  }
  async function graphql(query, variables) {
    if (!account) throw new Error('Add a GitHub account in Settings to use this review filter.');
    const {data} = await request('@graphql', {method: 'POST', body: {query, variables}});
    if (data.errors?.length) throw new Error(data.errors.map(error => error.message).join('; ').slice(0, 350));
    return data.data;
  }
  return {account, provider, prefix, request, json, pages, graphql};
}
function repoPath(context) { return `/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}`; }
function number(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid pull request number.');
  return value;
}
function sha(value) {
  if (!/^[a-f\d]{7,40}$/i.test(value || '')) throw new Error('Invalid commit or tree SHA.');
  return value;
}
function filePath(value) {
  if (typeof value !== 'string' || !value || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid file path.');
  return C.pathURL(value);
}
function publicState(store) {
  return {
    preferences: C.preferences(store.preferences),
    accounts: (store.accounts || []).map(({id, origin, login, label}) => ({id, origin, login, label, provider: providerFor(origin, store)})),
    hosts: [...origins(store)].map(origin => ({origin, provider: providerFor(origin, store)})),
    selectedAccounts: store.selectedAccounts || {},
    bookmarks: store.bookmarks || [],
  };
}
async function initialize(context, api) {
  const root = repoPath(context);
  const repository = await api.json(root, 60000);
  let ref = repository.default_branch;
  if (context.tail) {
    if (context.refHint && (context.tail === context.refHint || context.tail.startsWith(context.refHint + '/'))) ref = context.refHint;
    else if (context.tail === ref || context.tail.startsWith(ref + '/')) { /* Keep the matching default branch. */ }
    else {
      const first = context.tail.split('/')[0];
      if (/^[a-f\d]{40}$/i.test(first)) ref = first;
      else {
        const candidates = [];
        for (const type of ['heads', 'tags']) {
          try {
            const refs = await api.json(`${root}/git/matching-refs/${type}/${encodeURIComponent(first)}`, 60000);
            for (const item of refs) {
              const name = item.ref.slice(`refs/${type}/`.length);
              if (context.tail === name || context.tail.startsWith(name + '/')) candidates.push(name);
            }
          } catch { /* A ref namespace may be unavailable; the commit lookup validates the fallback. */ }
        }
        ref = candidates.sort((a, b) => b.length - a.length)[0] || first;
      }
    }
  }
  let commit;
  try { commit = await api.json(`${root}/commits/${encodeURIComponent(ref)}?per_page=1`, 60000); }
  catch (error) {
    if (repository.size === 0 && /empty/i.test(error.message)) return {
      repository: {name: repository.name, full_name: repository.full_name, default_branch: ref, private: repository.private, empty: true},
      ref, commitSha: null, treeSha: null, path: '', account: api.account?.login || null,
    };
    throw error;
  }
  return {
    repository: {name: repository.name, full_name: repository.full_name, default_branch: repository.default_branch, private: repository.private, empty: repository.size === 0},
    ref, commitSha: commit.sha, treeSha: commit.commit.tree.sha,
    path: context.tail ? context.tail.slice(ref.length).replace(/^\//, '') : '',
    account: api.account?.login || null,
  };
}
const viewedQuery = `query CodeTreeViewed($owner:String!,$repo:String!,$number:Int!,$after:String) {
  repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
    files(first:100,after:$after) { nodes { path viewerViewedState } pageInfo { hasNextPage endCursor } }
  } }
}`;
async function viewedFiles(context, api) {
  const output = {}; let after = null;
  for (let page = 0; page < 100; page++) {
    const result = await api.graphql(viewedQuery, {owner: context.owner, repo: context.repo, number: context.number, after});
    const files = result.repository?.pullRequest?.files;
    if (!files) throw new Error('Viewed-file status is unavailable.');
    for (const file of files.nodes) output[file.path] = file.viewerViewedState;
    if (!files.pageInfo.hasNextPage) return output;
    after = files.pageInfo.endCursor;
  }
  throw new Error('Viewed-file status exceeds the pagination limit.');
}
async function getDiff(context, api, store, fresh) {
  const root = repoPath(context);
  if (context.kind === 'commit') {
    const revision = sha(context.sha);
    return memo(`${api.prefix}${root}:commit-diff:${revision}`, 60000, async () => {
      const commit = await api.json(`${root}/commits/${revision}?per_page=1`, 60000, fresh);
      const [files, comments] = await Promise.all([
        api.pages(`${root}/commits/${revision}`, 'files'), api.pages(`${root}/commits/${revision}/comments`),
      ]);
      return {files, comments, title: commit.commit.message.split('\n')[0], number: null,
        base: {owner: context.owner, repo: context.repo, sha: commit.parents[0]?.sha || null},
        head: {owner: context.owner, repo: context.repo, sha: commit.sha},
        viewed: {}, viewedMode: 'none', warnings: commit.parents.length > 1 ? ['Merge commit: changes are relative to the first parent.'] : [],
      };
    }, fresh);
  }
  const pullNumber = number(context.number);
  const pull = await api.json(`${root}/pulls/${pullNumber}`, 15000, fresh);
  const diff = await memo(`${api.prefix}${root}:pull-diff:${pullNumber}:${pull.head.sha}:${pull.base.sha}`, 30000, async () => {
    const [files, comments, comparison] = await Promise.all([
      api.pages(`${root}/pulls/${pullNumber}/files`), api.pages(`${root}/pulls/${pullNumber}/comments`),
      api.json(`${root}/compare/${encodeURIComponent(pull.base.sha)}...${encodeURIComponent(pull.head.sha)}?per_page=1`, 30000),
    ]);
    const latest = await api.json(`${root}/pulls/${pullNumber}`, 1000, true);
    if (latest.head.sha !== pull.head.sha || latest.base.sha !== pull.base.sha) throw new Error('The pull request changed while loading. Refresh to review the latest revision.');
    const warnings = [];
    if (files.length < pull.changed_files) warnings.push(`GitHub returned ${files.length} of ${pull.changed_files} changed files. Its PR files API is limited to 3,000 files.`);
    const baseRepo = pull.base.repo;
    const headRepo = pull.head.repo || baseRepo;
    return {files, comments, title: pull.title, number: pullNumber, nodeId: pull.node_id,
      base: {owner: baseRepo.owner.login, repo: baseRepo.name, sha: comparison.merge_base_commit.sha},
      head: {owner: headRepo.owner.login, repo: headRepo.name, sha: pull.head.sha}, warnings};
  }, fresh);
  let viewed = {}; let viewedMode = 'local'; const warnings = [...diff.warnings];
  if (api.account) {
    try { viewed = await viewedFiles(context, api); viewedMode = 'github'; }
    catch { warnings.push('GitHub viewed-file status is unavailable with this token or server. Viewed marks are stored locally.'); }
  }
  if (viewedMode === 'local') viewed = store.localViewed?.[`${api.prefix}:${root}:${pullNumber}:${pull.head.sha}`] || {};
  return {...diff, viewed, viewedMode};
}
const pullsQuery = `query CodeTreePulls($owner:String!,$repo:String!,$login:String!,$after:String) {
  viewer { login }
  repository(owner:$owner,name:$repo) { pullRequests(states:OPEN,first:100,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}) {
    nodes { number title url isDraft updatedAt author { login } reviewDecision
      submittedReviews: reviews(first:1,states:[APPROVED,CHANGES_REQUESTED,COMMENTED]) { totalCount }
      myReviews: reviews(first:1,author:$login,states:[APPROVED,CHANGES_REQUESTED,COMMENTED,DISMISSED]) { totalCount }
      reviewRequests(first:100) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
    } pageInfo { hasNextPage endCursor }
  } }
}`;
async function listPulls(context, api, filter) {
  const root = repoPath(context);
  const allowed = ['all', 'awaiting', 'reviewed', 'changes', 'approved', 'unreviewed'];
  if (!allowed.includes(filter)) filter = 'all';
  let data;
  if (api.account) {
    try {
      data = await memo(`${api.prefix}${root}:pull-list-graphql`, 30000, async () => {
        const pulls = []; let after = null;
        for (let page = 0; page < 100; page++) {
          const result = await api.graphql(pullsQuery, {owner: context.owner, repo: context.repo, login: api.account.login, after});
          const connection = result.repository?.pullRequests;
          if (!connection) throw new Error('Pull requests are unavailable.');
          for (const item of connection.nodes) pulls.push({number: item.number, title: item.title, html_url: item.url, draft: item.isDraft,
            user: item.author, updated_at: item.updatedAt, decision: item.reviewDecision,
            reviewCount: item.submittedReviews.totalCount, myReviewCount: item.myReviews.totalCount,
            requested_reviewers: item.reviewRequests.nodes.map(node => node.requestedReviewer).filter(Boolean)});
          if (!connection.pageInfo.hasNextPage) return pulls;
          after = connection.pageInfo.endCursor;
        }
        throw new Error('The pull request list exceeds the pagination limit.');
      });
    } catch (error) {
      if (filter !== 'all') throw new Error(`Review filters are unavailable: ${error.message}`, {cause: error});
    }
  }
  if (!data) {
    if (filter !== 'all') throw new Error('Connect a GitHub token with Pull requests read permission to use review-state filters.');
    data = await memo(`${api.prefix}${root}:pull-list`, 30000, () => api.pages(`${root}/pulls?state=open&sort=updated&direction=desc`));
  }
  const login = api.account?.login;
  // Repositories without required reviews can have a null GraphQL decision.
  // In those repositories derive the review filter from current individual reviews.
  if (filter === 'approved' || filter === 'changes') {
    data = data.map(pull => ({...pull}));
    const undecided = data.filter(pull => !pull.decision && pull.reviewCount);
    for (let offset = 0; offset < undecided.length; offset += 4) {
      await Promise.all(undecided.slice(offset, offset + 4).map(async pull => {
        const reviews = await memo(`${api.prefix}${root}:reviews:${pull.number}`, 30000, () => api.pages(`${root}/pulls/${pull.number}/reviews`));
        const latest = new Map();
        for (const review of reviews) {
          if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED') latest.set(review.user?.login || String(review.user?.id), review.state);
        }
        const states = [...latest.values()];
        pull.decision = states.includes('CHANGES_REQUESTED') ? 'CHANGES_REQUESTED' : states.includes('APPROVED') ? 'APPROVED' : null;
      }));
    }
  }
  return {pulls: data.filter(pull => {
    if (filter === 'awaiting') return pull.requested_reviewers.some(user => user.login === login);
    if (filter === 'reviewed') return pull.myReviewCount > 0;
    if (filter === 'changes') return pull.decision === 'CHANGES_REQUESTED';
    if (filter === 'approved') return pull.decision === 'APPROVED';
    if (filter === 'unreviewed') return !pull.reviewCount;
    return true;
  }), total: data.length, authenticated: Boolean(api.account)};
}
async function registerEnterpriseScripts() {
  const store = await readStore();
  const hosts = [...origins(store)].filter(origin => !['https://github.com', 'https://gitlab.com'].includes(origin));
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const obsolete = existing.filter(script => script.id.startsWith('codetree-')).map(script => script.id);
  if (obsolete.length) await chrome.scripting.unregisterContentScripts({ids: obsolete});
  for (let index = 0; index < hosts.length; index++) {
    if (await chrome.permissions.contains({origins: [`${hosts[index]}/*`]})) {
      await chrome.scripting.registerContentScripts([{id: `codetree-${index}`, matches: [`${hosts[index]}/*`], js: ['core.js', 'content.js'], runAt: 'document_idle', persistAcrossSessions: true}]);
    }
  }
}
async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('Invalid request.');
  const store = await readStore();
  const isOptions = sender.url === chrome.runtime.getURL('options.html');
  let senderOrigin;
  try { senderOrigin = new URL(sender.url || '').origin; } catch { /* Invalid senders are rejected by the origin check below. */ }
  if (!isOptions && (!sender.tab || !origins(store).has(senderOrigin))) throw new Error('This page cannot access extension data.');
  if (message.type === 'STATE') return publicState(store);
  if (message.type === 'OPTIONS') { await chrome.runtime.openOptionsPage(); return true; }
  if (message.type === 'PREFERENCES') {
    const update = await writeStore(current => ({preferences: C.preferences({...C.preferences(current.preferences), ...message.value})}));
    return update.preferences;
  }
  if (message.type === 'SELECT_ACCOUNT') {
    if (message.origin !== senderOrigin && !isOptions) throw new Error('Invalid account host.');
    if (message.id !== 'auto' && !(store.accounts || []).some(account => account.id === message.id && account.origin === message.origin)) throw new Error('Account not found.');
    await writeStore(current => ({selectedAccounts: {...current.selectedAccounts, [message.origin]: message.id}}));
    clearCache(); return true;
  }
  if (message.type === 'ADD_ACCOUNT' || message.type === 'REMOVE_ACCOUNT') {
    if (!isOptions) throw new Error('Accounts can only be changed in the extension settings.');
    if (message.type === 'ADD_ACCOUNT') {
      const origin = C.normalizeOrigin(message.origin);
      const provider = message.provider === 'gitlab' ? 'gitlab' : 'github';
      if ((origin === 'https://github.com' || origin === 'https://gitlab.com' || (store.accounts || []).some(account => account.origin === origin)) && providerFor(origin, store) !== provider) throw new Error('This host is connected to another repository provider.');
      if (typeof message.token !== 'string' || !message.token || /\s/.test(message.token)) throw new Error('Enter a valid personal access token.');
      if (!(await chrome.permissions.contains({origins: [`${origin === 'https://github.com' ? 'https://api.github.com' : origin}/*`]}))) throw new Error('Grant browser access to this repository host first.');
      const temporary = {id: crypto.randomUUID(), origin, provider, token: message.token};
      const user = await client({origin, provider}, store, temporary).json('/user', 0, true);
      const login = provider === 'gitlab' ? user.username : user.login;
      if (!login) throw new Error('The server did not return an account username.');
      await writeStore(current => {
        const accounts = [...(current.accounts || [])];
        const index = accounts.findIndex(account => account.origin === origin && account.login === login);
        const account = {...temporary, id: index === -1 ? temporary.id : accounts[index].id, login, label: String(message.label || login).slice(0, 60)};
        if (index === -1) accounts.push(account); else accounts[index] = account;
        return {accounts};
      });
    } else {
      await writeStore(current => {
        const accounts = (current.accounts || []).filter(account => account.id !== message.id);
        const selectedAccounts = {...current.selectedAccounts};
        for (const origin of Object.keys(selectedAccounts)) if (selectedAccounts[origin] === message.id) selectedAccounts[origin] = 'auto';
        return {accounts, selectedAccounts};
      });
    }
    clearCache(); await registerEnterpriseScripts(); return publicState(await readStore());
  }
  if (message.type === 'BOOKMARK') {
    const update = await writeStore(current => {
      const bookmarks = [...(current.bookmarks || [])];
      if (message.remove) return {bookmarks: bookmarks.filter(item => item.id !== message.remove)};
      const url = new URL(message.url);
      if (!origins(current).has(url.origin) || url.username || url.password) throw new Error('Only enabled repository hosts can be bookmarked.');
      if (!bookmarks.some(item => item.url === url.href)) bookmarks.unshift({id: crypto.randomUUID(), url: url.href, title: String(message.title || url.pathname).slice(0, 180), created: Date.now()});
      return {bookmarks};
    });
    return update.bookmarks;
  }
  const context = validateContext(message.context, store);
  if (context.origin !== senderOrigin) throw new Error('A page can only request its own repository host.');
  const api = client(context, store);
  if (context.provider === 'gitlab') {
    const adapter = globalThis.CodeTreeGitLab;
    const root = adapter.projectPath(context);
    switch (message.type) {
      case 'INIT': return adapter.initialize(context, api);
      case 'TREE': return memo(`${api.prefix}${root}:tree:${message.sha}:${message.path || ''}`, 5 * 60000, () => adapter.tree(context, api, message), message.fresh);
      case 'BRANCHES': return memo(`${api.prefix}${root}:branches`, 60000, () => api.pages(`${root}/repository/branches`));
      case 'PULLS': return adapter.pulls(context, api, memo, message.filter || 'all');
      case 'DIFF': {
        const diff = await adapter.diff(context, api, memo, message.fresh);
        if (context.kind === 'commit') return diff;
        return {...diff, viewed: store.localViewed?.[`${api.prefix}:${root}:${context.number}:${diff.head.sha}`] || {}, viewedMode: 'local'};
      }
      case 'FILE': return memo(`${api.prefix}:file:${message.source?.project}:${message.source?.sha}:${message.path}`, 60000, () => adapter.source(api, message));
      case 'VIEWED': {
        if (context.kind !== 'pull') throw new Error('Viewed marks are available on merge requests.');
        const diff = await adapter.diff(context, api, memo, false);
        if (!diff.files.some(file => file.filename === message.path)) throw new Error('This file is not part of the merge request.');
        const state = message.viewed ? 'VIEWED' : 'UNVIEWED';
        const key = `${api.prefix}:${root}:${context.number}:${diff.head.sha}`;
        await writeStore(current => {
          const localViewed = {...current.localViewed, [key]: {...current.localViewed?.[key], [message.path]: state}};
          const keys = Object.keys(localViewed);
          while (keys.length > 50) delete localViewed[keys.shift()];
          return {localViewed};
        });
        return {state, mode: 'local'};
      }
      case 'REFRESH': clearCache(); return true;
      default: throw new Error('Unknown extension request.');
    }
  }
  const root = repoPath(context);
  switch (message.type) {
    case 'INIT': return initialize(context, api);
    case 'TREE': {
      const result = await api.json(`${root}/git/trees/${sha(message.sha)}${message.recursive !== false ? '?recursive=1' : ''}`, 5 * 60000, message.fresh);
      if (result.truncated && message.recursive !== false) {
        const shallow = await api.json(`${root}/git/trees/${sha(message.sha)}`, 5 * 60000, message.fresh);
        return {entries: shallow.tree.map(item => ({...item, loaded: item.type !== 'tree'})), lazy: true};
      }
      return {entries: result.tree.map(item => ({...item, loaded: !message.lazyChildren || item.type !== 'tree'})), lazy: false};
    }
    case 'BRANCHES': return memo(`${api.prefix}${root}:branches`, 60000, () => api.pages(`${root}/branches`));
    case 'PULLS': return listPulls(context, api, message.filter || 'all');
    case 'DIFF': return getDiff(context, api, store, message.fresh);
    case 'FILE': {
      const owner = String(message.source?.owner || ''); const repo = String(message.source?.repo || '');
      if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error('Invalid source repository.');
      if (!message.source.sha) return '';
      const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath(message.path)}?ref=${sha(message.source.sha)}`;
      return memo(api.prefix + ':raw:' + path, 60000, async () => (await api.request(path, {raw: true})).data);
    }
    case 'VIEWED': {
      number(context.number); filePath(message.path);
      const diff = await getDiff(context, api, store, false);
      if (!diff.files.some(file => file.filename === message.path)) throw new Error('This file is not part of the pull request.');
      const state = message.viewed ? 'VIEWED' : 'UNVIEWED';
      if (diff.viewedMode === 'github') {
        const mutation = message.viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed';
        const type = message.viewed ? 'MarkFileAsViewedInput' : 'UnmarkFileAsViewedInput';
        await api.graphql(`mutation CodeTreeViewed($input:${type}!) { ${mutation}(input:$input) { clientMutationId } }`, {input: {pullRequestId: diff.nodeId, path: message.path}});
      } else {
        const key = `${api.prefix}:${root}:${context.number}:${diff.head.sha}`;
        await writeStore(current => {
          const localViewed = {...current.localViewed, [key]: {...current.localViewed?.[key], [message.path]: state}};
          const keys = Object.keys(localViewed);
          while (keys.length > 50) delete localViewed[keys.shift()];
          return {localViewed};
        });
      }
      return {state, mode: diff.viewedMode};
    }
    case 'REFRESH': clearCache(); return true;
    default: throw new Error('Unknown extension request.');
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(value => sendResponse({ok: true, value}), error => {
    const text = String(error?.message || 'Request failed.').replace(/(?:github_pat_|gh[pousr]_|glpat-)[A-Za-z0-9_-]+/g, '[redacted]');
    sendResponse({ok: false, error: text});
  });
  return true;
});
chrome.runtime.onInstalled.addListener(() => registerEnterpriseScripts().catch(() => {}));
chrome.runtime.onStartup.addListener(() => registerEnterpriseScripts().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => { clearCache(); registerEnterpriseScripts().catch(() => {}); });
chrome.action.onClicked.addListener(async tab => {
  try { await chrome.tabs.sendMessage(tab.id, {type: 'TOGGLE'}); }
  catch { await chrome.runtime.openOptionsPage(); }
});
