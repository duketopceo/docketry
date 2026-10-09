---
version: alpha
name: docketry-design-system
description: "An operator-first dark console for an agent-native issue tracker. The canvas is near-black (#0a0c10) with a cool silver cast; a four-step surface ladder carries elevation; and every card, row, and panel wears a 1px metallic hairline — the 'silver lining' that gives the product its name-pun identity. The single chromatic accent is signal azure (#3ea1f7), reserved for primary actions, links, focus, and the four-point glint glyph that marks agent provenance. Status is a fixed 4-color system (red / amber / green / neutral); blue is never a status color. Typography is Inter for UI and JetBrains Mono for issue IDs and code, tuned to 13px body density with 32–40px rows. Depth comes from hairlines, not shadows. The lining is functional decoration: it is literally brightest where things go wrong, and a lit lining always ships with a recommended action."

colors:
  # --- Dark theme (default) ---
  accent: "#3ea1f7"
  accent-hover: "#6eb9fb"
  accent-pressed: "#2f8de0"
  accent-soft: "rgba(62,161,247,0.14)"
  on-accent: "#06080c"
  ink: "#eef1f6"
  ink-muted: "#c3c9d4"
  ink-subtle: "#8b93a3"
  ink-tertiary: "#5d6572"
  canvas: "#0a0c10"
  surface-1: "#10141b"
  surface-2: "#161b24"
  surface-3: "#1c222e"
  surface-4: "#232a38"
  lining-faint: "#1f232b"
  lining: "#39404c"
  lining-strong: "#5a6270"
  lining-bright: "#c9cdd4"
  status-urgent: "#ef4444"
  status-attention: "#f59e0b"
  status-healthy: "#10b981"
  status-neutral: "#9ca3af"
  status-urgent-soft: "rgba(239,68,68,0.14)"
  status-attention-soft: "rgba(245,158,11,0.14)"
  status-healthy-soft: "rgba(16,185,129,0.14)"
  status-neutral-soft: "rgba(156,163,175,0.14)"
  glint: "#3ea1f7"
  glint-silver: "#c9cdd4"
  overlay: "rgba(3,4,6,0.72)"
  # --- Light theme (inverse, secondary) ---
  light-canvas: "#f4f5f8"
  light-surface-1: "#ffffff"
  light-surface-2: "#eef0f4"
  light-surface-3: "#e4e7ec"
  light-ink: "#151923"
  light-ink-muted: "#3f4756"
  light-ink-subtle: "#667080"
  light-lining-faint: "#e8eaef"
  light-lining: "#c9cdd4"
  light-lining-strong: "#a3aab6"
  light-lining-bright: "#5f6879"
  light-accent: "#0b66cc"
  light-accent-hover: "#0a56ad"
  light-status-urgent-ink: "#b91c1c"
  light-status-attention-ink: "#b45309"
  light-status-healthy-ink: "#047857"
  light-status-neutral-ink: "#4b5563"

typography:
  display:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.4px
  headline:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: -0.2px
  title:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: -0.1px
  body-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-strong:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.1px
  micro:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0.4px
  button:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0.1px
  mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  section: 64px

density:
  row-compact: 32px
  row: 36px
  row-comfortable: 40px
  row-padding-x: 12px
  row-padding-y: 8px
  sidebar-width: 232px
  palette-width: 640px
  detail-pane-max: 720px

shadows:
  none: "none"
  overlay: "0 8px 28px rgba(0,0,0,0.50), 0 0 0 1px rgba(90,98,112,0.9)"
  tooltip: "0 4px 12px rgba(0,0,0,0.40)"
  light-overlay: "0 8px 28px rgba(21,25,35,0.16), 0 0 0 1px rgba(163,170,182,0.6)"

motion:
  duration-fast: 90ms
  duration-base: 140ms
  duration-overlay: 200ms
  ease-standard: "cubic-bezier(0.2, 0, 0.38, 0.9)"
  ease-out: "cubic-bezier(0.16, 1, 0.3, 1)"
  reduced: "0ms"

