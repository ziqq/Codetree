/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Trusted, browser-tab-scoped metadata for open file workspaces.
 *
 * Session storage holds paths and scroll positions only. Code workspaces
 * share their paths across branches; review workspaces belong to one
 * request or commit. Account and browser tab identities come from the
 * broker, never from caller-supplied workspace keys.
 */

import {maxFileTabPositions, maxFileTabs} from '../shared/file-tabs.js';
import {accountFor} from './hosts.js';
import {readStore} from './storage.js';
import {filePath, number, sha} from './validate.js';

/** Maximum number of browser-tab/account/repository workspaces in this session. */
const maxWorkspaces = 50;
/** Maximum serialized metadata bytes per workspace; 50 entries stay below session quota. */
const maxWorkspaceBytes = 64 * 1024;
/** Maximum accepted repository path length. */
const maxPathLength = 4096;
/** Maximum accepted branch or revision identifier length. */
const maxRefLength = 1024;
/** Maximum opaque route-identity length; this value is never a URL or storage key. */
const maxPageLength = 8192;
/** Maximum accepted scroll offset in CSS pixels. */
const maxScrollOffset = 1_000_000_000;
/** Tail of the metadata queue; failed operations never block later requests. */
let operations = Promise.resolve();

/**
 * Validates one metadata path with the existing repository-path rules.
 *
 * @param {*} value The repository-relative file path.
 * @returns {string} The unchanged path.
 */
function path(value) {
  if (typeof value !== 'string' || value.length > maxPathLength) throw new Error('Invalid file tab path.');
  filePath(value);
  return value;
}

/**
 * Validates a complete workspace and discards fields outside its metadata schema.
 *
 * @param {*} value The submitted workspace.
 * @returns {{paths: Array<string>, active: string, positions: Array<Object>, page: string}} Safe metadata.
 */
function workspace(value) {
  if (
    !value ||
    !Array.isArray(value.paths) ||
    value.paths.length > maxFileTabs ||
    typeof value.active !== 'string' ||
    (value.page !== undefined && (typeof value.page !== 'string' || value.page.length > maxPageLength)) ||
    !Array.isArray(value.positions) ||
    value.positions.length > maxFileTabPositions
  )
    throw new Error('Invalid file tab workspace.');
  const paths = value.paths.map(path);
  if (new Set(paths).size !== paths.length || (value.active && !paths.includes(value.active)))
    throw new Error('Invalid active file tab.');
  const positions = value.positions.map(position => {
    if (
      !position ||
      typeof position.ref !== 'string' ||
      position.ref.length > maxRefLength ||
      !paths.includes(position.path) ||
      !Number.isFinite(position.top) ||
      position.top < 0 ||
      position.top > maxScrollOffset ||
      !Number.isFinite(position.left) ||
      position.left < 0 ||
      position.left > maxScrollOffset
    )
      throw new Error('Invalid file tab position.');
    return {ref: position.ref, path: position.path, top: position.top, left: position.left};
  });
  const result = {paths, active: value.active, positions, page: value.page || ''};
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maxWorkspaceBytes)
    throw new Error('File tab workspace is too large.');
  return result;
}

/**
 * Builds a broker-owned key with account and page identities isolated.
 *
 * @param {Object} message The metadata request.
 * @param {Object} context The already validated, host-bound repository context.
 * @param {chrome.runtime.MessageSender} sender The sending repository tab.
 * @param {Object} store Accounts and account selection.
 * @returns {string} The collision-free serialized workspace key.
 */
function workspaceKey(message, context, sender, store) {
  if (!Number.isInteger(sender.tab?.id) || sender.tab.id < 0)
    throw new Error('File tabs require a repository browser tab.');
  if (message.scope !== 'code' && message.scope !== 'review') throw new Error('Invalid file tab scope.');
  const key = [
    sender.tab.id,
    accountFor(context, store)?.id || '',
    context.provider,
    context.origin,
    context.owner,
    context.repo,
    message.scope,
  ];
  if (message.scope === 'review') {
    if (context.kind === 'pull') key.push('pull', number(context.number));
    else if (context.kind === 'commit') key.push('commit', sha(context.sha).toLowerCase());
    else throw new Error('Review file tabs require a pull request, merge request or commit.');
  }
  return JSON.stringify(key);
}

/**
 * Reads or replaces metadata without touching other session-storage keys.
 *
 * Every operation waits for earlier operations, so a GET after a pending
 * save observes that save even when the worker handles messages together.
 * Writes move their workspace to the end for bounded oldest-first eviction.
 * A save must echo the account identity returned by its read; account
 * changes while queued reject the stale save instead of moving its tabs
 * into the newly selected account's workspace.
 *
 * @param {Object} message A FILE_TABS request with scope and optional value.
 * @param {Object} context The already validated, host-bound context.
 * @param {chrome.runtime.MessageSender} sender The sending repository tab.
 * @param {Object} store Accounts and account selection.
 * @returns {Promise<Object>} The metadata plus its broker-derived accountID.
 */
export function fileTabs(message, context, sender, store) {
  const key = workspaceKey(message, context, sender, store);
  const accountID = accountFor(context, store)?.id || '';
  const value = Object.hasOwn(message, 'value') ? workspace(message.value) : null;
  if (value && message.accountID !== accountID) throw new Error('The selected account changed. Reopen file tabs.');
  if (value && new TextEncoder().encode(JSON.stringify({key, value})).byteLength > maxWorkspaceBytes)
    throw new Error('File tab workspace is too large.');
  const result = operations.then(async () => {
    const {fileTabs: stored = []} = await chrome.storage.session.get('fileTabs');
    const entries = Array.isArray(stored) ? stored : [];
    if (!value) {
      try {
        return {...workspace(entries.find(entry => entry?.key === key)?.value), accountID};
      } catch {
        return {paths: [], active: '', positions: [], page: '', accountID};
      }
    }
    if ((accountFor(context, await readStore())?.id || '') !== accountID)
      throw new Error('The selected account changed. Reopen file tabs.');
    const next = entries.filter(entry => entry?.key !== key);
    next.push({key, value});
    await chrome.storage.session.set({fileTabs: next.slice(-maxWorkspaces)});
    return {...value, accountID};
  });
  operations = result.catch(() => {});
  return result;
}
