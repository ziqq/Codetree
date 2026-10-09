/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * GitHub REST and GraphQL adapter for github.com and GitHub Enterprise Server.
 *
 * Uses the broker's host-bound client and caches. Viewed marks use GitHub's
 * own GraphQL state when the account can read it, and local marks otherwise.
 */
import {clearCache, memo, treeMemo} from '../cache.js';
import {listBudget} from '../http.js';
import {saveLocalViewed} from '../storage.js';
import {filePath, number, sha} from '../validate.js';

/** REST path of the repository. */
function repoPath(context) {
  return `/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}`;
}

/**
 * Resolves the repository, the current ref and the path below it.
 *
 * Tree/blob URLs mix refs and paths (`tree/feature/x/src`), so the
 * longest matching branch or tag wins; a 40-character SHA is used as is.
 * Empty repositories return no commit or tree.
 *
 * @returns {Promise<{repository: Object, ref: string, commitSHA: ?string, treeSHA: ?string, path: string, account: ?string}>}
 */
async function initialize(context, api) {
  const root = repoPath(context);
  const repository = await api.json(root, 60000);
  let ref = repository.default_branch;
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
        for (const type of ['heads', 'tags']) {
          try {
            const refs = await api.json(`${root}/git/matching-refs/${type}/${encodeURIComponent(first)}`, 60000);
            for (const item of refs) {
              const name = item.ref.slice(`refs/${type}/`.length);
              if (context.tail === name || context.tail.startsWith(name + '/')) candidates.push(name);
            }
          } catch {
            /* A ref namespace may be unavailable; the commit lookup validates the fallback. */
          }
        }
        ref = candidates.sort((a, b) => b.length - a.length)[0] || first;
      }
    }
  }
  let commit;
  try {
    commit = await api.json(`${root}/commits/${encodeURIComponent(ref)}?per_page=1`, 60000);
  } catch (error) {
    if (repository.size === 0 && /empty/i.test(error.message))
      return {
        repository: {
          name: repository.name,
          full_name: repository.full_name,
          default_branch: ref,
          private: repository.private,
          empty: true,
        },
        ref,
        commitSHA: null,
        treeSHA: null,
        path: '',
        account: api.account?.login || null,
      };
    throw error;
  }
  return {
    repository: {
      name: repository.name,
      full_name: repository.full_name,
      default_branch: repository.default_branch,
      private: repository.private,
      empty: repository.size === 0,
    },
    ref,
    commitSHA: commit.sha,
    treeSHA: commit.commit.tree.sha,
    path: context.tail ? context.tail.slice(ref.length).replace(/^\//, '') : '',
    account: api.account?.login || null,
  };
}

/** Viewed state of every file in a pull request, 100 files per page. */
const viewedQuery = `query CodetreeViewed($owner:String!,$repo:String!,$number:Int!,$after:String) {
  repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
    files(first:100,after:$after) { nodes { path viewerViewedState } pageInfo { hasNextPage endCursor } }
  } }
}`;

/** Returns `{path: viewerViewedState}` for every file of the pull request. */
async function viewedFiles(context, api) {
  const output = {};
  const check = listBudget();
  let after = null;
  for (let page = 0; page < 100; page++) {
    const result = await api.graphql(viewedQuery, {
      owner: context.owner,
      repo: context.repo,
      number: context.number,
      after,
    });
    const files = result.repository?.pullRequest?.files;
    if (!files) throw new Error('Viewed-file status is unavailable.');
    check(files.nodes);
    for (const file of files.nodes) output[file.path] = file.viewerViewedState;
    if (!files.pageInfo.hasNextPage) return output;
    after = files.pageInfo.endCursor;
  }
  throw new Error('Viewed-file status exceeds the pagination limit.');
}

