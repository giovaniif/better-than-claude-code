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
| Land gate | `verify/yv land`, `verify/land.json` | **shadow mode**: records "would land", merges nothing |
| Verifier | `.claude/skills/verifier/SKILL.md`, `loop run verify --pr N` | a fresh session that knows only the PR URL |
| Babysitting | `.claude/skills/babysit/SKILL.md`, `verify/yv pr …` | written |
| Patrol / maintenance / weekly review | `.claude/skills/{patrol,map-maintenance,weekly-review}`, `verify/loops/` | systemd user timers starting Switchyard sessions |
| CI | `.github/workflows/ci.yml` | yardd, ui, sidecar, verify (unit tests + a real Chromium round trip) |

## State on 2026-11-15

- Timers enabled on the server (`systemctl --user list-timers 'switchyard-loop*'`).
- Codex is **not logged in** on the server, so loops fall back to Claude Sonnet
  under a tight cap (5-hour window ≤ 50%, week ≤ 30%), which skips most runs.
  Log Codex in (Hosts → Log in in Switchyard, or `codex login --device-auth`)
  and the loops use it.
- PR #1 (terminal scrollback garbled after a reload) is the first PR through
  the flow: found by the feature map, base repro, failing recipe first, fix,
  evidence bundle, green CI. It is waiting for a verifier verdict, which the
  patrol starts once usage allows. The gate's shadow call so far: would not land
  (no verdict yet).
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
6. You reply `merge` on the PR (the agent merges it) or `no …` (closed, never
   re-proposed). Pushes reach you through ntfy, because GitHub does not notify
   you of comments from your own account, which the agents post as.

## Going live

After at least a week in shadow mode, the weekly review compares every call
with what you did. One false accept (the gate would have landed a PR you
denied, changed or reverted) rules out its category. To go live for a category
with zero false accepts, set `mode: "live"` and add it to `liveCategories` in
`verify/land.json`; other categories stay in shadow.

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
