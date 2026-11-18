# Processes

The Processes tab in the workspace pane lists what the session is running right
now: its process tree (pid, command line shortened, CPU, memory, how long),
including background shells and a terminal's shell. It asks yardd for the list
(`session.procs`) when opened and every 3 s while visible. The pane is hidden
below 1100 px, so the tab exists at desktop only.

Each row but the engine's own (the Claude sidecar and its CLI) has a Stop (×,
on hover, always on touch) that asks for a second click and sends SIGTERM
(`session.kill`); a row with children also offers "Stop with children". A row
still running a few seconds later offers "Force kill" (SIGKILL), also
confirmed. yardd checks every pid against the session's tree read at that
moment and refuses anything else with a reason, shown under the row.

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
yv drive 'session:{{procs_sid}}' --viewport desktop --steps '[{"expect":"css:.thread","text":"Echo: [subagent] TEST-procs","timeout":20000},{"select":"label:Workspace view","value":"procs"},{"expect":{"role":"region","name":"Workspace"},"text":"sleep 30","timeout":20000},{"expect":{"role":"region","name":"Workspace"},"text":"yard-claude"},{"expect":{"role":"region","name":"Workspace"},"text":"PID"},{"shot":"processes"}]'
```

### nothing-running
Viewports: desktop
A session with no processes says so.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"select":"label:Workspace view","value":"procs"},{"expect":{"role":"region","name":"Workspace"},"text":"Nothing is running for this session."}]'
```

### terminal-shell-is-listed
Viewports: desktop
The shell of the session's terminal shows, tagged as the terminal's.

```sh
yv drive 'session:{{sid_think}}' --viewport desktop --steps '[{"select":"label:Workspace view","value":"terminal"},{"expect":"css:.xterm","text":"$"},{"select":"label:Workspace view","value":"procs"},{"expect":{"css":".proc-tag","hasText":"terminal"},"timeout":20000},{"shot":"terminal-shell"}]'
```

### stop-a-terminal-command
Viewports: desktop
A long command in the session's terminal shows in the tab; its Stop asks for a
second click, then SIGTERM ends it and the row goes.

```sh
yv drive 'session:{{sid_fail}}' --viewport desktop --steps '[{"select":"label:Workspace view","value":"terminal"},{"wait":"label:Terminal input"},{"type":"sleep 300\n","target":"label:Terminal input"},{"select":"label:Workspace view","value":"procs"},{"expect":{"css":".proc-row","hasText":"sleep 300"},"timeout":20000},{"click":"css:.proc-row:has-text(\"sleep 300\") .proc-kill"},{"expect":"role:button:Confirm stop process","text":"Stop?"},{"shot":"stop-armed"},{"click":"role:button:Confirm stop process"},{"expect":{"css":".proc-row","hasText":"sleep 300"},"visible":false,"timeout":10000},{"expect":{"css":".proc-tag","hasText":"terminal"}},{"shot":"stopped"}]'
```

### force-kill-what-ignores-sigterm
Viewports: desktop
A command that ignores SIGTERM is still there after Stop: the row says so and
offers Force kill, which asks again, then SIGKILL ends it.

```sh
yv drive 'session:{{sid_think}}' --viewport desktop --steps '[{"select":"label:Workspace view","value":"terminal"},{"wait":"label:Terminal input"},{"type":"trap \"\" TERM; sleep 301\n","target":"label:Terminal input"},{"select":"label:Workspace view","value":"procs"},{"expect":{"css":".proc-row","hasText":"sleep 301"},"timeout":20000},{"click":"css:.proc-row:has-text(\"sleep 301\") .proc-kill"},{"click":"role:button:Confirm stop process"},{"expect":"css:.proc-note","text":"Still running after SIGTERM.","timeout":10000},{"shot":"still-running"},{"click":"role:button:Force kill process"},{"expect":"role:button:Confirm force kill process","text":"Force kill?"},{"click":"role:button:Confirm force kill process"},{"expect":{"css":".proc-row","hasText":"sleep 301"},"visible":false,"timeout":10000}]'
```

