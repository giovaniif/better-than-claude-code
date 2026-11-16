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

### markdown-table-renders
Viewports: both
An agent's Markdown table renders as a table (header cells, one row per line), not as raw `| a | b |` text, and a wide one scrolls inside the thread instead of widening the page at 390 px.

```sh
yv api '{"op":"session.send","sessionId":"{{sid_echo}}","text":"TEST-table\n\n| File | Result | Note |\n|---|:---:|---|\n| src/a.ts | pass | |\n| src/b.ts | `fail` | expected 3 tokens, got 2 in the long-running integration suite for the parser |"}' --wait '{"op":"event","event":{"type":"turn_completed"}}'
yv drive 'session:{{sid_echo}}' --steps '[{"expect":{"css":".prose table th","hasText":"Result"}},{"expect":{"css":".prose table td","hasText":"src/b.ts"}},{"expect":{"css":".prose table td code","hasText":"fail"}},{"expect":{"css":".prose table tr"},"count":3},{"expect":{"css":".prose","hasText":"|---"},"visible":false},{"eval":"document.documentElement.scrollWidth <= window.innerWidth","equals":true},{"shot":"table"}]'
```

### markdown-blocks-without-blank-lines
Viewports: both
A heading or a list right under a line of text, with no blank line between them, still renders as a heading and a list, not as raw `## ` and `- ` text.

```sh
yv api '{"op":"session.send","sessionId":"{{sid_echo}}","text":"TEST-blocks\n\n## Summary\nFixed the parser.\n\nChanges:\n- src/a.ts\n- src/b.ts"}' --wait '{"op":"event","event":{"type":"turn_completed"}}'
yv drive 'session:{{sid_echo}}' --steps '[{"expect":{"css":".prose h3","hasText":"Summary"}},{"expect":{"css":".prose li","hasText":"src/b.ts"}},{"expect":{"css":".prose p","hasText":"Changes:"}},{"expect":{"css":".prose","hasText":"## Summary"},"visible":false},{"expect":{"css":".prose","hasText":"- src/a.ts"},"visible":false},{"shot":"blocks"}]'
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
yv drive 'session:{{sid_echo}}' --steps '[{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"eval":"(() => { const p = [...document.querySelectorAll(\".thread .prose p\")].find((e) => e.textContent === \"Echo: TEST-say hello\"); p.scrollIntoView({ block: \"center\" }); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString(); })()","equals":"Echo: TEST-say hello"},{"expect":{"role":"button","name":"Reply","exact":true},"inViewport":true},{"shot":"reply-button"},{"click":{"role":"button","name":"Reply","exact":true}},{"expect":"label:Message","value":"> Echo: TEST-say hello\n\n"},{"expect":{"role":"button","name":"Reply","exact":true},"visible":false},{"shot":"quoted"}]'
```

### no-reply-on-own-message
Viewports: desktop
Selecting text in your own prompt bubble offers no Reply button.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"eval":"(() => { const b = document.querySelector(\".thread .bubble\"); const r = document.createRange(); r.selectNodeContents(b); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); })()","equals":"TEST-say hello"},{"wait":500},{"expect":{"role":"button","name":"Reply","exact":true},"visible":false}]'
```

### queue-a-message-while-working
Like Claude Code: while a turn runs the reply box stays open, "Add to queue"
puts the message under "Queued" above the box and empties the box, and the
agent gets it at its next step, in the same turn: here the approved command
is that step, and the fake's answer names what was steered in. Each viewport
gets its own busy session.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"[cmd] TEST-busy turn mobile"}' --wait '{"op":"created"}' --save busy_mobile=sessionId
yv drive 'session:{{busy_mobile}}' --viewport mobile --steps '[{"expect":"text:Allow this command?"},{"fill":"label:Message","value":"TEST-queued one"},{"click":{"role":"button","name":"Add to queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-queued one"},{"expect":"label:Message","value":""},{"shot":"queued"},{"click":"role:button:Allow once"},{"expect":"css:.thread","text":"Ran it. | steered: TEST-queued one"},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"visible":false},{"shot":"sent"}]'
yv state --expect '{"sessions":[{"id":"{{busy_mobile}}","status":"idle"}]}'
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"[cmd] TEST-busy turn desktop"}' --wait '{"op":"created"}' --save busy_desktop=sessionId
yv drive 'session:{{busy_desktop}}' --viewport desktop --steps '[{"expect":"text:Allow this command?"},{"fill":"label:Message","value":"TEST-queued one"},{"click":{"role":"button","name":"Add to queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-queued one"},{"expect":"label:Message","value":""},{"shot":"queued"},{"click":"role:button:Allow once"},{"expect":"css:.thread","text":"Ran it. | steered: TEST-queued one"},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"visible":false},{"shot":"sent"}]'
yv state --expect '{"sessions":[{"id":"{{busy_desktop}}","status":"idle"}]}'
```

