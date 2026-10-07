# Chrome Web Store listing

Values for the Chrome Web Store Developer Dashboard, tab by tab. The upload API does not change listing fields; paste these values manually and keep them consistent with `src/manifest.json`, README and [Privacy](../PRIVACY.md). Do not name other extensions or products in the listing.

## Package

Upload `codetree-<version>.zip` from [GitHub Releases](https://github.com/ziqq/Codetree/releases). The first upload creates the item; later releases are submitted by the release workflow (see [Publishing](#publishing)).

## Store listing

| Field | Value |
| --- | --- |
| Description (summary, from the manifest) | Explore GitHub and GitLab with a code tree, file search, PR/MR review, full-file diffs and unlimited local bookmarks. |
| Category | Developer Tools |
| Language | English |

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
• File and folder icons from file-icons in color or monochrome, configurable code font and size
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

All files are in `docs/store/`. Screenshots are captures of the built extension on public GitLab pages (no account, no private data).

| Field | File | Size |
| --- | --- | --- |
| Store icon | `store-icon-128.png` (source `icon.svg`) | 128×128, 96×96 artwork with 16 px transparent padding |
| Screenshot 1 | `screenshot-1-tree.png`: repository tree with file-icons | 1280×800 |
| Screenshot 2 | `screenshot-2-changes.png`: merge request changes tree | 1280×800 |
| Screenshot 3 | `screenshot-3-full-file.png`: full-file diff from **View full** | 1280×800 |
| Screenshot 4 | `screenshot-4-requests.png`: merge request list | 1280×800 |
| Screenshot 5 | `screenshot-5-settings.png`: Settings | 1280×800 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile | `promo-marquee-1400x560.png` | 1400×560 |

Screenshots and promo images are 24-bit PNGs without transparency. GitHub screenshots can be added from an installed build; they must not show private repositories, tokens or other extensions.

### Additional fields

| Field | Value |
| --- | --- |
| Official URL | None (requires a verified domain) |
| Homepage URL | https://github.com/ziqq/Codetree |
| Support URL | https://github.com/ziqq/Codetree/issues |
| Mature content | No |

## Privacy

**Single purpose:** Navigate and review GitHub and GitLab repositories from a code tree sidebar.

| Permission | Justification |
| --- | --- |
| `storage` | Saves preferences, connected accounts and tokens, bookmarks, Viewed marks and a bounded repository tree cache. |
| `scripting` | Registers the sidebar for a GitHub Enterprise or GitLab server the user adds in Settings. |
| `identity` (optional) | Opens the provider's OAuth sign-in window when the user chooses to sign in. |
| Host permissions (github.com, api.github.com, gitlab.com) | Reads repository data from the provider API and shows the sidebar on its pages. |
| Optional host permission (`https://*/*`) | Requested only for a specific custom server origin the user submits in Settings. |
| Remote code | No, I am not using remote code. All executable code is packaged with the extension. |

**Data usage:** select

- **Authentication information**: access tokens, stored locally and sent only to the selected repository host.
- **Website content**: repository files, trees and comments, fetched from the selected host and kept in bounded local memory/cache.

Check all three certifications: data is not sold or transferred to third parties outside the approved use cases, not used for purposes unrelated to the single purpose, and not used to determine creditworthiness or for lending.

**Privacy policy URL:** https://github.com/ziqq/Codetree/blob/main/PRIVACY.md

## Distribution

| Field | Value |
| --- | --- |
| Payments | Free |
| Visibility | Public |
| Regions | All regions |

## Test instructions

```text
No account is needed. Open a public repository such as https://github.com/octocat/Hello-World or https://gitlab.com/gitlab-org/cli; the sidebar appears on the left (toggle with Shift+D). On a pull/merge request "Changes" page, the sidebar lists changed files and each native file header gets a "View full" button that opens the whole file with its changes. Private repositories require a personal access token in Settings.
```

## Publishing

The first package must be uploaded manually in the Developer Dashboard; the API cannot create an item. Then set the `CWS_EXTENSION_ID` repository variable and the `CWS_*` secrets described in [Checks and releases](RELEASING.md) so later releases are submitted automatically.
