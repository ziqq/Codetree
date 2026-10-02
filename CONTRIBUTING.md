# Contributing rules

## Pull request rules

1. Discuss new features with the maintainer first. Keep changes focused; avoid unrelated refactors and dependencies.
2. Inspect the working tree and preserve user changes. Never overwrite the maintainer's edits without confirmation.
3. Confirm the main implementation before adding/changing tests. Regression coverage must expose the previous implementation's mistake; never weaken checks to make a change pass.
4. Follow the existing style: two spaces, single quotes, explicit DOM creation and safe text rendering. Do not add `innerHTML`, `eval`, remote executable code or third-party page scripts.
5. Keep API behavior in the broker/adapters. Tokens belong in trusted extension storage and may only reach the selected API host.
6. Run syntax checks and verify affected browser interactions. Identify checks made with fixtures, live APIs and actual extension installation separately.
7. Update documentation and `CHANGELOG.md`. Keep versions newest first and entries ordered **DEPRECATED**, **ADDED**, **CHANGED**, **FIXED**; omit unused categories.
8. Describe the problem, resulting behavior and validation. Never attach tokens, private source files or personal browser data.

## Environment setup

Chrome/Chromium 114+ is the target. The extension has no runtime dependencies or bundler. Use Node.js 24, locked npm development tools and Python 3 for CI and packaging.

Load the repository root through **Load unpacked** in `chrome://extensions`. After edits, reload the extension and refresh the tab. Inspect its service worker through the Chrome extension card when debugging API/storage behavior.

```sh
npm ci
npm run verify
npm audit --audit-level=high
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
```

No committed automated test suite currently exists. Syntax checks are not functional tests. After implementation approval, add focused regression coverage for real previous failures.

See [Checks and releases](docs/RELEASING.md) for the exact CI gates, runtime allowlist, tag/version validation and artifact verification. Development dependencies, fixtures and screenshots must not enter the runtime ZIP.

## Manual validation

Choose cases relevant to your change:

- Public repositories, empty/error states and the affected provider.
- Nested GitLab namespaces, branch names containing `/` and paths containing spaces.
- Folder loading, search scope and loading all folders.
- PR/MR/commit changes, comments and correct merge-base/head revisions.
- Native **View full** with a closed sidebar, collapsed files and unchanged renames.
- Added/deleted text, binary files, truncated/missing patches and newline changes.
- Viewed marks, review filters and account selection with the required permissions.
- Docking, pin/hover behavior, keyboard navigation, themes and settings.
- Client-side navigation and native file-card rerenders without duplicate buttons.

Use disposable repositories/accounts for writes. Mark private-token and live-server cases as pending when environments are unavailable. A fixture does not prove Chrome permissions, authenticated writes or self-managed server compatibility.

## Issues

Use an ordinary descriptive title. Include Code Tree/browser/OS versions, provider/server version, reproduction steps, expected/actual behavior and a public URL or minimal example. Describe authentication/scopes without token values. Attach sanitized logs or screenshots only when useful.

Keep private source, organization details and credentials out of public issues.

## License

Code Tree uses the custom [Code Tree Source-Available License 1.0](LICENSE). Workplace use, internal modifications, free forks and PRs are permitted; monetization of covered derivatives, including fork-related donations and paid services for third parties, is restricted. Read the full terms before contributing or distributing a fork.

Contribute only material you have the right to provide under compatible terms. Preserve licensing/copyright notices and identify modifications when sharing covered material. Third-party components keep their own licenses; do not import code whose terms conflict with this project's license. Any contributor-specific permissions must be agreed before merging.