### remove-a-queued-message
Viewports: desktop
× drops a queued message: it leaves the list, does not come back to the reply
box, and never reaches the agent.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"[slow] TEST-drop turn"}' --wait '{"op":"created"}' --save dropq_sid=sessionId
yv drive 'session:{{dropq_sid}}' --viewport desktop --steps '[{"fill":"label:Message","value":"TEST-dropped"},{"click":{"role":"button","name":"Add to queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-dropped"},{"click":{"role":"button","name":"Remove from queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"visible":false},{"wait":500},{"expect":"label:Message","value":""},{"click":{"role":"button","name":"Stop","exact":true}},{"expect":"label:Message","value":""},{"expect":{"css":".thread","hasText":"TEST-dropped"},"visible":false}]'
```

### steer-a-running-turn
A message sent while the agent runs commands reaches it before its answer:
the answer accounts for it, in one turn, and the message shows where it went in.
The commands it interrupted still finish as succeeded, not failed.
(Sent over the API: a drive waits for the page to go quiet, which a running
turn never does.)

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"[steps] TEST-three steps"}' --wait '{"op":"event","event":{"type":"tool_started"}}' --save steps_sid=sessionId
yv api '{"op":"session.send","sessionId":"{{steps_sid}}","text":"TEST-steer"}'
yv drive 'session:{{steps_sid}}' --steps '[{"expect":"css:.thread","text":"steered: TEST-steer","timeout":15000},{"expect":"css:.thread","text":"TEST-steer"},{"expect":"css:.thread","text":"Worked for"},{"expect":{"css":".thread","hasText":"failed"},"visible":false},{"shot":"steered"}]'
yv state --expect '{"sessions":[{"id":"{{steps_sid}}","status":"idle"}]}'
```

### stop-returns-the-queue
Viewports: desktop
Stop ends the turn and puts what was queued back in the reply box, unsent.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"[slow] TEST-long turn"}' --wait '{"op":"created"}' --save slowq_sid=sessionId
yv drive 'session:{{slowq_sid}}' --viewport desktop --steps '[{"expect":"css:.thread","text":"Working"},{"fill":"label:Message","value":"TEST-held"},{"click":{"role":"button","name":"Add to queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-held"},{"click":{"role":"button","name":"Stop","exact":true}},{"expect":"label:Message","value":"TEST-held"},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"visible":false},{"expect":{"css":".thread","hasText":"Echo: TEST-held"},"visible":false}]'
```

### edit-a-queued-message
Viewports: desktop
Edit takes a queued message back into the reply box; so does the up arrow in
an empty box.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"[slow] TEST-another long turn"}' --wait '{"op":"created"}' --save editq_sid=sessionId
yv drive 'session:{{editq_sid}}' --viewport desktop --steps '[{"fill":"label:Message","value":"TEST-first draft"},{"click":{"role":"button","name":"Add to queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-first draft"},{"click":{"role":"button","name":"Edit","exact":true}},{"expect":"label:Message","value":"TEST-first draft"},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"visible":false},{"click":{"role":"button","name":"Add to queue","exact":true}},{"expect":{"css":"[aria-label=\"Waiting to send\"]"},"text":"TEST-first draft"},{"press":"ArrowUp","target":"label:Message"},{"expect":"label:Message","value":"TEST-first draft"},{"click":{"role":"button","name":"Stop","exact":true}}]'
```

### subagent-nests-and-expands
A Claude subagent (the Agent tool) shows as one entry in the work log: its
description, its type and how long it took; collapsed, its steps stay out of
the list. Opening it shows the steps it took, nested, and its report. The
scripted sidecar's `[subagent]` turn runs one subagent that reads a file and
lists a folder.

```sh
yv api '{"op":"session.create","engine":"claude","model":"claude-haiku-5-5","effort":"medium","cwd":"{{repo}}","worktree":true,"text":"[subagent] TEST-survey"}' --wait '{"op":"created"}' --save sub_sid=sessionId
yv drive 'session:{{sub_sid}}' --steps '[{"expect":"css:.thread","text":"Echo: [subagent] TEST-survey","timeout":20000},{"click":"role:button:Worked for"},{"expect":"css:.thread","text":"TEST-survey the repo"},{"expect":"css:.thread","text":"general-purpose"},{"expect":"css:.thread","text":"2 steps"},{"expect":{"css":".thread","hasText":"README.md"},"visible":false},{"shot":"subagent-collapsed"},{"click":"role:button:TEST-survey the repo"},{"expect":"css:.thread","text":"README.md"},{"expect":"css:.thread","text":"ls src"},{"expect":"css:.thread","text":"TEST-subagent report: two files read"},{"shot":"subagent-open"},{"click":"role:button:TEST-survey the repo"},{"expect":{"css":".thread","hasText":"README.md"},"visible":false}]'
```

## Gotchas
- Recipes share one isolated yardd and run in order, and several send to `sid_echo`: by `reply-to-part-of-answer` its first answer is scrolled out of view at 390 px, so that recipe scrolls the paragraph into view before selecting it (a user only selects what they see).
- A failed turn leaves the session status `idle` in the sidebar, with the red error line in the thread.
