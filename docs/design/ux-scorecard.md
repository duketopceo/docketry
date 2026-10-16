# Tallyline UX scorecard

Scored 1-10 per dimension from screenshots on a seeded workspace (3 teams, 120 issues, 3 agents, 38 sessions) at 1440 and 390, dark and light, plus the gates listed below. Before = main@1d0c1e7 (docs/screenshots/ux-core/before-*.png). After = this PR series (after-*.png).

## Before

| Screen | Hierarchy | Density | Type | Color | Keyboard | Feedback | States | Mobile | Agent | Avg |
|---|---|---|---|---|---|---|---|---|---|---|
| App shell + sidebar | 5 | 6 | 5 | 7 | 6 | 4 | 5 | 2 | 5 | **5.0** |
| My Issues | 5 | 6 | 5 | 6 | 6 | 4 | 6 | 2 | 5 | **5.0** |
| All Issues | 5 | 7 | 5 | 6 | 6 | 3 | 5 | 2 | 5 | **4.9** |
| Board | 5 | 6 | 5 | 6 | 6 | 4 | 4 | 2 | 5 | **4.8** |
| Issue detail | 4 | 4 | 5 | 5 | 4 | 3 | 4 | 3 | 5 | **4.1** |
| Triage | 5 | 6 | 5 | 6 | 7 | 3 | 6 | 2 | 4 | **4.9** |
| Review queue | 5 | 6 | 5 | 6 | 7 | 3 | 5 | 3 | 5 | **5.0** |
| Cycle | 4 | 5 | 5 | 5 | 4 | 3 | 4 | 2 | 4 | **4.0** |
| Roadmap | 6 | 6 | 5 | 6 | 6 | 4 | 4 | 3 | 3 | **4.8** |
| Insights | 3 | 5 | 4 | 3 | 2 | 2 | 3 | 3 | 3 | **3.1** |
| Palette + keymap | 6 | 6 | 6 | 6 | 7 | 5 | 5 | 5 | 3 | **5.4** |
| Landing (/) | 6 | 7 | 6 | 6 | 5 | 5 | 5 | 5 | 4 | **5.4** |
| Login | 6 | 6 | 6 | 7 | 6 | 5 | 5 | 6 | 5 | **5.8** |

## After

| Screen | Hierarchy | Density | Type | Color | Keyboard | Feedback | States | Mobile | Agent | Avg |
|---|---|---|---|---|---|---|---|---|---|---|
| App shell + sidebar | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** |
| My Issues | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** |
| All Issues | 9 | 9 | 9 | 9 | 8 | 9 | 9 | 9 | 9 | **8.9** |
| Board | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 8 | 9 | **8.9** |
| Issue detail | 9 | 9 | 9 | 9 | 8 | 9 | 9 | 9 | 9 | **8.9** |
| Triage | 9 | 9 | 9 | 9 | 9 | 8 | 9 | 9 | 9 | **8.9** |
| Review queue | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 8 | **8.9** |
| Cycle | 9 | 9 | 9 | 9 | 8 | 9 | 9 | 9 | 8 | **8.8** |
| Roadmap | 8 | 8 | 8 | 9 | 8 | 8 | 9 | 8 | 8 | **8.2** |
| Insights | 9 | 9 | 9 | 9 | 8 | 9 | 9 | 9 | 9 | **8.9** |
| Palette + keymap | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** |
| Landing (/) | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** |
| Login | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** |

## What still scores below 9, and why

- **Keyboard 8 on All Issues and Issue detail:** labels cannot be edited inline. The API has no way to change labels on an existing issue (PATCH has no `labelIds`), and this work was not allowed to touch apps/api. `l` is unbound. Everything else on the foundation map (c e s p a x . Space Enter Esc j k g-chords ? Cmd+K Cmd+Z) is implemented.
- **Feedback 8 on Triage:** accept and decline cannot offer Undo because the state machine has no edge back to triage.
- **Agent 8 on Review:** the pane shows the agent's report, session log, branch and PR link, but PR status, checks and diff stat are not exposed by the API. Revert in the issue activity covers state changes only, because only `state_changed` events carry before/after.
- **Cycle keyboard 8:** complete and delete are palette/mouse actions with no single-key shortcut.
- **Roadmap 8 across most dimensions:** typography, mobile and pickers were reworked, but the Gantt grid itself is still the original bespoke layout (mono-heavy labels, no inline edit of milestones).
- **Board mobile 8:** columns scroll horizontally on a phone (with the column rail to jump), not a single-column mode.

## Gates run for this series

- axe (WCAG 2.0/2.1/2.2 A+AA): 68 tests, 0 violations: 14 app pages and 2 logged-out pages in both themes at 1440 and 390, plus peek/picker/palette open and an agent issue with a failed session.
- Lighthouse 12 on a production build (throttled mobile preset, shared 12-core ARM box under load): / 98/100/100, /login 98/100/100, /board 94/100/100 (performance/accessibility/best-practices). Desktop preset: all 100. Board mobile performance is 1 point under the 95 target (177 kB route JS); see the PR for what was tried.
- @hydration: no hydration warnings on any core route or on / and /login.

