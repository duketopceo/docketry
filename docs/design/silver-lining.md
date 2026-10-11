# Silver Lining: foundation and rules

Silver Lining is the shared interface foundation for the owner's operator tools. It covers:

- **Tallyline**, the web app: issues, board, triage, review, cycles, roadmap.
- **open-computer**, the control-plane console: sandboxes, router, approvals, audit.
- **Silver Lining itself**: the tokens, components and rules both products inherit.

The target is Linear-level quality as an open-source tool, adapted for one operator who runs agents all day and keeps these screens open for hours.

`DESIGN.md` holds the token values. This document holds the rules those values serve. When they disagree, this document wins and `DESIGN.md` gets fixed.

Every rule below is either checked by a gate (section 13) or marked *review* when only a human can judge it.

---

## 1. Principles

1. **Calm by default, lit when it matters.** The resting state is quiet: dark neutrals, hairline edges, one accent. Brightness and color are spent only on what needs the operator: a blocked issue, a failed run, an approval waiting. A lit lining always comes with a recommended action.
2. **The keyboard is the primary input.** Every action can be reached without a pointer. The mouse is a convenience.
3. **Content over chrome.** Navigation, headers and toolbars recede. The operator's issues, runs and logs carry the visual weight.
4. **Speed is a feature.** Interactions feel instant. Waiting is designed, never accidental.
5. **State is never lost.** Filters, scroll position, drafts, pane sizes and collapsed sections survive navigation and reloads.
6. **Agents are first-class and always attributed.** Anything an agent did is visibly marked, traceable to its session, and reversible by a human.
7. **Comfortable for long sessions.** If a choice looks better in a screenshot but tires the eyes after four hours, the comfortable choice wins.
8. **One system, two products.** Tallyline and open-computer share tokens, components, shortcuts and copy rules. A user who knows one already knows the other.

---

## 2. Theme engine

Following Linear's approach, themes are generated, not hand-picked. Each theme is derived in OKLCH from three inputs:

| Input | Meaning | Default (dark) |
|---|---|---|
| `base` | Hue and lightness of the canvas | `oklch(0.16 0.012 255)` (≈ `#0a0c10`, cool silver cast) |
| `accent` | The single chromatic accent | `oklch(0.68 0.15 245)` (≈ `#3ea1f7`, signal azure) |
| `contrast` | 0–100; spreads the surface ladder and text steps | `30` |

From those three inputs the generator derives:

- **Surfaces:** the 4-step surface ladder (`surface-1..4`), each step +0.03 to +0.045 L from the previous.
- **Linings:** the 4 lining steps (`faint`, default, `strong`, `bright`).
- **Text:** the 4 text steps (`ink`, `muted`, `subtle`, `tertiary`).
- **Overlays:** overlay and scrim.

Status colors are **not** generated. They are fixed per theme (section 5), so meaning never shifts with taste.

Shipped themes: **Dark** (default), **Light**, **High contrast dark** (`contrast` = 70), and **Follow system**.

Users may set their own `base`, `accent` and `contrast`. The generator clamps every output so the contrast floors in section 3 still hold.

**Rules**

- The canvas is never `#000000`, and text is never `#ffffff`. Pure black and pure white cause halation and eye strain over long sessions. Darkest canvas L ≥ 0.13; brightest text L ≤ 0.96.
- The accent covers at most about 5% of any screen's pixels (*review*). If everything is blue, nothing is.
- No large saturated surfaces. Chroma above 0.08 is allowed only on elements of 32px height or less, such as pills, badges and the focus ring. Banners use the soft (14% alpha) variants.
- Theme switches apply instantly, with no reload, and persist per device.

---

## 3. Contrast floors

Floors are measured with WCAG 2.2 contrast against the actual surface behind the text. The gate is axe plus a token contrast test.

