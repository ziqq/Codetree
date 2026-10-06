# Checks and releases

The browser extension has no runtime dependencies. Node.js/npm provide development linters, validation and the pinned esbuild bundler; Python 3 creates the distributable ZIP. CI uses Node.js 24 and the pinned npm lockfile.

## Local checks

```sh
npm ci
npm run verify
npm audit --audit-level=high
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
```

`npm run check` runs ESLint, CSS validation, the Node.js regression suite and JavaScript syntax checks, then bundles a temporary build and validates Manifest V3 metadata, CSP, permissions, bundled assets, PNG dimensions, local documentation links, YAML, dependency/version consistency, possible credential strings and changelog ordering. `actionlint` validates workflow semantics. The audit includes development dependencies.

Functional browser checks remain necessary. The approved regressions cover Viewed head changes with cached/expired metadata, lazy-folder races, overlapping tree loads, CRLF patches and post-publication automation wiring. These checks do not establish native Chrome installation, private account access or authenticated server writes.

## Extension package

```sh
npm run package
python3 scripts/package.py --verify dist/code-tree-0.3.0.zip
```

`npm run build` bundles `src/background/index.js`, `src/content/index.js` and `src/options/index.js` with esbuild into classic scripts (`background.js`, `content.js`, `options.js`) and copies the manifest, styles, Settings page and icons into `build/`. The service worker, content script and Settings page load no other scripts at runtime. Bundles are not minified, so store reviewers can read them, and the output is byte-for-byte reproducible for a checkout.

The ZIP places `manifest.json` at its root, ready to extract into a folder and load as an unpacked extension. It contains only the explicit runtime allowlist, `PRIVACY.md` and the maintainer-approved [LICENSE](../LICENSE). CI tooling, dependencies, documentation screenshots, Git data, development fixtures and source-only documents are excluded. Development metadata points to `LICENSE`; CI checks that it exists, is nonempty and agrees with the lockfile's license metadata.

The packager reads `build/` and checks manifest and Settings asset references against that allowlist. It uses sorted entries, fixed timestamps/permissions and stored ZIP entries so the archive bytes are reproducible across platforms without depending on a compression-library version. It verifies CRCs, every bundled byte, the entry list and the companion SHA-256 file after building. CI bundles twice into separate directories and compares the ZIP bytes; the release jobs rebuild the tagged source before verifying the downloaded ZIP.

No extension signing key is used; the Chrome Web Store signs submitted packages. The workflow publishes ZIP assets to GitHub Releases and submits the same ZIP to the Chrome Web Store when configured.

## GitHub Actions

[Verify Code Tree](../.github/workflows/ci.yml) runs on branch pushes, pull requests and manual dispatch. It installs locked development tools, runs all source/workflow/audit checks and uploads the verified ZIP and checksum. Permissions are read-only.

[Release Code Tree](../.github/workflows/release.yml) runs on pushed tags beginning with `v`, or manually from the default branch with a `version` input. It calls the same verification workflow for that checkout. Publication fails unless all checks pass and:

- The tag is exactly `vX.Y.Z`, with no prerelease suffix or leading-zero components.
- The tag version equals `src/manifest.json`, development metadata and the newest changelog version.
- A maintainer-approved `LICENSE` exists.
- The downloaded CI ZIP still matches the tagged source and its checksum.

Only the publication job receives `contents: write`. External actions are pinned to verified commit SHAs. A manual run first creates the annotated tag on the verified commit through the API; an existing tag fails the run. The job then creates a GitHub Release with the ZIP and SHA-256. Its notes contain installation steps, the matching changelog section, commits since the previous tag, version/Chrome/archive details and the checksum. An existing release is not overwritten automatically.

After the GitHub Release, the `chrome-web-store` job verifies the same ZIP again and submits it through the Chrome Web Store API v2: it uploads the package, waits for processing, checks the accepted version and requests publication with the default review flow. The job is skipped with a warning until the store is configured:

| Name | Kind | Value |
| --- | --- | --- |
| `CWS_EXTENSION_ID` | Repository variable | Item ID from the Developer Dashboard |
| `CWS_CLIENT_ID` | Secret | Google Cloud OAuth client ID with the Chrome Web Store API enabled |
| `CWS_CLIENT_SECRET` | Secret | Matching OAuth client secret |
| `CWS_REFRESH_TOKEN` | Secret | Refresh token for the `https://www.googleapis.com/auth/chromewebstore` scope |

The publisher ID is fixed in the workflow. The first package must be uploaded manually because the API cannot create an item. A version that the store already holds cannot be uploaded again. Listing text is maintained separately in [Chrome Web Store listing](STORE_LISTING.md).

Releases created with `GITHUB_TOKEN` do not trigger separate `release.published` workflows. After a successful publication, the workflow therefore runs the pinned labeler's `release-completed` operation with the default-branch configuration; an empty waiting-for-release selection is allowed. The notification job runs after every outcome, reports success, failure, cancellation or skipping, uses the trusted default-branch template and the existing Discord/Telegram secrets, and reports required-provider failures. Manual release events retain their existing workflows. No additional personal access token is required.

## Create a release

1. Preserve the approved Code Tree Source-Available License 1.0 in `LICENSE` and in the package. Any change to those terms requires maintainer approval before publication.
2. Update `src/manifest.json`, `package.json`, the Settings/README version labels and the newest `CHANGELOG.md` section together. Refresh the lockfile with `npm install --package-lock-only --ignore-scripts`.
3. Run the local checks, inspect the package and verify affected browser interactions.
4. Commit and push the release source; wait for the branch CI to succeed.
5. When the maintainer requests publication, either run **Release Code Tree** manually from the default branch with the version, or create and push the matching annotated tag:

```sh
git tag -a v0.3.0 -m 'Code Tree 0.3.0'
git push origin v0.3.0
```

6. Verify the release workflow conclusion and download the ZIP/checksum from the release. Compare them to the expected tagged package. Check the Chrome Web Store submission state in the Developer Dashboard. A queued workflow or a tag push alone is not release proof.

The commands use the current version as an example. Configuration of the workflow does not create a tag or release by itself.
