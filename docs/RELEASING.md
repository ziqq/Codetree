# Checks and releases

The browser extension has no runtime dependencies or bundler. Node.js/npm provide development linters and validation; Python 3 creates the distributable ZIP. CI uses Node.js 24 and the pinned npm lockfile.

## Local checks

```sh
npm ci
npm run verify
npm audit --audit-level=high
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
```

`npm run check` runs ESLint, CSS validation and JavaScript syntax checks, then validates Manifest V3 metadata, CSP, permissions, referenced assets, PNG dimensions, local documentation links, YAML, dependency/version consistency, possible credential strings and changelog ordering. `actionlint` validates workflow semantics. The audit includes development dependencies.

Functional browser checks remain necessary. These checks do not establish native Chrome installation, private account access or authenticated server writes. A committed regression suite requires maintainer confirmation of the main implementation under [AGENTS.md](../AGENTS.md).

## Extension package

```sh
npm run package
python3 scripts/package.py --verify dist/code-tree-0.2.0.zip
```

The ZIP places `manifest.json` at its root, ready to extract into a folder and load as an unpacked extension. It contains only the explicit runtime allowlist, `PRIVACY.md` and the maintainer-approved [LICENSE](../LICENSE). CI tooling, dependencies, documentation screenshots, Git data, development fixtures and source-only documents are excluded. Development metadata points to `LICENSE`; CI checks that it exists, is nonempty and agrees with the lockfile's license metadata.

The builder checks manifest and imported/HTML asset references against that allowlist. It uses sorted entries, fixed timestamps/permissions and stored ZIP entries so the archive bytes are reproducible across platforms without depending on a compression-library version. It verifies CRCs, every source byte, the entry list and the companion SHA-256 file after building. CI builds twice and compares the ZIP bytes.

No extension signing key is used. The workflow publishes ZIP assets to GitHub Releases; extension-store upload/signing is a separate operation.

## GitHub Actions

[Verify Code Tree](../.github/workflows/ci.yml) runs on branch pushes, pull requests and manual dispatch. It installs locked development tools, runs all source/workflow/audit checks and uploads the verified ZIP and checksum. Permissions are read-only.

[Release Code Tree](../.github/workflows/release.yml) runs on pushed tags beginning with `v`. It calls the same verification workflow for that tagged checkout. Publication fails unless all checks pass and:

- The tag is exactly `vX.Y.Z`, with no prerelease suffix or leading-zero components.
- The tag version equals `manifest.json`, development metadata and the newest changelog version.
- A maintainer-approved `LICENSE` exists.
- The downloaded CI ZIP still matches the tagged source and its checksum.

Only the publication job receives `contents: write`. External actions are pinned to verified commit SHAs. The job creates a GitHub Release with the ZIP, SHA-256 and the matching changelog section. An existing release is not overwritten automatically.

## Create a release

1. Preserve the approved Code Tree Source-Available License 1.0 in `LICENSE` and in the package. Any change to those terms requires maintainer approval before publication.
2. Update `manifest.json`, `package.json`, the Settings/README version labels and the newest `CHANGELOG.md` section together. Refresh the lockfile with `npm install --package-lock-only --ignore-scripts`.
3. Run the local checks, inspect the package and verify affected browser interactions.
4. Commit and push the release source; wait for the branch CI to succeed.
5. Create and push the matching annotated tag when the maintainer requests publication:

```sh
git tag -a v0.2.0 -m 'Code Tree 0.2.0'
git push origin v0.2.0
```

6. Verify the release workflow conclusion and download the ZIP/checksum from the release. Compare them to the expected tagged package. A queued workflow or a tag push alone is not release proof.

The commands use the current version as an example. Configuration of the workflow does not create a tag or release by itself.
