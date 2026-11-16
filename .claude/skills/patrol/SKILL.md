---
name: patrol
description: The hourly patrol loop for Switchyard - handle in-flight agent PRs (owner replies, babysitting, land gate, post-merge watch), then find one real issue in the running app, fix it, prove it with an evidence bundle and open a PR. Started hourly by the Loop patrol automation; use when asked to run a patrol.
---

# Patrol run

About 50 minutes per run. Use the whole budget: stopping after the warm-up is
a failure mode. Read the clock with `date -u`; never write an estimated time.
You are in a fresh worktree branched from origin/main, started by the
`Loop patrol` automation on the live yardd (or by hand with `verify/yv loop run patrol`). Read CLAUDE.md and `.claude/skills/verify/SKILL.md` first.

## 0. Coordination

- **Ledger:** GitHub issues labelled `patrol` (one per finding) and PRs
  labelled `patrol`. Each finding issue's body ends with a status block:
  ```
  <!-- patrol:status -->
  status: candidate | in-progress | pr-open | merged | denied | duplicate
  pr: #N
  thread: <url of the owner's last reply, if any>
  gate: <last land check result>
  watch: <green | regression | pending>
  fingerprint: <route> | <element> | <issue>
  ```
- **Lock:** the issue titled `Patrol run log` (label `patrol-log`). Create it
  if missing. At start, read its last comments: if a `run-start <UTC>` less
  than 55 minutes old has no matching `run-end`, exit silently (post nothing).
  (yardd already skips a scheduled run while the previous one is going; this
  lock also covers a run started by hand.) Otherwise comment `run-start <date -u output>`; at the very end comment
  `run-end <date -u output>: <one-line summary>`. Use
  `verify/yv pr comment`-style markers: every comment you write ends with
  `<!-- yv:agent -->` (`gh issue comment --body-file -` with the marker appended).
- **Notifications:** GitHub never notifies the owner of comments from their
  own account (you post as them). For anything they must see (a PR ready for
  "merge", a regression, a question), `verify/yv notify "<msg>" --click <url>`.
  If it answers `"sent": false` (ntfy is off), nobody was pinged: say it in
  the PR thread with `verify/yv pr comment`, once per blocker and head.
- **Denied fingerprints:** closed `patrol` issues with status `denied`. Never
  re-propose one.

## Phase A: in-flight PRs (at most ~15 minutes)

```sh
gh pr list --repo giovaniif/switchyard --label patrol --state open --json number,title,headRefName,updatedAt
```

For each open patrol PR:
1. `verify/yv pr status <N>` → `humanReplies`:
   - `merge`: merge it (`gh pr merge <N> --squash --match-head-commit <head>`),
     set the finding to `merged`, then `verify/yv land watch <N>` once the
     workflows finish (next run if they are still going).
   - `no …`: close the PR with a comment, set the finding to `denied` with the
     reason and its fingerprint, close the issue. Never re-propose it.
   - anything else is feedback: apply it in a worktree on that branch
     (`git worktree add ../pr-<N> <branch>`), re-prove, push.
2. Babysit it to ready: follow `.claude/skills/babysit/SKILL.md` (one pass).
   When it needs a verifier: `verify/yv loop run verify --pr <N>` starts a
   fresh, independent session; do not verify your own PR. No verdict on head
   and no verifier running (`verify/yv loop status`) means the last one died,
   often on the usage cap (`verify/yv loop log <id>`): start a new one.
3. Ready (checks green, PASS or PASS+NOTES verdict on head, no threads):
   `verify/yv land merge <N>` from a checkout at origin/main (your run's
   worktree starts there; the gate refuses to run from a PR head). The gate is live: it re-checks everything and
   squash-merges pinned to the head SHA. If it answers `waiting on guards`
   (a deploy in flight, 20 minutes since the last merge), try again next run.
   If it is blocked by `self-or-ci`, `irreversible`, `verdict-human` or another
   rule a person must judge, notify the owner once: "#N needs you: <blocker>".
4. For merged patrol PRs from the last day: `verify/yv land watch <N>`.

## Phase B: one new fix

1. **Stack.** `verify/yv doctor`, then `verify/yv iso up && verify/yv iso seed`.
2. **Area.** `verify/yv map status`; pick the area whose `lastRun` is oldest
   (rotation). Note its Gotchas: known product bugs are candidates too.
