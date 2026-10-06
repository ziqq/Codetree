/**
 * Release workflow: tag and manual triggers, default-branch tagging, generated
 * release notes, Chrome Web Store submission states, issue completion and
 * notification variables.
 */
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {parse} from 'yaml';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = parse(read('.github/workflows/release.yml'));
const notifications = parse(read('.github/workflows/notifications.yml'));
const template = read('.github/notify/templates/release.md');
const step = (job, name) => workflow.jobs[job].steps.find(item => item.name === name);
const releaseTag =
  "${{ github.event_name == 'workflow_dispatch' && format('v{0}', inputs.version) || github.ref_name }}";
const storeConfigured = ['CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'codetree-release-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'bin'));
  return root;
}

function tool(root, name, body) {
  writeFileSync(join(root, 'bin', name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(root, 'bin', name), 0o755);
}

// GitHub runs `run` steps with `bash --noprofile --norc -eo pipefail`.
function run(script, root, env) {
  return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd: root,
    encoding: 'utf8',
    env: {...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...env},
  });
}

const calls = root => (existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8') : '');

test('releases run from stable tags or a manual version and verify the same tag', () => {
  assert.deepEqual(workflow.on.push.tags, ['v*']);
  assert.equal(workflow.on.workflow_dispatch.inputs.version.required, true);
  assert.equal(workflow.env.RELEASE_TAG, releaseTag);
  assert.equal(workflow.jobs.verify.with.release_tag, releaseTag);
  assert.equal(workflow.concurrency.group, `codetree-release-${releaseTag}`);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  assert.equal(workflow.jobs.publish.needs, 'verify');
  assert.deepEqual(workflow.jobs.publish.permissions, {contents: 'write'});
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name !== 'publish' && job.permissions) assert.notEqual(job.permissions.contents, 'write', name);
  }
});

test('manual releases tag the verified commit only from the default branch', t => {
  const root = sandbox(t);
  tool(root, 'gh', 'echo "gh $*" >> "$RUNNER_TEMP/calls.log"\ncase "$*" in *git/tags*) echo tag-object ;; esac');
  const tagStep = step('publish', 'Create tag (manual runs)');
  assert.equal(tagStep.if, "github.event_name == 'workflow_dispatch'");
  const env = {
    RUNNER_TEMP: root,
    RELEASE_TAG: 'v1.0.0',
    DEFAULT_BRANCH: 'main',
    GITHUB_REPOSITORY: 'ziqq/Codetree',
    GITHUB_SHA: 'a'.repeat(40),
    GH_TOKEN: 'synthetic-test',
  };

  const rejected = run(tagStep.run, root, {...env, GITHUB_REF: 'refs/heads/feature'});
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout, /only from main/);
  assert.equal(calls(root), '');

  const created = run(tagStep.run, root, {...env, GITHUB_REF: 'refs/heads/main'});
  assert.equal(created.status, 0, created.stderr);
  const [tag, ref] = calls(root).trim().split('\n');
  assert.match(
    tag,
    /repos\/ziqq\/Codetree\/git\/tags -f tag=v1\.0\.0 -f message=Codetree 1\.0\.0 -f object=a{40} -f type=commit/,
  );
  assert.match(ref, /repos\/ziqq\/Codetree\/git\/refs -f ref=refs\/tags\/v1\.0\.0 -f sha=tag-object/);
  assert.match(step('publish', 'Publish GitHub Release').run, /--verify-tag/);
});

