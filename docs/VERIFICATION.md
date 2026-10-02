# Verification

Version: **0.2.0**. Date: **2026-10-02**.

This record distinguishes local behavior from live-server and installed-extension proof. The maintainer authorized fixes and regression verification after the release review.

## Release-review regressions

The 23 approved Node.js checks pass on the corrected implementation. Running the same checks against the previous `f83e0d5` source produces 17 failures and 6 passes. Coverage includes fresh PR/MR head checks with cached and expired metadata, local and mocked synchronized Viewed marking/unmarking, rejected missing revisions/unrelated paths, stale folder replies, replacement requests for the same folder, interrupted load-all operations, overlapping tree loads, CRLF/full-file validation and explicit post-publication automation wiring. The release adapter is exercised with a local dummy action process and fake release API response; draft releases are rejected. No real release, label change or notification is sent by these tests.

GitHub's Viewed mutation does not accept an expected head SHA. The broker checks current metadata immediately before the mutation, but a concurrent push during the remote mutation cannot be prevented atomically by this API.

The exact pinned `ziqq/actions` labeler bundle was also run locally through the workflow adapter. A fake loopback API confirmed that it accepted the published-release event, read `.github/labels.json` from `main`, queried issues/labels and completed with an empty target selection. All three requests were local GETs; this did not publish a release or change GitHub state.

## Navigation-review regressions

Eight additional checks exercise the production branch, refresh and review-list handlers with controlled RPC completion order. The complete suite now passes 31 checks. Running these eight checks against the previous `11e2480` content script produces 6 failures and 2 passes: stale branch results/errors, refresh replies during navigation and errors from a superseded PR/MR filter are rejected; current refreshes and current filter errors still work.

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
- Release-review fixes: a GitLab folder response delayed by three seconds did not add repository-only files after switching to the changes tree; Viewed marking/unmarking succeeded on both providers; header previews opened with the sidebar closed, including a collapsed GitHub file.

Additional local broker checks verified GitHub, GitLab and custom GitLab account validation with synthetic tokens, custom-host script registration, token-free state responses, host-bound headers, disabled redirects/cookies and four rejected requests without a network call. These include cross-host access, untrusted account changes and invalid source project/file paths.

Earlier local checks covered GitHub review filters, comments, Viewed, bookmarks, slash-containing branches, docking and preferences; core patch mismatch/truncation errors; empty repositories and 404 responses; host/token isolation; a 50,000-file synthetic tree with visible-row rendering. Those checks do not establish performance on real devices or live authenticated servers.

README screenshots are captures of the local fixture. JavaScript syntax, manifest references and final archive contents are checked separately during packaging.

## Installed Chrome

Code Tree 0.2.0 was confirmed enabled as an unpacked extension in the maintainer's Chrome profile, with Octotree disabled. The installed directory was synchronized with the `fe8f277` source. Chrome's extension Details page confirmed the directory, and the extension's Reload action displayed its restarted confirmation. The service worker was inactive immediately afterward; refreshing the repository tabs successfully initialized the extension. The following checks were repeated after Reload using actual extension messaging/storage and live public pages, without a PAT:

- GitHub `ziqq/Codetree`: repository tree, branches, file search and Refresh worked; the sidebar background matched the page's computed background.
- GitHub `octocat/Hello-World`, PR #1: native-header `View full` opened a validated 7-row preview with the sidebar closed and the native file collapsed. Local Viewed marking and unmarking succeeded.
- GitLab `gitlab-org/cli`, MR !3991: both native-header buttons appeared; a collapsed file opened with the sidebar closed. The complete `label_list.go` preview contained 206 diff lines with unchanged context and highlighted changes; scrolling reached the last head-revision line. Next-file navigation opened the 275-line test-file preview.
- GitLab local Viewed marking/unmarking, repository folder loading and the open-MR list worked. The unauthenticated Approved filter showed token guidance; switching back to All restored results.

The `fe8f277` smoke check passed after Reload. No Code Tree-specific errors were identified in the captured page logs; both pages also recorded an unattributed `MessageNotSentError`, whose source could not be established from the available log data. Local Viewed marks were restored to unmarked after verification. Public-page interactions verify the normal flows; the asynchronous race cases use the production handlers with controlled RPC completion above. Authenticated provider writes remain unverified.

Follow-up checks used new Chrome tabs with fresh captured logs. GitHub tree loading, Refresh and page reload, plus GitLab full-file preview, completed with no error entries; the earlier `MessageNotSentError` was not reproduced. Chrome's extension Details page did not display a recorded error for Code Tree. This does not establish the source of the earlier message.

Two idle/wake cycles were confirmed through Chrome's actual extension Details UI. With the worker shown inactive, GitHub Refresh loaded the repository tree; refreshing Details showed the worker active. After another 40-second idle period, Details showed the worker inactive again. Opening the GitLab full-file preview then loaded all 206 diff lines, and refreshed Details showed the worker active. The sidebar's initially closed preference was restored after the checks. The actual Settings page had no connected accounts, so real PAT, private-repository and authenticated review checks still require an account and selected repository URLs.

## Navigation, highlighting and OAuth follow-up

The existing 31 regressions still pass; no test file was added or changed for this follow-up. One-off checks exercised the production helpers and broker with synthetic Chrome APIs/network responses:

