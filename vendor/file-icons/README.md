# Vendored file-icons

Unmodified copies from [file-icons/atom](https://github.com/file-icons/atom) at commit `de1643106d3ad7db491114538bf48d2ed214d60c`:

| File | Source |
| --- | --- |
| `icondb.cjs` | `lib/icons/.icondb.js` (compiled matching rules) |
| `icons.less` | `styles/icons.less` (glyphs and metrics) |
| `colours.less` | `styles/colours.less` (palette) |
| `fonts/*.woff2` | `fonts/` (file-icons, Font Awesome 4.7, MFixx, DevOpicons) |
| `LICENSE.md` | `LICENSE.md` |

`scripts/file-icons.mjs` generates the content-script icon table from these files during `npm run build`. Atom's Octicons glyphs are replaced by SVG paths from `@primer/octicons`. Licenses for every component are listed in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md), which is packaged with the extension.

To update, copy the same files from a newer file-icons/atom commit, record that commit here and in the notices, rebuild and review the sidebar icons.