| Text role | Dark floor | Dark ceiling | Light floor |
|---|---|---|---|
| Primary text (`ink`) | 12:1 | 16:1 | 12:1 |
| Secondary (`ink-muted`) | 7:1 | — | 7:1 |
| Tertiary or metadata (`ink-subtle`, `ink-tertiary`) | 4.5:1 | — | 4.5:1 |
| Disabled | 3:1 (and never the only signal) | — | 3:1 |
| UI component edges (inputs, focus ring) | 3:1 | — | 3:1 |

The ceiling exists for comfort: past about 16:1 on a dark canvas, text starts to glow. These floors apply on every surface step text can sit on, not just the canvas.

---

## 4. Typography

- **Faces:**
  - **Inter** for interface text, with `font-feature-settings: "cv11", "ss01", "tnum"`. `tnum` keeps counts, dates and estimates aligned.
  - **JetBrains Mono** for issue keys, IDs, hashes, code and log lines.
  - No third face.
- **Scale:** `micro 11 / caption 12 / body 13 / body-lg 14 / title 15 / headline 17 / display 24`. Nothing below 11px, anywhere.
- **Weights:** 400, 500 and 600 only. Emphasis comes from weight and ink step, not from size jumps or color.
- **Measure:** running text (issue descriptions, docs) is 72ch at most. Lists and tables are not capped.
- **Truncation:** single-line titles truncate with an ellipsis and show the full text in a tooltip and the peek panel. Issue keys never truncate.
- Uppercase is used only for `micro` labels, with +0.4px tracking.

---

## 5. Color semantics

Color carries fixed meanings. A color is never reused for decoration.

| Meaning | Token | Used for |
|---|---|---|
| Urgent or failing | `status-urgent` (red) | Urgent priority, failed run, blocked by error, destructive action confirm |
| Needs attention | `status-attention` (amber) | High priority, waiting on approval, nearing budget or limit |
| Healthy or done | `status-healthy` (green) | Done, passed, approved |
| Neutral | `status-neutral` | Backlog, idle, cancelled |
| Accent | `accent` (azure) | Primary action, link, focus, selection, **agent provenance glint** |

- Blue is never a status color, and red is never used just to draw the eye.
- Status is never conveyed by color alone. It always pairs with an icon shape and a text label, which matters for color-blind users and for monochrome screenshots.
- The lining brightens (`lining-bright`) only on the element that needs action, never on whole regions.

---

## 6. Layout and density

- **Shell:** an inverted L. The sidebar on the left (232px default, resizable 200–320px, collapsible to 56px) holds workspace, views and navigation. The header strip (48px) holds the title, breadcrumbs, view controls and filter pills. Everything else is content.
- **Panes:** list → peek (right, 480–720px, resizable) → full detail. Pane widths persist per view.
- **Grid:** 4px base. Use spacing tokens only: `2 4 8 12 16 24 32 64`.
- **Density modes,** chosen per user:

  | Mode | Row height | Notes |
  |---|---|---|
  | Compact | 32px | — |
  | Default | 36px | — |
  | Comfortable | 40px | Default on touch |

  Switching density changes only row height and vertical padding. Nothing reflows horizontally.
- **Breakpoints:**
  - At 1440px and above, full shell plus peek.
  - From 1024px to 1439px, peek overlays the list.
  - From 640px to 1023px, the sidebar becomes a drawer.
  - Below 640px, single column, with a bottom action bar for the 4 most common actions.
- **No layout shift:** reserve space for async content. Skeletons match the final geometry.

---

## 7. Interaction rules

**Keyboard**

- `Cmd/Ctrl+K` opens the command palette. The palette covers 100% of actions available on screen, and a test enforces this (section 13).
- Single-key shortcuts act on the focused or selected item:
  - `c` create
  - `e` edit title
  - `s` state
  - `p` priority
  - `a` assignee
  - `l` labels
  - `x` select
  - `.` actions menu
- `g` then a letter navigates: `g i` my issues, `g b` board, `g t` triage, `g r` review, `g c` cycle, `g a` all issues, `g s` insights, `g p` roadmap, `g e` activity, `g ,` settings.
- `j`/`k` or the arrow keys move, `Enter` opens, `Space` peeks, `Esc` closes the topmost layer and returns focus to where it came from.
- `?` shows every shortcut for the current screen, generated from the same registry the palette uses.
- Shortcuts are identical in Tallyline and open-computer wherever the action exists in both.

