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

## Gotchas
- A failed turn leaves the session status `idle` in the sidebar, with the red error line in the thread.
