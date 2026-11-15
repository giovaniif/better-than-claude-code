# Thread

A session's page shows its turns in order: the prompt as a bubble, streamed
text that settles into the final answer, thinking and tool calls folded into a
work log ("Worked for 3s"), edits as diffs, and an engine error as a red line.
Follow-up messages append a new turn. Both engines render the same way.

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

### reply-renders
Expect at both viewports: the prompt and the fake's reply "Echo: TEST-say hello".

```sh
yv drive 'session:{{sid_echo}}' --steps '[{"expect":"css:.thread","text":"TEST-say hello"},{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"shot":"reply"}]'
```

### thinking-folds
A finished turn with thinking folds into "Worked for …"; opening it shows the
thought's first line.

```sh
yv drive 'session:{{sid_think}}' --steps '[{"expect":"css:.thread","text":"Thought it through."},{"click":"role:button:Worked for"},{"expect":"css:.thread","text":"Reading the tests"},{"shot":"thinking-open"}]'
```

### edit-shows-diff
An edit shows the file and its diff lines inline.

```sh
yv drive 'session:{{sid_edit}}' --steps '[{"expect":"css:.thread","text":"src/lib.rs"},{"expect":"css:.thread","text":"fn added() {}"},{"expect":"css:.thread","text":"Edited src/lib.rs."}]'
```

### failed-turn-shows-error
The engine's error shows in the thread.

```sh
yv drive 'session:{{sid_fail}}' --steps '[{"expect":"css:.error-line","text":"fake failure: the model is unavailable"}]'
```

### follow-up-turn
A reply typed in the session runs a second turn in the same thread.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"fill":"label:Message","value":"TEST-second turn"},{"click":"role:button:Send"},{"expect":"css:.thread","text":"Echo: TEST-second turn"}]'
yv state --expect '{"sessions":[{"id":"{{sid_echo}}","status":"idle"}]}'
```

### claude-session-renders
A Claude session (scripted sidecar) renders like a Codex one.

```sh
yv drive 'session:{{sid_claude}}' --steps '[{"expect":"css:.thread","text":"Echo: TEST-hello from Claude"}]'
```

### reply-to-part-of-answer
Selecting part of an agent's answer shows a Reply button over the selection;
pressing it puts the selection in the reply box as a quote, ready for a reply
under it. Selecting your own message shows no button.

```sh
yv drive 'session:{{sid_echo}}' --steps '[{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"eval":"(() => { const p = [...document.querySelectorAll(\".thread .prose p\")].find((e) => e.textContent === \"Echo: TEST-say hello\"); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString(); })()","equals":"Echo: TEST-say hello"},{"expect":{"role":"button","name":"Reply","exact":true},"inViewport":true},{"shot":"reply-button"},{"click":{"role":"button","name":"Reply","exact":true}},{"expect":"label:Message","value":"> Echo: TEST-say hello\n\n"},{"expect":{"role":"button","name":"Reply","exact":true},"visible":false},{"shot":"quoted"}]'
```

### no-reply-on-own-message
Viewports: desktop
Selecting text in your own prompt bubble offers no Reply button.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"eval":"(() => { const b = document.querySelector(\".thread .bubble\"); const r = document.createRange(); r.selectNodeContents(b); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); })()","equals":"TEST-say hello"},{"wait":500},{"expect":{"role":"button","name":"Reply","exact":true},"visible":false}]'
```

### queue-a-message-while-working
While a turn runs (here: waiting for an approval), the reply box stays open:
sending queues the message, shown under "Queued" above the box, and it runs
as its own turn once the current one completes. Each viewport gets its own
busy session (the approval is answered during the drive).

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"[cmd] TEST-busy turn mobile"}' --wait '{"op":"created"}' --save busy_mobile=sessionId
yv drive 'session:{{busy_mobile}}' --viewport mobile --steps '[{"expect":"text:Allow this command?"},{"fill":"label:Message","value":"TEST-queued one"},{"click":{"role":"button","name":"Add to queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-queued one"},{"expect":"label:Message","value":""},{"shot":"queued"},{"click":"role:button:Allow once"},{"expect":"css:.thread","text":"Echo: TEST-queued one"},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"visible":false},{"shot":"sent"}]'
yv state --expect '{"sessions":[{"id":"{{busy_mobile}}","status":"idle"}]}'
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"[cmd] TEST-busy turn desktop"}' --wait '{"op":"created"}' --save busy_desktop=sessionId
yv drive 'session:{{busy_desktop}}' --viewport desktop --steps '[{"expect":"text:Allow this command?"},{"fill":"label:Message","value":"TEST-queued one"},{"click":{"role":"button","name":"Add to queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-queued one"},{"expect":"label:Message","value":""},{"shot":"queued"},{"click":"role:button:Allow once"},{"expect":"css:.thread","text":"Echo: TEST-queued one"},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"visible":false},{"shot":"sent"}]'
yv state --expect '{"sessions":[{"id":"{{busy_desktop}}","status":"idle"}]}'
```

### stop-holds-the-queue
Viewports: desktop
Stop ends the turn but does not send what was queued; a queued message can
be removed.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"[slow] TEST-long turn"}' --wait '{"op":"created"}' --save slowq_sid=sessionId
yv drive 'session:{{slowq_sid}}' --viewport desktop --steps '[{"expect":"css:.thread","text":"Working"},{"fill":"label:Message","value":"TEST-held"},{"click":{"role":"button","name":"Add to queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-held"},{"click":{"role":"button","name":"Stop","exact":true}},{"expect":{"role":"button","name":"Stop","exact":true},"visible":false},{"wait":800},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-held"},{"expect":{"css":".thread","hasText":"Echo: TEST-held"},"visible":false},{"click":{"role":"button","name":"Remove from queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"visible":false}]'
```

## Gotchas
- A failed turn leaves the session status `idle` in the sidebar, with the red error line in the thread.
