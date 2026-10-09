# Codetree

Codetree is a Chrome/Chromium Manifest V3 extension for GitHub/GitLab repository navigation and file review. It has no runtime dependencies or Codetree backend. Opt-in browser Sync stores only preferences and bookmark metadata. A private npm package provides development checks, Sass compilation and esbuild bundling of `src/` into `build/`; Python packages the bundled runtime files.

## General rules

1. Ask before adding functionality that has not been discussed. Do not introduce unrelated features, dependencies or architecture.
2. Never add/edit tests before the main implementation is confirmed. Regression coverage must demonstrate the old failure and preserve intended behavior.
3. Inspect `git status` and the relevant diff first. Never overwrite the maintainer's edits to earlier agent code without confirmation.
4. Avoid overengineering. Follow existing modules and keep changes narrow.
5. Keep `CHANGELOG.md` newest first and entries ordered **DEPRECATED**, **ADDED**, **CHANGED**, **FIXED**; omit unused categories.
6. Respect present lint/analysis configuration, including `analytics_options.yaml` or `analysis_options.yaml` when working with other languages. Neither is currently used by this JavaScript extension.
7. Use English identifiers, documentation and commits. Discuss decisions in the maintainer's language.

## Environment setup

Run `npm ci` and `npm run build`, then load `build/` as an unpacked extension in Chrome/Chromium 116+. Rebuild, reload the extension and refresh repository tabs after changes. Use Node.js 24 and Python 3 for the full development/packaging checks; users loading a release ZIP need neither.

## Project structure

- `src/shared/`: preferences/shortcuts, routes/URLs, tree model, patch validation, reactive primitives and original icons; side-effect-free ES modules used by every context.
- `src/background/`: trusted service worker. `index.js` routes messages; `storage`, `cache`, `http`, `client`, `hosts`, `accounts` and `validate` hold the host-bound broker, bounded caches and request validation.
- `src/background/providers/`: GitHub REST/GraphQL and GitLab REST adapters, each with its own request handler.
- `src/background/sync.js`: opt-in, bounded browser Sync for whitelisted preferences/bookmarks; credentials and caches stay local.
- `src/background/oauth/`: public client IDs and trusted OAuth device/PKCE/refresh flows. Never add a client secret; registration and live sign-in remain pending until the maintainer supplies IDs.
- `src/content/`: Shadow DOM sidebar. `app.js` composes feature factories (`createX(app)`) from `sidebar/`, `viewer/` and `native/`; factories receive shared state and functions through `app`, so they run in tests without a page.
- `src/content/viewer/syntax.js`: original lexical highlighting with bounded tokens, yielding and cancellation; render token ranges as text nodes.
- `src/content/sidebar.scss`, `styles/_themes.scss`: isolated UI styles and GitHub/GitLab light/dark palettes. `page.scss` styles native controls; `sidebar/layout.js` adds runtime preference values.
- `src/options/`: appearance and account settings.
- `src/manifest.json`, `src/icons/`: distribution metadata and original assets.
- `vendor/file-icons/`, `scripts/file-icons.mjs`: maintainer-approved file-icons/atom rules, styles and fonts, compiled into the content script at build time. Keep the files unmodified, record the source commit and keep `THIRD_PARTY_NOTICES.md` packaged.
- `scripts/`, `.github/workflows/`: bundling, validation, deterministic runtime packaging and releases by stable tag.
- `docs/`, `PRIVACY.md`: architecture, feature boundaries and validation/data records. Read [Architecture](docs/ARCHITECTURE.md) before changing messages, storage or the content factories.
- Document every module and function with JSDoc (Python: docstrings); explain non-obvious invariants such as request generations, limits and security checks.
- Every source file starts with the license header (repository URL, `Copyright (C) 2026 Anton Ustinoff`, license URL); the module description goes inside that header, after an empty line.
- Abbreviations in our names are upper case (`clientID`, `treeSHA`, `redirectURI`, `maxBookmarkURLLength`). Names defined by provider and browser APIs keep their spelling (`pullRequestId`, `clientMutationId`, `windowId`, `getElementById`).

## Key commands

```sh
git status --short
npm ci
npm run verify
npm audit --audit-level=high
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
git diff --check
```

`npm test` runs approved regressions for Viewed revision checks against the bundled service worker, asynchronous tree loading through the content factories, reactive primitives, sidebar rendering and Settings preferences on a minimal fake DOM (`tests/support/`), full-file patch validation and release follow-up wiring. Follow the implementation-approval rule before changing coverage. Syntax/unit-test success does not prove browser or authenticated API behavior.

## Coding conventions

- Prettier formatting (`npm run format`; two spaces, single quotes, semicolons, 120 columns) and explicit DOM APIs.
- Render server/user text with `textContent`; no `innerHTML`, `eval` or remote executable dependencies.
- Keep tokens/API requests in the trusted broker. Settings sends account commands to the service worker.
- Validate origins, providers, repository identifiers, source revisions and paths; bind requests to the sender's configured host.
- Preserve token-only API headers, `credentials: 'omit'`, `redirect: 'error'`, timeouts and trusted-only storage access.
- Bound caches and render visible rows. Never present truncated responses as complete.
- Keep persisted trees scoped by account/host/repository/revision, clear them on Refresh/account changes and reject stale cache writes after invalidation. Do not persist raw files or comments.
- Use validated patches and exact request revisions for full-file diffs. Preserve limits/error paths.
- Distinguish local GitLab Viewed marks from synchronized GitHub marks.
- Native selectors may change. Keep insertion idempotent and clean up on navigation. Do not copy another extension's source/assets; the vendored file-icons/atom icon set is the approved exception.

## Validation and delivery

Verify affected browser interactions and use real public APIs when possible. Separate fixture proof, live read-only API proof, Chrome installation, authenticated writes and self-managed servers. Preserve unrelated failures and user changes.

Keep fixtures, archives, development tools, temporary screenshots and secrets out of the runtime package. Identify fixture images in README. Stage intended paths, inspect archive contents and verify the remote before an authorized push. Follow [Checks and releases](docs/RELEASING.md); tags must match manifest/development/changelog versions and an approved license. Do not create tags, releases or store submissions without a request.

The maintainer has approved the custom [Codetree Source-Available License 1.0](LICENSE): workplace use and free forks are allowed; monetization of covered derivatives, including donations and paid fork services, is restricted. Preserve the full terms in distribution packages. License changes belong to the maintainer; do not replace these terms or grant additional commercial rights without authorization.
