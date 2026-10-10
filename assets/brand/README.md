# docketry brand assets (proposal)

Status: **proposal, 2026-10-10. The owner signs off logos.** Nothing here replaces
`assets/logo.svg` / `assets/logo-wordmark.svg` until approved.

All files are hand-written SVG. No raster sources, no stock icons, no generated imagery.
PNG files in `preview/` are renders (`resvg`, then `oxipng`) for review only.

| File | Use |
|---|---|
| `logo.svg` | Mark for light backgrounds (solid ink card, light-theme azure glint) |
| `logo-dark.svg` | Mark for dark backgrounds (surface card, outlined, dark-theme azure glint) |
| `wordmark.svg` / `wordmark-dark.svg` | "docketry" lettering, ink for light / near-white for dark |
| `lockup.svg` / `lockup-dark.svg` | Mark + wordmark, for README and site headers |
| `glint.svg` | The agent-provenance star on its own (spec in `DESIGN.md`) |
| `status-glyphs.svg` | Urgent / attention / healthy / neutral, shape plus colour |
| `social-card.svg` | 1280x640 repo social preview (no text, so it renders without fonts) |

## Construction

The viewBox is 32 x 32 on an 8 px module.

- **Docket card.** Rounded rectangle, 24 x 19, corner radius 4, stroke 2. A docket is the
  court's pending list; the card is one entry.
- **Silver lining.** A 12 px, 2.4 px-stroke round-capped bar laid over the card's top edge in
  `#c9cdd4`. It is the lit edge from `DESIGN.md`, and the one detail kept from the old mark.
- **Two rows.** Two 3 px bars, 12 and 7.5 px long, at a 6 px pitch. The previous mark had three
  rows at 2.6 px, which close up below 24 px; two thicker rows still read at 16 px.
- **Glint.** A four-point star with straight segments, 14 px across, centred on the card's
  top-right corner: tips at (25,0), (32,7), (25,14), (18,7), waist points at 1.9 px offset on the
  diagonals. Same geometry as the glint in `DESIGN.md`, scaled to 14/16.

The wordmark is stroked monoline paths, not type: stroke 2.2, round caps and joins,
x-height 10, ascender 16, descender 5 (y). Circles for `d`, `o`, `c`, `e` (r 5); straight
stems for `d`, `k`, `r`; one diagonal pair for `k` and `y`. Because it is paths, it renders
identically without Inter installed.

## Colour

Tokens come from `DESIGN.md`: ink `#151923`/`#eef1f6`, lining `#c9cdd4`, card
`#10141b`, outline `#5a6270` (3.18:1 on the canvas), azure `#3ea1f7` on dark (7.1:1) and
`#0b66cc` on light (5.5:1 on white).

## Legibility

`preview/preview-sheet.png` shows each mark at 160, 32 and 16 px on light and dark. At 16 px
the card, the lit edge and the glint stay distinct; the two rows merge into one texture, which
is expected. The dark outline variant is the weakest at 16 px, so favicons should use the
solid `logo.svg` card on a light tile or the dark variant with a filled card.

## Open questions for sign-off

1. Keep the glint on the logo? `DESIGN.md` reserves it for "an agent touched this", so putting
   it on the brand mark spends some of that meaning. The alternative is a mark with no glint.
2. Wordmark as paths (current) or set in Inter 600 as before?
