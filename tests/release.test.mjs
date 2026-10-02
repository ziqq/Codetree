import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {parse} from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));

test('post-publication jobs use the existing pinned automation and least privileges', () => {
  const labels = workflow.jobs['release-labels']; const notify = workflow.jobs['release-notifications'];
  assert.equal(labels.needs, 'publish'); assert.equal(notify.needs, 'publish');
  assert.deepEqual(labels.permissions, {contents: 'read', issues: 'write'});
  assert.deepEqual(notify.permissions, {contents: 'read'});
  assert.equal(labels.steps.find(step => step.with?.repository === 'ziqq/actions').with.ref, 'ccd1a799683cd461a45d9303ac6fcb2792f8f5d2');
  const action = notify.steps.find(step => step.uses?.startsWith('ziqq/actions/notify@'));
  assert.ok(action); assert.equal(action.with['failure-policy'], 'required');
  assert.match(action.with.variables, /needs\.publish\.outputs\.release/);
});

test('release labeler receives the confirmed published event even when triggered by tag push', t => {
  const root = mkdtempSync(join(tmpdir(), 'code-tree-release-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'release-actions/labeler/dist'), {recursive: true});
  const release = {tag_name: 'v0.2.0', name: 'Code Tree 0.2.0', draft: false, published_at: '2026-10-02T00:00:00Z'};
  writeFileSync(join(root, 'release.json'), JSON.stringify(release));
  writeFileSync(join(root, 'event.json'), JSON.stringify({ref: 'refs/tags/v0.2.0', repository: {default_branch: 'main'}}));
  writeFileSync(join(root, 'gh'), '#!/bin/sh\ncat "$RUNNER_TEMP/release.json"\n'); chmodSync(join(root, 'gh'), 0o755);
  writeFileSync(join(root, 'release-actions/labeler/dist/index.js'), `
    const fs = require('node:fs');
    fs.writeFileSync(process.env.RUNNER_TEMP + '/received.json', JSON.stringify({
      event: JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      name: process.env.GITHUB_EVENT_NAME, operation: process.env.INPUT_OPERATION,
      allowEmpty: process.env['INPUT_ALLOW-EMPTY'], allowRemoval: process.env['INPUT_ALLOW-PATTERN-REMOVAL'],
    }));
  `);
  const step = workflow.jobs['release-labels'].steps.find(step => step.run);
  const script = step.run.match(/<<'JS'\n([^]*?)\nJS/)[1];
  const env = {...process.env, PATH: `${root}:${process.env.PATH}`, RUNNER_TEMP: root,
    GITHUB_EVENT_PATH: join(root, 'event.json'), GITHUB_EVENT_NAME: 'push',
    GITHUB_REPOSITORY: 'ziqq/Codetree', RELEASE_TAG: 'v0.2.0', GH_TOKEN: 'synthetic-test'};
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: root, env});
  const result = JSON.parse(readFileSync(join(root, 'received.json'), 'utf8'));
  assert.equal(result.name, 'release'); assert.equal(result.event.action, 'published');
  assert.deepEqual(result.event.release, release); assert.equal(result.event.repository.default_branch, 'main');
  assert.equal(result.operation, 'release-published'); assert.equal(result.allowEmpty, 'true'); assert.equal(result.allowRemoval, 'true');
  writeFileSync(join(root, 'release.json'), JSON.stringify({...release, draft: true}));
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: root, env, stdio: 'pipe'}), /not published/);
});
