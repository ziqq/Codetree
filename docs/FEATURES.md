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
| Viewed marks | Native GraphQL when available, explicit local fallback; folder indicators | Local, scoped to project/request/head/account; folder indicators |
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

The **Unified / Side-by-side** switch is available in file tabs and **View full**. Unified is the default; the selected layout is shared by both viewers until the page reloads. Side-by-side shows the old revision on the left and the new revision on the right, with aligned change blocks, empty gaps for unmatched additions/removals and synchronized scrolling. Switching reuses the loaded revisions and preserves the top source line. Saved tab positions use unified coordinates so reopening a file in either layout restores the same source location. Ordinary repository text and comments do not show this switch.

**Ctrl/Cmd+F** or the search button opens literal, case-insensitive search in the active file; an open View full dialog takes priority over inline tabs. Enter/Shift+Enter and previous/next buttons wrap through matches and reveal off-screen source rows horizontally and vertically. Search includes both revisions, counts unchanged context once and survives switching Unified/Side-by-side. Highlighting preserves syntax tokens and original Unicode offsets. Each viewer keeps its own query only while its current file is open; closing search hides highlights and retains the query for reopening. Native input fields keep browser/editor find behavior. Scanning yields between chunks, cancels stale queries and lists the first 10,000 matches with an explicit `+` count when more exist.

**Ctrl/Cmd+G** switches the same input to source-line mode and prefills `:`. Append `223` and press Enter to reveal line 223; in diffs, choose New (the default) or Old to reach either revision, including deleted lines. Escape closes the field without moving. The mode is labeled Line; invalid numbers show the valid range and empty revisions report that no lines exist. Ctrl/Cmd+F restores text-search mode and its previous query. In text-search mode, `:223` remains literal search text and never triggers navigation. Line navigation works in file tabs and View full, in both layouts, and follows the existing tab-position restoration behavior.

Line numbers select source text: click for one line, or Shift-click to extend from the first selected line. A range belongs to Old or New, so selecting the other revision starts a new range. The selected source rows stay highlighted through virtual scrolling and Unified/Side-by-side changes; empty alignment gaps cannot be selected. File tabs and View full keep independent selections and clear them when their file or viewer is replaced.

A selected range exposes **Copy permalink**, **Copy code** and **Clear selection** in the footer, leaving the upper toolbar unchanged. Permalinks target the exact commit, source repository and path, including old names on renames and fork revisions. GitHub Markdown files open in their plain source view so line anchors work. If an exact source repository is unavailable, permalink copying stays disabled instead of using the page's repository. Copy code reads the complete selected source range, including virtualized lines, with no line numbers, diff signs or text from the opposite revision. Clipboard success/failure is reported next to the actions; a failed write keeps the selection for retry. Copying runs only after a user action and adds no clipboard permission. Selection stays in viewer memory, outside session metadata and Sync, and adds no shortcuts.

The **Changes** group provides previous/next change-block buttons and a counter in file tabs and **View full**, in both layouts. A block is a contiguous run of additions/removals, separated from other blocks by unchanged context. Navigation wraps and reveals virtualized rows without fetching revisions again; tab positions use the existing restoration behavior. The counter follows scrolling and retains the selected block while visible, including when the last block cannot reach the top of the viewport. Before the first block enters view it shows `0 / N`; diffs with no changed lines show `0 / 0` and disabled arrows. These controls add no shortcuts or preferences.

An unchanged rename loads the previous path at the base revision and the new path at the head revision. Added/deleted files use an empty opposite revision. Known binary extensions have disabled native buttons; encoding, binary content and size checks also run in the broker.

Changed text must have a complete patch that matches both source revisions. Missing/truncated or incompatible patches show an error with a native diff link. There is no fallback that presents an incomplete file diff as complete.

The viewer does not submit reviews/comments or replace the provider's review editor. Use native pages for review conversations, approvals and merges.

## In-page file tabs

