# Chrome Web Store listing

Source text for the Chrome Web Store Developer Dashboard. The upload API does not change listing fields; paste these values manually and keep them consistent with `src/manifest.json`, README and [Privacy](../PRIVACY.md). Do not name other extensions or products in the listing.

## Store listing

| Field | Value |
| --- | --- |
| Name | Codetree |
| Summary | Explore GitHub and GitLab with a code tree, file search, PR/MR review, full-file diffs and unlimited local bookmarks. |
| Category | Developer Tools |
| Language | English |
| Homepage | https://github.com/ziqq/Codetree |
| Support | https://github.com/ziqq/Codetree/issues |
| Privacy policy | https://github.com/ziqq/Codetree/blob/main/PRIVACY.md |

The summary must stay within 132 characters and match the manifest description.

### Description

```text
Codetree adds a fast file tree to GitHub and GitLab, so you can browse repositories and review pull/merge requests without losing your place.

REPOSITORY NAVIGATION
• Repository file tree with search, keyboard navigation and branch switching
• Works with large repositories: visible rows render on demand, folders load lazily
• Unlimited local bookmarks for repositories, files, issues and requests

CODE REVIEW
• Changed-file tree for pull requests, merge requests and commits, with additions/deletions per folder
• Inline review comments with authors and links to their discussions
• "View full" in native file headers: the whole changed file with highlighted changes and both line numbers
• Open PR/MR lists with Requested from me, Reviewed by me, Changes requested, Approved and No reviews filters
• Viewed marks: synchronized with GitHub when available, local on GitLab

PERSONALIZATION
• Left or right docking, pinning per window, hover opening and resizing
• File and folder icons from file-icons, configurable code font and size
• Custom shortcuts (default Shift+D to toggle, Shift+S to search), page rules and URL exclusions

ACCOUNTS AND SERVERS
• Public repositories work without signing in
• Personal access tokens for private repositories, with multiple accounts per host
• GitHub Enterprise Server and self-managed GitLab over HTTPS

PRIVACY
• No Codetree account, backend, analytics or advertising
• Requests go directly from your browser to your repository host
• Tokens stay in local extension storage and are never shared with web pages
• Optional browser Sync covers only preferences and bookmarks

Codetree is source-available: https://github.com/ziqq/Codetree
```

### Graphics

| Asset | Size | Source |
| --- | --- | --- |
| Store icon | 128×128 PNG | `src/icons/icon128.png` |
| Screenshots (1–5) | 1280×800 or 640×400 | Captures of the installed extension on live public repositories |
| Small promo tile | 440×280 | Optional |

The README images show a development fixture; replace them with captures from an installed build before submission. Screenshots must not show private repositories, tokens or other extensions.

## Privacy practices

**Single purpose:** Navigate and review GitHub and GitLab repositories from a code tree sidebar.

| Permission | Justification |
| --- | --- |
| `storage` | Saves preferences, connected accounts and tokens, bookmarks, Viewed marks and a bounded repository tree cache. |
| `scripting` | Registers the sidebar for a GitHub Enterprise or GitLab server the user adds in Settings. |
| `activeTab` | Opens or closes the sidebar from the toolbar button on the current tab. |
| `identity` (optional) | Opens the provider's OAuth sign-in window when the user chooses to sign in. |
| GitHub/GitLab host access | Reads repository data from the provider API and shows the sidebar on its pages. |
| Optional HTTPS host access | Requested only for a specific custom server origin the user submits in Settings. |
| Remote code | No. All executable code is packaged with the extension. |

Data usage disclosures:

- **Authentication information:** access tokens, stored locally and sent only to the selected repository host.
- **Website content:** repository files, trees and comments, fetched from the selected host and kept in bounded local memory/cache.
- Data is not sold, not used for purposes unrelated to the single purpose and not used to determine creditworthiness.

## Publishing

The first package must be uploaded manually in the Developer Dashboard; the API cannot create an item. Then set the `CWS_EXTENSION_ID` repository variable and the `CWS_*` secrets described in [Checks and releases](RELEASING.md) so later releases are submitted automatically.
