# Changelog

## 0.3.1

- **ADDED**: Chrome Web Store listing fields, privacy answers, screenshots and promo images in `docs/STORE_LISTING.md` and `docs/store/`
- **CHANGED**: new Codetree extension icon matching the store icon
- **CHANGED**: README previews replaced with light/dark captures of the installed extension on public GitHub and GitLab pages
- **CHANGED**: removed the unused `activeTab` permission; the toolbar button only messages the page
- **CHANGED**: Chrome Web Store secrets are passed only to the configuration check and upload steps, and release jobs install dependencies without lifecycle scripts
- **CHANGED**: the sidebar and Settings re-render through a small dependency-free reactive module (`src/shared/reactive.js`, SolidJS-style signals, memos and render effects) instead of manual redraw calls; toolbar controls persist between renders, the visible rows are computed once per change, each page and full-file view runs in its own root that releases its listeners, frames and native buttons on navigation, and the Files tab keeps a single loading status
- **CHANGED**: every source file starts with the license header that contains its module description, and abbreviations in Codetree's own names are upper case (`clientID`, `treeSHA`, `headSHA`)
- **CHANGED**: the Pull/Merge requests and Bookmarks counts show the number of search matches, like the Files count
- **FIXED**: release workflow tests require the Chrome Web Store item ID from `secrets.CWS_EXTENSION_ID` for release notes and submission
- **FIXED**: pages receive only the accounts and account selection of their own host and can bookmark only their own host
- **FIXED**: bookmark URLs longer than 2,048 characters are rejected so they cannot exhaust local storage or the Sync snapshot
- **FIXED**: branch and path tails with empty, `.` or `..` segments (for example from an encoded `%2F`) are rejected before API requests
- **FIXED**: a not-found reply without an account now explains that private repositories need a connected account with read access; with an account it names the account and the token/SSO checks
- **FIXED**: viewer loading and error states are centered, and the Open Settings and Retry buttons sit under the explanation with visible button styles
- **FIXED**: saving Appearance in Settings no longer overwrites the dock or width changed in the sidebar or by Sync, and Settings shows preferences changed elsewhere without discarding unsaved edits of other fields
- **FIXED**: after saving, Settings shows the stored Navigation values, for example trimmed hide patterns
- **FIXED**: changing the tree mode or review filter with the keyboard keeps focus on the select
- **FIXED**: background tree loading no longer re-renders the Pull/Merge requests or Bookmarks tab, and "Load all folders" rebuilds the tree once per four folders instead of once per folder
- **FIXED**: the repository header updates as soon as the page changes and after Refresh on the Bookmarks tab, and a failed account switch shows the account that is still selected
- **FIXED**: a review diff reloaded from a native View full button also reloads the changed-file rows, so their Viewed marks belong to the same head revision
- **FIXED**: clicking a folder with folder click disabled moves the keyboard tab stop to that row
- **FIXED**: the page style is rewritten only when it changes, and the sidebar lays out once per navigation and pin click
- **FIXED**: sidebar loading and error states are centered with Retry and Open settings in one row below the text, , the toast stays within the docked sidebar, and a failed Refresh or Retry is reported in the view instead of being repeated in a toast

## 0.3.0

