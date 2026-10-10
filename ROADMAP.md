# Roadmap

Current program plan (2026-10-10): [plans/2026-10-10-program-roadmap-plan.md](./plans/2026-10-10-program-roadmap-plan.md)

| Horizon | Unit | Difficulty |
|---|---|---|
| Now | U1 Reconcile docs with code, delete stub `services/dispatch` and empty `packages/ui` | easy |
| Now | U2 GitHub Actions gate for `pnpm check` | medium |
| Now | U3 e2e scripts that do not need free host ports | easy |
| Now | U4 Agent key revoke and rotate | easy |
| Now | U5 Hosted dogfood instance (#88) | medium |
| Next | U6 Remove or use Redis | easy / medium |
| Next | U7 Push-based event stream | medium |
| Next | U8 Agent session acknowledgement and timeout | medium |
| Next | U9 Transition-triggered dispatch | medium |
| Next | U10 Web UI: board overflow, virtualization, design pass | medium |
| Next | U11 WordInk voice intake (#41) | medium |
| Later | U12 OAuth agent install | hard |
| Later | U13 Multi-workspace hardening | hard |
| Later | U14 Trim unused integrations | medium |

Research behind this: [docs/research/2026-10-10-landscape.md](./docs/research/2026-10-10-landscape.md).

## Earlier milestones

Shipped history is in [CHANGELOG.md](./CHANGELOG.md); the original product requirements (R1-R25) are in
[plans/2026-10-08-1647-feat-docketry-plan.md](./plans/2026-10-08-1647-feat-docketry-plan.md).
