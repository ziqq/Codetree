# Landing page

Codetree's public homepage and privacy policy are prepared for `https://codetree.ustinoff.dev/` in English and Russian. The source lives in `landing/` on `main` and is published by a GitHub Actions Pages workflow. No VPS, paid hosting, purchased certificate or Codetree backend is involved. Domain registration and renewal remain the owner's responsibility.

Status, **2 November 2026**: deployed successfully to [codetree.ustinoff.dev](https://codetree.ustinoff.dev/). All four EN/RU pages return HTTPS 200, and HTTP redirects to HTTPS. The release [0.5.0](https://github.com/ziqq/Codetree/releases/tag/v0.5.0) includes all accumulated features and the new extension homepage URL. Chrome Web Store received 0.5.0 and the updated homepage/policy URLs; its Dashboard reports **Pending review**, not public availability of 0.5.0. See the deployment record below for evidence and verification limits.

The landing page is not part of the extension: it is excluded from the runtime ZIP, cannot access repositories or tokens and changes no OAuth callback. Commits, pushes, Pages settings and DNS changes each need the owner's authorization.

## Verified starting point

Checked on 29 October 2026 with read-only `dig`, `gh api` and `curl`:

| Item                                         | State                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Repository                                   | `ziqq/Codetree`, public; Pages available on GitHub Free                                                                 |
| Codetree Pages                               | Not enabled; no `gh-pages` branch; repository homepage URL empty                                                        |
| `ustinoff.dev` name servers                  | `ns1.reg.ru.`, `ns2.reg.ru.`; do not change them, the zone also serves mailchecker                                      |
| `_github-pages-challenge-ziqq.ustinoff.dev`  | TXT present; mailchecker Pages reports `protected_domain_state: verified`                                               |
| `@` TXT                                      | Google `google-site-verification=…` present; keep it                                                                    |
| `codetree.ustinoff.dev`                      | No records at the authoritative server                                                                                  |
| CAA for `ustinoff.dev`                       | None; Let's Encrypt is not restricted                                                                                   |
| Reference: `mailchecker.ustinoff.dev`        | CNAME `ziqq.github.io.`, `gh-pages:/` legacy build, certificate approved until 2027-01-26, `https_enforced: true`        |

Recheck these facts at intake. Confirm in [GitHub account Settings → Pages](https://github.com/settings/pages) that `ustinoff.dev` is listed as **Verified** for `ziqq`. If it is, keep the existing TXT and do not generate a replacement. A verified root protects immediate subdomains such as `codetree.ustinoff.dev` for repositories of the same account.

## Source layout

The landing page follows mailchecker’s EN/RU page structure and visual layout. Vite builds Nunjucks HTML entries, rendered once per locale from typed TypeScript dictionaries. TypeScript covers the Vite configuration, dictionaries, template context and browser language selector; `landing:typecheck` checks these without emitting files. It has no analytics, cookie banner, PWA manifest, minification of HTML or precompressed files; GitHub Pages compresses responses itself.

```text
landing/
  vite.config.ts                 Vite config and the Nunjucks rendering plugin
  index.html, privacy.html        Nunjucks entries (one per page)
  src/main.ts                     Language selection, bundled by Vite
  src/data.ts                     Locales, routes, SEO links and template context
  src/i18n/{en,ru}.ts, types.ts    Dictionaries and their required type
  src/styles/style.scss           Light/dark styles, system fonts
  src/templates/layouts/          _layout.njk (document), _policy.njk
  src/templates/partials/         Header, footer, hero, features, gallery, data, screenshot
  src/templates/policy/_<locale>.njk  Policy bodies: PRIVACY.md and its translation
```

`scripts/landing.mjs` (`npm run landing:build`) runs one Vite build per locale with the locale as its Vite mode and merges them into `dist/landing/` (ignored by Git): English at the root, other locales under `/<locale>/`. Fingerprinted `assets/` are shared; a different file with the same name fails the build. The result is then validated: every local `href`, `src`, `srcset` and CSS `url()` must resolve to a published file, and plain `http:` resources fail. `scripts/check.mjs` runs the same build into a temporary directory and skips its generic HTML asset check for `landing/`, whose entries are templates. `scripts/package.py` uses an allowlist, so nothing from `landing/` reaches the extension ZIP.

Templates reference repository files through `{{ repo }}`: `../` for builds, which Vite resolves relative to the entry and fingerprints, and `/@fs/<repository>/` for the dev server. Shared files are `docs/store/icon.svg`, `src/icons/icon48.png` and the light/dark captures `1-github-tree`, `3-github-full-file` and `4-gitlab-changes` from `docs/store/screenshots/`. Nunjucks autoescapes all dictionary strings; markup lives only in templates. Unknown variables fail the build (`throwOnUndefined`).

Development:

```sh
npm run landing:dev
LOCALE=ru npm run landing:dev
npm run landing:build
python3 -m http.server --bind 127.0.0.1 --directory dist/landing 8088
```

The dev server (`http://127.0.0.1:8087/`) renders one locale, chosen by `LOCALE`, and serves `/ru/…` URLs from the same entries; add `?lang=en` or `?lang=ru` to match it. Templates reload the page on change. Check both locales in the built output before publishing.

Rules for the pages:

- Describe Codetree's actual behavior from README, [Features](FEATURES.md) and [Privacy](../PRIVACY.md). Do not copy mailchecker's Gmail claims or images.
- Screenshots are the store captures of Codetree 0.3.1 on public pages without an account; the caption says so, as README does. `picture` with `prefers-color-scheme` selects the light or dark capture. The extension UI is English, so Russian pages reuse the same images.
- Describe released behavior only: the site deploys from `main`, which may contain unreleased features, while the installation button points to the Chrome Web Store.
- Built pages use root-absolute paths (`base: '/'`), so the site must be served at the root of `codetree.ustinoff.dev`. Canonical and `hreflang` links come from `src/data.ts`.
- No analytics, cookies, remote fonts, CDNs or third-party scripts. System font stack. `src/main.ts` does not render text.
- Language: an explicit `?lang=en|ru` wins, then the manual choice saved as `codetree.landing.language` in this site's `localStorage` (wrapped in `try`/`catch`), then Russian for direct `/ru/` URLs, then the first supported browser language. Every internal link carries `?lang=`, so the choice works without storage. The policy pages disclose this preference. `src/main.ts` is a Vite module in `<head>` and binds the selector when the document is ready.
- `policy/_en.njk` mirrors `PRIVACY.md` with its last-change date (22 October 2026); `policy/_ru.njk` translates it and names the English version as authoritative. A change to `PRIVACY.md` updates both and the date in the same pull request; nothing enforces this automatically.
- A new locale needs `src/i18n/<locale>.ts`, an entry in `translations` (`src/data.ts`), `policy/_<locale>.njk` , the locale build list in `scripts/landing.mjs` and the `supportedLanguage` check in `src/main.ts`.
- Every page has the language selector and links to the policy, GitHub repository and issues. The homepage install button links to the [public Chrome Web Store listing](https://chromewebstore.google.com/detail/codetree/omfcokfhgbjklkbkbhfadefpolbndjba).

`tests/landing.test.mjs` transpiles the actual TypeScript language script, builds both locales and checks localized links, canonical URLs, fingerprinted shared screenshots and the absence of template syntax or extension files, and runs `src/main.ts` against the language-priority cases.

## Pages workflow

`.github/workflows/landing.yml`:

- Triggers: push to `main` touching `landing/**`, `scripts/landing.mjs`, `package-lock.json`, `docs/store/icon.svg`, `docs/store/screenshots/**`, `src/icons/**` or the workflow itself; manual `workflow_dispatch`.
- Top-level `permissions: {}`; the build job has `contents: read`; the deploy job has `pages: write` and `id-token: write` and uses the `github-pages` environment.
- `concurrency: { group: codetree-landing, cancel-in-progress: false }` so a deployment is never interrupted.
- Steps: checkout, Node 24 with the npm cache, `npm ci`, `npm run landing:build`, `actions/configure-pages` v6.0.0, `actions/upload-pages-artifact` v5.0.0 with `path: dist/landing`, `actions/deploy-pages` v5.0.1, each pinned to its commit SHA.

With Actions publishing, the custom domain lives in the Pages settings; no `CNAME` file is needed. The default `github-pages` environment policy permits deployments only from the default branch; keep it.

`npm run check` (and therefore CI on every branch) builds the landing page into a temporary directory, so pull requests validate templates and references before merge. The CI workflow itself does not deploy.

## Enabling Pages

After the landing pull request is merged:

1. **Repository Settings → Pages → Build and deployment → Source: GitHub Actions** (API: `POST /repos/ziqq/Codetree/pages` with `build_type: workflow`).
2. **Custom domain:** save `codetree.ustinoff.dev` **before** adding DNS, so nobody else can claim the hostname.
3. Run the landing workflow. The temporary `https://ziqq.github.io/Codetree/` address does not render assets because pages use root-absolute paths; check the site on the custom domain after DNS.

## DNS in REG.RU

In **Domains → ustinoff.dev → DNS servers and zone management → Add record → CNAME**, while the name servers remain `ns1/ns2.reg.ru` ([REG.RU instructions](https://help.reg.ru/support/dns-servery-i-nastroyka-zony/nastroyka-resursnykh-zapisey-dns/nastroyka-resursnykh-zapisey-v-lichnom-kabinete)):

| Type    | Subdomain  | Canonical name    |
| ------- | ---------- | ----------------- |
| `CNAME` | `codetree` | `ziqq.github.io.` |

Keep the default TTL. The value is a host name: no scheme, repository or path. This is the only new record. Do not add A/AAAA records or a wildcard for this name, and do not route it through `mailchecker`. Preserve `@`, `www`, `mailchecker`, mail records and both verification TXT records.

## DNS and HTTPS checks

```sh
dig @ns1.reg.ru codetree.ustinoff.dev CNAME +noall +answer
dig @1.1.1.1 codetree.ustinoff.dev CNAME +noall +answer
gh api repos/ziqq/Codetree/pages
```

Both resolvers should eventually return `CNAME ziqq.github.io.`. If only the authoritative answer is correct, wait for caches rather than editing valid records. GitHub documents delays of up to 24 hours for DNS and certificates.

GitHub requests the Let's Encrypt certificate automatically. When `https_certificate.state` is `approved`, enable **Enforce HTTPS** (`PUT /repos/ziqq/Codetree/pages` with `https_enforced: true`). Never bypass certificate warnings or use `curl -k`. If provisioning stalls, distinguish wrong DNS, a missing deployment and a pending certificate before changing anything; do not repeatedly remove and re-add the custom domain.

## Acceptance

```sh
curl -I https://codetree.ustinoff.dev/
curl -I http://codetree.ustinoff.dev/
curl -I https://codetree.ustinoff.dev/privacy.html
curl -I https://codetree.ustinoff.dev/ru/
curl -I https://codetree.ustinoff.dev/ru/privacy.html
curl -I https://mailchecker.ustinoff.dev/
```

Expect HTTPS 200 for the four Codetree pages, a 301 from HTTP to HTTPS, and mailchecker unchanged. In a browser at 1280 px and 375 px wide, check both languages, light and dark images, language switching, all links and that no resource loads over HTTP.

Record in this document: deployed commit and workflow run, DNS delta, authoritative and public answers, certificate state and expiry, HTTPS enforcement, page results and tested widths.

## Deployment record — 2 November 2026

- GitHub Pages enabled with `build_type: workflow`; custom domain `codetree.ustinoff.dev`, `protected_domain_state: verified`.
- REG.RU confirmed **Внесены изменения зоны** after adding only `CNAME codetree → ziqq.github.io.`. Existing root/www A records, both verification TXT records and mailchecker CNAME were preserved.
- Local verification: `npm run verify` passed (473 tests); landing build/typecheck, ESLint, Prettier, actionlint and `git diff --check` passed. The 17-file extension ZIP contains no landing files.
- Browser: EN/RU homepages and policy navigation, language selection, desktop and 375 px mobile layout checked. Current preview used the browser's dark theme; the existing light screenshots remain selected by `prefers-color-scheme`.
- Deployed commit: `6bf7991f13c0df341de8ba8007eb8433e59e6e2b`; [Pages run 41448625863](https://github.com/ziqq/Codetree/actions/runs/41448625863) succeeded.
- Authoritative `ns1.reg.ru` and public `1.1.1.1` DNS both returned `CNAME ziqq.github.io.`. GitHub's Pages health check reports valid DNS, the site served by Pages, and HTTPS eligibility.
- Certificate approved for `codetree.ustinoff.dev`, expiry `2027-01-31`; `https_enforced: true`. `/`, `/privacy.html`, `/ru/` and `/ru/privacy.html` returned HTTPS 200; HTTP returned 301 to HTTPS. These requests used `curl --resolve` with the address returned by public DNS and normal TLS validation, because this workstation's resolver still cached an earlier negative DNS answer. After refreshing the workstation DNS cache, ordinary HTTPS requests also returned 200. A live browser check then opened all four HTTPS pages and verified EN/RU switching and home/policy navigation.
- Mailchecker Pages remains on `mailchecker.ustinoff.dev`, HTTPS enforced, certificate expiry `2027-01-26`.
- [Release run 41450944013](https://github.com/ziqq/Codetree/actions/runs/41450944013) succeeded, including package verification, GitHub publication, Chrome Web Store submission and its existing follow-up jobs. Tag `v0.5.0` targets release commit `00106e4901ebe7492b192753b3becb312ac8d584`. The downloaded ZIP matches the local build byte for byte: 17 files, 1,022,477 bytes, SHA-256 `f1e885acc1ab76669be241e441764450f7e56bb5422f9228fc6f6c08ae9ddc24`.
- The Developer Dashboard confirms **Pending review** after submission. Homepage `https://codetree.ustinoff.dev/` and policy `https://codetree.ustinoff.dev/privacy.html` were saved before the submission. No claim is made that Google has approved 0.5.0 or made those listing changes public.

## Public links

- [Store listing](STORE_LISTING.md): Homepage URL `https://codetree.ustinoff.dev/`, Privacy policy URL `https://codetree.ustinoff.dev/privacy.html`; these values were saved in the Chrome Web Store Dashboard and submitted with 0.5.0. Future listing changes must also be saved in the Dashboard. Support URL stays GitHub issues.
- Repository homepage is set to `https://codetree.ustinoff.dev/`.
- README links the homepage, hosted policy and Chrome Web Store; the repository copy `PRIVACY.md` remains available. `src/manifest.json` uses the new `homepage_url`. Editing documentation alone does not update the public listing; Google must approve the submitted Dashboard changes.

Google OAuth is out of scope: Codetree uses GitHub and GitLab OAuth only. Do not add Google clients, reuse mailchecker's clients or change GitHub/GitLab callbacks as part of this work.