- **ADDED**: GitLab and self-managed GitLab support, including nested namespaces, branches, folder loading, MR/commit changes, discussions, local Viewed marks and review filters
- **ADDED**: `View full` in native GitHub/GitLab file headers, including collapsed files and unchanged renames; known binary files have a disabled text-preview button
- **ADDED**: provider selection and GitLab token guidance in settings
- **ADDED**: contribution rules, agent instructions, privacy and feature/verification documentation
- **ADDED**: push/PR CI with JavaScript/CSS/workflow checks, manifest/CSP/assets/docs validation, locked dependency audit and verified runtime packaging
- **ADDED**: stable-tag GitHub Releases with version/license gates, reproducible ZIP, SHA-256 and verification of downloaded CI artifacts
- **ADDED**: manual release runs that tag the verified commit, detailed release notes with installation steps, commits and checksum, and Chrome Web Store API v2 submission when the store is configured
- **ADDED**: Chrome Web Store listing text and privacy-practice justifications
- **ADDED**: file and folder icons from file-icons/atom (file-icons, Font Awesome 4.7, MFixx and DevOpicons fonts plus Octicons SVGs) with the original path/name matching rules and theme-specific colours; licenses are packaged in `THIRD_PARTY_NOTICES.md`
- **ADDED**: VS Code workspace settings, recommended extensions, tasks and debug configurations, plus a Makefile for checks, builds and tags
- **ADDED**: Codetree Source-Available License 1.0 allowing workplace use and free forks while prohibiting monetization of covered derivatives, including fork-related donations and paid services
- **ADDED**: configurable toggle/search shortcuts, page scopes, URL exclusions, folder click settings and pinning per browser window
- **ADDED**: account/host/revision-scoped persistent tree cache with expiration, size limits and refresh/account invalidation
- **ADDED**: original bounded lexical syntax highlighting for full-file review, with independent old/new revision state
- **ADDED**: prepared GitHub device-flow and GitLab PKCE sign-in with automatic refresh; activation awaits registered public client IDs
- **ADDED**: opt-in browser Sync for preferences and bookmark metadata, with trusted storage, an explicit allowlist, bounded snapshots and visible quota errors
- **CHANGED**: sidebar, native controls and Settings styles use SCSS compiled by Sass in the existing build/CI pipeline; GitHub/GitLab light and dark palettes remain live, and CSS validation checks the compiled output
- **CHANGED**: collapsed Codetree tab uses a bottom-to-top wordmark, accented initial, rounded corners and a horizontal two-line grip
- **CHANGED**: README screenshots refreshed for Codetree 0.3.0 with the current product name and file-icons theme
- **CHANGED**: source moved to `src/` as ES modules (shared, service worker, content script, Settings) and bundled with esbuild into `build/`; the release ZIP is packaged from the reproducible bundle
- **CHANGED**: product name from `GitHub Code Tree` to `Codetree`
- **CHANGED**: full-file previous/next navigation includes every changed file independently of sidebar search
- **CHANGED**: collapsed edge tab includes the product name, opening chevron and grip
- **CHANGED**: icon styles are Color and Monochrome file-icons plus Minimal original icons; a saved Outline style becomes Monochrome
- **CHANGED**: original file icons distinguish JSON, Markdown, licenses, ignore files and source documents; folders show their expanded state, and branch/PR controls use circular nodes
- **CHANGED**: minimum Chrome version to 116 for OAuth authorization-window lifecycle support
- **CHANGED**: web-accessible styles and fonts use per-session dynamic URLs (Chrome 130+), so websites cannot detect the extension by its ID
- **CHANGED**: repository pages receive only bookmarks for enabled hosts; synced bookmarks for other hosts stay stored and appear once the host is connected
- **FIXED**: full-file code colors use provider-specific syntax and diff palettes, GitHub diff tokens and GitLab selected code-theme backgrounds instead of shared red/green overlays
- **FIXED**: GitLab discussions requiring authentication no longer block a public MR/commit diff; unavailable comments are reported separately
- **FIXED**: unauthenticated API operations report that an account is required instead of saying a token was rejected
- **FIXED**: invalid repository/source identifiers with dot segments are rejected before requesting an API endpoint
- **FIXED**: error messages redact every GitLab token prefix and the stored credentials of each account, including custom-server tokens
- **FIXED**: a non-string signed-in username in a repository context is rejected instead of failing during account selection
- **FIXED**: sidebar and full-file viewer follow the current GitHub/GitLab color tokens instead of a fixed GitHub palette; native preview controls inherit provider border/focus colors
- **FIXED**: Viewed marks validate the displayed head revision against fresh PR/MR metadata before writing
- **FIXED**: stale lazy-folder replies and overlapping tree loads cannot mutate a refreshed tree or a different file mode
- **FIXED**: full-file patch validation normalizes CRLF consistently with source files
- **FIXED**: releases complete issues through the labeler's `release-completed` operation and notify every outcome directly instead of relying on suppressed `GITHUB_TOKEN` release events
- **FIXED**: delayed refresh and branch responses cannot overwrite the active repository after navigation; errors from an old PR/MR filter cannot hide current results
- **FIXED**: native View full controls remain visible when API authentication fails and provide account connection/retry guidance
- **FIXED**: GitHub commit diff headers without a diff ID receive native View full controls
- **FIXED**: settings dropdown chevrons have consistent spacing and theme colors while retaining native keyboard controls
- **FIXED**: initial page events wait for saved preferences and the sidebar stylesheet before revealing the panel or applying page padding, preventing a collapsed sidebar from flashing open
- **FIXED**: the collapsed handle accounts for GitHub Issues sidebar width, including native collapse/expand and page navigation
- **FIXED**: the search shortcut hint keeps its width instead of being squeezed by the search input
- **FIXED**: upgraded the development selector parser to 7.1.6 to remove quadratic flat-selector parsing (GHSA-rj75-hqrm-r3gf) without weakening CSS validation
- **FIXED**: removed the vulnerable Stylelint glob dependency chain while retaining CSS syntax checks, seven stylesheet rule categories and the strict development dependency audit

- **FIXED**: closed sidebar Shadow DOM prevents connected pages from reading or deleting bookmarks across repository hosts; synthetic global shortcuts cannot change preferences
- **FIXED**: patch coordinates and row creation are bounded to the exact source revisions before context expansion
- **FIXED**: API and OAuth bodies are bounded while streaming, including responses without Content-Length and aggregate REST/GraphQL pagination limits; full-file decoding preserves UTF-8 BOMs
- **FIXED**: request-list and bookmark replies cannot replace another sidebar tab; Refresh invalidates pending branch menus
- **FIXED**: selected and remembered lazy folder chains load their children; encoded GitLab refs preserve slash-containing names

## 0.1.0

- **ADDED**: original Chrome MV3 extension with a GitHub repository tree, file/folder search, branches and keyboard navigation
- **ADDED**: PR/commit changed-file trees with file/folder statistics, inline comments, Viewed marks and validated full-file text previews
- **ADDED**: open PR list with requested, reviewed, approved, changes-requested and no-review filters
- **ADDED**: local bookmarks, icon styles, code fonts/sizes, docking, pinning, hover opening and resizing
- **ADDED**: multiple GitHub accounts and GitHub Enterprise Server configuration
- **ADDED**: visible-row rendering, bounded API cache and lazy fallback for truncated trees
