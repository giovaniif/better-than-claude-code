# Agent loops

Scheduled agents for this repository, following the
[agent verification playbook](https://gist.github.com/giovaniif/fce3a9b4d0a510ddc827a6ed7f5899d7).
Each run is a normal Switchyard session on the live yardd (titled `Loop <kind> …`),
in its own worktree branched from `origin/main`, with full access. Read it, reply
to it or stop it from any Switchyard window.

| Loop | When | Skill |
|---|---|---|
| patrol | hourly at :37 | `.claude/skills/patrol/SKILL.md`: in-flight PRs, then one verified fix |
| maintain | daily 03:30 (São Paulo) | `.claude/skills/map-maintenance/SKILL.md`: keep `verify/features` current |
| review | Mondays 08:00 (São Paulo) | `.claude/skills/weekly-review/SKILL.md`: the gate's calls vs the owner's |
| verify | started by patrol per PR | `.claude/skills/verifier/SKILL.md`: independent verdict |
| babysit | by hand, per PR | `.claude/skills/babysit/SKILL.md` |

Settings: `verify/loops.json` (engine, model, effort, minutes, usage budget).
Every loop runs on Claude (Opus 5.5), the owner's choice on 2026-11-15. A run is
skipped once Claude's 5-hour window passes 70% or its week passes 80%, so the
owner's own sessions keep room.

## Install

```sh
verify/loops/install.sh            # writes the units, timers off
verify/loops/install.sh --enable   # and turns the timers on
```

It installs `~/.local/share/switchyard-loops/run` (from `run.sh`), clones the
loops' own checkout to `~/.local/share/switchyard-loops/switchyard` (reset to
`origin/main` on every run: never edit it), and writes
`switchyard-loop@.service` plus one timer per loop to `~/.config/systemd/user`.

## Operate

```sh
verify/yv loop status                  # loop sessions, last launch per loop, usage
verify/yv loop pause                   # every loop skips until resumed
verify/yv loop resume
verify/yv loop run patrol --dry-run    # what would be sent, and why it would skip
systemctl --user start switchyard-loop@patrol   # one run now
journalctl --user -u 'switchyard-loop@*' -n 50
```

A run is skipped (and recorded in `~/.local/state/switchyard-verify/loops/<kind>.last.json`)
when loops are paused, the previous run of the same kind is still going, the
machine is busy, or the engine's usage is above the budget in `loops.json`.
Finished loop sessions beyond the newest three per kind are archived, and the
`target/` of loop worktrees idle for two hours is deleted. A launch that fails
sends one ntfy alert per hour.