test('release notes combine the changelog, commits since the previous tag, details and checksum', t => {
  const root = sandbox(t);
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  mkdirSync(join(root, 'dist'));
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'src/manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      version: '1.0.0',
      description: 'Synthetic description.',
      minimum_chrome_version: '116',
    }),
  );
  writeFileSync(
    join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## 1.0.0\n\n- **ADDED**: current entry\n\n## 0.9.0\n\n- **ADDED**: previous entry\n',
  );
  writeFileSync(join(root, 'dist/codetree-1.0.0.zip'), Buffer.alloc(2048));
  writeFileSync(join(root, 'dist/codetree-1.0.0.sha256'), `${'b'.repeat(64)}  codetree-1.0.0.zip\n`);
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'old change');
  git('tag', 'v0.9.0');
  git('commit', '-q', '--allow-empty', '-m', 'new change');
  const notes = step('publish', 'Write release notes');
  assert.equal(notes.env.STORE_EXTENSION_ID, '${{ vars.CWS_EXTENSION_ID }}');

  const result = run(notes.run, root, {RELEASE_TAG: 'v1.0.0', STORE_EXTENSION_ID: ''});
  assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(join(root, 'dist/release-notes.md'), 'utf8');
  assert.ok(text.startsWith('Synthetic description.\n\n## Install\n'));
  assert.match(text, /Download \*\*codetree-1\.0\.0\.zip\*\*/);
  assert.match(text, /## What's new\n\n- \*\*ADDED\*\*: current entry\n/);
  assert.doesNotMatch(text, /previous entry/);
  assert.match(text, /## Changes since v0\.9\.0\n\n- new change \([0-9a-f]+\)\n/);
  assert.doesNotMatch(text, /old change/);
  assert.match(
    text,
    /\| Version \| 1\.0\.0 \|\n\| Minimum Chrome \| 116 \|\n\| Manifest \| V3 \|\n\| Archive size \| 2\.0 KiB \|/,
  );
  assert.match(text, new RegExp(`\`\`\`\\n${'b'.repeat(64)}  codetree-1\\.0\\.0\\.zip\\n\`\`\``));
  assert.doesNotMatch(text, /Chrome Web Store/);

  const store = run(notes.run, root, {RELEASE_TAG: 'v1.0.0', STORE_EXTENSION_ID: 'store-item'});
  assert.equal(store.status, 0, store.stderr);
  assert.match(
    readFileSync(join(root, 'dist/release-notes.md'), 'utf8'),
    /chromewebstore\.google\.com\/detail\/store-item/,
  );

  const missing = run(notes.run, root, {RELEASE_TAG: 'v1.0.1'});
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Release changelog section is missing/);
});

test('Chrome Web Store submission is read-only and skipped until configured', () => {
  const job = workflow.jobs['chrome-web-store'];
  assert.equal(job.needs, 'publish');
  assert.deepEqual(job.permissions, {contents: 'read'});
  assert.equal(job.env.CWS_PUBLISHER_ID, 'f3cf73d3-37ce-4ab4-88a4-5cb1fce26075');
  assert.equal(job.env.CWS_EXTENSION_ID, '${{ vars.CWS_EXTENSION_ID }}');
  for (const name of storeConfigured.slice(1)) assert.equal(job.env[name], `\${{ secrets.${name} }}`);
  const [report, ...steps] = job.steps;
  for (const name of storeConfigured) assert.match(report.if, new RegExp(`env\\.${name} == ''`));
  assert.match(report.run, /::warning::/);
  for (const item of steps) {
    for (const name of storeConfigured) assert.match(item.if, new RegExp(`env\\.${name} != ''`), item.name);
  }
});

test('Chrome Web Store submission requires a processed upload of the release version before review', t => {
  const script = step('chrome-web-store', 'Upload and submit for review').run;
  const env = {
    RELEASE_TAG: 'v1.0.0',
    CWS_PUBLISHER_ID: 'publisher',
    CWS_EXTENSION_ID: 'item',
    CWS_CLIENT_ID: 'client',
    CWS_CLIENT_SECRET: 'secret',
    CWS_REFRESH_TOKEN: 'refresh',
    MOCK_TOKEN: '{"access_token":"token"}',
    MOCK_UPLOAD: '{"uploadState":"IN_PROGRESS"}',
    MOCK_STATUS: '{"lastAsyncUploadState":"SUCCEEDED","crxVersion":"1.0.0"}',
    MOCK_PUBLISH: '{"state":"PENDING_REVIEW"}',
  };
  const submit = overrides => {
    const root = sandbox(t);
    tool(root, 'python3', 'echo "python3 $*" >> "$RUNNER_TEMP/calls.log"');
    tool(root, 'sleep', ':');
    tool(
      root,
      'curl',
      [
        'echo "curl $*" >> "$RUNNER_TEMP/calls.log"',
        'case "$*" in',
        '  *oauth2.googleapis.com/token*) echo "$MOCK_TOKEN" ;;',
        '  *upload/v2/publishers/publisher/items/item:upload*) echo "$MOCK_UPLOAD" ;;',
        '  *v2/publishers/publisher/items/item:fetchStatus*) echo "$MOCK_STATUS" ;;',
        '  *v2/publishers/publisher/items/item:publish*) echo "$MOCK_PUBLISH" ;;',
        'esac',
      ].join('\n'),
    );
    const result = run(script, root, {...env, RUNNER_TEMP: root, ...overrides});
    return {...result, calls: calls(root)};
  };

  const submitted = submit({});
  assert.equal(submitted.status, 0, submitted.stderr);
  assert.match(submitted.calls, /python3 scripts\/package\.py --tag v1\.0\.0 --verify dist\/codetree-1\.0\.0\.zip/);
  assert.match(
    submitted.calls,
    /-T dist\/codetree-1\.0\.0\.zip https:\/\/chromewebstore\.googleapis\.com\/upload\/v2\//,
  );
  assert.match(submitted.calls, /items\/item:fetchStatus/);
  assert.match(
    submitted.calls,
    /\{"publishType":"DEFAULT_PUBLISH"\} https:\/\/chromewebstore\.googleapis\.com\/v2\/publishers\/publisher\/items\/item:publish/,
  );
  assert.match(submitted.stdout, /::add-mask::token/);
  assert.match(submitted.stdout, /Chrome Web Store state: PENDING_REVIEW/);

  for (const [overrides, error] of [
    [{MOCK_TOKEN: '{}'}, /access token was not issued/],
    [{MOCK_STATUS: '{"lastAsyncUploadState":"FAILED"}'}, /upload ended with state 'FAILED'/],
    [
      {MOCK_STATUS: '{"lastAsyncUploadState":"SUCCEEDED","crxVersion":"0.9.0"}'},
      /accepted version 0\.9\.0 instead of 1\.0\.0/,
    ],
  ]) {
    const failed = submit(overrides);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout, error);
    assert.doesNotMatch(failed.calls, /:publish/);
  }

  const rejected = submit({MOCK_PUBLISH: '{"state":"REJECTED"}'});
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout, /submission ended with state 'REJECTED'/);
});

