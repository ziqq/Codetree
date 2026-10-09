/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * GitLab REST adapter for gitlab.com and self-managed GitLab.
 *
 * Uses the broker's host-bound client and caches. Projects may live in
 * nested namespaces. Folders load one level at a time, and Viewed marks
 * are always local because GitLab has no API for them.
 */

import * as C from '../../shared/routes.js';
import {clearCache, memo, treeMemo} from '../cache.js';
import {saveLocalViewed} from '../storage.js';
import {sha} from '../validate.js';

/** REST path of the project (`owner/repo` encoded as one ID). */
const projectPath = context => `/projects/${encodeURIComponent(`${context.owner}/${context.repo}`)}`;

/** Adds GitHub's `login` field to a GitLab user. */
const user = value => (value ? {...value, login: value.username} : null);

/** Reviewer states that count as a submitted review. */
const completedReviews = new Set(['reviewed', 'requested_changes', 'approved', 'unapproved']);

/**
 * Converts a GitLab diff entry to the GitHub file shape used by the sidebar.
 *
 * Additions and deletions are counted from the patch, so files whose
 * patch GitLab omitted have no statistics.
 */
function file(value) {
  const patch = value.diff || '';
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@ ')) inHunk = true;
    else if (inHunk && line.startsWith('+')) additions++;
    else if (inHunk && line.startsWith('-')) deletions++;
  }
  return {
    filename: value.new_path,
    previous_filename: value.renamed_file ? value.old_path : null,
    status: value.new_file ? 'added' : value.deleted_file ? 'removed' : value.renamed_file ? 'renamed' : 'modified',
    patch,
    additions,
    deletions,
    too_large: Boolean(value.too_large),
    collapsed: Boolean(value.collapsed),
  };
}

/**
 * Resolves the project, the current ref and the path below it.
 *
 * Like GitHub, the longest branch or tag that prefixes the URL tail wins.
 */
