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

All files are in `docs/store/`. Screenshots are captures of the built extension on public pages (the Codetree repository on GitHub and `gitlab-org/cli` on GitLab), without an account or private data. Every scene is captured in `screenshots/light/` and `screenshots/dark/` with the same page, window size and actions. The uploaded `screenshots/split/` frames join each pair along a slanted seam (light above, dark below), so the store's five screenshots show both themes.

| Field | File | Size |
| --- | --- | --- |
| Store icon | `store-icon-128.png` (source `icon.svg`) | 128×128, 96×96 artwork with 16 px transparent padding |
| Screenshot 1 | `screenshots/split/1-github-tree.png`: GitHub repository tree with file-icons | 1280×800 |
| Screenshot 2 | `screenshots/split/2-github-changes.png`: GitHub pull request changes tree | 1280×800 |
| Screenshot 3 | `screenshots/split/3-github-full-file.png`: GitHub full-file diff from **View full** | 1280×800 |
| Screenshot 4 | `screenshots/split/4-gitlab-changes.png`: GitLab merge request changes tree | 1280×800 |
| Screenshot 5 | `screenshots/split/5-settings.png`: Settings | 1280×800 |
| Small promo tile | `promo-small-440x280.png`: light and dark sidebars | 440×280 |
| Marquee promo tile | `promo-marquee-1400x560.png`: light pull request changes with the dark **View full** dialog | 1400×560 |

Screenshots and promo images are 24-bit PNGs without transparency. Screenshots must not show private repositories, tokens or other extensions.

### Additional fields

| Field | Value |
| --- | --- |
| Official URL | None (requires a verified domain) |
| Homepage URL | https://github.com/ziqq/Codetree |
| Support URL | https://github.com/ziqq/Codetree/issues |
| Mature content | No |

## Privacy

Paste these values into the **Privacy** tab. Upload the current package first: the dashboard asks for a justification of every permission in the uploaded manifest.

### Single purpose

```text
Codetree adds a code tree sidebar to GitHub and GitLab pages so users can navigate repository files and review pull/merge request changes, including full-file diffs, without leaving the page.
```

### Permission justification

`storage`:

```text
Stores the user's preferences, connected accounts and their access tokens, bookmarks, Viewed marks and a size-limited cache of repository file trees in local extension storage. Optional browser Sync stores only preferences and bookmark metadata.
```

`scripting`:

```text
Registers the content script for a GitHub Enterprise Server or self-managed GitLab origin that the user explicitly adds in Settings, so the sidebar can appear on that server's pages. No code is injected into other sites.
```

Host permission:

```text
github.com and gitlab.com: show the sidebar and View full buttons on repository pages. api.github.com and the GitLab API: read repository trees, branches, pull/merge request changes and file contents for the page the user is viewing. The optional https://*/* permission is requested at runtime only for the single custom server origin the user enters in Settings.
```

`identity` (optional, if the dashboard asks):

```text
Opens the provider's OAuth sign-in window when the user chooses to sign in to GitHub or GitLab from Settings.
```

### Remote code

Select **No, I am not using remote code**. If a justification is requested:

```text
All JavaScript is bundled in the package. The extension does not load or evaluate code from any server.
```

### Data usage

Select only:

- **Authentication information** (Данные для аутентификации): GitHub/GitLab access tokens the user enters in Settings, stored locally and sent only to the selected repository host.
- **Website content** (Содержимое сайтов): repository files, trees, diffs and comments fetched from the selected host and kept in bounded local memory/cache.

Leave the other types unchecked. The page URL is read only locally to recognize the repository and is never sent or stored except in bookmarks the user creates, so neither **Web history** nor **User activity** applies.

Check all three certifications: data is not sold or transferred to third parties outside the approved use cases, not used for purposes unrelated to the single purpose, and not used to determine creditworthiness or for lending.

### Privacy policy URL

```text
https://github.com/ziqq/Codetree/blob/main/PRIVACY.md
```

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

The first package must be uploaded manually in the Developer Dashboard; the API cannot create an item. Then set the `CWS_*` secrets described in [Checks and releases](RELEASING.md) so later releases are submitted automatically.
