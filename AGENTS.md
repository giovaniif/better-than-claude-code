# Agents

Codex and other agents: read [CLAUDE.md](CLAUDE.md). It is the agent guide for
this repository (build, hard rules, verifying), whatever the engine.

Skills live in `.claude/skills/*/SKILL.md`; read the one a task names:

- `verify`: prove a change works in the running app (`verify/yv`)
- `verifier`: the independent verifier pass on a PR
- `babysit`: drive a PR to ready
- `patrol`, `map-maintenance`, `weekly-review`: the scheduled loops
