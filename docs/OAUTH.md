# OAuth setup

The GitHub and GitLab OAuth applications are registered and their public client IDs are bundled in `src/background/oauth/config.js`, enabling both sign-in buttons in Settings. The production GitHub device-flow handler has obtained and cancelled an authorization attempt through the real API, with temporary session storage simulated in Node.js. A GitLab protocol probe used the production PKCE handler with a simulated callback; the real token endpoint rejected a deliberately invalid test code with `invalid_grant`. Neither probe authorized a user account. Actual account sign-in, token refresh and installed-Chrome behavior remain unverified. PAT connections remain available; no client secret is shipped.

## GitHub

Register a Codetree OAuth application and enable its device flow. Keep expiring user access tokens enabled; the worker refreshes them. Put its public client ID in `oauthConfig.github` in `src/background/oauth/config.js`. The homepage can point to this repository.

GitHub requires a callback URL in the registration form even for a device-flow application. For the published Chrome extension, use:

```text
https://omfcokfhgbjklkbkbhfadefpolbndjba.chromiumapp.org/github
```

This callback is a registration requirement; Codetree's GitHub sign-in uses device flow without a callback or client secret. Leave wildcard matching disabled.

Settings offers public-only access (`read:user`) or private-repository access (`repo read:user`). GitHub's classic `repo` scope also grants write permissions; the UI explains this choice and retains the fine-grained read-only PAT option. Codetree submits only explicit Viewed-file mutations, not source edits/reviews/comments.

The worker retains the temporary device code in trusted session storage. Settings shows the user code and GitHub verification link, polls at the server's interval, handles pending/slow-down/denied/expired responses and supports cancellation. Reopening Settings resumes an unexpired attempt; closing Settings stops polling. Tokens are verified through `/user` before saving an account.

Protocol reference: [GitHub OAuth/device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## GitLab

Register a **non-confidential** Codetree application on GitLab.com with `read_api`. Put the Application ID in `oauthConfig.gitlab` in `src/background/oauth/config.js`. Register the exact redirect URI:

```text
https://<installed-extension-id>.chromiumapp.org/gitlab
```

The registered callbacks cover the published Chrome extension and the maintainer's current unpacked development build:

```text
https://omfcokfhgbjklkbkbhfadefpolbndjba.chromiumapp.org/gitlab
https://pnflgbnkjlheolnlnoflaohlmdbffdfo.chromiumapp.org/gitlab
```

Find the installed extension ID on `chrome://extensions`. An unpacked directory and a published store package can have different IDs; register the redirect for each intended distribution before enabling it. Do not assume the development ID is the eventual store ID.

GitLab sign-in requests the optional Chrome `identity` permission when clicked. The worker generates a random state/verifier, uses SHA-256 PKCE, validates the exact callback and state, then exchanges the code directly with GitLab. No client secret is shipped. Custom repository servers continue to use PATs.

References: [GitLab PKCE](https://docs.gitlab.com/api/oauth2/), [GitLab application registration](https://docs.gitlab.com/integration/oauth_provider/), [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity).

## Credentials and verification

Access/refresh tokens remain in trusted local extension storage. Expiring credentials refresh before an API request; concurrent refreshes are deduplicated and refreshed identity is checked. A removed or replaced account cannot be restored by a stale refresh. An expired token without refresh data requires reconnecting. Removing an account clears local credentials/cache; provider-side grants must be revoked in the provider's authorized-app settings.

Before claiming OAuth readiness, verify actual sign-in for both registered IDs, cancellation/denial, private access, token refresh and worker idle/wake. Local simulations do not establish provider acceptance or installed-Chrome behavior.
