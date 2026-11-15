# Processes

The Processes tab in the workspace pane lists what the session is running right
now: its process tree (pid, command line shortened, CPU, memory, how long),
including background shells and a terminal's shell. It asks yardd for the list
(`session.procs`) when opened and every 3 s while visible. The pane is hidden
below 1100 px, so the tab exists at desktop only.

## Setup

```sh
yv iso up
yv iso seed
```

## Cleanup

```sh
yv iso down
```

## Recipes

### lists-the-process-tree
Viewports: desktop
The scripted Claude sidecar's `[subagent]` turn leaves a `sleep 30` running
under the sidecar. The tab shows it, and the sidecar above it.

```sh
yv api '{"op":"session.create","engine":"claude","model":"claude-haiku-5-5","effort":"medium","cwd":"{{repo}}","worktree":true,"text":"[subagent] TEST-procs"}' --wait '{"op":"created"}' --save procs_sid=sessionId
yv drive 'session:{{procs_sid}}' --viewport desktop --steps '[{"expect":"css:.thread","text":"Echo: [subagent] TEST-procs","timeout":20000},{"click":{"role":"button","name":"Processes","exact":true}},{"expect":{"role":"region","name":"Workspace"},"text":"sleep 30","timeout":20000},{"expect":{"role":"region","name":"Workspace"},"text":"yard-claude"},{"expect":{"role":"region","name":"Workspace"},"text":"PID"},{"shot":"processes"}]'
```

### nothing-running
Viewports: desktop
A session with no processes says so.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Processes","exact":true}},{"expect":{"role":"region","name":"Workspace"},"text":"Nothing is running for this session."}]'
```

### terminal-shell-is-listed
Viewports: desktop
The shell of the session's terminal shows, tagged as the terminal's.

```sh
yv drive 'session:{{sid_think}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"$"},{"click":{"role":"button","name":"Processes","exact":true}},{"expect":{"css":".proc-tag","hasText":"terminal"},"timeout":20000},{"shot":"terminal-shell"}]'
```

### hidden-on-mobile
Viewports: mobile
There is no workspace pane, so no Processes tab, below 1100 px (known).

```sh
yv drive 'session:{{sid_echo}}' --viewport mobile --steps '[{"expect":{"role":"button","name":"Processes","exact":true},"visible":false}]'
```

## Gotchas
- Below 1100 px the pane is hidden (`@media (max-width: 1100px)`): no Processes tab on mobile.
- The list is the host sampler's, up to 3 s old, so a process that started a moment ago shows on the next refresh.