Ordinary tree-file clicks open or activate a deduplicated file tab above the native page content. Repository files show read-only text; changed files show validated full-file diffs. Tabs have close buttons and support Left/Right and Home/End navigation while their file buttons have focus. Ctrl/Cmd-click retains new-browser-tab navigation, and submodules keep their native links. Native comments and review controls stay usable below the workspace; native **View full** and the sidebar full-diff action still open the existing dialog.

File tabs support native drag-and-drop ordering with a before/after insertion marker. The saved order uses the existing workspace paths, so Code retains one order across branches while each PR, MR or commit keeps its own order. Reordering preserves the active file and its source position.

Right-click a tab, or use **ContextMenu / Shift+F10** from its file button, to open **Close others**, **Close right**, **Close all** and **Reopen closed file**. The menu is clamped to the viewport; **Up/Down** selects an enabled action, **Enter** activates it and **Escape** dismisses it. A reopened file returns to its prior slot with its saved canonical source positions, so Unified and Side-by-side restore the same source location. History keeps up to 32 unique closed paths and 256 saved position records, remains memory-only and resets on navigation, account/workspace-scope changes or page reload; it is not added to session metadata or Sync. When no tabs remain, a compact recovery bar exposes Reopen while history is available. Without history, the empty workspace can hide normally.

Code workspaces share their open paths and active file across branches, but scroll positions belong to each branch. Files absent from the selected branch remain open with an unavailable state, Retry and a default-branch action when applicable. A PR, MR or commit has its own workspace and exact-revision scroll positions. Returning restores that workspace; choosing a branch from review restores Code's workspace. A reload of the same native route preserves the active inline file, while an explicit native-file navigation selects its requested path.

The broker keeps metadata in trusted session storage, isolated by browser tab, selected account, provider/host, repository and Code/review scope. It stores paths, the active path, an opaque page-route identity and scroll positions, never raw text or comments. Account changes reject stale saves. Metadata is excluded from browser Sync and clears on extension/browser restart. Bounds are 32 open paths, 256 positions, 50 scoped workspaces and 64 KiB per stored entry. This new beta workflow still needs installed-browser smoke verification; implementation does not establish live GitHub/GitLab behavior.

## Quick Open

**Ctrl/Cmd+P** opens a separate file palette with fuzzy matching over names and full paths in the current loaded file set. It includes ordinary files, excludes folders/submodules and exposes the loaded-only scope when lazy folders remain. Searching does not fetch or expand missing tree entries. With no query, it lists recent successfully opened files from the current scope. Query and recents are memory-only and reset on route, file mode or account changes; they add no stored metadata, Sync data or permissions.

Use **Up/Down** to select a result, **Home/End** for the first/last result, **Enter** to open its inline tab, and **Escape** to close the palette. Ctrl/Cmd-click opens a result in a browser tab using the existing native-file navigation. A query such as `src/main.js:120` adds a one-based source-line target; ordinary files and diffs use New, while a removed file uses Old. Navigation reuses the existing file-tab and source-line paths, including their loading/error handling and position saves. Native editors retain their shortcuts.

Quick Open searches file paths, **Ctrl/Cmd+F** searches literal text in the current file or diff, and **Ctrl/Cmd+G** navigates within that file. A colon remains literal in Ctrl/Cmd+F; `path:line` belongs to Quick Open and does not change the viewer's Find mode.

## Shared appearance and navigation