components:
  issue-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    height: "{density.row}"
    padding: "0 12px"
    borderBottom: "1px solid {colors.lining-faint}"
  issue-row-hover:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: "0 12px"
  issue-row-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.xs}"
    padding: "0 12px"
  issue-row-blocked:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: "0 12px"
    borderBottom: "1px solid {colors.lining-bright}"
  card-panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
    border: "1px solid {colors.lining}"
  card-panel-attention:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
    border: "1px solid {colors.lining-bright}"
  status-pill:
    backgroundColor: "{colors.status-neutral-soft}"
    textColor: "{colors.status-neutral}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
    height: 20px
  badge-id:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.xs}"
    padding: "1px 6px"
    border: "1px solid {colors.lining-faint}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    height: 32px
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
  button-primary-pressed:
    backgroundColor: "{colors.accent-pressed}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    height: 32px
    border: "1px solid {colors.lining}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    height: 32px
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    height: 32px
    border: "1px solid {colors.lining}"
  text-input-focused:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    border: "1px solid {colors.lining-strong}"
  keycap:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.xs}"
    padding: "1px 5px"
    height: 18px
    border: "1px solid {colors.lining-faint}"
  command-palette:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    width: "{density.palette-width}"
    shadow: "{shadows.overlay}"
    border: "1px solid {colors.lining-strong}"
  command-palette-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    height: 40px
  command-palette-row-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
  sparkle-glint:
    color: "{colors.glint}"
    size: 16px
  empty-state:
    backgroundColor: "transparent"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.body}"
    padding: "48px 24px"
  error-panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 16px
    border: "1px solid {colors.lining-bright}"
---

## Overview

docketry is a self-hostable, agent-native issue tracker — humans and AI agents work the same board. The name is the system: a **docket** is the court's pending list, and the brand concept is **the silver lining** — every card, row, and panel wears a 1px metallic hairline (`{colors.lining}` family), and that lining literally brightens (`{colors.lining-bright}`) wherever the system needs attention: a blocked issue, a failed agent run, a stale sync. Functional decoration — the lining is brightest where things go wrong.

