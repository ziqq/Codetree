/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Native source-line links bound to the exact repository and commit shown by a viewer.
 */

import {blobURL, normalizeOrigin} from './routes.js';

/**
 * Returns a permalink to one source line or an inclusive range at an exact commit.
 *
 * Numeric GitLab project IDs need an authoritative namespace; falling back to
 * the page repository would link fork revisions to the wrong project.
 *
 * @param {object} context The viewer's provider and website origin.
 * @param {object} source The loaded revision's repository descriptor and full SHA.
 * @param {string} path The path at this revision, including an old name for renamed files.
 * @param {number} start The first one-based source line.
 * @param {number} [end=start] The last one-based source line.
 * @returns {?string} The native permalink, or null when its exact source is unavailable.
 */
export function linePermalink(context, source, path, start, end = start) {
  if (
    !context ||
    !source ||
    !['github', 'gitlab'].includes(context.provider) ||
    !/^[a-f\d]{40}$/i.test(source.sha || '') ||
    typeof path !== 'string' ||
    !path ||
    Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    path.split('/').some(part => !part || part === '.' || part === '..') ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start
  )
    return null;
  try {
    const origin = normalizeOrigin(context.origin);
    let owner = source.owner;
    let repo = source.repo;
    if (context.provider === 'gitlab') {
      const project = source.projectPath ?? source.project;
      if (typeof project !== 'string' || !project.includes('/')) return null;
      const parts = project.split('/');
      if (parts.some(part => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')) return null;
      owner = parts.slice(0, -1).join('/');
      repo = parts.at(-1);
    } else if (
      typeof owner !== 'string' ||
      typeof repo !== 'string' ||
      !/^[\w.-]+$/.test(owner) ||
      !/^[\w.-]+$/.test(repo) ||
      [owner, repo].some(part => part === '.' || part === '..')
    )
      return null;
    const url = new URL(blobURL({origin, provider: context.provider, owner, repo}, source.sha, path));
    if (context.provider === 'github' && /\.(md|markdown|mdown|mkdn|mkd)$/i.test(path))
      url.searchParams.set('plain', '1');
    url.hash = `L${start}${end === start ? '' : `-${context.provider === 'github' ? 'L' : ''}${end}`}`;
    return url.href;
  } catch {
    return null;
  }
}
