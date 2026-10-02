# Changelog

## 0.2.0

- **ADDED**: GitLab and self-managed GitLab support, including nested namespaces, branches, folder loading, MR/commit changes, discussions, local Viewed marks and review filters
- **ADDED**: `View full` in native GitHub/GitLab file headers, including collapsed files and unchanged renames; known binary files have a disabled text-preview button
- **ADDED**: provider selection and GitLab token guidance in settings
- **ADDED**: contribution rules, agent instructions, privacy and feature/verification documentation
- **ADDED**: push/PR CI with JavaScript/CSS/workflow checks, manifest/CSP/assets/docs validation, locked dependency audit and verified runtime packaging
- **ADDED**: stable-tag GitHub Releases with version/license gates, reproducible ZIP, SHA-256 and verification of downloaded CI artifacts
- **ADDED**: Code Tree Source-Available License 1.0 allowing workplace use and free forks while prohibiting monetization of covered derivatives, including fork-related donations and paid services
- **CHANGED**: product name from `GitHub Code Tree` to `Code Tree`
- **CHANGED**: full-file previous/next navigation includes every changed file independently of sidebar search
- **CHANGED**: collapsed edge tab includes the product name, opening chevron and grip
- **FIXED**: GitLab discussions requiring authentication no longer block a public MR/commit diff; unavailable comments are reported separately
- **FIXED**: unauthenticated API operations report that an account is required instead of saying a token was rejected
- **FIXED**: invalid repository/source identifiers with dot segments are rejected before requesting an API endpoint
- **FIXED**: sidebar and full-file viewer follow the current GitHub/GitLab color tokens instead of a fixed GitHub palette; native preview controls inherit provider border/focus colors
- **FIXED**: Viewed marks validate the displayed head revision against fresh PR/MR metadata before writing
- **FIXED**: stale lazy-folder replies and overlapping tree loads cannot mutate a refreshed tree or a different file mode
- **FIXED**: full-file patch validation normalizes CRLF consistently with source files
- **FIXED**: tag releases invoke the existing labeler and notification actions directly after publication instead of relying on suppressed `GITHUB_TOKEN` release events

## 0.1.0

- **ADDED**: original Chrome MV3 extension with a GitHub repository tree, file/folder search, branches and keyboard navigation
- **ADDED**: PR/commit changed-file trees with file/folder statistics, inline comments, Viewed marks and validated full-file text previews
- **ADDED**: open PR list with requested, reviewed, approved, changes-requested and no-review filters
- **ADDED**: local bookmarks, icon styles, code fonts/sizes, docking, pinning, hover opening and resizing
- **ADDED**: multiple GitHub accounts and GitHub Enterprise Server configuration
- **ADDED**: visible-row rendering, bounded API cache and lazy fallback for truncated trees