/**
 * Loads the changed files, review comments and revisions of a pull request or commit.
 *
 * Pull requests compare the merge base with the head. If the head or base
 * moves while loading, the result is rejected instead of mixing revisions.
 * Commits compare with their first parent.
 *
 * @returns {Promise<Object>} `{files, comments, title, number, base, head, warnings, viewed, viewedMode}`.
 */
async function getDiff(context, api, store, fresh) {
  const root = repoPath(context);
  if (context.kind === 'commit') {
    const revision = sha(context.sha);
    return memo(
      `${api.prefix}${root}:commit-diff:${revision}`,
      60000,
      async () => {
        const commit = await api.json(`${root}/commits/${revision}?per_page=1`, 60000, fresh);
        const [files, comments] = await Promise.all([
          api.pages(`${root}/commits/${revision}`, 'files'),
          api.pages(`${root}/commits/${revision}/comments`),
        ]);
        return {
          files,
          comments,
          title: commit.commit.message.split('\n')[0],
          number: null,
          base: {owner: context.owner, repo: context.repo, sha: commit.parents[0]?.sha || null},
          head: {owner: context.owner, repo: context.repo, sha: commit.sha},
          viewed: {},
          viewedMode: 'none',
          warnings: commit.parents.length > 1 ? ['Merge commit: changes are relative to the first parent.'] : [],
        };
      },
      fresh,
    );
  }
  const pullNumber = number(context.number);
  const pull = await api.json(`${root}/pulls/${pullNumber}`, 15000, fresh);
  const diff = await memo(
    `${api.prefix}${root}:pull-diff:${pullNumber}:${pull.head.sha}:${pull.base.sha}`,
    30000,
    async () => {
      const [files, comments, comparison] = await Promise.all([
        api.pages(`${root}/pulls/${pullNumber}/files`),
        api.pages(`${root}/pulls/${pullNumber}/comments`),
        api.json(
          `${root}/compare/${encodeURIComponent(pull.base.sha)}...${encodeURIComponent(pull.head.sha)}?per_page=1`,
          30000,
        ),
      ]);
      const latest = await api.json(`${root}/pulls/${pullNumber}`, 1000, true);
      if (latest.head.sha !== pull.head.sha || latest.base.sha !== pull.base.sha)
        throw new Error('The pull request changed while loading. Refresh to review the latest revision.');
      const warnings = [];
      if (files.length < pull.changed_files)
        warnings.push(
          `GitHub returned ${files.length} of ${pull.changed_files} changed files. Its PR files API is limited to 3,000 files.`,
        );
      const baseRepo = pull.base.repo;
      const headRepo = pull.head.repo || baseRepo;
      return {
        files,
        comments,
        title: pull.title,
        number: pullNumber,
        nodeID: pull.node_id,
        base: {owner: baseRepo.owner.login, repo: baseRepo.name, sha: comparison.merge_base_commit.sha},
        head: {owner: headRepo.owner.login, repo: headRepo.name, sha: pull.head.sha},
        warnings,
      };
    },
    fresh,
  );
  let viewed = {};
  let viewedMode = 'local';
  const warnings = [...diff.warnings];
  if (api.account) {
    try {
      viewed = await viewedFiles(context, api);
      viewedMode = 'github';
    } catch {
      warnings.push(
        'GitHub viewed-file status is unavailable with this token or server. Viewed marks are stored locally.',
      );
    }
  }
  if (viewedMode === 'local')
    viewed = store.localViewed?.[`${api.prefix}:${root}:${pullNumber}:${pull.head.sha}`] || {};
  return {...diff, viewed, viewedMode};
}

/** Open pull requests with the review data needed by the review filters. */
const pullsQuery = `query CodetreePulls($owner:String!,$repo:String!,$login:String!,$after:String) {
  viewer { login }
  repository(owner:$owner,name:$repo) { pullRequests(states:OPEN,first:100,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}) {
    nodes { number title url isDraft updatedAt author { login } reviewDecision
      submittedReviews: reviews(first:1,states:[APPROVED,CHANGES_REQUESTED,COMMENTED]) { totalCount }
      myReviews: reviews(first:1,author:$login,states:[APPROVED,CHANGES_REQUESTED,COMMENTED,DISMISSED]) { totalCount }
      reviewRequests(first:100) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
    } pageInfo { hasNextPage endCursor }
  } }
}`;

