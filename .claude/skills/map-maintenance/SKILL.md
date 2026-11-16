---
name: map-maintenance
description: Daily upkeep of the Switchyard feature map (verify/features) - add recipes for user-facing flows that have none, re-run areas and fix drift, record product gaps as Gotchas and findings, and open one PR with the map changes. Started daily by the Loop maintain automation.
---

# Map maintenance run

One PR per run with the map changes. The patrol babysits and gates it like any
other PR. Read `.claude/skills/verify/SKILL.md` and `verify/features/README.md` first.

1. **Index hygiene.** List what the app offers and diff it against the map:
   - UI: `grep -n 'aria-label=\|role=\|<button' ui/src/*.tsx`, the routes
     (`new`, `hosts`, `session`), the panes (Changes, Terminal, Pull request),
     menus and dialogs.
   - Protocol: every op handled in `crates/yardd/src/ws.rs` (`"session.create" =>` …)
     and every event in `ui/src/protocol.ts`.
   - Every user-facing flow with no recipe gets one, or a `(manual: why)` entry.
2. **Areas.** Run the two areas with the oldest results (`verify/yv map status`),
   plus any area whose code changed since its last run
   (`git log --since=2.days --name-only origin/main -- crates ui`).
   Fix drift: the recipe is wrong, the app is right. Keep recipes exact
   (expect real text, read values back with `state --expect`).
3. **Product gaps.** A recipe that fails because the app is wrong stays
   failing. Add a Gotcha with the date and what you saw, and open (or update)
   a `patrol` finding issue with the status block from the patrol skill
   (`status: candidate`) so the patrol can pick it up.
4. **Never weaken a recipe.** Removing or renaming a `### recipe` blocks the
   gate (`recipe-removed`); do it only with a reason in the PR body.
5. **Output.** One PR on `map/<date>` labelled `patrol` and `feature-map`:
   what was added, what drifted and why, which product gaps were found (with
   their issues), and the `map run` results (`verify/yv map status`).
   Start a verifier: `verify/yv loop run verify --pr <N>`.
6. `verify/yv iso down --all`; `rm -rf target` when done.
