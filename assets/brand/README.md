# tallyline brand assets

The decided brand is the tally-strike mark: four upright strokes struck through
by one signal-azure line, with the "tallyline" lockup. The retired docketry
logo, wordmark and card artwork have been removed.

All files are hand-written SVG. No raster sources, no stock icons, no generated imagery.
PNG files in `preview/` are renders (`resvg`) for review only.

| File | Use |
|---|---|
| `mark.svg` / `mark-dark.svg` | The mark at 24 px and up (light / dark backgrounds) |
| `mark-small.svg` / `mark-small-dark.svg` | 16 px optimized variant, used for <= 20 px |
| `icon.svg` | Favicon with a `prefers-color-scheme` swap |
| `lockup.svg` / `lockup-dark.svg` | Mark plus "tallyline" wordmark as paths |
| `glint.svg` | The agent-provenance star on its own (spec in `DESIGN.md`; not a logo) |
| `status-glyphs.svg` | Urgent / attention / healthy / neutral, shape plus colour |
| `social-card.svg` | 1280 x 640 GitHub social preview, lockup on the dark canvas |
| `preview-sheet.svg` | Legibility sheet: mark at 160, 32 and 16 px, light and dark |

## Raster exports

`node tools/brand/export.mjs` writes the favicon, apple-touch icon, Open Graph
and Twitter images into `apps/web/app/` (Next file conventions, so they are wired
into page metadata) and the 192 / 512 PNG icons into `apps/web/public/brand/`.
`node tools/brand/verify.mjs` asserts they exist at the right sizes and that the
mark geometry is unchanged.

## Colour

Tokens come from `DESIGN.md`: ink `#151923`/`#eef1f6`, azure `#3ea1f7` on dark
(7.1:1) and `#0b66cc` on light (5.5:1 on white).
