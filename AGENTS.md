# Code Tree

Code Tree is a Chrome/Chromium Manifest V3 extension for GitHub/GitLab repository navigation and file review. It has no runtime dependencies, backend or cloud service. A private npm package provides development checks, and Python packages the unchanged runtime files.

## General rules

1. Ask before adding functionality that has not been discussed. Do not introduce unrelated features, dependencies or architecture.
2. Never add/edit tests before the main implementation is confirmed. Regression coverage must demonstrate the old failure and preserve intended behavior.
3. Inspect `git status` and the relevant diff first. Never overwrite the maintainer's edits to earlier agent code without confirmation.
4. Avoid overengineering. Follow existing modules and keep changes narrow.
5. Keep `CHANGELOG.md` newest first and entries ordered **DEPRECATED**, **ADDED**, **CHANGED**, **FIXED**; omit unused categories.
6. Respect present lint/analysis configuration, including `analytics_options.yaml` or `analysis_options.yaml` when working with other languages. Neither is currently used by this JavaScript extension.
7. Use English identifiers, documentation and commits. Discuss decisions in the maintainer's language.

## Environment setup

Load the repository root as an unpacked extension in Chrome/Chromium 116+. Reload the extension and refresh repository tabs after changes. Use Node.js 24, `npm ci` and Python 3 for the full development/packaging checks; these tools are not needed by users loading the extension.

## Project structure

- `core.js`: defaults/preferences, routes/URLs, original icons, tree logic and patch validation.
- `syntax.js`: original lexical highlighting with bounded tokens, yielding and cancellation; render token ranges as text nodes.
- `background.js`: trusted service worker, host-bound broker, accounts/storage, bounded cache and GitHub REST/GraphQL adapter.
- `gitlab.js`: GitLab adapter using the broker's client/cache.
- `oauth*.js`: public client IDs and trusted OAuth device/PKCE/refresh flows. Never add a client secret; registration and live sign-in remain pending until the maintainer supplies IDs.
- `content.js`: Shadow DOM sidebar/viewer and native diff-header buttons.
- `sidebar.css`: isolated UI styles; page styles are constructed in `content.js`.
- `options.*`: appearance and account settings.
- `manifest.json`, `icons/`: distribution metadata and original assets.
- `scripts/`, `.github/workflows/`: validation, deterministic runtime packaging and releases by stable tag.
- `docs/`, `PRIVACY.md`: feature boundaries and validation/data records.

## Key commands

```sh
git status --short
npm ci
npm run verify
npm audit --audit-level=high
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
git diff --check
```

`npm test` runs approved regressions for Viewed revision checks, asynchronous tree loading, full-file patch validation and release follow-up wiring. Follow the implementation-approval rule before changing coverage. Syntax/unit-test success does not prove browser or authenticated API behavior.

## Coding conventions

- Two spaces, single quotes, semicolons and explicit DOM APIs.
- Render server/user text with `textContent`; no `innerHTML`, `eval` or remote executable dependencies.
- Keep tokens/API requests in the trusted broker. Settings sends account commands to the service worker.
- Validate origins, providers, repository identifiers, source revisions and paths; bind requests to the sender's configured host.
- Preserve token-only API headers, `credentials: 'omit'`, `redirect: 'error'`, timeouts and trusted-only storage access.
- Bound caches and render visible rows. Never present truncated responses as complete.
- Keep persisted trees scoped by account/host/repository/revision, clear them on Refresh/account changes and reject stale cache writes after invalidation. Do not persist raw files or comments.
- Use validated patches and exact request revisions for full-file diffs. Preserve limits/error paths.
- Distinguish local GitLab Viewed marks from synchronized GitHub marks.
- Native selectors may change. Keep insertion idempotent and clean up on navigation. Do not copy another extension's source/assets.

## Validation and delivery

Verify affected browser interactions and use real public APIs when possible. Separate fixture proof, live read-only API proof, Chrome installation, authenticated writes and self-managed servers. Preserve unrelated failures and user changes.

Keep fixtures, archives, development tools, temporary screenshots and secrets out of the runtime package. Identify fixture images in README. Stage intended paths, inspect archive contents and verify the remote before an authorized push. Follow [Checks and releases](docs/RELEASING.md); tags must match manifest/development/changelog versions and an approved license. Do not create tags, releases or store submissions without a request.

The maintainer has approved the custom [Code Tree Source-Available License 1.0](LICENSE): workplace use and free forks are allowed; monetization of covered derivatives, including donations and paid fork services, is restricted. Preserve the full terms in distribution packages. License changes belong to the maintainer; do not replace these terms or grant additional commercial rights without authorization.
