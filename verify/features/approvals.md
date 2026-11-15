# Approvals

In "Ask first" mode a command waits for the user: the thread shows "Allow this
command?" with Allow once, Always allow and Deny, and the sidebar row says
"Needs approval". The decision goes to the engine and the turn continues.

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

### pending-shows-card
Expect at both viewports: the card with its three buttons, and the row status.

```sh
yv drive 'session:{{sid_cmd}}' --steps '[{"expect":"text:Allow this command?"},{"expect":"role:button:Allow once"},{"expect":"role:button:Always allow"},{"expect":{"role":"button","name":"Deny","exact":true}},{"expect":"css:.session-row","text":"Needs approval"},{"shot":"approval"}]'
yv state --expect '{"sessions":[{"id":"{{sid_cmd}}","status":"needs_approval"}]}'
```

### allow-once
Allowing runs the command; the fake answers "Ran it." and the session goes idle.

```sh
yv drive 'session:{{sid_cmd}}' --viewport desktop --steps '[{"click":"role:button:Allow once"},{"expect":"css:.thread","text":"Ran it."}]'
yv state --expect '{"sessions":[{"id":"{{sid_cmd}}","status":"idle"}]}'
```

### allow-then-follow-up
After an allowed command the turn ends and the session is idle, so the next
message starts a turn instead of waiting in the queue. (The answer used to be
logged after the engine heard it; a fast engine could end the turn first and
leave the session `running`, with the follow-up stuck in the queue.)

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"[cmd] TEST-allow then follow up"}' --wait '{"op":"created"}' --save follow_sid=sessionId
yv drive 'session:{{follow_sid}}' --viewport desktop --steps '[{"click":"role:button:Allow once"},{"expect":"css:.thread","text":"Ran it."},{"fill":"label:Message","value":"TEST-next step"},{"press":"Enter"},{"expect":"css:.thread","text":"Echo: TEST-next step"}]'
yv state --expect '{"sessions":[{"id":"{{follow_sid}}","status":"idle"}]}'
```

### deny
Denying skips the command; the fake answers "Skipped it.".

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"[cmd] TEST-deny me"}' --wait '{"op":"created"}' --save deny_sid=sessionId
yv drive 'session:{{deny_sid}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Deny","exact":true}},{"expect":"css:.thread","text":"Skipped it."},{"click":"role:button:Worked for"},{"expect":"css:.thread","text":"Denied"}]'
```

### always-allow
"Always allow" runs it and records the choice.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"[cmd] TEST-always"}' --wait '{"op":"created"}' --save always_sid=sessionId
yv drive 'session:{{always_sid}}' --viewport desktop --steps '[{"click":"role:button:Always allow"},{"expect":"css:.thread","text":"Ran it."},{"click":"role:button:Worked for"},{"expect":"css:.thread","text":"Always allowed"}]'
```

## Gotchas
- A decided approval folds into the turn's "Worked for … · Ran 1 command" row; open it to read "Allowed", "Always allowed" or "Denied".
- `role:button:Allow` matches "Allow once" and "Always allow"; name buttons in full or use `exact`.
