# Features

The same Codetree sidebar serves both providers. This table describes the implementation rather than promising identical behavior across server editions.

| Capability | GitHub | GitLab |
| --- | --- | --- |
| Repository tree | Recursive tree, folder fallback if truncated | Paginated folder loading; nested namespaces |
| File/folder search | Loaded files; optional full folder loading | Loaded files; optional full folder loading |
| Branch selection | Branch list, slash-containing names, default branch | Branch list, slash-containing names, default branch |
| Changed-file tree | PRs and commits | MRs and commits |
| File/folder statistics | API additions/deletions | Counts from available diff hunks; omitted patches cannot contribute complete counts |
| Inline comments | PR/commit comments | MR discussion notes/replies and commit comments; API access may require a token |
| Viewed marks | Native GraphQL when available, explicit local fallback | Local, scoped to project/request/head/account |
| Whole-file preview | Merge-base/head or first parent/commit | Merge-base/head or first parent/commit; source and target project IDs for forks |
| Native View full button | Current React headers and legacy file headers | RapidDiffs headers and legacy file headers |
| Open request list | REST; GraphQL with account | Paginated merge-request list |
| Requested from me | Personal reviewer requests | Current account's unreviewed/review-started/unapproved reviewer state |
| Reviewed by me | Submitted review history, including dismissed reviews | Completed reviewer state or current approval by the account |
| Changes requested | Aggregate decision or latest individual decisions | Requested-changes reviewer state / supported server decision |
| Approved | Aggregate decision or latest individual decisions | Actual approvals or approved reviewer states; not a guarantee that merge requirements are satisfied |
| No reviews | No submitted, non-dismissed review | No completed reviewer state/current approval; withdrawn historical reviews may not be represented |
| Multiple accounts | PATs per host, automatic/manual selection | PATs per host, automatic/manual selection |
| Custom server | GitHub Enterprise Server over HTTPS | Self-managed GitLab over HTTPS |

Both providers require a token for review-state filters. GitLab reviewer/approvals APIs and states depend on server version, edition and permissions. Failures remain visible; an unsupported filter is not silently returned as an empty list.

## Full-file review

The native button is inserted into a changed file's header. A rerendered header gets one button; a route change clears the old bindings. The sidebar can stay closed. Headers with a native file path receive the button even when API access fails; clicking offers account connection/retry guidance. Website sign-in and extension API authentication are separate. Text previews include all unchanged context, additions and removals, old/new line numbers and previous/next file navigation.

An unchanged rename loads the previous path at the base revision and the new path at the head revision. Added/deleted files use an empty opposite revision. Known binary extensions have disabled native buttons; encoding, binary content and size checks also run in the broker.

Changed text must have a complete patch that matches both source revisions. Missing/truncated or incompatible patches show an error with a native diff link. There is no fallback that presents an incomplete file diff as complete.

The viewer does not submit reviews/comments or replace the provider's review editor. Use native pages for review conversations, approvals and merges.

## Shared appearance and navigation

- Left/right sidebar, pinning per browser window, hover opening, resizing and labeled collapsed edge tab. The Appearance default is applied when a window first opens Codetree; the pin button updates repository tabs in that window. Session pin states reset on extension/browser restart.
- File and folder icons from [file-icons/atom](https://github.com/file-icons/atom), matched by the same path and name rules: Color uses its theme-specific colours, Monochrome the muted text colour, and Minimal the original simple icons. Files without a rule use the original icons.
- System monospace and locally installed named code fonts, with configurable size.
- Configurable toggle/search shortcuts, up to eight comma-separated alternatives per action; blank disables the action. Ctrl/Cmd/Alt/Shift/Mod, single keys and named navigation/function keys are supported. Typing, composition, AltGraph and key repeats do not trigger them; browser-reserved combinations may take priority. Arrow-key tree navigation remains available.
- All-repository or code/review page scope and up to 64 full-URL exclusions. Patterns use a literal URL with * wildcards. Hidden pages do not load the sidebar or insert View full controls.
- Folder-name click can expand/collapse a folder or just focus its row; its disclosure button and keyboard navigation always work.
- Persistent revision/account/host-scoped tree cache, capped at 48 entries/4 MiB/24 hours. Refresh and account changes clear it; storage quota failure falls back to uncached persistence. File text/comments remain in bounded worker memory only.
- Original lexical syntax colors for JavaScript/TypeScript, Dart, Go, Rust, Python, Ruby, PHP, Java, Kotlin, Swift, C/C++, C#, shell, SQL, CSS, JSON, YAML, TOML, HTML/XML and Markdown. Each revision has independent multiline string/comment state. Tokenization yields in chunks, supports cancellation and falls back to complete plain text past 200,000 tokens per revision. Embedded-language/semantic parsing is not implemented.
- Local bookmarks for repository-host pages, without a product-imposed count limit; browser storage limits still apply.

## Current boundaries

GitHub device flow and GitLab PKCE/refresh are prepared, but this build has no registered client IDs and cannot complete live OAuth sign-in yet. See [OAuth setup](OAUTH.md). Optional browser Sync covers preferences and bookmarks within one browser ecosystem. Cross-browser sync and GitLab native Viewed synchronization are absent. Named fonts are not downloaded. The lexical highlighter does not claim full grammar parity. These boundaries are also listed in README.

## Feature coverage

Reviewed on 2026-10-02. Codetree is a working beta covering ten common repository-sidebar capability groups with an independent implementation. The table separates implemented behavior from verified environments.

| Capability group | Codetree status |
| --- | --- |
| PR/commit changed-file tree | Implemented with statistics, comments and Viewed marks. Public GitHub comments and local Viewed are verified; authenticated GitHub writes and GitLab discussions remain pending. |
| Full-file diffs | Verified on real GitHub/GitLab pages, including a closed sidebar and collapsed native file. Text limits and unavailable-preview states are documented. |
| Request list and review filters | Lists are verified on public pages. Five review filters are implemented and fixture-tested; real authenticated filtering remains pending. |
| Branch selection | Branch menus/search and branch-root navigation are implemented; public branch loading is verified. |
| Code font settings | Font/size settings are implemented and fixture-tested. Named fonts require local installation. |
| File icon themes | file-icons/atom icons in Color and Monochrome, plus the original Minimal style; verified on live GitHub and GitLab repositories. |
| Unlimited bookmarks | Local repository/file/issue/request bookmarks are implemented, without a product count limit; browser storage limits apply. |
| Sidebar docking | Left/right docking, pinning, hover opening and resizing are implemented and fixture-tested. |
| Multiple accounts | PAT accounts and automatic/manual selection are implemented; real multi-account verification remains pending. |
| GitHub Enterprise | HTTPS custom-host support is implemented; a live Enterprise Server has not been verified. |

Configurable shortcuts, pinning per browser window, page-display/hide patterns, folder click preferences and a persistent tree cache are also implemented. OAuth is prepared pending registration and live verification. GitLab repository/MR support is an additional provider implementation, with the differences above.