- Shortcut defaults, exact modifiers, Ctrl/Cmd alternatives, disabled actions, conflicting bindings and invalid duplicate modifiers.
- GitHub/GitLab code/review scope and URL wildcard exclusions.
- Highlighting range bounds and preservation of the original source text across eight sample languages, multiline state, cancellation and the 200,000-token plain-text fallback.
- Persisted tree reuse in a newly created worker, Refresh invalidation, superseded fresh replies, the 48-entry cap and isolation of window pin states. A late default initialization retained an existing window override.
- OAuth device scopes, polling intervals, pending/slow-down replies, cancellation and response validation; GitLab PKCE, state/exact callback checks and direct token refresh. Refreshed identity was checked, and removing an account during refresh prevented a stale credential write. These simulations used synthetic IDs/tokens and made no provider requests.

On an actual private GitHub PR accessible through website sign-in, the missing native **View full** button was reproduced: the extension had no API account, initialization returned 404 and header insertion depended on successful API data. After fixing insertion and reloading the installed extension, the same file header displayed the button with the sidebar closed. Clicking it displayed an explicit access error with **Connect account in Settings** and **Retry**. Native Viewed state and review drafts were not changed. Private full-file content still requires an extension account; website sign-in alone does not establish API access. Private source screenshots remain local and are not included in this repository.

After unlocking the Mac, the installed extension was reloaded from the synchronized source and the live smoke check resumed:

- GitHub `ziqq/Codetree`: repository loading and file search worked; filtering for `core.js` returned that file. The default toggle closed the sidebar, the search shortcut opened/focused search, and typing the toggle shortcut in the input did not close it.
- Toggling the window pin propagated to another Code Tree tab in the same Chrome window. The original pinned state and closed-sidebar preference were restored afterward. Isolation between different windows remains covered by the synthetic broker check above.
- GitLab MR !3991: the native button opened the complete 206-line Go diff with lexical keyword/string colors and 40 rendered rows for the current viewport/buffer.
- GitHub commit `3b41a65`: native headers had no diff IDs, revealing a separate insertion gap. Using each React header's nearest file region fixed it. After another extension Reload, the native `core.js` button opened its validated 298-line full diff with lexical JavaScript colors; no header had duplicate controls, and the captured fresh page logs had no errors.
- A new private GitHub PR tab retained its native button with the sidebar closed, but still had no connected extension account. Private file content remains pending account connection. Website review drafts and native Viewed state were not changed.

The Mac locked again while opening Settings for the PAT handoff, so its final native Settings state was not confirmed. Custom shortcut bindings/page-display rules/folder-click choices use the production helper checks above; this smoke used their default settings. Live OAuth remains unavailable until registered client IDs are supplied; actual sign-in, browser authorization and provider-side refresh are not proven by the simulations.

## CI and packaging checks

Local ESLint, CSS lint, JavaScript syntax, manifest/CSP/asset/icon/doc/YAML/lockfile/changelog validation and pinned `actionlint` checks passed. The installed development dependency audit reported no vulnerabilities. No linter rules were weakened to accept the existing source.

The runtime builder checks its allowlist against manifest/imported/HTML assets, places `manifest.json` at the ZIP root and verifies all source bytes, CRCs, metadata and SHA-256. Before license adoption, the missing license rejected publication even for a matching tag. After the maintainer approved the strict Code Tree Source-Available License 1.0, the local matching-tag check passed and the mismatched tag remained rejected. That earlier licensed ZIP contained 14 runtime/privacy/license files; two local builds matched byte-for-byte. The OAuth/highlighting follow-up adds three runtime modules, making 17 packaged files.

All steps in the actual [Verify Code Tree run for `fe8f277`](https://github.com/ziqq/Codetree/actions/runs/37025445689) passed, including the 31 regressions, workflow validation, dependency audit and packaging. Its downloaded ZIP matched the checkout build and a separate clean `git archive` build byte-for-byte. The runtime ZIP is 145,292 bytes; SHA-256: `88f297c2ce1afe81441ea9c56638c7779416f22af029ff16af64d5b4d1e1f925`. No tag or release was created.

The follow-up [Verify Code Tree run for `3b41a65`](https://github.com/ziqq/Codetree/actions/runs/37046485013) also passed every step: 31 existing regressions, JavaScript/CSS/static checks, workflow validation, dependency audit, reproducible packaging and artifact upload. Its downloaded ZIP matched both the checkout package and a clean committed archive byte-for-byte. This build contains 17 files and is 189,412 bytes; SHA-256: `27dc501ca370365ec79a9fd417c7cdda11c19142c1e03e5757b1db27478a25bc`. The audit found no vulnerabilities. No tag, release or store publication was made.

## Pending environments

- Full browser restart.
- Private GitHub/GitLab repositories with real PATs.
- Registered GitHub/GitLab OAuth sign-in, denial/cancellation, provider token refresh and idle/wake during authorization.
- Native GitHub Viewed writes and authenticated GitLab discussions/review endpoints.
- Live GitHub Enterprise Server and self-managed GitLab, including older layouts/versions.
- Firefox, Safari and extension-store distribution.

Actual public page DOM was inspected read-only to select GitHub React and GitLab RapidDiffs header anchors. The extension was not injected into live pages during that inspection. Fixture interactions and direct API checks do not replace the pending environment checks.
