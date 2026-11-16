# Persistence

yardd keeps every session in SQLite. After a restart the sessions and their
history come back; a session that was mid-turn gets "yardd restarted during this
turn." and a failed turn end; the next message resumes the engine's thread
(Codex `thread/resume`).

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

### survives-restart
Sessions and their replies are still there after a restart.

```sh
yv iso restart
yv state --expect '{"sessions":[{"id":"{{sid_echo}}","status":"idle"},{"id":"{{sid_edit}}"},{"id":"{{sid_claude}}"}]}'
yv drive 'session:{{sid_echo}}' --steps '[{"expect":"css:.thread","text":"Echo: TEST-say hello"}]'
```

### mid-turn-restart
A turn running during a restart ends with an error line.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"[slow] TEST-cut by restart"}' --wait '{"op":"created"}' --save cut_sid=sessionId
yv iso restart
yv drive 'session:{{cut_sid}}' --viewport desktop --steps '[{"expect":"css:.thread","text":"yardd restarted during this turn."}]'
yv state --expect '{"sessions":[{"id":"{{cut_sid}}","status":"idle"}]}'
```

### resume-after-restart
A follow-up after a restart resumes the Codex thread instead of starting a new one.

```sh
yv iso restart
yv api '{"op":"session.send","sessionId":"{{sid_echo}}","text":"TEST-after restart"}' --wait '{"op":"event","sessionId":"{{sid_echo}}","event":{"type":"turn_completed"}}'
grep -q "req thread/resume" "$(v fake)/codex.log"
```

### reload-keeps-open-session
A reload keeps the open session (phone browsers reload discarded tabs), and
Back returns to the session opened before.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"reload":true},{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"goto":"session:{{sid_edit}}"},{"expect":"css:.session-row.active","text":"TEST-fix the greeting"},{"eval":"(history.back(), true)","equals":true},{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"reload":true},{"expect":"css:.thread","text":"Echo: TEST-say hello"}]'
yv drive 'session:{{sid_echo}}' --viewport mobile --steps '[{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"reload":true},{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"goto":"session:{{sid_edit}}"},{"click":"role:button:Open sessions"},{"expect":"css:.session-row.active","text":"TEST-fix the greeting"},{"press":"Escape"},{"eval":"(history.back(), true)","equals":true},{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"reload":true},{"expect":"css:.thread","text":"Echo: TEST-say hello"}]'
```

### claude-resume-after-restart (manual: needs a real Claude turn)
The scripted sidecar ignores `resume`; a real Claude resume spends the Claude
subscription.

## Gotchas
- After a restart the mid-turn session's status is `idle`, not `error`; the thread carries the error line.
