---
name: babysit
description: Drive a Switchyard pull request to ready - fix failing CI, answer and resolve review threads, re-request the reviewer bot, get a fresh verifier verdict after each push, then run the land gate. Use when asked to babysit, shepherd or finish a PR.
---

# Babysit a PR

One babysitter per PR, in its own worktree on the PR branch. Never babysit
inside a worktree you are editing for something else.

## One pass

```sh
N=<number>
verify/yv pr status $N
```

1. **CI.** For each failed check: `gh run view <run-id> --log-failed --repo giovaniif/switchyard`.
   Fix the cause (not the test), run the same thing locally
   (`CARGO_BUILD_JOBS=4 cargo test -p yardd`, `cd ui && bun test`,
   `cd sidecar/yard-claude && bun test`, `verify/yv selftest`), commit, push.
2. **Review threads.** `verify/yv pr threads $N`. Fix real findings, then
   `verify/yv pr reply $N <thread-id> --body "Fixed in <sha>: …" --resolve`.
   If you decline one, reply with the reason and leave it for the reviewer
   (or resolve only if the reviewer is a bot and the reason is solid).
3. **After every push:** the old verdict is stale. Re-record the head proofs
   in the evidence bundle (`verify/yv evidence retarget <dir> --head <new sha>`, then the head proofs again),
   `evidence publish`, update the PR body's Verification section, then ask for
   a fresh verifier: `verify/yv loop run verify --pr $N`. If a review bot is
   configured (`verify/land.json` review.bots), `verify/yv pr rerequest $N`.
   Do not poke a bot whose review is in flight: wait at least 15 minutes after
   a request. An approval can carry over to a new head silently: compare the
   review's commit with the head (`pr status` → `botReview.onHead`, `staleApprovals`).
4. **Ready** means: required checks green, a PASS or PASS+NOTES verdict on the
   current head, no open threads, merge state CLEAN. Then:
   ```sh
   verify/yv land check $N
   verify/yv land merge $N     # live: merges when every rule holds
   ```
5. **Merging.** The gate (live since 2026-11-15) merges a landable PR, PASS
   and PASS+NOTES alike. Otherwise only the owner's explicit `merge` comment
   on *this* PR (`pr status` → `humanReplies[].merge`) merges it; a "merge" on
   one PR never carries over to another. When the owner said merge:
   `gh pr merge $N --squash --match-head-commit <head> --repo giovaniif/switchyard`.
   After any merge, `verify/yv land watch $N` once the workflows finish.

## Gotchas

- `BLOCKED` with green checks and a verdict almost always means an open thread.
  Updating the branch will not fix it.
- Removing a requested reviewer through the API can clear team requests too. Restore them.
- A "clean" automatic merge of main into the branch can still break types or
  behaviour. CI is the real gate; re-verify after it.
- Never open drafts from an automated loop: it cannot un-draft them.
- Agents post as the owner's account, so GitHub does not notify the owner of
  agent comments. Every agent comment carries `<!-- yv:agent -->` (use
  `verify/yv pr comment|reply`, never raw `gh pr comment`). To reach the owner,
  `verify/yv notify "#N needs you: …" --click <PR url>`.
- Never write a comment without the agent marker: a bare "merge" from this
  account is read as the owner's instruction.
