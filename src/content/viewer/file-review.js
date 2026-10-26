/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Owned Viewed-and-next control shared by file tabs and the full-file dialog.
 */

import {icon} from '../../shared/icons.js';
import {el} from '../dom.js';
import {createAlive, createRenderEffect, createSignal, onCleanup, withOwner} from '../reactive.js';
import {listen} from '../reactive-dom.js';
import {createViewedAction} from '../viewed.js';

/**
 * Adds a review action for one loaded PR/MR file. Navigation follows the full
 * listed file order, wrapping once, and waits for a confirmed Viewed write.
 * Closing or replacing the viewer never cancels the write; it only prevents
 * that viewer from navigating when the reply arrives.
 *
 * @param {object} app The content feature context.
 * @param {{bottom: Element, owner: object}} shell The owned viewer footer.
 * @param {{path: string}} node The current changed file.
 * @param {object} diff The captured PR/MR diff and its listed files.
 * @param {() => boolean} current Whether this render still owns the viewer.
 * @param {(path: string) => Promise<void>} open Opens another file in the same viewer.
 * @param {() => number} navigation Reads navigation intent before metadata saves finish.
 */
export function createFileReview(app, shell, node, diff, current, open, navigation = () => 0) {
  if (app.state.context?.kind !== 'pull' || app.state.diff !== diff) return;
  const action = createViewedAction(app);
  const index = diff.files.findIndex(file => file.filename === node.path);
  if (index === -1 || !action.current()) return;
  const alive = createAlive();
  const [pending, setPending] = createSignal(false);
  const [failure, setFailure] = createSignal('');
  const label = el('span');
  const control = el('button', {type: 'button', class: 'small-button'}, [icon('check'), label]);
  const status = el('span', {class: 'file-review-status', role: 'status', 'aria-live': 'polite'});
  const group = el('div', {class: 'file-review', role: 'group', 'aria-label': 'File review'}, [control, status]);
  const openFile = withOwner(open);
  shell.bottom.append(group);
  onCleanup(() => group.remove());

  /** Whether this control may still act on its captured page and viewer. */
  function available() {
    return alive() && current() && action.current();
  }

  /** Finds the next unviewed listed file without consulting sidebar filters. */
  function nextUnviewed() {
    for (let offset = 1; offset < diff.files.length; offset++) {
      const path = diff.files[(index + offset) % diff.files.length].filename;
      if (!action.viewed(path)) return path;
    }
    return null;
  }

  /** Saves Viewed once, then advances only while this viewer is still current. */
  async function advance() {
    if (!available() || pending()) return;
    const request = navigation();
    setFailure('');
    setPending(true);
    try {
      if (!action.viewed(node.path) && !(await action.set(node.path, true))) return;
      if (!available() || request !== navigation()) return;
      const path = nextUnviewed();
      if (path) await openFile(path);
    } catch (error) {
      if (available()) setFailure(error?.message || 'Could not save Viewed. Try again.');
    } finally {
      if (alive()) setPending(false);
    }
  }

  listen(control, 'click', advance);
  createRenderEffect(() => {
    const supported = available();
    group.hidden = !supported;
    if (!supported) {
      control.disabled = true;
      return;
    }
    const viewed = action.viewed(node.path);
    const complete = viewed && !nextUnviewed();
    control.disabled = pending() || complete;
    label.textContent = pending() ? 'Saving…' : viewed ? 'Next unviewed' : 'Viewed & next';
    status.textContent = failure() || (complete ? 'All listed files viewed' : '');
    status.classList.toggle('error', Boolean(failure()));
  });
}
