# Privacy

Code Tree has no backend, analytics, advertising, paid account or telemetry. It communicates directly with the repository provider selected by the user.

## Local data

`chrome.storage.local` contains preferences, connected accounts and PAT/OAuth credentials, selected account IDs, bookmarks, local Viewed marks and bounded cached repository trees. These belong to the browser profile and are not synchronized by Code Tree. OAuth refresh tokens remain with their account credentials. Trusted session storage contains window pin states and temporary GitHub device authorization data; it clears on extension/browser restart.

Local storage access is set to `TRUSTED_CONTEXTS`; session storage is trusted-only by default. Content scripts receive account IDs, labels and usernames, plus preferences/bookmarks; they never receive access/refresh tokens or device codes. Removing an account deletes its local credentials and clears cached trees. It does not revoke provider-side OAuth grants; use the provider's authorized-app settings for that. Uninstalling removes Chrome extension data.

Repository metadata, comments and file text are cached in bounded service-worker memory. Revision-keyed trees, including private file/folder names, persist within 48 entries/4 MiB and have a 24-hour validity period. Expired entries are discarded when the cache is next loaded/written; no background timer deletes inactive stored data at the expiry time. Keys include account, host, project and revision. Refresh and account changes clear both caches; storage quota failures remove the persistent cache.

## Network requests

- GitHub.com uses `https://api.github.com`.
- GitHub Enterprise Server uses the configured origin's `/api/v3` and `/api/graphql`.
- GitLab.com/self-managed GitLab uses the configured origin's `/api/v4`.
- PATs are sent in API authorization headers. API redirects and cookie credentials are disabled.
- OAuth requests go directly to GitHub's `/login/device/code` and `/login/oauth/access_token`, or GitLab's `/oauth/authorize` and `/oauth/token`. Browser sign-in uses the provider's normal session in its authorization window. Token exchanges disable redirects/cookies and use no client secret or intermediary server.
- No remote fonts or executable scripts are downloaded. Named fonts use locally installed fonts with a system fallback.

The repository service processes API requests under its own policies. Opening a normal repository/discussion link is ordinary browser navigation.

## Browser permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Preferences, credentials, bookmarks, Viewed marks, trees and session state |
| `scripting` | Register content scripts for user-configured servers |
| `activeTab` | Toggle the sidebar from the extension toolbar |
| GitHub/GitLab host access | Fetch repository data and insert the UI |
| Optional HTTPS host access | Connect a specific custom origin submitted in Settings |
| Optional `identity` | GitLab OAuth authorization window; requested only when signing in with GitLab |

The optional HTTPS pattern allows requesting custom origins; Code Tree requests only the submitted origin. Accounts can be added/removed only through extension Settings, not from content scripts.

## Writes

Preferences, bookmarks and account choices are local. GitLab Viewed marks are local. GitHub Viewed marks can synchronize through GraphQL when supported; otherwise local mode is identified in the sidebar.

The extension reads review comments/decisions. It does not submit reviews, publish comments, merge requests or modify source files.
