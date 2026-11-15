---
name: weekly-review
description: Weekly review of the Switchyard land gate - compare every shadow-mode decision with what the owner actually did, count false accepts per category, and report which categories could go live. Started by the weekly loop timer; use when asked for the gate review.
---

# Weekly gate review

The gate runs in shadow mode (`verify/land.json` `mode: shadow`): it records
"would land" / "would not land" in the ledger and merges nothing. This review
is the evidence for ever switching a category to live.

1. `verify/yv land review --days 7`. Each row is a PR's last gate decision
   next to the owner's action: `merged-as-is`, `merged-after-changes`,
   `merged-then-reverted`, `closed`, `open`.
2. For every disagreement, read the PR and its thread and say why:
   - **False accept** (the gate would land it; the owner denied, changed or
     reverted it): what did the gate miss? Propose a rule (a blocker in
     `verify/src/land.ts`, a verifier instruction, a recipe).
   - **False reject**: which blocker fired and whether it was right to.
3. **One false accept in a category means no-go for that category**, this week
   and until a rule change covers it.
4. Post the report as a comment on the `Patrol run log` issue (with
   `<!-- yv:agent -->`) and `verify/yv notify` the owner with the summary:
   categories, PRs, false accepts, false rejects, candidates for live
   (zero false accepts and at least 3 PRs).
5. Do not change `mode` or `liveCategories` yourself. Going live is the
   owner's call: open a PR that edits `verify/land.json` only if they asked.
