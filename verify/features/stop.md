# Stop

Stop (`session.interrupt`) ends a running turn. If the engine ignores it, yardd
ends the turn itself after 5 s (`turn_completed` `interrupted`, with a note); a
stuck Claude sidecar is killed and replaced on the next message.

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

### stop-slow-turn
A turn that honours interrupts stops at once: the Stop button goes away and
the session is idle. (A turn with no tool calls has no work-log row, so no
"Stopped after" label shows.)

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"[slow] TEST-long job"}' --wait '{"op":"created"}' --save slow_sid=sessionId
yv drive 'session:{{slow_sid}}' --viewport desktop --steps '[{"expect":"css:.thread","text":"Working"},{"click":{"role":"button","name":"Stop","exact":true}},{"expect":{"role":"button","name":"Stop","exact":true},"visible":false}]'
yv state --expect '{"sessions":[{"id":"{{slow_sid}}","status":"idle"}]}'
```

### stop-stuck-codex-turn
A Codex turn that ignores Stop is closed by yardd within about 5 s, with a note.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"[stuck] TEST-ignores stop"}' --wait '{"op":"created"}' --save stuck_sid=sessionId
yv drive 'session:{{stuck_sid}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Stop","exact":true}},{"expect":"css:.thread","text":"Codex did not stop the turn, so it was ended here.","timeout":15000}]'
yv state --expect '{"sessions":[{"id":"{{stuck_sid}}","status":"idle"}]}'
```

### stop-stuck-claude-turn
A Claude sidecar that ignores Stop is killed; the next message starts a new one.

```sh
yv api '{"op":"session.create","engine":"claude","model":"claude-haiku-5-5","effort":"medium","cwd":"{{repo}}","worktree":true,"text":"[stuck] TEST-claude ignores stop"}' --wait '{"op":"created"}' --save cstuck_sid=sessionId
yv drive 'session:{{cstuck_sid}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Stop","exact":true}},{"expect":"css:.thread","text":"Claude Code did not stop, so its process was ended.","timeout":15000},{"fill":"label:Message","value":"TEST-after stop"},{"click":"role:button:Send"},{"expect":"css:.thread","text":"Echo: TEST-after stop"}]'
```

## Gotchas
- The Stop button only shows while the session is running or waiting for approval.
