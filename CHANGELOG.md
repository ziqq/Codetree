# Changelog

## 0.2.0

- **ADDED**: GitLab and self-managed GitLab support, including nested namespaces, branches, folder loading, MR/commit changes, discussions, local Viewed marks and review filters
- **ADDED**: `View full` in native GitHub/GitLab file headers, including collapsed files and unchanged renames; known binary files have a disabled text-preview button
- **ADDED**: provider selection and GitLab token guidance in settings
- **ADDED**: contribution rules, agent instructions, privacy and feature/verification documentation
- **ADDED**: push/PR CI with JavaScript/CSS/workflow checks, manifest/CSP/assets/docs validation, locked dependency audit and verified runtime packaging
- **ADDED**: stable-tag GitHub Releases with version/license gates, reproducible ZIP, SHA-256 and verification of downloaded CI artifacts
- **ADDED**: Code Tree Source-Available License 1.0 allowing workplace use and free forks while prohibiting monetization of covered derivatives, including fork-related donations and paid services
- **ADDED**: configurable toggle/search shortcuts, page scopes, URL exclusions, folder click settings and pinning per browser window
- **ADDED**: account/host/revision-scoped persistent tree cache with expiration, size limits and refresh/account invalidation
- **ADDED**: original bounded lexical syntax highlighting for full-file review, with independent old/new revision state
- **ADDED**: prepared GitHub device-flow and GitLab PKCE sign-in with automatic refresh; activation awaits registered public client IDs
- **ADDED**: opt-in browser Sync for preferences and bookmark metadata, with trusted storage, an explicit allowlist, bounded snapshots and visible quota errors
- **CHANGED**: product name from `GitHub Code Tree` to `Code Tree`
- **CHANGED**: full-file previous/next navigation includes every changed file independently of sidebar search
- **CHANGED**: collapsed edge tab includes the product name, opening chevron and grip
- **CHANGED**: minimum Chrome version to 116 for OAuth authorization-window lifecycle support
- **FIXED**: GitLab discussions requiring authentication no longer block a public MR/commit diff; unavailable comments are reported separately
- **FIXED**: unauthenticated API operations report that an account is required instead of saying a token was rejected
- **FIXED**: invalid repository/source identifiers with dot segments are rejected before requesting an API endpoint
- **FIXED**: sidebar and full-file viewer follow the current GitHub/GitLab color tokens instead of a fixed GitHub palette; native preview controls inherit provider border/focus colors
- **FIXED**: Viewed marks validate the displayed head revision against fresh PR/MR metadata before writing
- **FIXED**: stale lazy-folder replies and overlapping tree loads cannot mutate a refreshed tree or a different file mode
- **FIXED**: full-file patch validation normalizes CRLF consistently with source files
- **FIXED**: tag releases invoke the existing labeler and notification actions directly after publication instead of relying on suppressed `GITHUB_TOKEN` release events
- **FIXED**: delayed refresh and branch responses cannot overwrite the active repository after navigation; errors from an old PR/MR filter cannot hide current results
- **FIXED**: native View full controls remain visible when API authentication fails and provide account connection/retry guidance
- **FIXED**: GitHub commit diff headers without a diff ID receive native View full controls
- **FIXED**: settings dropdown chevrons have consistent spacing and theme colors while retaining native keyboard controls
- **FIXED**: the sidebar starts hidden until saved preferences are applied, preventing a collapsed sidebar from flashing open when a repository loads
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