- Left/right sidebar, pinning per browser window, hover opening, resizing and labeled collapsed edge tab. The Appearance default is applied when a window first opens Codetree; the pin button updates repository tabs in that window. Session pin states reset on extension/browser restart.
- Ctrl/Cmd-click a file row to open its file page or native diff in a new browser tab. Ordinary file clicks activate the in-page workspace described above.
- The Files search has an optional `.*` regular-expression mode over full repository paths, without case sensitivity. Enter a pattern without delimiters or flags, such as `\.(dart|swift)$` or `^src/`. Invalid patterns show an error and no results. Search covers loaded entries, combines with Only unviewed and leaves review progress unfiltered. The mode resets on navigation or tab changes and is not stored or synced.
- Switching branches restores Code's open paths and active file, including slash-containing branch names. An existing workspace takes priority over the native page's file path; without one, file/blame/raw pages preserve their resolved path and other pages open the branch root. The inline workspace reports files absent from the selected branch without closing their tabs.
- In changed-file trees, a folder has a Viewed indicator when all listed descendant files are Viewed, including files hidden by search or collapsed folders. The indicator follows the provider's Viewed mode and updates after a successful file-mark change; it does not mark files in bulk.
- When Viewed marks are available, changed-file trees offer **Only unviewed** alongside a `viewed/total` review count. The filter combines with path search and preserves folder expansion, hiding viewed files and folders without unviewed descendants. Progress counts every listed changed file, independent of search, filtering and collapsed folders; existing API-limit warnings still apply. Confirmed file-mark writes update both immediately; failed or stale writes do not. The filter resets on page navigation and is not stored or synced.
- File and folder icons from [file-icons/atom](https://github.com/file-icons/atom), matched by the same path and name rules: Color uses its theme-specific colours, Monochrome the muted text colour, and Minimal the original simple icons. Files without a rule use the original icons.
- System monospace and locally installed named code fonts, with configurable size.
- Configurable toggle/search shortcuts, up to eight comma-separated alternatives per action; blank disables the action. Ctrl/Cmd/Alt/Shift/Mod, single keys and named navigation/function keys are supported. Typing, composition, AltGraph and key repeats do not trigger them; browser-reserved combinations may take priority. Arrow-key tree navigation remains available.
- All-repository or code/review page scope and up to 64 full-URL exclusions. Patterns use a literal URL with * wildcards. Hidden pages do not load the sidebar or insert View full controls.
- Folder-name click can expand/collapse a folder or just focus its row; its disclosure button and keyboard navigation always work.
- Persistent revision/account/host-scoped tree cache, capped at 48 entries/4 MiB/24 hours. Refresh and account changes clear it; storage quota failure falls back to uncached persistence. File text/comments remain in bounded worker memory only.
- Original lexical syntax colors for JavaScript/TypeScript, Dart, Go, Rust, Python, Ruby, PHP, Java, Kotlin, Swift, C/C++, C#, shell, SQL, CSS, JSON, YAML, TOML, HTML/XML and Markdown. Each revision has independent multiline string/comment state. Tokenization yields in chunks, supports cancellation and falls back to complete plain text past 200,000 tokens per revision. Embedded-language/semantic parsing is not implemented.
- Local bookmarks for repository-host pages, without a product-imposed count limit; browser storage limits still apply.

## Current boundaries

GitHub device flow and GitLab PKCE are enabled with registered public client IDs; actual account sign-in and refresh remain pending live verification. GitLab callbacks cover the published Chrome extension and the maintainer's current development build; other unpacked IDs require an additional registered callback. See [OAuth setup](OAUTH.md). Optional browser Sync covers preferences and bookmarks within one browser ecosystem. Cross-browser sync and GitLab native Viewed synchronization are absent. Named fonts are not downloaded. The lexical highlighter does not claim full grammar parity. These boundaries are also listed in README.

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

Configurable shortcuts, pinning per browser window, page-display/hide patterns, folder click preferences and a persistent tree cache are also implemented. Hide rules accept existing `*` wildcards and `regex:`-prefixed JavaScript expressions without delimiters or flags; both match the full URL without its fragment, case-sensitively. Invalid expressions are rejected before saving, and malformed stored expressions are ignored during navigation. The existing limits (64 non-empty rules, 16,384 characters) and optional browser Sync apply to both rule types. OAuth is configured for both providers; live account verification remains pending. GitLab repository/MR support is an additional provider implementation, with the differences above.
