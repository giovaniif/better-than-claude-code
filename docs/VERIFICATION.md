# Verification and agent PRs

How agents find, fix, prove and land changes to Switchyard without someone
reading every diff. Based on the
[agent verification playbook](https://gist.github.com/giovaniif/fce3a9b4d0a510ddc827a6ed7f5899d7).
Set up 2026-11-15.

| Piece | Where | State |
|---|---|---|
| Verification CLI | `verify/yv` (`verify/src`) | built: doctor, build, iso, api, state, shot, drive, map, evidence, design-check, annotate, assets, pr, land, notify, loop, selftest |
| Verification skill | `.claude/skills/verify/SKILL.md` | written |
| Feature map | `verify/features/*.md` | 17 areas, 71 recipes: 61 pass, 6 manual, 4 fail on known product bugs (mobile layout, terminal replay after reload) |
| Evidence bundle | `verify/yv evidence` | the proof bar from the playbook, enforced by `evidence verify` |
| Land gate | `verify/yv land`, `verify/land.json` | **live** for every category: merges PRs it finds landable (PASS or PASS+NOTES) |
| Verifier | `.claude/skills/verifier/SKILL.md`, `loop run verify --pr N` | a fresh session that knows only the PR URL: a run of the manual automation `Loop verify`, on the Automations page |
| Babysitting | `.claude/skills/babysit/SKILL.md`, `verify/yv pr …` | written |
| Patrol / maintenance / weekly review | `.claude/skills/{patrol,map-maintenance,weekly-review}`, `verify/loops/` | yardd automations `Loop patrol`/`maintain`/`review` on the live yardd (`verify/yv loop automations --apply`); runs show on the Automations page |
| CI | `.github/workflows/ci.yml` | yardd, ui, sidecar, verify (unit tests + a real Chromium round trip) |

## State on 2026-11-15

- Timers enabled on the server (`systemctl --user list-timers 'switchyard-loop*'`).
  Since 2026-11-16 only the tidy timer is left: the scheduled loops are
  automations (`verify/yv loop status` shows their next and last run).
- Every loop runs on Claude Opus 5.5, skipped above 70% of the 5-hour window
  or 80% of the week.
- The land gate is live: the verifier posts PASS or PASS+NOTES, then runs
  `land merge`, which merges when every rule holds. Self-or-CI and
  irreversible changes still go to the owner.
- PR #2 (reply to a part of an agent's answer, the owner's feature request)
  went through the whole loop unattended: evidence, a PASS+NOTES verdict, the
  gate merged it 13 s later, and the post-merge watch came back green.
- PR #1 (terminal scrollback garbled after a reload) got a FAIL from its
  verifier, which found the first fix incomplete; the second round attaches
  only after the first fit, with the verifier's repro as a recipe.
- Open product gap: no layout below ~700 px (layout/mobile-* recipes fail).

## The isolated app

`verify/yv iso up` builds yardd and the UI from the checkout (only when
stale), starts yardd on a free loopback port with a throwaway data dir and
HOME, the scripted engines from `crates/yardd/tests/fake-codex`, a fake `gh`
that answers one canned PR and a fake `ssh` that never connects. The agent's
inherited `YARD_*` settings (it usually runs inside a Switchyard session) are
scrubbed. `iso seed` adds a `TEST-demo-app` repository and one session per
scripted behaviour. Nothing touches the live yardd on 47717, `~/.yard`, or a
real model.

## What a patrol PR looks like

1. A claim: what the user saw and why it is wrong.
2. A base repro (screenshots, drive output with errors), the regression test
   failing on the test-only commit, then the fix.
3. Head proofs at mobile (390×844) and desktop (1440×900), the test suites,
   the design check, `evidence verify` passing, all published to the
   `verify-assets` branch and summarised in the PR body.
4. An independent verifier's verdict comment (`<!-- land:verdict … -->`) on the head SHA.
5. `verify/yv land check` (blockers: draft, stale or missing verdict, checks,
   threads, merge state, irreversible effects, self-or-CI changes, unscanned
   files, removed recipes; guards: deploys, last deploy failed, time since
   the last merge, landing hours 08:00-22:00 São Paulo).
6. The verifier runs `verify/yv land merge`: a landable PR is squash-merged,
   pinned to its head. `land watch` checks the workflows on the merge commit
   and opens a revert PR on a regression (a job that failed or timed out; a run whose jobs never got a runner is re-run instead). You can still reply `no …` on any
   PR (closed, never re-proposed) or `merge` on one the gate blocked. Pings
   reach you as Switchyard notifications (`verify/yv notify`), because GitHub does not notify you of comments
   from your own account, which the agents post as.

## Staying live

The weekly review compares every decision with what happened afterwards
(reverts, follow-up changes, your objections). A false accept is a reason to
take its category out of `liveCategories` in `verify/land.json` until a rule
covers it.

## Known limits

- Agents and the owner share one GitHub account. Agent comments carry
  `<!-- yv:agent -->`; a bare "merge" from that account counts as the owner's.
  A bot account or GitHub App would make this airtight.
- No review bot is installed; the verifier's verdict is the review
  (`approval.verdictCounts`). Add bots under `review.bots` when there are any.
- There is no branch protection; required checks come from `verify/land.json`.
- Not driven by the CLI (marked manual in the map): the Finder dialog, real
  SSH hosts and the remote installer, paste and OS drag-and-drop, terminal
  selection, real Claude turns.
