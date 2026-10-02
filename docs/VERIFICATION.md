# Verification

Version: **0.2.0**. Date: **2026-10-02**.

This record distinguishes local behavior from live-server and installed-extension proof. No committed test files were introduced or changed before the maintainer confirms the main implementation.

## Live public APIs

The production service worker and adapters ran in a Node VM with mocked Chrome storage/messaging and real anonymous API requests. Requests only read public repositories; Viewed changes used mocked local storage.

| Case | Result |
| --- | --- |
| GitLab `gitlab-org/cli`, MR !3991 | 30 root entries, folder loading mode, 469 branches, 56 open MRs and 2 changed files |
| GitLab full-file preview | Both raw revisions of `internal/commands/label/list/label_list.go` loaded; the validated full diff produced 205 rows |
| GitLab public discussions | Actual API returned 401 without an account; the adapter reported unavailable comments while the rest of the diff loaded |
| GitHub `octocat/Hello-World`, PR #1 | Repository tree, 3 branches, 1 changed file, inline comments, both file revisions and local Viewed mark loaded |
| GitHub full-file preview | Validated `README` comparison produced 7 rows |

The public smoke check made 39 API requests and no remote writes. Counts describe that snapshot and can change afterward.

## Browser fixture

The local development server serves the real content script, styles, settings page and background broker. It simulates repository API responses and Chrome APIs; fixture files are outside this repository/runtime package.

Checked for the new implementation:

- GitHub and GitLab native-header **View full** insertion, including a disabled binary button.
- Whole-file preview from a header with the sidebar closed, including unchanged context and highlighted changes.
- Unchanged rename resolution using old and new paths.
- GitLab nested namespace routing, changed-file tree and local Viewed labeling.
- All five GitLab review filters using reviewer states and approvals.
- GitLab lazy folder loading and search for a nested file after loading all folders.
- Provider selection in Settings, updated GitLab origin and permission guidance.
- Added/deleted file previews and absence of browser console errors on the fixture/settings pages.
- Theme correction: GitHub light/dark, GitLab light/dark and an arbitrary GitHub token palette. In every case the sidebar's computed background and foreground matched the page; controls inherited the provider's subtle-surface token.
- Full-file viewer retained the GitLab page background and opened from a native header with the sidebar closed after the theme change.

Additional local broker checks verified GitHub, GitLab and custom GitLab account validation with synthetic tokens, custom-host script registration, token-free state responses, host-bound headers, disabled redirects/cookies and four rejected requests without a network call. These include cross-host access, untrusted account changes and invalid source project/file paths.

Earlier local checks covered GitHub review filters, comments, Viewed, bookmarks, slash-containing branches, docking and preferences; core patch mismatch/truncation errors; empty repositories and 404 responses; host/token isolation; a 50,000-file synthetic tree with visible-row rendering. Those checks do not establish performance on real devices or live authenticated servers.

README screenshots are captures of the local fixture. JavaScript syntax, manifest references and final archive contents are checked separately during packaging.

## CI and packaging checks

Local ESLint, CSS lint, JavaScript syntax, manifest/CSP/asset/icon/doc/YAML/lockfile/changelog validation and pinned `actionlint` checks passed. The installed development dependency audit reported no vulnerabilities. No linter rules were weakened to accept the existing source.

The runtime builder checks its allowlist against manifest/imported/HTML assets, places `manifest.json` at the ZIP root and verifies all source bytes, CRCs, metadata and SHA-256. A mismatched tag was rejected, and the current pending license rejected publication even for a matching tag. GitHub Actions execution is recorded separately after the workflow runs.

## Pending environments

- Installation and execution as an actual Chrome extension, including permissions, worker lifecycle and content-script isolation in that environment.
- Private GitHub/GitLab repositories with real PATs.
- Native GitHub Viewed writes and authenticated GitLab discussions/review endpoints.
- Live GitHub Enterprise Server and self-managed GitLab, including older layouts/versions.
- Firefox, Safari and extension-store distribution.

Actual public page DOM was inspected read-only to select GitHub React and GitLab RapidDiffs header anchors. The extension was not injected into live pages during that inspection. Fixture interactions and direct API checks do not replace the pending environment checks.