async function initialize(context, api) {
  const root = projectPath(context);
  const project = await api.json(root, 60000);
  const repository = {
    name: project.path,
    full_name: project.path_with_namespace,
    default_branch: project.default_branch,
    private: project.visibility !== 'public',
    empty: Boolean(project.empty_repo),
  };
  if (project.empty_repo || !project.default_branch)
    return {
      repository,
      ref: project.default_branch || '',
      commitSha: null,
      treeSha: null,
      path: '',
      account: api.account?.login || null,
    };
  let ref = project.default_branch;
  if (context.tail) {
    if (context.refHint && (context.tail === context.refHint || context.tail.startsWith(context.refHint + '/')))
      ref = context.refHint;
    else if (context.tail === ref || context.tail.startsWith(ref + '/')) {
      /* Keep the matching default branch. */
    } else {
      const first = context.tail.split('/')[0];
      if (/^[a-f\d]{40}$/i.test(first)) ref = first;
      else {
        const candidates = [];
        for (const type of ['branches', 'tags']) {
          const values = await api.pages(`${root}/repository/${type}?search=${encodeURIComponent('^' + first)}`);
          for (const value of values)
            if (context.tail === value.name || context.tail.startsWith(value.name + '/')) candidates.push(value.name);
        }
        ref = candidates.sort((a, b) => b.length - a.length)[0] || first;
      }
    }
  }
  const commit = await api.json(`${root}/repository/commits/${encodeURIComponent(ref)}`, 60000);
  return {
    repository,
    ref,
    commitSha: commit.id,
    treeSha: commit.id,
    path: context.tail ? context.tail.slice(ref.length).replace(/^\//, '') : '',
    account: api.account?.login || null,
  };
}

/** Lists one folder at a revision; subfolders load when opened. */
async function tree(context, api, message) {
  if (!/^[a-f\d]{7,40}$/i.test(message.sha || '')) throw new Error('Invalid repository revision.');
  const folder = message.path || '';
  if (folder && folder.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('Invalid folder path.');
  const root = projectPath(context);
  const values = await api.pages(
    `${root}/repository/tree?ref=${encodeURIComponent(message.sha)}&path=${encodeURIComponent(folder)}&recursive=false`,
  );
  return {
    entries: values.map(value => ({
      path: folder ? value.path.slice(folder.length + 1) : value.path,
      type: value.type,
      sha: value.id,
      mode: value.mode,
      loaded: value.type !== 'tree',
    })),
    lazy: values.some(value => value.type === 'tree'),
  };
}

/** Flattens positioned discussion notes into inline comments, skipping system notes. */
function comments(discussions, context) {
  const output = [];
  for (const discussion of discussions) {
    const position = discussion.notes.find(note => note.position)?.position;
    if (!position) continue;
    for (const note of discussion.notes) {
      if (note.system) continue;
      const location = note.position || position;
      output.push({
        id: note.id,
        path: location.new_path || location.old_path,
        line: location.new_line || location.old_line,
        side: location.new_line ? 'RIGHT' : 'LEFT',
        body: note.body,
        user: user(note.author),
        resolved: Boolean(note.resolved),
        html_url: `${C.pullURL(context, context.number)}#note_${note.id}`,
      });
    }
  }
  return output;
}

/**
 * Loads discussions or comments, tolerating missing permission.
 *
 * Public merge requests may still require a token for discussions; the
 * diff is returned with a warning instead of failing.
 */
async function readComments(path, api, warnings) {
  try {
    return await api.pages(path);
  } catch (error) {
    if (![401, 403].includes(error.status) || /rate limit/i.test(error.message)) throw error;
    warnings.push(
      'GitLab comments are unavailable with this access. Connect a token with read_api permission to load discussions.',
    );
    return [];
  }
}

/**
 * Loads the changed files, discussions and revisions of a merge request or commit.
 *
 * Merge requests use GitLab's `diff_refs`; if they change while loading,
 * the result is rejected. Server diff limits and omitted patches are
 * reported as warnings.
 */
async function diff(context, api, memo, fresh) {
  const root = projectPath(context);
  if (context.kind === 'commit') {
    const revision = context.sha;
    if (!/^[a-f\d]{7,40}$/i.test(revision || '')) throw new Error('Invalid commit SHA.');
    return memo(
      `${api.prefix}${root}:commit-diff:${revision}`,
      60000,
      async () => {
        const commit = await api.json(`${root}/repository/commits/${revision}`, 60000, fresh);
        const warnings =
          commit.parent_ids.length > 1 ? ['Merge commit: changes are relative to the first parent.'] : [];
        const [changes, notes] = await Promise.all([
          api.pages(`${root}/repository/commits/${revision}/diff`),
          readComments(`${root}/repository/commits/${revision}/comments`, api, warnings),
        ]);
        return {
          files: changes.map(file),
          title: commit.title,
          number: null,
          comments: notes
            .filter(note => note.path)
            .map((note, index) => ({
              id: index,
              path: note.path,
              line: note.line,
              body: note.note,
              user: user(note.author),
              html_url: `${C.repoURL(context)}/-/commit/${revision}`,
            })),
          base: {project: `${context.owner}/${context.repo}`, sha: commit.parent_ids[0] || null},
          head: {project: `${context.owner}/${context.repo}`, sha: commit.id},
          warnings,
          viewed: {},
          viewedMode: 'none',
        };
      },
      fresh,
    );
  }
  if (!Number.isSafeInteger(context.number) || context.number < 1) throw new Error('Invalid merge request number.');
  const path = `${root}/merge_requests/${context.number}`;
  const request = await api.json(path, 15000, fresh);
  const refs = request.diff_refs;
  if (!refs?.head_sha || !refs?.base_sha)
    throw new Error('GitLab is still preparing this merge request diff. Retry shortly.');
  return memo(
    `${api.prefix}${path}:diff:${refs.base_sha}:${refs.head_sha}`,
    30000,
    async () => {
      const warnings = [];
      const [changes, discussions] = await Promise.all([
        api.pages(`${path}/diffs`),
        readComments(`${path}/discussions`, api, warnings),
      ]);
      const latest = await api.json(path, 1000, true);
      if (latest.diff_refs?.head_sha !== refs.head_sha || latest.diff_refs?.base_sha !== refs.base_sha)
        throw new Error('The merge request changed while loading. Refresh to review the latest revision.');
      const expected = String(request.changes_count || '');
      if (/^\d+$/.test(expected) && changes.length < Number(expected))
        warnings.push(`GitLab returned ${changes.length} of ${expected} files. Its server diff limits apply.`);
      if (expected.endsWith('+')) warnings.push('GitLab reports a limited file count. Its server diff limits apply.');
      if (changes.some(value => value.too_large || value.collapsed))
        warnings.push(
          'Some patches were omitted by GitLab. Full-file previews require complete patches when the text changed.',
        );
      return {
        files: changes.map(file),
        comments: comments(discussions, context),
        title: request.title,
        number: context.number,
        base: {project: request.target_project_id, sha: refs.base_sha},
        head: {project: request.source_project_id || request.target_project_id, sha: refs.head_sha},
        warnings,
      };
    },
    fresh,
  );
}

/**
 * Lists open merge requests, optionally filtered by review state.
 *
 * Filters use the reviewers and approvals endpoints, whose availability
 * depends on the server edition and version.
 */
async function pulls(context, api, memo, filter) {
  const root = projectPath(context);
  const list = await memo(`${api.prefix}${root}:merge-list`, 30000, () =>
    api.pages(`${root}/merge_requests?state=opened&scope=all&order_by=updated_at&sort=desc`),
  );
  const allowed = ['all', 'awaiting', 'reviewed', 'changes', 'approved', 'unreviewed'];
  if (!allowed.includes(filter)) filter = 'all';
  if (filter !== 'all' && !api.account)
    throw new Error('Connect a GitLab token with read_api permission to use review-state filters.');
  let data = list.map(value => ({
    number: value.iid,
    title: value.title,
    html_url: value.web_url,
    draft: value.draft || value.work_in_progress,
    user: user(value.author),
    updated_at: value.updated_at,
    requested_reviewers: (value.reviewers || []).map(user),
    decision: value.detailed_merge_status === 'requested_changes' ? 'CHANGES_REQUESTED' : null,
  }));
  if (filter !== 'all') {
    for (let offset = 0; offset < data.length; offset += 4)
      await Promise.all(
        data.slice(offset, offset + 4).map(async item => {
          const path = `${root}/merge_requests/${item.number}`;
          const reviews = await memo(`${api.prefix}${path}:reviewers`, 30000, () => api.pages(`${path}/reviewers`));
          let approvals = [];
          if (filter !== 'awaiting') {
            const state = await api.json(`${path}/approvals`, 30000);
            approvals = (state.approved_by || []).map(value => value.user.username);
          }
          item.reviewCount = reviews.filter(value => completedReviews.has(value.state)).length + approvals.length;
          item.myReviewCount =
            reviews.some(value => value.user?.username === api.account.login && completedReviews.has(value.state)) ||
            approvals.includes(api.account.login)
              ? 1
              : 0;
          item.awaiting = reviews.some(
            value =>
              value.user?.username === api.account.login &&
              ['unreviewed', 'review_started', 'unapproved'].includes(value.state),
          );
          if (reviews.some(value => value.state === 'requested_changes')) item.decision = 'CHANGES_REQUESTED';
          else if (approvals.length || reviews.some(value => value.state === 'approved')) item.decision = 'APPROVED';
        }),
      );
  }
  return {
    pulls: data.filter(value => {
      if (filter === 'awaiting') return value.awaiting;
      if (filter === 'reviewed') return value.myReviewCount > 0;
      if (filter === 'changes') return value.decision === 'CHANGES_REQUESTED';
      if (filter === 'approved') return value.decision === 'APPROVED';
      if (filter === 'unreviewed') return !value.reviewCount;
      return true;
    }),
    total: list.length,
    authenticated: Boolean(api.account),
  };
}

/**
 * Returns the raw text of a file at a revision of a project.
 *
 * Fork merge requests read the base and head from different projects.
 */
async function source(api, message) {
  const project = String(message.source?.project || '');
  if (
    (!/^\d+$/.test(project) && !/^[\w.-]+(?:\/[\w.-]+)+$/.test(project)) ||
    project.split('/').some(part => part === '.' || part === '..')
  )
    throw new Error('Invalid source project.');
  if (!message.source.sha) return '';
  if (!/^[a-f\d]{7,40}$/i.test(message.source.sha)) throw new Error('Invalid source revision.');
  if (!message.path || message.path.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('Invalid file path.');
  return (
    await api.request(
      `/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(message.path)}/raw?ref=${message.source.sha}`,
      {raw: true},
    )
  ).data;
}

/**
 * Handles a repository request from a GitLab page.
 *
 * @param {Object} message `{type: 'INIT'|'TREE'|'BRANCHES'|'PULLS'|'DIFF'|'FILE'|'VIEWED'|'REFRESH', …}`.
 * @param {Object} context The validated repository context.
 * @param {Object} api The host-bound client.
 * @param {Object} store The stored data.
 * @returns {Promise<*>}
 */
export async function handle(message, context, api, store) {
  const root = projectPath(context);
  switch (message.type) {
    case 'INIT':
      return initialize(context, api);
    case 'TREE':
      return treeMemo(
        `${api.prefix}${root}:tree:${sha(message.sha)}:${message.path || ''}`,
        () => tree(context, api, message),
        message.fresh,
      );
    case 'BRANCHES':
      return memo(`${api.prefix}${root}:branches`, 60000, () => api.pages(`${root}/repository/branches`));
    case 'PULLS':
      return pulls(context, api, memo, message.filter || 'all');
    case 'DIFF': {
      const value = await diff(context, api, memo, message.fresh);
      if (context.kind === 'commit') return value;
      return {
        ...value,
        viewed: store.localViewed?.[`${api.prefix}:${root}:${context.number}:${value.head.sha}`] || {},
        viewedMode: 'local',
      };
    }
    case 'FILE':
      return memo(`${api.prefix}:file:${message.source?.project}:${message.source?.sha}:${message.path}`, 60000, () =>
        source(api, message),
      );
    case 'VIEWED': {
      if (context.kind !== 'pull') throw new Error('Viewed marks are available on merge requests.');
      const headSha = sha(message.headSha);
      const value = await diff(context, api, memo, false);
      if (value.head.sha !== headSha)
        throw new Error('The merge request changed. Refresh the file list before marking a file as viewed.');
      if (!value.files.some(item => item.filename === message.path))
        throw new Error('This file is not part of the merge request.');
      const request = await api.json(`${root}/merge_requests/${context.number}`, 15000, true);
      if (request.diff_refs?.head_sha !== headSha)
        throw new Error('The merge request changed. Refresh the file list before marking a file as viewed.');
      const state = message.viewed ? 'VIEWED' : 'UNVIEWED';
      await saveLocalViewed(`${api.prefix}:${root}:${context.number}:${headSha}`, message.path, state);
      return {state, mode: 'local'};
    }
    case 'REFRESH':
      await clearCache();
      return true;
    default:
      throw new Error('Unknown extension request.');
  }
}
