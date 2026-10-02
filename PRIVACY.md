# Privacy

Code Tree has no backend, analytics, advertising, paid account or telemetry. It communicates directly with the repository provider selected by the user.

## Local data

`chrome.storage.local` contains preferences, connected accounts and PATs, selected account IDs, bookmarks and local Viewed marks. These belong to the browser profile and are not synchronized by Code Tree.

Storage access is set to `TRUSTED_CONTEXTS`. Content scripts receive account IDs, labels and usernames, plus preferences/bookmarks; they never receive PATs. Removing an account deletes its token. Uninstalling removes Chrome extension data.

Repository metadata, trees, comments and file text are cached in bounded service-worker memory. The cache expires and clears on account changes/refreshes. There is no persistent repository cache.

## Network requests

- GitHub.com uses `https://api.github.com`.
- GitHub Enterprise Server uses the configured origin's `/api/v3` and `/api/graphql`.
- GitLab.com/self-managed GitLab uses the configured origin's `/api/v4`.
- PATs are sent in API authorization headers. API redirects and cookie credentials are disabled.
- No remote fonts or executable scripts are downloaded. Named fonts use locally installed fonts with a system fallback.

The repository service processes API requests under its own policies. Opening a normal repository/discussion link is ordinary browser navigation.

## Browser permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Preferences, accounts, bookmarks and local Viewed marks |
| `scripting` | Register content scripts for user-configured servers |
| `activeTab` | Toggle the sidebar from the extension toolbar |
| GitHub/GitLab host access | Fetch repository data and insert the UI |
| Optional HTTPS host access | Connect a specific custom origin submitted in Settings |

The optional HTTPS pattern allows requesting custom origins; Code Tree requests only the submitted origin. Accounts can be added/removed only through extension Settings, not from content scripts.

## Writes

Preferences, bookmarks and account choices are local. GitLab Viewed marks are local. GitHub Viewed marks can synchronize through GraphQL when supported; otherwise local mode is identified in the sidebar.

The extension reads review comments/decisions. It does not submit reviews, publish comments, merge requests or modify source files.
