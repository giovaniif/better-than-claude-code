# Agent loops

Scheduled agents for this repository, following the
[agent verification playbook](https://gist.github.com/giovaniif/fce3a9b4d0a510ddc827a6ed7f5899d7).
Each run is a Switchyard session on the live yardd, in its own worktree branched
from `origin/main`, with full access. Read it, reply to it or stop it from any
Switchyard window.

| Loop | When | Started by | Skill |
|---|---|---|---|
| patrol | hourly | automation `Loop patrol` | `.claude/skills/patrol/SKILL.md`: in-flight PRs, then one verified fix |
| maintain | daily 03:30 (São Paulo) | automation `Loop maintain` | `.claude/skills/map-maintenance/SKILL.md`: keep `verify/features` current |
| review | Mondays 08:00 (São Paulo) | automation `Loop review` | `.claude/skills/weekly-review/SKILL.md`: the gate's calls vs the owner's |
| verify | per PR | patrol, `verify/yv loop run verify --pr N` (manual automation `Loop verify`) | `.claude/skills/verifier/SKILL.md`: independent verdict |
| babysit | by hand, per PR | `verify/yv loop run babysit --pr N` (manual automation `Loop babysit`) | `.claude/skills/babysit/SKILL.md` |

Every loop is a yardd automation (the scheduled three since 2026-11-16, verify and
babysit since 2026-11-17). Runs are titled `Loop <kind> · <date>`, or
`Loop <kind> #<PR> · <date>` for verify and babysit, show on the **Automations**
page and never in the sidebar, and are archived when their first turn ends.

Verify and babysit have a **manual** schedule: they never fire on their own.
`verify/yv loop run verify --pr N` applies its skip rules, saves `Loop verify`
when its settings differ from `verify/loops.json` (or creates it), then asks yardd
for a run with that PR's prompt (`automation.run { force, prompt, title: "#N" }`).
"Run now" on the page starts a run with the saved prompt, which only says there is
no PR and stops. Switching `Loop verify` or `Loop babysit` off on the page makes
`loop run` skip them (like `verify/yv loop pause`, but per loop). A yardd from
before manual schedules refuses to save them: `loop run` then starts an ordinary
session as before (it shows in the sidebar) and reports `oldYardd` with the reason.

Settings: `verify/loops.json` (engine, model, effort, minutes, schedule, usage
budget). Every loop runs on Claude (Opus 5.5), the owner's choice on 2026-11-15.
A scheduled run is skipped while the previous run of the same loop is still going,
or once Claude's 5-hour window passes 70% or its week passes 80%
(`maxFiveHour`/`maxWeek` on the automation), so the owner's own sessions keep room.
Schedules are in the server's time zone (America/Sao_Paulo). yardd counts an
interval from when it was saved, so patrol runs at the minute it was installed
(installed 2026-11-16 16:38, so around :38), drifting a few seconds per run.

## Install

```sh
verify/loops/install.sh --enable          # units, tidy timer on, automations applied
verify/yv loop automations                # what --apply would create or change
verify/yv loop automations --apply        # create or update the five automations
verify/yv loop automations --apply --iso default   # the same against an isolated yardd
```

`loop automations --apply` finds each automation by name, so rerunning it edits
instead of duplicating (an existing one keeps its Enabled switch). Run it after
changing `verify/loops.json` or a scheduled loop's prompt (`automationPrompt()` in
`verify/src/loop.ts`). Against the live yardd it also turns off the old
`switchyard-loop-{patrol,maintain,review}.timer`; `install.sh` no longer writes them.

`install.sh` installs `~/.local/share/switchyard-loops/run` (from `run.sh`), clones the
loops' own checkout to `~/.local/share/switchyard-loops/switchyard` (never edit it:
it is reset to `origin/main` every five minutes), and writes `switchyard-loop@.service`
and `switchyard-loop-tidy.{service,timer}` to `~/.config/systemd/user`. The
automations use that checkout as their folder: yardd fetches `origin` there and
cuts each run's worktree from `origin/main`.

## Operate

```sh
verify/yv loop status                  # automations (next and last run), loop sessions, usage
verify/yv loop run patrol --dry-run    # what a run by hand would send, and why it would skip
verify/yv loop run verify --pr 161 --dry-run   # the automation.run a verifier would get
verify/yv loop run verify --pr 161 --iso default --checkout <repo>   # the same against an isolated yardd
systemctl --user start switchyard-loop@patrol   # one run by hand, as an ordinary session
journalctl --user -u switchyard-loop-tidy -n 50
```

Pause a scheduled loop with its Enabled switch on the Automations page; "Run now"
there starts one regardless of the skip rules. `verify/yv loop pause` / `resume`
only stop `verify/yv loop run` (verifier, babysit and runs by hand). With `--iso`, the
pause flag and the `last.json` records live in that isolated yardd's folder instead.

Every five minutes `switchyard-loop-tidy.timer` → `run tidy` resets the loops'
checkout to `origin/main` and runs `verify/yv loop tidy`: it archives finished
`Loop …` sessions (yardd already archives automation runs) and deletes the `target/`
of loop worktrees idle for two hours. A `verify/yv loop run` that is skipped is
recorded in `~/.local/state/switchyard-verify/loops/<kind>.last.json`; an automation
keeps its own last run. A launch by `run` that fails sends one Switchyard
notification per hour (`verify/yv notify`).