**Feedback**

- **Optimistic by default:** the UI shows the result within 100ms and reconciles with the server afterward. If the server rejects the change, the UI rolls back visibly and the toast says why.
- **Undo, not confirm:** reversible actions (state, assignee, labels, archive, bulk edits) show a toast with `Undo` (`Cmd/Ctrl+Z`) for 8 seconds. Confirmation dialogs are reserved for irreversible actions: deleting a workspace, revoking all keys, purging data. Even then, the user types the name.
- **No modal stacking:** at most one modal. Pickers are popovers anchored to their trigger.
- **Inline edit everywhere:** title, state, priority, assignee, labels, estimate and cycle are editable in place, from lists, board and detail.
- **Multi-select:** `x`, Shift+click or Shift+J/K select. Bulk actions appear in a floating bar showing the selection count, and every bulk action is undoable.

---

## 8. Performance budgets

These are gates, not targets.

| Measure | Budget |
|---|---|
| Input → visual response | ≤ 100ms (p95) |
| Route change with cached data | ≤ 200ms |
| First load, LCP, on the deploy box over the tunnel | ≤ 1.5s |
| CLS | ≤ 0.02 |
| JS per route, gzipped | ≤ 180kB initial |
| List rendering | Virtualized above 200 rows; scrolling holds 60fps on 2,000 rows |
| Live updates | SSE events applied in batches at most every 250ms, never blocking input |

---

## 9. Long-session comfort

The rules that make an 8-hour day pleasant rather than tiring:

- **No motion at rest.** Nothing animates, pulses or blinks unless the operator just acted or something needs them. Spinners are banned in favor of skeletons. Progress for long jobs is a thin determinate bar.
- **Motion is short and purposeful:** 90–200ms, using `ease-standard` or `ease-out`. With `prefers-reduced-motion`, all transitions drop to 0ms except opacity fades of 90ms or less.
- **Notifications are batched and quiet:**
  - Agent activity updates the inbox count and the row in place, and never steals focus.
  - Toasts auto-dismiss, except error toasts that need a decision.
  - Sound is off unless the user turns it on.
- **No surprise layout changes.** Incoming live data never moves the row under the cursor or the keyboard focus. New items appear with a "3 new" pill the user clicks to reveal them.
- **Remembered state, per view and device:** filters, sort, grouping, scroll position, peek width, sidebar width and collapse state, density, theme, and unsent drafts (comments and descriptions autosave locally every 2s).
- **Readable at a glance from across the desk:** status icons stay recognizable at 16px, and the issue key plus title are the highest-contrast elements in a row.
- **Night use:** the theme follows the system by default. The dark theme's surfaces stay below L 0.30, so a dark room isn't lit by the UI.

---

## 10. Agent-native rules

- **Provenance glint:** the four-point glint (accent color) marks anything an agent created or changed: rows, comments, field changes and timeline entries. Hovering or focusing it shows the agent's name, session and time. Clicking it opens the session timeline.
- **Every agent change is attributable and reversible:** the activity log shows a diff (before → after) and a per-change `Revert`.
- **Humans approve at the edges:** review queues (Tallyline) and approval consoles (open-computer) use the same pattern:
  - A list of pending items, oldest first, each showing who asked, what will change, and what it will cost or risk.
  - `a` approves, `r` sends back with a required note, `Enter` opens the full context.
- **Agent sessions** show live status (running, waiting on human, done, failed) with the fixed status colors. A running session's row shows one short live line; full logs live in the session view.
- **Throttled presentation:** when an agent changes 50 things in a minute, the UI groups them into one summarized activity entry that expands to show each change.

---

## 11. Accessibility

