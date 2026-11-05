/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Branch/tag comparison picker using the owned viewer dialog and native comparison routes.
 */

import {icon} from '../../shared/icons.js';
import {compareURL, validRef} from '../../shared/routes.js';
import {el, empty} from '../dom.js';

/** Creates a comparison picker; its replies and controls belong to one dialog and page lifetime. */
export function createCompare(app) {
  /** Loads branch/tag choices and navigates only after an explicit Compare action. */
  async function openCompare(fresh = false) {
    const {state} = app;
    const context = state.context;
    if (!context) return;
    const epoch = state.epoch;
    app.closeBranches();
    const shell = app.viewerShell(
      'Compare branches and tags',
      'Changes in Head since its common ancestor with Base.',
      'Compare branches and tags',
    );
    shell.bottom.remove();
    const generation = state.refreshGeneration;
    const current = () => app.isCurrent(shell) && state.epoch === epoch && state.refreshGeneration === generation;
    shell.body.replaceChildren(
      empty('Loading branches and tags', 'Fetching references from this repository…', 'refresh'),
    );
    try {
      const values = await app.rpc('REFS', {fresh});
      if (!current()) return;
      const refs = values.filter(item => ['branch', 'tag'].includes(item.type) && validRef(item.ref));
      if (!refs.length) {
        shell.body.replaceChildren(
          empty('No branches or tags', 'This repository has no references to compare.', 'branch'),
        );
        return;
      }
      const base = el('select', {'aria-label': 'Base branch or tag', required: ''});
      const head = el('select', {'aria-label': 'Head branch or tag', required: ''});
      for (const select of [base, head]) {
        for (const [type, label] of [
          ['branch', 'Branches'],
          ['tag', 'Tags'],
        ]) {
          const group = el('optgroup', {label});
          for (const item of refs.filter(item => item.type === type))
            group.append(el('option', {value: item.ref, text: item.name}));
          if (group.children.length) select.append(group);
        }
      }
      const preferredBase =
        context.kind === 'compare' ? context.baseRef : `refs/heads/${state.info?.repository.default_branch}`;
      const preferredHead = context.kind === 'compare' ? context.headRef : `refs/heads/${state.info?.ref}`;
      base.value = refs.find(item => item.ref === preferredBase)?.ref || refs[0].ref;
      head.value = refs.find(item => item.ref === preferredHead)?.ref || refs[0].ref;
      const submit = el('button', {type: 'submit', class: 'small-button primary', text: 'Compare'});
      const form = el('form', {class: 'compare-form'}, [
        el('label', {}, [el('span', {text: 'Base'}), el('span', {class: 'compare-select'}, [base, icon('chevron')])]),
        el('label', {}, [el('span', {text: 'Head'}), el('span', {class: 'compare-select'}, [head, icon('chevron')])]),
        el('p', {
          text: 'Branches and tags are resolved to exact commits when the comparison loads. No pull request is created.',
        }),
        submit,
      ]);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (current()) location.assign(compareURL(context, base.value, head.value));
      });
      shell.body.replaceChildren(form);
      base.focus();
    } catch (error) {
      if (!current()) return;
      shell.body.replaceChildren(
        empty('Could not load branches and tags', error.message, 'branch', [
          el('button', {
            type: 'button',
            class: 'small-button',
            text: 'Retry',
            onClick: app.run(() => openCompare(true)),
          }),
        ]),
      );
    }
  }
  return {openCompare};
}