3. **Map warm-up (≤ 15 min).** `verify/yv map run <area>`. Map drift (the
   recipe is wrong, the app is right): fix the recipe in this run's PR or a
   separate small PR. A real bug becomes a candidate.
4. **Explore like a user** at both viewports (`shot`, `drive`, `aria`):
   wrong or stale data, dead or wrong actions, errors and failed API calls,
   friction and dead ends, layout breaks, missing loading/empty/error states,
   slow screens, edge states (dialogs, long text, back/forward via reload,
   double submit, restart mid-turn, a remote host going away).
5. **Pick one fix**, about 5 files or 200 lines at most.
   - Priority: functional bug, then UX friction, then polish. Fixes only a
     screen reader would notice are not eligible.
   - Restate it: what the user sees, why it is wrong, why it is not
     deliberate (check `git log -S`, docs/ARCHITECTURE.md "Decided", CHANGELOG).
   - Dedupe against denied fingerprints, open `patrol` issues and open PRs.
     When marking an issue duplicate, link the original first.
   - "Nothing qualifies" is allowed only after walking every main flow
     (new session, thread, approvals, stop, panes, sidebar, hosts) at both viewports.
   - Open (or update) the finding issue with the status block: `in-progress`.
6. **Prove it** (the proof bar in the verify skill):
   - Reproduce on base and record it (`evidence add --ref base --kind repro`).
   - Commit the failing test alone (a Rust test in `crates/yardd/tests`, a
     `bun test` in `ui/src`, or a feature-map recipe), record it failing at
     that commit, then commit the fix.
   - Prove it on head at both viewports, run the tests, the design check for
     UI changes, `evidence verify`, `evidence publish`.
   - The fixed bug's repro becomes (or stays) a recipe in `verify/features/`.
7. **Open the PR** (never a draft) on a branch named `patrol/<slug>`:
   - Title: what changed, for users. Label `patrol`. Assign `giovaniif`.
   - Body (`.github/pull_request_template.md`): what was wrong and how it was
     found; zoom crops (`verify/yv annotate`), then full before/after pairs per
     viewport, all as `verify-assets` URLs (`verify/yv assets push`); the test
     plan; the Verification section from `evidence publish`. End with `<!-- yv:agent -->`.
   - Link the finding issue; set it to `pr-open`.
   - Start the verifier: `verify/yv loop run verify --pr <N>`. On PASS or
     PASS+NOTES it runs `verify/yv land merge <N>` itself.
   - Do one babysit pass.

## Finish

`verify/yv iso down --all`, `run-end` on the run log, and remove your
`target/` if you will not need it (`rm -rf target`): each worktree's build is
gigabytes. Leave the worktree itself: yardd archives the run when its turn
ends, and `verify/yv loop tidy` frees the `target/` of a run idle for two hours.

## Rules

- Repo hard rules in CLAUDE.md apply: never touch port 47717, never write
  under `~/.yard` from tests, no Claude turns, LocalStack ports are off limits,
  `CARGO_BUILD_JOBS` stays modest (4).
- Never weaken a recipe or a test to make it pass.
- Merge only through `verify/yv land merge` (or the owner's explicit `merge`
  on that PR). Never `gh pr merge` around the gate, never push to `main`.
- Changes to CI, `verify/` (except `verify/features/`), skills or CLAUDE.md
  always go to the owner: the gate blocks them as self-or-CI.
- A map-only PR (only `verify/features/`) still needs an evidence bundle:
  base notes `no-repro: map-only …` and `no-failing-test: the recipe is the
  test`, the head `map run <area>` output as `--kind fix`, and the recipe as a
  `--kind test --cmd`. Without one the verifier must answer FAIL.
- Every surprise becomes a Gotcha in the feature map, a CLI fix, or a rule in
  this file (in a PR). Don't let the same failure happen twice.
- Branch every fix from `origin/main` (`git checkout -b patrol/<slug>
  origin/main`), never `git checkout main`: a worktree's local `main` can be
  days old.
- `iso restart` keeps the data dir. When you re-record proofs on the same iso
  (after a rebase or a review fix), use names not taken by the first run, or
  yardd refuses them as duplicates and the head shows failed API calls.
- `annotate --box` is in CSS pixels (the viewport, 1440x900 or 390x844), not
  in the 2x screenshot's pixels.