- WCAG 2.2 AA is the floor. axe reports 0 violations on every screen in both themes at 1440px and 390px.
- **Focus:** a 2px `accent` ring with a 2px offset, always visible on keyboard focus. It is never removed, only restyled.
- **Targets:** at least 24×24px for pointers and 32×32px on touch breakpoints.
- Every icon-only control has an accessible name. Every form control has a label (visible, or `aria-label` for inline editors).
- Live regions announce toasts and completed async actions politely. Errors are announced assertively.
- Full keyboard operability is tested end to end (section 13), not assumed.

---

## 12. Copy rules

- Write from the operator's side: "Send back to agent", not "Set state to rejected".
- Buttons say exactly what happens: "Archive 3 issues", "Approve run", "Revoke key".
- Errors say what went wrong and what to do next, with no apology and no codes unless they help.
- Empty states say what will appear here and how to add the first item, with one primary action.
- Numbers are tabular, dates are relative within 7 days ("2h ago") with the absolute time on hover, and durations read like "4m 12s".
- One name per concept across both products: *workspace*, *team*, *issue*, *agent*, *session*, *run*, *approval*.

---

## 13. Enforcement: deterministic gates

Each gate runs in CI and fails the build.

| Gate | What it checks | Command |
|---|---|---|
| Token-only styling | No raw hex, rgb or hsl colors, and no px font sizes outside the token scale, in component code | `pnpm lint:design` (stylelint plus an ESLint rule on className and style) |
| Contrast | Every text-step × surface-step pair in every theme meets section 3 | `pnpm test:contrast` (computes from the generated tokens) |
| Theme parity | Tallyline and open-computer ship the same generated token set (hash match) | `pnpm test:token-parity` |
| Accessibility | axe at 0 violations, WCAG 2.2 AA, both themes, 1440 and 390, every route | `pnpm test:e2e --grep @a11y` |
| Palette coverage | Every registered action is in the palette and has a shortcut or a palette entry | `pnpm test:e2e --grep @palette` |
| Keyboard journeys | Create, triage, assign, bulk-edit, review and approve, completed with the keyboard only | `pnpm test:e2e --grep @keyboard` |
| Visual regression | Screenshot baselines per route × theme × breakpoint × density, 0.1% pixel tolerance | `pnpm test:visual` |
| Performance | Budgets in section 8 (Lighthouse CI plus an interaction-latency harness) | `pnpm test:perf` |
| No layout shift on live data | An SSE burst of 50 events moves neither focus nor the hovered row | `pnpm test:e2e --grep @live` |
| Hydration | 0 hydration warnings on every route | `pnpm test:e2e --grep @hydration` |

---

## 14. How open-computer adopts it

open-computer renders server-side from Python's standard library, with no build step. It adopts Silver Lining in four ways:

- **Shared tokens:** it vendors the generated `silver-lining.css` (CSS custom properties for every token and theme). A sync script copies it from Tallyline's build output, and the parity gate checks the hash.
- **Same shell and keyboard model:**
  - The sidebar becomes the console's sections: Overview, Sandboxes, Runs, Approvals, Router, Audit.
  - `Cmd/Ctrl+K` opens a palette over console actions.
  - `j`/`k`, `Enter`, `Esc` and `?` behave identically.
- **Console-specific patterns:**
  - Dense tables use the compact density.
  - Log streams use JetBrains Mono at 12px with line numbers, capped at 5,000 lines in the DOM and virtualized.
  - The approvals queue follows section 10 exactly.
  - Cost appears next to every action that spends money.
- **Its own safety rules:**
  - No GET request ever causes side effects. The current `GET /run` that boots microVMs must become a POST with a confirm step.
  - Anything that leaves the box shows its destination.

---

## 15. Where Tallyline departs from Linear, on purpose

- **Self-host first:** every screen works with no network calls beyond the operator's own API, and no third-party fonts or scripts in production.
- **Agents are teammates, not integrations:** they have identities, keys, sessions, provenance and a review queue.
- **The lining is functional:** Linear uses near-invisible borders. Silver Lining makes the edge itself the attention signal.
- **Review is a first-class view,** because most incoming work comes from agents.
- **No AI chrome:** no sparkles on buttons and no "AI" badges. The glint means exactly one thing: an agent touched this.
