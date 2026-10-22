# Privacy

Codetree has no backend, analytics, advertising, paid account or telemetry. Repository requests go directly to the provider selected by the user. Optional browser Sync uses the browser vendor’s account storage; Codetree operates no synchronization server.

## Local data

`chrome.storage.local` contains preferences, connected accounts and PAT/OAuth credentials, selected account IDs, bookmarks, local Viewed marks and bounded cached repository trees. These belong to the browser profile and are not encrypted by the extension; protect the profile and device accordingly. Credentials, accounts, selected account IDs, Viewed marks and caches are never included in browser Sync. OAuth refresh tokens remain with their account credentials. Trusted session storage contains window pin states, temporary GitHub device authorization data and file-tab workspace metadata; it clears on extension/browser restart.

File workspaces store repository file paths, the active path, an opaque native-route identity and branch/revision scroll positions. Keys isolate the browser tab, selected account, provider/host, repository and Code or PR/MR/commit scope. Paths and route identities may reveal private repository metadata. The broker validates metadata, derives account identities itself and rejects stale saves after account changes. Limits are 32 open files, 256 positions, 50 workspaces and 64 KiB per entry. Raw file text and comments are never persisted with this metadata; it is excluded from browser Sync.

Local storage access is set to `TRUSTED_CONTEXTS`; session storage is trusted-only by default. Content scripts receive account IDs, labels and usernames, plus preferences/bookmarks; they never receive access/refresh tokens or device codes. Removing an account deletes its local credentials and clears cached trees. It does not revoke provider-side OAuth grants; use the provider's authorized-app settings for that. Uninstalling removes Chrome extension data.

Repository metadata, comments and file text are cached in bounded service-worker memory. Revision-keyed trees, including private file/folder names, persist within 48 entries/4 MiB and have a 24-hour validity period. Expired entries are discarded when the cache is next loaded/written; no background timer deletes inactive stored data at the expiry time. Keys include account, host, project and revision. Refresh and account changes clear both caches; storage quota failures remove the persistent cache.

## Optional browser Sync

Sync is off by default and enabled separately in Settings on each device. `chrome.storage.sync` is restricted to `TRUSTED_CONTEXTS`. It contains only an explicit whitelist of appearance/navigation preferences and bookmark URLs, titles and creation times. URLs/titles may reveal private repository names; enabling Sync authorizes sending that metadata to the browser vendor under its account policies. Tokens, account IDs, usernames, custom-server permissions, Viewed marks, tree/file contents and session state are excluded.

One versioned snapshot is bounded to 8 KiB and checked against available browser quotas. A quota or malformed-data failure leaves local data intact and appears in Settings. Initial activation applies existing remote preferences and merges bookmarks by URL; duplicate URLs retain local details. Later writes replace the snapshot by saved timestamp; equal timestamps use the last delivered snapshot. Device clock differences can delay incoming changes until a new local save. Disabling stops this device and preserves both its local copy and the shared snapshot. It does not delete copies on other devices or revoke the browser account.

Sync requires the same browser ecosystem and extension ID; it does not connect Chrome, Edge, Firefox and Safari accounts. Multi-device/vendor behavior still requires live verification.

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
| GitHub/GitLab host access | Fetch repository data and insert the UI |
| Optional HTTPS host access | Connect a specific custom origin submitted in Settings |
| Optional `identity` | GitLab OAuth authorization window; requested only when signing in with GitLab |

The optional HTTPS pattern allows requesting custom origins; Codetree requests only the submitted origin. Accounts can be added/removed only through extension Settings, not from content scripts.

## Writes

Account choices are local. Preferences and bookmarks are local by default and may synchronize after explicit opt-in. GitLab Viewed marks are local. GitHub Viewed marks can synchronize through GraphQL when supported; otherwise local mode is identified in the sidebar.

The extension reads review comments/decisions. It does not submit reviews, publish comments, merge requests or modify source files.
