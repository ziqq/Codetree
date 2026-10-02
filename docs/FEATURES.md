# Features

The same Code Tree sidebar serves both providers. This table describes the implementation rather than promising identical behavior across server editions.

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

The native button is inserted into a changed file's header. A rerendered header gets one button; a route change clears the old bindings. The sidebar can stay closed. Text previews include all unchanged context, additions and removals, old/new line numbers and previous/next file navigation.

An unchanged rename loads the previous path at the base revision and the new path at the head revision. Added/deleted files use an empty opposite revision. Known binary extensions have disabled native buttons; encoding, binary content and size checks also run in the broker.

Changed text must have a complete patch that matches both source revisions. Missing/truncated or incompatible patches show an error with a native diff link. There is no fallback that presents an incomplete file diff as complete.

The viewer does not submit reviews/comments or replace the provider's review editor. Use native pages for review conversations, approvals and merges.

## Shared appearance and navigation

- Left/right sidebar, pinning, hover opening, resizing and labeled collapsed edge tab.
- Three original icon styles: Color, Outline and Minimal.
- System monospace and locally installed named code fonts, with configurable size.
- Fixed keyboard shortcuts and arrow-key tree navigation.
- Local bookmarks for repository-host pages, without a product-imposed count limit; browser storage limits still apply.

## Current boundaries

OAuth, cloud sync, configurable shortcuts, per-window pinning and a persistent tree cache are absent. Named fonts are not downloaded. The viewer has no syntax highlighting. GitLab native Viewed synchronization is absent. These boundaries are also listed in README so they are not confused with implemented functionality.

## Octotree comparison

Checked against the current [Octotree feature guide](https://www.octotree.io/features) on 2026-10-02. Code Tree is a working beta with independent equivalents for the ten listed Pro capability groups. The table separates implemented behavior from verified environments; it is not a claim of complete product parity.

| Octotree Pro capability | Code Tree status |
| --- | --- |
| PR/commit changed-file tree | Implemented with statistics, comments and Viewed marks. Public GitHub comments and local Viewed are verified; authenticated GitHub writes and GitLab discussions remain pending. |
| Full-file diffs | Verified on real GitHub/GitLab pages, including a closed sidebar and collapsed native file. Text limits and unavailable-preview states are documented. |
| Request list and review filters | Lists are verified on public pages. Five review filters are implemented and fixture-tested; real authenticated filtering remains pending. |
| Branch selection | Branch menus/search and branch-root navigation are implemented; public branch loading is verified. |
| Code font settings | Font/size settings are implemented and fixture-tested. Named fonts require local installation. |
| File icon themes | Three original styles are implemented and fixture-tested. |
| Unlimited bookmarks | Local repository/file/issue/request bookmarks are implemented, without a product count limit; browser storage limits apply. |
| Sidebar docking | Left/right docking, pinning, hover opening and resizing are implemented and fixture-tested. |
| Multiple accounts | PAT accounts and automatic/manual selection are implemented; real multi-account verification remains pending. |
| GitHub Enterprise | HTTPS custom-host support is implemented; a live Enterprise Server has not been verified. |

The guide also describes configurable shortcuts, pinning per browser window, page-display/hide patterns, folder click preferences and a persistent tree cache. Code Tree currently has fixed shortcuts, one shared pin preference, fixed page routing, click-to-open folders and a service-worker memory cache. OAuth is absent. GitLab repository/MR support is an additional provider implementation, with the differences above.
