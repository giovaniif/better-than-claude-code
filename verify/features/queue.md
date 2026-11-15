# Queue

The resource guard queues a new session (status `queued`, with the reason)
while load is above the core count or free memory is under `YARD_MIN_FREE_GB`.
"Start anyway" starts it at once. This area runs with forced pressure
(`YARD_FORCE_PRESSURE`).

## Setup

```sh
yv iso up --pressure
yv iso seed --profile empty
```

## Cleanup

```sh
yv iso down
```

## Recipes

### new-session-queues
A new session waits with its reason shown, and the sidebar says Queued.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"TEST-queued job"}' --wait '{"op":"created"}' --save q_sid=sessionId
yv state --expect '{"sessions":[{"id":"{{q_sid}}","status":"queued"}]}'
yv drive 'session:{{q_sid}}' --steps '[{"expect":"css:.queued-line","text":"Queued:"},{"expect":"role:button:Start anyway"},{"shot":"queued"}]'
```

### start-anyway
"Start anyway" runs the queued prompt.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"TEST-start me anyway"}' --wait '{"op":"created"}' --save q2_sid=sessionId
yv drive 'session:{{q2_sid}}' --viewport desktop --steps '[{"click":"role:button:Start anyway"},{"expect":"css:.thread","text":"Echo: TEST-start me anyway"}]'
yv state --expect '{"sessions":[{"id":"{{q2_sid}}","status":"idle"}]}'
```

### hosts-page-shows-pressure
The Hosts page says why new sessions wait.

```sh
yv drive hosts --steps '[{"expect":"role:region:iso-host","text":"queued"}]'
```

## Gotchas
- Queued sessions survive a restart and keep their prompt.
