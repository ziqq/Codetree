/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Open pull/merge request list with review-state filters.
 */
import {icon} from '../../shared/icons.js';
import {batch} from '../../shared/reactive.js';
import {pullURL} from '../../shared/routes.js';
import {el, empty} from '../dom.js';
import {requestName} from '../page.js';

/** Returns the loaded requests whose number, title or author contains the search query. */
export function matchingPulls(state) {
  const query = state.query.toLowerCase();
  return state.pulls.filter(pull =>
    `${pull.number} ${pull.title} ${pull.user?.login || ''}`.toLowerCase().includes(query),
  );
}

/** Creates the requests feature: `loadPulls` and `renderPulls`. */
export function createPulls(app) {
  const {state} = app;

  /**
   * Loads requests for the selected filter.
   *
   * A reply is applied only while the page, tab, view and filter are unchanged,
   * so a slow filter cannot overwrite a newer one.
   */
  async function loadPulls() {
    const epoch = state.epoch;
    const filter = state.filter;
    const tab = state.tab;
    const generation = (state.viewGeneration = (state.viewGeneration || 0) + 1);
    const current = () =>
      epoch === state.epoch && generation === state.viewGeneration && filter === state.filter && state.tab === tab;
    batch(() => {
      state.loading = true;
      state.error = '';
    });
    try {
      const result = await app.rpc('PULLS', {filter});
      if (!current()) return;
      batch(() => {
        state.pulls = result.pulls;
        state.totalPulls = result.total;
        state.loading = false;
      });
    } catch (error) {
      if (current())
        batch(() => {
          state.loading = false;
          state.error = error.message;
        });
    }
  }

  /** Renders the requests matching the search. */
  function renderPulls() {
    const {body} = app.view;
    const name = requestName(state.context);
    const pulls = matchingPulls(state);
    if (!pulls.length) {
      body.replaceChildren(
        empty(
          `No matching ${name}s`,
          state.filter === 'all' && !state.query
            ? `There are no open ${name}s in this repository.`
            : 'Try another filter or search.',
          'pr',
        ),
      );
      return;
    }
    const list = el('div', {class: 'list'});
    for (const pull of pulls) {
      const item = el('a', {class: 'pr-item', href: pullURL(state.context, pull.number)}, [
        el('div', {class: `pr-title${pull.draft ? ' draft' : ''}`}, [icon('pr'), el('span', {text: pull.title})]),
      ]);
      const metadata = el('div', {class: 'pr-meta'}, [
        el('span', {
          text: `${state.context.provider === 'gitlab' ? '!' : '#'}${pull.number} · ${pull.user?.login || 'unknown'}`,
        }),
      ]);
      if (pull.draft) metadata.append(el('span', {text: 'Draft'}));
      if (pull.decision)
        metadata.append(
          el('span', {
            class: `review-state${pull.decision === 'CHANGES_REQUESTED' ? ' changes' : ''}`,
            text:
              {APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required'}[
                pull.decision
              ] || pull.decision,
          }),
        );
      item.append(metadata);
      list.append(item);
    }
    body.replaceChildren(list);
  }
  return {loadPulls, renderPulls};
}
