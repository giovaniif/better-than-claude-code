---
name: verifier
description: Independent verifier pass for a Switchyard pull request. A fresh agent that knows only the PR URL checks the claim against the running app and the evidence bundle, then posts a machine-readable verdict (PASS, PASS+NOTES, FAIL, HUMAN) bound to the head SHA. Use when asked to verify or give a land verdict on a PR.
---

# Verifier pass

You are not the author. You know the PR URL and nothing else: do not read the
author's session, worktree or notes. Your verdict is what lets the land gate
consider the PR, so a wrong PASS is the worst outcome here. When unsure, say
HUMAN.

## 1. Read the PR cold

```sh
N=<number>
verify/yv pr status $N            # head sha, checks, threads, size, earlier verdicts
gh pr view $N --repo giovaniif/switchyard --json title,body,headRefName,headRefOid,files
gh pr diff $N --repo giovaniif/switchyard
```

Restate the claim in your own words: what the user saw, why it was wrong,
what should happen now. If the PR body does not let you restate it, that is a
FAIL ("claim unclear").

## 2. Check out the exact head

Work in your own worktree (the loop gives you one). Then:

```sh
git fetch origin pull/$N/head && git checkout --detach <headRefOid>
verify/yv doctor
```

## 3. Check the evidence

The PR body's Verification section links `bundle.json` on the `verify-assets` branch.

```sh
verify/yv evidence fetch <bundle-url> .verify/evidence/pr-$N
verify/yv evidence verify .verify/evidence/pr-$N
```

Look at the screenshots yourself (base repro and head fix, both viewports).
Do they show what the claim says? A bundle that verifies but shows something
else is a FAIL.

## 4. Reproduce independently

Do not trust the author's steps alone. Bring up your own isolated app at the
head and drive the claim yourself, at both viewports for UI changes:

```sh
verify/yv iso up && verify/yv iso seed
verify/yv drive <route> --steps '…'      # the user flow the PR claims to fix
verify/yv map run <the area it touches>  # compare with `verify/yv map status` known failures
CARGO_BUILD_JOBS=4 cargo test -p yardd && (cd ui && bun test)
verify/yv design-check                   # UI changes
verify/yv assets check                   # no screenshots committed to the branch
```

Also read the diff for: changes outside the claim, weakened or deleted
recipes or tests, `dangerouslySetInnerHTML`, Origin/bind changes, data
deletion, anything in CLAUDE.md's hard rules.

## 5. Decide

- **PASS**: the claim is real, the fix works at head in your own run, the
  evidence verifies, nothing else changed.
- **PASS+NOTES**: as PASS, with small non-blocking notes (naming, a missing
  edge state you checked yourself).
- **FAIL**: the fix does not work, the evidence does not verify, tests fail,
  or the diff does more than it says. Say exactly what failed and how to see it.
- **HUMAN**: only when a person must judge it: irreversible effects
  (installers, releases, the database schema, secrets), the security
  boundary (binding, Origin checks), deleting user data, changes to the
  rules themselves (CI, the gate, skills), a flow the CLI cannot drive
  that the change depends on, or real doubt that it is correct.

The owner merges on PASS and PASS+NOTES without reading the PR (2026-11-15).
Design and product choices that are reasonable and match the claim (order,
copy, defaults, layout, what a setting remembers) are **not** a reason for
HUMAN: list them under notes and give PASS+NOTES. Fix-worthy problems are
FAIL, not HUMAN.

```sh
# Copy the bundle you fetched in step 3 into the verdict: PASS re-verifies it at this checkout.
verify/yv land verdict $N --verdict PASS --bundle .verify/evidence/pr-$N --notes "What you ran and saw." --dry-run
verify/yv land verdict $N --verdict PASS --bundle .verify/evidence/pr-$N --notes "What you ran and saw."
```

The comment carries `<!-- land:verdict v=1 sha=<head> verdict=<X> -->`; a
push after it makes it stale and the gate asks for a new pass.

## 6. Land

After a PASS or PASS+NOTES, hand the PR to the gate. It is live: it merges
only when every rule holds, and it is the only way agent PRs merge.

```sh
git checkout --detach origin/main   # the gate runs main's rules, never the PR's
verify/yv land merge $N
```

- `merged`: wait for the workflows on the merge commit, then
  `verify/yv land watch $N` (a regression opens a revert PR and pings the owner).
  If they are still running when your budget ends, the patrol watches it.
- `waiting on guards`: leave it; the patrol retries every hour.
- `blocked`: read the blockers. Ones a person must judge (`self-or-ci`,
  `irreversible`, `security-boundary`, `data-loss`) go to the owner:
  `verify/yv notify "#$N needs you: <blocker>" --click <PR url>`.

Finish with `verify/yv iso down --all`.
