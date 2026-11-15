---
name: weekly-review
description: Weekly review of the Switchyard land gate - compare every gate decision with what happened afterwards (reverts, follow-up changes, owner objections), count false accepts per category, and recommend which categories stay live. Started by the weekly loop timer; use when asked for the gate review.
---

# Weekly gate review

The gate is live for every category (`verify/land.json`: `mode: live`,
`liveCategories: ["*"]`, the owner's call on 2026-11-15). It records every
decision in the ledger. This review checks that it deserves to stay live.

1. `verify/yv land review --days 7`. Each row is a PR's last gate decision
   next to the owner's action: `merged-as-is`, `merged-after-changes`,
   `merged-then-reverted`, `closed`, `open`.
2. For every disagreement, read the PR and its thread and say why:
   - **False accept** (the gate landed it, or would have; the owner reverted,
     changed or objected to it afterwards): what did the gate miss? Propose a rule (a blocker in
     `verify/src/land.ts`, a verifier instruction, a recipe).
   - **False reject**: which blocker fired and whether it was right to.
3. **One false accept in a category means no-go for that category**, this week
   and until a rule change covers it.
4. Post the report as a comment on the `Patrol run log` issue (with
   `<!-- yv:agent -->`) and `verify/yv notify` the owner with the summary:
   categories, PRs, false accepts, false rejects, candidates for live
   (zero false accepts and at least 3 PRs).
5. Do not change `mode` or `liveCategories` yourself. Recommend taking a
   category out of live in the report; the owner decides.