The default surface is a near-black operator console (`{colors.canvas}` #0a0c10, faint cool-silver cast) built for density: 13px body, 36px rows, 8–12px in-row padding, one level of elevation maximum. The single chromatic accent is **signal azure** `{colors.accent}` (#3ea1f7) — electric blue-azure at ~208° hue, deliberately a full cyan-step away from the indigo-lavender family common to this product category; it reads as "action," never as "status." Status is the fixed four-color system (`{colors.status-*}`), and blue is never a status color.

The second signature is the **glint** — a four-point sparkle glyph (`{component.sparkle-glint}`) that means exactly one thing: *an agent touched this*. Agent-filed issue, agent comment, agent-shipped PR — the glint marks provenance. It is sparse by rule: never decorative, never animated, never a shimmer.

**Key Characteristics:**
- **Dark-first operator console** — near-black canvas, four-step surface ladder, one level of card elevation.
- **The silver lining** — 1px metallic hairline on every container; `lining-bright` on attention states, always paired with a status color and a recommended action.
- **Signal azure accent** — `{colors.accent}` only on primary actions, links, focus rings, and the glint. Nowhere else.
- **Fixed 4-color status** — red `#ef4444` urgent/blocked, amber `#f59e0b` attention/pending, green `#10b981` healthy/done, neutral `#9ca3af` inactive/archive. No fifth status color, ever.
- **Glint = agent provenance** — a 4-point star, rendered at 12/16/20px, always static.
- **Density as a feature** — `{density.row}` 36px default (32 compact / 40 comfortable), 4px spacing base, hairlines instead of shadows.
- **Inter + JetBrains Mono** — UI and provenance-of-data (IDs, SHAs, branch names) respectively.

## Colors

### Brand & Accent
- **Signal Azure** (`{colors.accent}` — `#3ea1f7`): the only chromatic accent. Primary action fill, inline links, focus ring, active-nav indicator, and the glint glyph. ~6.8:1 contrast on `{colors.canvas}`.
- **Azure Hover** (`{colors.accent-hover}` — `#6eb9fb`): lighter azure — hovered primary CTA, hovered link.
- **Azure Pressed** (`{colors.accent-pressed}` — `#2f8de0`): pressed/active fill.
- **Azure Soft** (`{colors.accent-soft}` — `rgba(62,161,247,0.14)`): translucent azure wash — selected row background, active nav item, "this thing is targeted" state.
- **On Accent** (`{colors.on-accent}` — `#06080c`): text/icons on azure fills — near-black, not white (azure at ~6.8:1 against near-black vs ~2.9:1 against white).

### Surface (dark, default)
- **Canvas** (`{colors.canvas}` — `#0a0c10`): app background. Near-black with a faint cool cast — never true `#000`.
- **Surface 1** (`{colors.surface-1}` — `#10141b`): cards, panels, inputs. The workhorse lift.
- **Surface 2** (`{colors.surface-2}` — `#161b24`): raised panels — command palette, popovers, hover-state fills.
- **Surface 3** (`{colors.surface-3}` — `#1c222e`): nested insets — code blocks, quote panels, active palette rows.
- **Surface 4** (`{colors.surface-4}` — `#232a38`): deepest lift — pinned/sticky regions inside panels.
- **Overlay** (`{colors.overlay}` — `rgba(3,4,6,0.72)`): scrim behind palette/dialogs.

### The Silver Lining
The lining is a separate border system from generic dividers. Generic dividers use `lining-faint`; the **lining** tokens are the signature edge.

- **Lining Faint** (`{colors.lining-faint}` — `#1f232b`): inner table rules, row bottom borders, quiet separators. Structurally present, visually recessive.
- **Lining** (`{colors.lining}` — `#39404c`): the default 1px metallic hairline on every card, panel, input, and bordered button. Dull silver at rest — a cool, desaturated blue-gray that reads as metal, not as a color.
- **Lining Strong** (`{colors.lining-strong}` — `#5a6270`): hover/focus strengthening of the same edge; outer border of floating surfaces (palette, menus).
- **Lining Bright** (`{colors.lining-bright}` — `#c9cdd4`): the lit lining. Bright silver — used ONLY when a surface enters an attention state (blocked, failed, overdue, conflict). The brightening is the decoration-as-signal: the edge of the thing that needs you literally shines. A `lining-bright` state is never naked — it always carries a status color (dot/pill) AND a recommended action (button or `Cmd+K` action).

### Text
- **Ink** (`{colors.ink}` — `#eef1f6`): titles, emphasized body, selected states.
- **Ink Muted** (`{colors.ink-muted}` — `#c3c9d4`): secondary text, palette row text.
- **Ink Subtle** (`{colors.ink-subtle}` — `#8b93a3`): metadata, timestamps, placeholders, unselected nav. ~6:1 on canvas — minimum for body text.
- **Ink Tertiary** (`{colors.ink-tertiary}` — `#5d6572`): disabled, footnotes, decorative-only text. ~3.7:1 — never the sole carrier of meaning.

### Status — the fixed 4-color system
Pinned values; do not author alternates for the dark theme (all four pass ≥4.5:1 as text on canvas).

| Token | Value | Meaning |
|---|---|---|
| `{colors.status-urgent}` | `#ef4444` | Urgent / blocked / failing |
| `{colors.status-attention}` | `#f59e0b` | Attention / pending / stuck |
| `{colors.status-healthy}` | `#10b981` | Healthy / complete / shipped |
| `{colors.status-neutral}` | `#9ca3af` | Inactive / archived / not started |

- **`*-soft` variants** (`rgba(…,0.14)`): pill/badge backgrounds — status color at low alpha on the surface, never a solid fill behind text.
- Status is always **dot + label** or **icon + label**, never color alone (a11y: status must survive monochrome rendering).
- **Blue is never a status color.** Azure = action. There is no "info" status; informational meta uses `ink-subtle`.

### Inverse theme (light, secondary)
A complete inverse set for documentation, emails, print-exported issues, and the optional light mode. Applied as a theme swap — token names map 1:1 with `light-` prefixes on values.

- **Light Canvas** (`{colors.light-canvas}` — `#f4f5f8`): silver-white, not pure white — the canvas keeps the metallic cast.
- **Light Surface 1–3** (`#ffffff` → `#eef0f4` → `#e4e7ec`): cards rise to white; insets sink a step darker.
- **Light Ink** (`{colors.light-ink}` — `#151923`) / **Muted** (`#3f4756`) / **Subtle** (`#667080`).
- **Light Lining** (`{colors.light-lining}` — `#c9cdd4`): the literal silver value — the resting hairline on light. **Strong** `#a3aab6`; **Bright** `{colors.light-lining-bright}` `#5f6879` (on light, "lit" reads as darker-contrast silver).
- **Light Accent** (`{colors.light-accent}` — `#0b66cc`): darkened azure, ~5.7:1 on white — the azure is hue-stable across themes, only lightness moves.
- **Light status ink**: `#b91c1c` / `#b45309` / `#047857` / `#4b5563` for status text on light; the pinned 500-values remain the dot/indicator colors.

## Typography

### Font Family
- **Inter** — all UI text. Enable `font-feature-settings: "calt", "kern"` globally; add `"tnum"` on any numeric column, timer, or count display so digits align in tables.
- **JetBrains Mono** — issue IDs (`DOC-1234`), commit SHAs, branch names, inline code, keycap legends, log/console output. Fallback `ui-monospace, SF Mono, Menlo`.
- Fallback stack for Inter: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

### Hierarchy

| Token | Size | Weight | Line Height | Tracking | Use |
|---|---|---|---|---|---|
| `{typography.display}` | 24px | 600 | 1.25 | -0.4px | Page titles, empty-state headlines |
| `{typography.headline}` | 17px | 600 | 1.35 | -0.2px | Panel/modal titles, section heads |
| `{typography.title}` | 15px | 500 | 1.4 | -0.1px | Issue titles, card titles |
| `{typography.body-lg}` | 14px | 400 | 1.55 | 0 | Detail-view prose, comment bodies |
| `{typography.body}` | 13px | 400 | 1.5 | 0 | Default UI text, list rows |
| `{typography.body-strong}` | 13px | 500 | 1.5 | 0 | Emphasis, selected row, table headers |
| `{typography.caption}` | 12px | 400 | 1.4 | 0.1px | Metadata, timestamps, secondary labels |
| `{typography.micro}` | 11px | 500 | 1.3 | 0.4px | Pill labels, overlines (may set uppercase) |
| `{typography.button}` | 13px | 500 | 1.25 | 0.1px | All button labels |
| `{typography.mono}` | 12px | 400 | 1.45 | 0 | Issue IDs, code, SHAs, branches |
| `{typography.mono-sm}` | 11px | 400 | 1.4 | 0 | ID chips, keycap legends |

### Principles
- **13px is the body.** This is a console, not a document. `body-lg` 14px is for long-form reading surfaces (issue description, comments) only.
- **Negative tracking lives on display sizes only** (-0.4px at 24px, fading to 0 at body). Micro/pill labels take *positive* tracking (+0.4px) — the contrast marks them as taxonomy.
- **Mono is provenance-of-data.** Anything machine-identified — IDs, SHAs, branches, durations in logs — is JetBrains Mono. Issue IDs are always mono, never Inter.
- **Weight range is narrow** (400/500/600). No 700+; hierarchy comes from size and ink color, not heavier weights.

## Layout

### Density (the numbers are the product)
- **Rows:** `{density.row}` 36px default, `{density.row-compact}` 32px, `{density.row-comfortable}` 40px. Row content: `{density.row-padding-x}` 12px horizontal, `{density.row-padding-y}` 8px vertical.
- **Padding inside rows/cards:** 8–12px in rows, 16px (`{spacing.lg}`) in cards. Nothing in a list view gets 24px.
- **Borders:** 1px, always. No 2px borders except the 2px focus ring.
- **Elevation:** at most 1 level — a panel on canvas. No card-on-card nesting; inner regions use `{colors.surface-3}` insets or `lining-faint` rules.

### Spacing System
- **Base unit:** 4px. Tokens: `{spacing.xxs}` 2 · `xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 24 · `xxl` 32 · `section` 64.
- Section rhythm is `{spacing.section}` 64px — tighter than marketing cadence; this is an app shell.

### Grid & Panes
- **App frame:** left sidebar `{density.sidebar-width}` 232px on `{colors.canvas}`; list column; detail pane (`{density.detail-pane-max}` 720px max) that either docks right (wide) or pushes over the list (narrow).
- **List+detail is the canonical layout** — inbox/board → detail. Board columns are fixed 300px with `{spacing.md}` gutters.
- **Command palette:** centered overlay, `{density.palette-width}` 640px, top ~18% of viewport.
- Max content width for detail prose: 720px — long lines hurt scan speed.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 — canvas | `{colors.canvas}`, no border | App background, sidebar |
| 1 — panel | `{colors.surface-1}` + 1px `{colors.lining}` | Cards, panels, inputs |
| 2 — raised | `{colors.surface-2}` + 1px `{colors.lining}` | Palette, popovers, menus, hover |
| 3 — inset | `{colors.surface-3}` + 1px `{colors.lining-faint}` | Code blocks, nested regions |
| 4 — floating | `{colors.surface-2}` + `{shadows.overlay}` | Command palette, dialogs, toasts |
| — attention | any level + 1px `{colors.lining-bright}` | Blocked/error/conflict state overlaying the level |

**Shadows are rationed.** Cards and panels carry zero drop shadow — the lining does the work. Only floating UI (palette, menus, dialogs, toasts) gets `{shadows.overlay}`. On the light theme, `{shadows.light-overlay}`.

### Decorative Depth
- None. No atmospheric gradients, no spotlight cards, no glows behind heroes.
- The only "light" in the system is the lining — and it is reserved for function (resting edge vs lit edge).
- Focus ring is depth: `box-shadow: 0 0 0 2px {colors.canvas}, 0 0 0 4px {colors.accent}` — a 2px azure ring offset by a canvas-colored gap, visible on every surface.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | ID chips, keycaps, micro badges, row corners |
| `{rounded.sm}` | 6px | Buttons, inputs, palette rows, menu items |
| `{rounded.md}` | 8px | Cards, panels, toasts — the default container radius |
| `{rounded.lg}` | 10px | Large panels, board columns |
| `{rounded.xl}` | 14px | Command palette, dialogs, sheet overlays |
| `{rounded.pill}`/`{rounded.full}` | 9999px | Status pills, avatars, filter chips |

Radius is quiet: 8px is the answer to "what radius," and the range never exceeds 14px. No pill-round buttons; pills are for status and chips only.

### The Glint (sparkle glyph spec)
The agent-provenance mark is a **four-point concave star**: 8 vertices — 4 outer tips on the axes, 4 inner waist points on the diagonals — connected by straight segments. No curves (crisp at small sizes), no animation, ever.

- **Sizes:** 12px (inline with caption/mono — comments feed, row metadata), 16px (default — issue rows, PR cards, avatar badge), 20px (emphasis — agent-attribution headers). Never larger than 20px in product UI; never smaller than 12px.
- **Color:** `{colors.glint}` (azure) when the glint is the only accent on the element; `{colors.glint-silver}` (`{colors.lining-bright}`) when it sits inside an already-attention-lit surface so azure stays scarce.
- **Geometry (at 16px box):** outer radius 8, waist radius ~2.5 on the 45° diagonals — e.g. `M8 0 L9.8 6.2 L16 8 L9.8 9.8 L8 16 L6.2 9.8 L0 8 L6.2 6.2 Z`. Scale proportionally for 12/20.
- **Placement:** preceding the actor name or attached to the avatar's bottom-right corner as a 12px badge on a `surface-2` disc. One glint per provenance fact — not one per line item.

## Motion

Fast, functional, and optional. Motion communicates cause (selection moved, overlay entered) — never celebration.

| Token | Value | Use |
|---|---|---|
| `{motion.duration-fast}` | 90ms | Hover color/background, lining brightening |
| `{motion.duration-base}` | 140ms | Selection changes, row expand, pill transitions |
| `{motion.duration-overlay}` | 200ms | Palette/dialog/menu entrance — the only transform+opacity animation |
| `{motion.ease-standard}` | `cubic-bezier(0.2, 0, 0.38, 0.9)` | Default productive ease |
| `{motion.ease-out}` | `cubic-bezier(0.16, 1, 0.3, 1)` | Overlay entrances |

- **Budget:** no CSS transition exceeds 150ms except overlay entrances (200ms ceiling). Nothing springs.
- **Animate only:** color, background, border-color (lining), opacity. Transforms only on overlay entrance (`translateY(4px) scale(0.98)` → identity).
- **Never animated:** the glint (no shimmer, no twinkle — a shimmering glint reads as decoration and voids its meaning), skeleton shimmer under reduced motion, lining-bright (it snaps or fades once — it does not pulse).
- **`prefers-reduced-motion`:** all durations → `{motion.reduced}` (0ms); entrances become instant opacity swaps; skeletons render as static blocks. Respect is mandatory, not a setting.
- **Loading:** skeletons over spinners; skeleton shapes must match final layout exactly (CLS < 0.05 is a budget, not a hope). Optimistic UI on mutations; roll back with the standard error pattern.

## Voice & Copy

Terse, technical, declarative. The UI is written by an engineer for an operator.

- **No exclamation points.** Exception: none in product UI — a genuine alert still gets a red dot, not a bang.
- **Sentence case** on buttons, headings, menu items. Uppercase only for `micro` overline labels.
- **Specific verb labels:** "Triage to backlog", "Re-run agent", "Re-authenticate" — never "Submit" or "OK".
- **Errors follow the three-line contract:** what broke (one sentence, human) → why (most-likely cause, plain English) → what to do (a button label or a `Cmd+K` action). Example: `Agent run failed. The GitHub token expired.` → `[Reconnect GitHub]`.
- **Timestamps:** relative under 7 days (`2h ago`, `yesterday`), then `MMM d`. Never raw ISO in UI.
- **Brevity in lists:** notes truncate at ~140 chars with expand affordance; URLs render domain + last segment; counts format `1.2k`.
- **Empty states are three parts:** what you'll see here → why it's empty (system healthy / hasn't run / no data) → what to do next (button or shortcut).
- **Agent provenance in copy:** agent-authored content names the agent — `ornith filed this issue` — the glint glyph precedes the name; the words carry the fact, the glyph carries the mark.

## Imagery

- **The product is the imagery.** Docs, README, and marketing surfaces show real product UI — the board, the inbox, an agent-run trace — framed in `card-panel` chrome on `{colors.canvas}`.
- **Empty-state illustration:** a single piece of linework — a docket card outline in `{colors.lining}` with one edge in `{colors.lining-bright}` and a small silver glint — never characters, never stock art.
- **No photography, no textures, no gradient meshes.** The palette is flat dark + metal + one azure.
- **Avatars:** 20/24/32px circles (`{rounded.full}`). Agent avatars carry the 12px glint badge; human avatars never do — provenance is visual from across the room.

## Components

### Buttons
- **`button-primary`** — azure CTA. `{colors.accent}` fill, `{colors.on-accent}` near-black label (azure fails 4.5:1 against white text; near-black reads ~6.8:1). 32px height, `{rounded.sm}`, padding 6px 12px. One per view region.
- **`button-primary-hover` / `-pressed`** — `accent-hover` / `accent-pressed` fills.
- **`button-secondary`** — transparent + 1px `{colors.lining}`; the default action in lists and cards.
- **`button-ghost`** — borderless, `ink-subtle` text; toolbar/inline actions only.
- Destructive actions are `button-secondary` styled with `status-urgent` text — never a solid red fill except inside a confirmed dialog.

### Rows & Lists
- **`issue-row`** — the atom of the app. 36px, transparent on canvas, 1px `{colors.lining-faint}` bottom rule. Contents left→right: status dot (6px, status color), `badge-id` (mono `DOC-1234`), title in `body` (truncate), glint (12px, only if agent-touched), right-cluster metadata in `caption` `ink-subtle` (assignee avatar, priority glyph, relative time).
- **`issue-row-hover`** — `{colors.surface-1}` wash + shows inline actions (assign, snooze) at right. Transition at `duration-fast`.
- **`issue-row-selected`** — `{colors.accent-soft}` wash + `body-strong` title. Multi-select states use the same wash.
- **`issue-row-blocked`** — bottom rule upgrades to `{colors.lining-bright}` and the row carries the urgent status pill. The lining IS the alert frame — no red background fill on rows.

### Cards & Panels
- **`card-panel`** — `surface-1` + 1px `{colors.lining}` + `{rounded.md}` + 16px padding. The universal container.
- **`card-panel-attention`** — identical chrome, border swaps to `{colors.lining-bright}`. Used for blocked cards on the board, failed agent-run cards, conflict notices. Always contains a status pill and an action button.

### Status & Badges
- **`status-pill`** — 20px pill: `*-soft` background + status-color dot (5px) + `micro` label in the status color. Four variants only (urgent/attention/healthy/neutral).
- **`badge-id`** — mono ID chip: `surface-2`, `lining-faint` border, `mono-sm` `ink-subtle` text (`DOC-1234`). Clickable = copies ID; hover reveals `ink-muted`.

### Inputs
- **`text-input`** — `surface-1`, 1px `{colors.lining}`, 32px, `body` text.
- **`text-input-focused`** — same surface; border brightens to `{colors.lining-strong}` + the azure focus ring (`0 0 0 2px canvas, 0 0 0 4px accent`). Focus is lining + ring, never just color.
- Validation: inline, on blur — error text in `status-urgent` `caption` under the field; the input's lining also lifts to `lining-bright`.

### Overlays
- **`command-palette`** — `surface-2` + `{colors.lining-strong}` + `{shadows.overlay}` + `{rounded.xl}`, 640px, entrance `translateY(4px)+opacity` at `duration-overlay` `ease-out`. Contents in order: recent items → navigation (`g` chords mirrored as commands) → actions on selection → fuzzy search → help. Row height 40px; active row = `surface-3`.
- **`keycap`** — kbd hint glyph: `surface-2`, `lining-faint` border, `mono-sm`. `⌘K` lives at the right of the sidebar search field, always visible.

### Provenance
- **`sparkle-glint`** — the four-point star per the Shapes spec. Rendered inline-block, baseline-aligned to text, `aria-hidden="true"` with the provenance fact carried in text (`filed by ornith`) — the glyph is a mark, not the message.

### Empty & Error
- **`empty-state`** — centered in the list/panel: linework docket card (lining stroke), `headline` "what you'll see here", `body` `ink-subtle` "why it's empty", then the action (`button-secondary` or keycap-hinted shortcut).
- **`error-panel`** — `card-panel` chrome with `{colors.lining-bright}` border, `status-urgent` dot + `body-strong` "what broke", `body` `ink-muted` "why", right-aligned `button-secondary` action ("Retry", "Re-authenticate"). In panels; `role="alert"`.

## Do's and Don'ts

### Do
- Put a 1px `{colors.lining}` hairline on every card, panel, and bordered input — the lining is the system.
- Reach for `lining-bright` + status + action as the single attention pattern. It replaces red-tinted backgrounds.
- Keep azure scarce: primary action, link, focus, glint. If a screen has more than three azure elements, remove some.
- Default rows to `{density.row}` 36px and body to `{typography.body}` 13px.
- Render every agent-touched artifact with one glint + named attribution in text.
- Mark issue IDs, SHAs, branches in `{typography.mono}`.
- Keep transitions under 150ms; entrance overlays under 200ms.

### Don't
- Don't use azure (or any blue) as a status color. Red/amber/green/neutral only.
- Don't add a fifth status color or a sixth surface step.
- Don't animate or decorate the glint — no shimmer, no twinkle, no celebratory confetti states.
- Don't use `lining-bright` decoratively. If nothing is wrong, nothing is lit.
- Don't nest cards on cards — one level of elevation; use `surface-3` insets or `lining-faint` rules inside.
- Don't ship 56px+ rows, 16px body text in lists, or marketing-page whitespace.
- Don't toast-and-dismiss critical errors — failures are `error-panel` with a persistent action.
- Don't let the glint mark humans or appear where no agent acted. It is provenance, not decoration.

## Accessibility

- **Contrast floor:** 4.5:1 for body text, 3:1 for large/UI text and meaningful graphics (status dots count as meaningful — pair with labels anyway).
- **Status is never color-only:** dot + label, or icon + label, in every status surface.
- **Focus:** visible on every interactive element — `focus-visible` renders the azure double ring (`2px canvas` gap + `2px accent`); no outline:none without the replacement.
- **Keyboard:** `Cmd+K`/`Ctrl+K` palette (mandatory), `j`/`k` list movement, `Enter` open, `e` edit, `Cmd+Enter` submit, `Esc` close, `g`+letter go-to, `?` shortcut sheet. Every interactive element reachable by keyboard — no `tabindex > 0`.
- **Announcements:** errors and agent-completion events use `role="alert"`/`aria-live="polite"` respectively.
- **Motion:** `prefers-reduced-motion` zeroes all transitions (token `{motion.reduced}`).
- **Hit targets:** rows hold ≥32px (compact) — pointer-fine context; interactive controls ≥24px minimum, ≥40px on touch viewports.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| wide | ≥1440px | Sidebar + list + docked detail pane |
| desktop | 1280px | Same; detail pane narrows to 560px |
| laptop | 1024px | Sidebar collapses to icon rail (56px) |
| tablet | 768px | List full-width; detail becomes push-over sheet |
| mobile | ≤480px | Single column; detail is a full-screen route; rows go `row-comfortable` 40px |

### Touch Targets
- Rows 40px on touch (`row-comfortable`), buttons/inputs 40px, palette rows 44px.
- Hover-only affordances (inline row actions) get persistent overflow menus on touch.

### Collapsing Strategy
- **Sidebar:** 232px → icon rail at 1024px → hidden behind a top-left menu on mobile; `Cmd+K` remains the primary navigation on every size.
- **Detail pane:** docked right → push-over sheet at tablet → routed page at mobile. `Esc` always returns to the list with selection preserved.
- **Board:** columns scroll horizontally under 768px rather than crushing below 260px.
- **Density holds:** rows never exceed 40px or drop below 32px; padding never inflates on large screens — extra space goes to the list, not to chrome.

## Iteration Guide

1. Reference tokens by name (`{colors.lining-bright}`, `{density.row}`) — never paraphrase values into prose.
2. New component variants are new frontmatter entries (`-hover`, `-active`, `-attention`), not prose footnotes.
3. Before adding a token, ask whether the surface ladder + lining scale + 4-status system already expresses it. The system's strength is restraint.
4. An attention state is always three things: `lining-bright` edge + status color + recommended action. Ship all three or none.
5. If a screen needs more than one `button-primary`, the hierarchy is wrong — demote the rest to `button-secondary`/`button-ghost`.
6. Agent-authored surfaces get one glint at the attribution point, not a sparkle pattern.
7. Check every change against `{motion.reduced}` — if removing motion breaks comprehension, the state wasn't encoded in color/type/lining first.

## Known Gaps

- Light-theme status *dot* colors reuse the pinned 500-values; contrast on `#f4f5f8` (~3.4:1 for red) passes the 3:1 graphic floor but labels should use the `light-status-*-ink` set for text.
- Board-view (Kanban) card anatomy inherits `card-panel`; column virtualization and drag states are not yet specified.
- Chart/dataviz palette for analytics views is intentionally deferred — analytics is not a launch surface; when needed it derives from status hues, never new chromatic colors.
- Notification/email templates follow the light token set but are not componentized here.
- `lining-bright` on the light theme (`#5f6879`) is darker-not-brighter; the semantic is "highest-contrast silver," and prose should describe it as *lit* regardless of direction.

## Component Signatures

The seven load-bearing components — the minimum vocabulary an agent needs to ship a screen that looks like docketry.

| Component | Signature |
|---|---|
| **Row** (`issue-row`) | 36px height · transparent on canvas · 1px `lining-faint` bottom rule · status dot → `badge-id` → truncated `body` title → optional 12px glint → `caption` metadata cluster right. Hover: `surface-1` + inline actions. Selected: `accent-soft` wash. Blocked: `lining-bright` rule + urgent pill. |
| **Card** (`card-panel`) | `surface-1` · 1px `lining` border · `rounded-md` 8px · 16px padding · zero shadow. Title in `title`, meta in `caption` `ink-subtle`. Attention variant swaps the border to `lining-bright` and adds pill + action. |
| **Status pill** (`status-pill`) | 20px pill · `status-*-soft` fill · 5px status dot · `micro` label in the status color · `rounded.pill`. Four statuses only; blue never appears. |
| **Command palette** (`command-palette`) | `surface-2` · `lining-strong` border · `shadows.overlay` · `rounded.xl` 14px · 640px · 40px rows (`surface-3` active) · `⌘K` trigger · entrance 200ms `ease-out` · recent → navigate → actions → search → help ordering. |
| **Sparkle glint** (`sparkle-glint`) | 4-point concave star, straight segments · 12/16/20px · `glint` azure (or `glint-silver` inside lit surfaces) · static, `aria-hidden` · means exactly "an agent touched this" · sparse by rule. |
| **Empty state** (`empty-state`) | Linework docket card (`lining` stroke, one `lining-bright` edge, silver glint) · `headline` what's here · `body` `ink-subtle` why empty · `button-secondary` or keycap action. Centered, 48px vertical padding. |
| **Error state** (`error-panel`) | `card-panel` chrome + `lining-bright` border · urgent dot + `body-strong` what broke · `body` `ink-muted` why · `button-secondary` recommended action right-aligned · `role="alert"` · persists until dismissed or resolved — never auto-dismisses. |