/**
 * Lists open pull requests, optionally filtered by review state.
 *
 * Filters need an account (GraphQL). When a repository does not require
 * reviews, GitHub reports no review decision; the latest approving or
 * change-requesting review of each reviewer decides instead.
 *
 * @param {'all'|'awaiting'|'reviewed'|'changes'|'approved'|'unreviewed'} filter
 * @returns {Promise<{pulls: Array, total: number, authenticated: boolean}>}
 */
async function listPulls(context, api, filter) {
  const root = repoPath(context);
  const allowed = ['all', 'awaiting', 'reviewed', 'changes', 'approved', 'unreviewed'];
  if (!allowed.includes(filter)) filter = 'all';
  let data;
  if (api.account) {
    try {
      data = await memo(`${api.prefix}${root}:pull-list-graphql`, 30000, async () => {
        const pulls = [];
        const check = listBudget();
        let after = null;
        for (let page = 0; page < 100; page++) {
          const result = await api.graphql(pullsQuery, {
            owner: context.owner,
            repo: context.repo,
            login: api.account.login,
            after,
          });
          const connection = result.repository?.pullRequests;
          if (!connection) throw new Error('Pull requests are unavailable.');
          check(connection.nodes);
          for (const item of connection.nodes)
            pulls.push({
              number: item.number,
              title: item.title,
              html_url: item.url,
              draft: item.isDraft,
              user: item.author,
              updated_at: item.updatedAt,
              decision: item.reviewDecision,
              reviewCount: item.submittedReviews.totalCount,
              myReviewCount: item.myReviews.totalCount,
              requested_reviewers: item.reviewRequests.nodes.map(node => node.requestedReviewer).filter(Boolean),
            });
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
    if (filter !== 'all')
      throw new Error('Connect a GitHub token with Pull requests read permission to use review-state filters.');
    data = await memo(`${api.prefix}${root}:pull-list`, 30000, () =>
      api.pages(`${root}/pulls?state=open&sort=updated&direction=desc`),
    );
  }
  const login = api.account?.login;
  // Repositories without required reviews can have a null GraphQL decision.
  // In those repositories derive the review filter from current individual reviews.
  if (filter === 'approved' || filter === 'changes') {
    data = data.map(pull => ({...pull}));
    const undecided = data.filter(pull => !pull.decision && pull.reviewCount);
    for (let offset = 0; offset < undecided.length; offset += 4) {
      await Promise.all(
        undecided.slice(offset, offset + 4).map(async pull => {
          const reviews = await memo(`${api.prefix}${root}:reviews:${pull.number}`, 30000, () =>
            api.pages(`${root}/pulls/${pull.number}/reviews`),
          );
          const latest = new Map();
          for (const review of reviews) {
            if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED')
              latest.set(review.user?.login || String(review.user?.id), review.state);
          }
          const states = [...latest.values()];
          pull.decision = states.includes('CHANGES_REQUESTED')
            ? 'CHANGES_REQUESTED'
            : states.includes('APPROVED')
              ? 'APPROVED'
              : null;
        }),
      );
    }
  }
  return {
    pulls: data.filter(pull => {
      if (filter === 'awaiting') return pull.requested_reviewers.some(user => user.login === login);
      if (filter === 'reviewed') return pull.myReviewCount > 0;
      if (filter === 'changes') return pull.decision === 'CHANGES_REQUESTED';
      if (filter === 'approved') return pull.decision === 'APPROVED';
      if (filter === 'unreviewed') return !pull.reviewCount;
      return true;
    }),
    total: data.length,
    authenticated: Boolean(api.account),
  };
}

/**
 * Handles a repository request from a GitHub page.
 *
 * `VIEWED` re-checks the head revision against fresh metadata before
 * writing, so a mark never lands on a newer revision than the one shown.
 *
 * @param {Object} message `{type: 'INIT'|'TREE'|'BRANCHES'|'PULLS'|'DIFF'|'FILE'|'VIEWED'|'REFRESH', …}`.
 * @param {Object} context The validated repository context.
 * @param {Object} api The host-bound client.
 * @param {Object} store The stored data.
 * @returns {Promise<*>}
 */
export async function handle(message, context, api, store) {
  const root = repoPath(context);
  switch (message.type) {
    case 'INIT':
      return initialize(context, api);
    case 'TREE': {
      return treeMemo(
        `${api.prefix}${root}:tree:${sha(message.sha)}:${message.recursive !== false}:${Boolean(message.lazyChildren)}`,
        async () => {
          const result = await api.json(
            `${root}/git/trees/${sha(message.sha)}${message.recursive !== false ? '?recursive=1' : ''}`,
            5 * 60000,
            message.fresh,
          );
          if (result.truncated && message.recursive !== false) {
            const shallow = await api.json(`${root}/git/trees/${sha(message.sha)}`, 5 * 60000, message.fresh);
            return {entries: shallow.tree.map(item => ({...item, loaded: item.type !== 'tree'})), lazy: true};
          }
          return {
            entries: result.tree.map(item => ({...item, loaded: !message.lazyChildren || item.type !== 'tree'})),
            lazy: false,
          };
        },
        message.fresh,
      );
    }
    case 'BRANCHES':
      return memo(`${api.prefix}${root}:branches`, 60000, () => api.pages(`${root}/branches`));
    case 'PULLS':
      return listPulls(context, api, message.filter || 'all');
    case 'DIFF':
      return getDiff(context, api, store, message.fresh);
    case 'FILE': {
      const owner = String(message.source?.owner || '');
      const repo = String(message.source?.repo || '');
      if (
        !/^[\w.-]+$/.test(owner) ||
        !/^[\w.-]+$/.test(repo) ||
        ['.', '..'].includes(owner) ||
        ['.', '..'].includes(repo)
      )
        throw new Error('Invalid source repository.');
      if (!message.source.sha) return '';
      const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath(message.path)}?ref=${sha(message.source.sha)}`;
      return memo(api.prefix + ':raw:' + path, 60000, async () => (await api.request(path, {raw: true})).data);
    }
    case 'VIEWED': {
      if (context.kind !== 'pull') throw new Error('Viewed marks are available on pull requests.');
      number(context.number);
      filePath(message.path);
      const headSHA = sha(message.headSHA);
      const diff = await getDiff(context, api, store, false);
      if (diff.head.sha !== headSHA)
        throw new Error('The pull request changed. Refresh the file list before marking a file as viewed.');
      if (!diff.files.some(file => file.filename === message.path))
        throw new Error('This file is not part of the pull request.');
      const request = await api.json(`${root}/pulls/${context.number}`, 15000, true);
      if (request.head?.sha !== headSHA)
        throw new Error('The pull request changed. Refresh the file list before marking a file as viewed.');
      const state = message.viewed ? 'VIEWED' : 'UNVIEWED';
      if (diff.viewedMode === 'github') {
        const mutation = message.viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed';
        const type = message.viewed ? 'MarkFileAsViewedInput' : 'UnmarkFileAsViewedInput';
        await api.graphql(
          `mutation CodetreeViewed($input:${type}!) { ${mutation}(input:$input) { clientMutationId } }`,
          {input: {pullRequestId: diff.nodeID, path: message.path}},
        );
      } else {
        await saveLocalViewed(`${api.prefix}:${root}:${context.number}:${headSHA}`, message.path, state);
      }
      return {state, mode: diff.viewedMode};
    }
    case 'REFRESH':
      await clearCache();
      return true;
    default:
      throw new Error('Unknown extension request.');
  }
}