test('post-publication jobs complete issues and report every release outcome', () => {
  const issues = workflow.jobs['complete-issues'];
  assert.equal(issues.needs, 'publish');
  assert.equal(issues.if, "needs.publish.result == 'success'");
  assert.deepEqual(issues.permissions, {contents: 'read', issues: 'write'});
  assert.deepEqual(issues.concurrency, {group: 'labels-${{ github.repository }}', 'cancel-in-progress': false});
  const labeler = issues.steps.find(item => item.uses?.startsWith('ziqq/actions/labeler@'));
  assert.equal(labeler.uses, 'ziqq/actions/labeler@a991545704ba3fc43380d2b6024db3ca6935e4a7');
  assert.equal(labeler.with.operation, 'release-completed');
  assert.equal(labeler.with['config-source'], 'api');
  assert.equal(labeler.with['allow-empty'], 'true');
  assert.equal(labeler.with['allow-pattern-removal'], 'true');

  const notify = workflow.jobs.notify;
  assert.deepEqual(notify.needs, ['verify', 'publish', 'chrome-web-store']);
  assert.equal(notify.if, 'always()');
  assert.deepEqual(notify.permissions, {contents: 'read'});
  assert.equal(
    notify.steps.find(item => item.uses?.startsWith('actions/checkout@')).with.ref,
    '${{ github.event.repository.default_branch }}',
  );
  const action = notify.steps.find(item => item.uses?.startsWith('ziqq/actions/notify@'));
  assert.equal(action.with['failure-policy'], 'required');
  assert.match(action.with.variables, /"status_label": .*'failure'.*'cancelled'.*'skipped'.*'success'/);
  assert.match(
    action.with.variables,
    /needs\.publish\.outputs\.release && fromJSON\(needs\.publish\.outputs\.release\)\.html_url \|\| ''/,
  );
});

test('every release notification supplies the variables its template uses', () => {
  const used = new Set([...template.matchAll(/\{\{(?:#if |url )?([a-z_]+)\}\}/g)].map(match => match[1]));
  assert.deepEqual([...used].sort(), ['release_name', 'release_tag', 'release_url', 'status_label']);
  const manual = notifications.jobs['release-published'].steps.find(item =>
    item.uses?.startsWith('ziqq/actions/notify@'),
  );
  const automatic = workflow.jobs.notify.steps.find(item => item.uses?.startsWith('ziqq/actions/notify@'));
  for (const variables of [manual.with.variables, automatic.with.variables]) {
    assert.deepEqual([...variables.matchAll(/^\s*"([a-z_]+)":/gm)].map(match => match[1]).sort(), [...used].sort());
  }
  assert.match(template, /\{\{#if status_label\}\}/);
  assert.match(template, /\{\{#if release_url\}\}\n\[Open release\]/);
});
