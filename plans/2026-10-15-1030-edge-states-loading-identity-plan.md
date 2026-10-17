---
title: tallyline - Edge states, loading surfaces, and identity swap
type: feature
date: 2026-10-15
topic: tallyline
artifact_contract: ce-unified-plan/v1
origin: user request (edge cases plan, loading screen, design.md, no slop fonts, free-repo iconography, long-session build)
execution: code
---

# tallyline — Edge states, loading surfaces, and identity swap (2026-10-15)

The four-PR UI overhaul (#103–#112) landed and is live on tallyline.app. This plan is the next
pass: make the un-happy paths designed surfaces, swap the template fonts for deliberate picks, and
adopt a real icon set — all optimized for operators who keep the app open for hours.

## Goal Capsule

- **Objective:** every reachable state of the app (loading, empty, error, degraded, concurrent)
  is an intentional designed surface per `docs/design/silver-lining.md` §16; typography is
  Atkinson Hyperlegible Next + Commit Mono; icons are Phosphor.
- **Product authority:** `DESIGN.md` + `docs/design/silver-lining.md` §4, §16, §17 as amended in
  this pass — the contract is now written; the units below make the code true to it.
- **Decisions settled (2026-10-15):**
  - Sans = **Atkinson Hyperlegible Next** via `@fontsource/atkinson-hyperlegible-next` (the Pro
    release; weights 400–700). Replaces `@fontsource-variable/inter`.
  - Mono = **Commit Mono** via `@fontsource/commit-mono` (400/500/700). Replaces
    `@fontsource-variable/jetbrains-mono`.
  - Icons = **Phosphor** via `@phosphor-icons/react` 2.1.x (MIT). Replaces hand-rolled inline
    SVGs. Glint + TallyMark stay custom (brand geometry).
  - Weight usage stays 400/500/600 per the existing narrow-range rule — the fonts ship heavier
    files, the product doesn't use them.
  - Tabular numerals move to the mono face (the "data face" rule) instead of `tnum`.

## Status key

`done` = in `main` with evidence. `partial` = part exists. `todo` = not started.

### U0. Design contract — done in this pass

- **Status:** done (uncommitted working-tree edit).
- **Evidence:** `docs/design/silver-lining.md` §4 rewritten (faces, no-template-face rule,
  mono-as-data-face), §16 Edge states (loading/empty/error/degradation) and §17 Iconography
  appended; `DESIGN.md` frontmatter + Typography section + font bullets swapped.
- **Verification:** docs read clean; no cross-section renumbering needed (new sections are 16/17,
  appended — every existing `section N` reference stays valid).

## Now (implementation units)

### U1. Typography swap — Atkinson Pro + Commit Mono

- **Status:** todo.
- **Depends on:** U0.
- **Files:** `apps/web/package.json` (deps), `apps/web/app/layout.tsx` (imports),
  `apps/web/app/globals.css` (`--font-sans`/`--font-mono` stacks, feature settings),
  `apps/web/app/(auth)` surfaces inherit automatically.
- **Spec:** `@fontsource/atkinson-hyperlegible-next` weights 400/500/600 + matching italics;
  `@fontsource/commit-mono` 400/500/700. Static per-weight imports (no variable package exists).
  `--font-sans: "Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", sans-serif`;
  `--font-mono: "Commit Mono", ui-monospace, SFMono-Regular, Menlo, monospace`. Feature settings
  drop to `"kern"` — Atkinson has no `cv11`/`ss01`/`tnum`.
- **Numeric columns:** anywhere `tnum` did the work (counts, estimates, durations, cycle
  progress), render in `--font-mono` per the data-face rule — small targeted class swap, not a
  global font-family change.
- **Density audit (the risk):** Atkinson is wider and has a larger x-height than Inter. Re-check
  36px row truncation points, badge-id/keycap fit, the 232px sidebar at 13px, and `72ch` measure.
  If 13px Atkinson reads cramped, the fix is tracking/leading, not a smaller size (11px floor
  holds).
- **Verification:** `pnpm lint:design` + typecheck; e2e axe + a visual-diff run on the scorecard
  script (`tools/e2e/scripts/scorecard.mjs`); eyeball triage/board/detail at compact+comfortable
  density, both themes.
- **Difficulty:** easy-medium (deps + one CSS file + audit pass).
- **Simpler alternative:** none — this is the unit.

### U2. Iconography — Phosphor adoption

- **Status:** todo.
- **Depends on:** U0. Independent of U1.
- **Files:** `apps/web/package.json` (+`@phosphor-icons/react`), new
  `apps/web/components/app/icons.ts` (the single named-icon map), then the 10 files carrying
  inline UI SVGs: `app/nav-icons.tsx` (the shared nav set), `app/filter-bar.tsx`,
  `app/peek-body.tsx`, `app/session-badge.tsx`, `app/ui.tsx`, `issue-list-client.tsx`,
  `primitives.tsx`, `review-queue.tsx`, `landing/landing.tsx`.
- **Keep custom:** `tally-mark.tsx` and the glint `Sparkle` in `primitives.tsx` — brand geometry,
  not icon-set stock.
- **Spec:** `regular` weight at 16px default, `bold` for active/emphasis; no thin/fill/duotone;
  `currentColor` everywhere; every icon-only control keeps its accessible name.
- **Verification:** typecheck + `pnpm lint:design`; e2e (nav icons are keyed in specs via
  aria-labels — they must keep them); axe on nav/palette/pickers; no icon `<svg>` left outside
  `icons.ts`, `tally-mark.tsx`, `primitives.tsx` (a grep gate is acceptable).
- **Difficulty:** medium (mechanical, ~10 files, icon-choice judgment per glyph).
- **Simpler alternative:** keep hand-rolled icons — rejected by the user already.

### U3. Loading surfaces

- **Status:** todo.
- **Depends on:** U0.
- **Gap (evidence):** 10 of 20 routes ship `loading.tsx`; missing: `notifications` and the whole
  `settings/*` tree (9 routes). One `error.tsx` exists at `(app)` level only.
- **Work:**
  a. `loading.tsx` skeletons for `notifications` + every `settings/*` route — skeleton geometry
     matches final layout (row heights, sidebar rails, form blocks).
  b. Cold-boot mark: tally strokes draw once (300ms) on first app paint; static under
     `prefers-reduced-motion`; never between routes. Implement as a `(app)` segment-level
     loading state or a first-mount overlay — pick whichever Next 16 renders earliest per the
     bundled docs.
  c. Lazy-dialog acknowledgement: `⌘K`/`c`/`?`/Space open the frame immediately; contents stream
     — currently `next/dynamic ssr:false` mounts nothing until the chunk lands, so the trigger
     can feel dead on cold cache. Frame-first mounting per §16.
  d. Slow-path escalation: skeleton regions gain muted "Still loading…" + Retry at ~4s.
  e. SSE drop: quiet "reconnecting" pill; reads live, writes disabled with reason.
- **Verification:** e2e — `data-qc-ready` timing still works (wrapper effect, not dialog body);
  skeleton presence per route; axe on skeleton regions (`aria-busy`/`role=status` where
  appropriate); reduced-motion check on the boot mark.
- **Difficulty:** medium.
- **Simpler alternative:** skeletons only, skip the boot mark — acceptable cut if the overlay
  approach fights streaming; document the skip in the plan.

### U4. Edge-state build-out

- **Status:** todo.
- **Depends on:** U0. U3 shares files (boundaries) — sequence after it.
- **Work:**
  a. `error.tsx` per `(app)` segment that can fail independently (issues/[key], board, review,
     triage at minimum) + verify the app-level boundary's copy/reset affordance.
  b. Partial-failure panels: the `feedError` pattern on issue detail is the reference — extend
     it anywhere a page composes secondary fetches (peek comments, session timeline).
  c. Empty-flavor pass: audit every `EmptyState` call site — filtered-empty gets a clear-filters
     affordance, error-empty never masquerades (check `issues` list, triage, review, notifications,
     search results).
  d. Deleted-while-viewing gone-state on `issues/[key]` (API 410/404 → designed page, not the
     default error boundary).
  e. Ghost actors: removed member/agent renders `name (removed)` — check `Avatar`/`actor`
     rendering paths.
  f. 409 conflict surface: state-change rejections show server truth + intended change (the
     store's rollback toast exists — this upgrades it to a visible diff where the picker
     re-opens with current truth).
  g. Double-submit/idempotency audit on mutations (comment POST, quick-create, bulk).
  h. Session-expiry draft preservation: comment/description drafts autosave locally (2s) and
     survive re-auth redirect.
- **Verification:** one `@edge` e2e spec per state class (API failure via route interception,
  filtered-empty, deleted-issue, draft-survives-reload), axe on each new state.
- **Difficulty:** medium-large — the biggest unit; can split (a–c first, d–h second).
- **Simpler alternative:** ship (a),(b),(c) only and defer conflict/ghost/draft to a second pass —
  acceptable; name the deferral in the PR.

### U5. Gates and e2e

- **Status:** todo.
- **Depends on:** U1–U4.
- **Work:** `@edge` tagged specs per §16 state class; extend `landing.spec.ts`-style a11y sweeps
  to the new states; verify the §13 gate table still maps (visual baselines will churn on the
  font swap — regenerate `tools/e2e` scorecard/screenshot baselines deliberately in the font PR,
  not silently).
- **Verification:** full e2e suite green in CI on a throwaway DB; design gate unchanged or lower.
- **Difficulty:** medium.

## Risks / watch-items

- **Atkinson width:** the font is wider than Inter — truncation points, row capacity, and the
  sidebar may need re-tuning; this is the expected main churn of U1.
- **No variable packages:** static weight imports only; check the bundle budget (180kB/route)
  still holds — font files are not JS, but watch total transferred weight on first load.
- **Phosphor glyph coverage:** a few bespoke glyphs (cycle arrow, triage funnel) need the closest
  Phosphor match — pick conservatively; where nothing fits, an existing custom glyph may stay
  with a comment (the rule is "no hand-rolled *UI* icons", not "no custom geometry ever").
- **Screenshot churn:** font swap invalidates every visual baseline — expected, regenerate in-PR.
- **`icons.ts` discipline:** components importing `@phosphor-icons/react` directly defeats the
  audit map — add a lint deny-rule on the package path outside `icons.ts` if eslint allows.