### stop-with-children
Viewports: desktop
A process with a child offers "Stop with children", which ends both.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"select":"label:Workspace view","value":"terminal"},{"wait":"label:Terminal input"},{"type":"sh -c \"sleep 302 & wait\"\n","target":"label:Terminal input"},{"select":"label:Workspace view","value":"procs"},{"expect":{"css":".proc-row","hasText":"sleep 302 & wait"},"timeout":20000},{"click":"css:.proc-row:has-text(\"sleep 302 & wait\") .proc-kill"},{"expect":"role:button:with its children","text":"Stop with children"},{"shot":"stop-with-children"},{"click":"role:button:with its children"},{"expect":{"css":".proc-row","hasText":"sleep 302"},"visible":false,"timeout":10000}]'
```

### stop-with-children-fits-the-pane
Viewports: desktop
Arming Stop on a row with children keeps the table inside the pane: both
choices show in full and the pane does not scroll sideways. Once, the two
buttons sat in the row's last cell and widened it, so at 1440 px the table ran
45 px past the pane, "Stop with children" was cut at the window's edge and the
command shrank to "sle…".

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"select":"label:Workspace view","value":"terminal"},{"wait":"label:Terminal input"},{"type":"sh -c \"sleep 304 & wait\"\n","target":"label:Terminal input"},{"select":"label:Workspace view","value":"procs"},{"expect":{"css":".proc-row","hasText":"sleep 304 & wait"},"timeout":20000},{"click":"css:.proc-row:has-text(\"sleep 304 & wait\") .proc-kill"},{"expect":"role:button:with its children","text":"Stop with children","inViewport":true},{"expect":"role:button:Confirm stop process","text":"Stop","inViewport":true},{"eval":"(() => { const p = document.querySelector(\".proc-table\").parentElement; return p.scrollWidth <= p.clientWidth; })()","equals":true},{"shot":"armed-fits"},{"click":"role:button:with its children"},{"expect":{"css":".proc-row","hasText":"sleep 304"},"visible":false,"timeout":10000}]'
```

### agent-offers-no-stop
Viewports: desktop
The Claude sidecar is the session's agent: its row has no Stop. The
`sleep 30` it left running has one.

```sh
yv api '{"op":"session.create","engine":"claude","model":"claude-haiku-5-5","effort":"medium","cwd":"{{repo}}","worktree":true,"text":"[subagent] TEST-kill-agent"}' --wait '{"op":"created"}' --save agent_sid=sessionId
yv drive 'session:{{agent_sid}}' --viewport desktop --steps '[{"expect":"css:.thread","text":"Echo: [subagent] TEST-kill-agent","timeout":20000},{"select":"label:Workspace view","value":"procs"},{"expect":{"css":".proc-row","hasText":"sleep 30"},"timeout":20000},{"expect":{"css":".proc-row","hasText":"yard-claude"}},{"expect":"css:.proc-row:has-text(\"yard-claude\") .proc-kill","count":0},{"expect":"css:.proc-row:has-text(\"sleep 30\") .proc-kill","count":1},{"shot":"agent-row"}]'
```

### refused-outside-the-session
The daemon refuses a pid that is not in the session's tree, with
a reason rather than an error: pid 1, and pid 2 (on Linux the kernel's thread daemon, never a session's).

```sh
yv api '{"op":"session.kill","sessionId":"{{sid_echo}}","pid":1,"signal":"kill"}' --wait '{"op":"session.killed"}' --expect '{"op":"session.killed","result":"refused","reason":"~belongs to the system"}'
yv api '{"op":"session.kill","sessionId":"{{sid_echo}}","pid":2,"signal":"term"}' --wait '{"op":"session.killed"}' --expect '{"op":"session.killed","result":"refused","reason":"~not one of this session"}'
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
- An interactive shell ignores SIGTERM, so stopping a terminal's own shell reads "Still running after SIGTERM."; Force kill ends it and the terminal.
