# Penglai 0.5.12 presentation direction

This is the art direction for README, `website/`, macOS DMG, Windows NSIS,
and the Electron first-run wizard. It is not a public download claim.

## Direction

**Ink sea, paper hall.** Deep ink navy (`#0B1C2C`), warm paper
(`#F6F1E8`), cinnabar (`#C45C26`), hairline gold (`#C9A36A`), stone grey
text (`#2C333A`). One seal mark (existing 蓬 / favicon), no stock purple
AI gradients, no badge walls, no emoji headings.

Motion is present and restrained: slow cloud/grain in the hero, fade-up
on section entry, a single hairline that tracks scroll. All motion
disables under `prefers-reduced-motion`. Focus rings stay visible.
Body text contrast ≥ 4.5:1.

Photography: real Penglai screens (wizard, conversation, office, memory,
plugin center). Do not invent a second product UI. Caption 0.5.5 shots
honestly if a 0.5.12 frame is not captured yet.

Downloads: until immutable `v0.5.12` readback, cards keep the published
0.5.11 filenames and SHA-256 from `docs/PUBLICATION_MANIFEST_0.5.11.md`.

## Surfaces

| Surface | Files | Bar |
| --- | --- | --- |
| README | `README.md` | GitHub Markdown; bilingual; download cards; FAQ; limits |
| Site | `website/index.html` (English origin), `website/zh/index.html`, `website/en/index.html` (compat), `website/styles/main.css`, `website/scripts/site.js` | Desktop 1280 and mobile 390; motion; keyboard |
| Wizard | `apps/desktop/static/wizard/*`, splash | Back/retry/error remain real |
| DMG | packaging + `scripts/build-local-dmg.mjs` / `package-mac.mjs` | Drag to Applications, bilingual |
| NSIS | `scripts/nsis/Penglai.nsi` + bitmaps | Must keep scoped stop, `/PURGE`, verified restore |

## Out of bounds

No new hosting account, no paid stock, no second Agent screenshot, no
skipping Owner approvals, no Defender-off or `/IM` process kill regressions.
