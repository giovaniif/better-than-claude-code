# OpenCode and Grok

OpenCode (`opencode acp`) and Grok (`grok agent stdio`) run through yardd's
ACP driver. Where their CLI is installed, the model picker lists each as its
own row next to Claude and Codex; a session on either streams its reply,
asks before commands and edits (Ask first), and takes the approval like the
other engines. Messages sent mid-turn wait for the next turn: neither engine
takes input inside a running one. The scripted `opencode` and `grok` in
`crates/yardd/tests/fake-codex` stand in for both; `[cmd]`, `[edit]`,
`[think]`, `[slow]`, `[stuck]`, `[fail]` work as for the fake Codex.

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

### picker-lists-opencode-and-grok
Expect at both viewports: the model picker on the new-session page has a
folded row per engine, "OpenCode · 1 model" (the fake's free model; more
appear once a provider is added) and "Grok · 2 models", and opening Grok's
row lists its models.

```sh
yv drive new --steps '[{"click":{"css":".picker .btn-quiet","nth":0}},{"expect":"role:button:OpenCode · 1 model"},{"click":"role:button:Grok · 2 models"},{"expect":{"css":".picker-model","hasText":"Fake Large"}},{"shot":"picker"}]'
```

### opencode-session-streams-a-reply
Expect at both viewports: a session started on OpenCode's free model answers
"Echo: <prompt>" and its row names the model.

```sh
yv drive new --steps '[{"click":{"css":".picker .btn-quiet","nth":0}},{"click":"role:button:OpenCode · 1 model"},{"click":{"css":".picker-model","hasText":"Fake Free (opencode)"}},{"fill":"label:Message","value":"TEST-hello from OpenCode"},{"click":"role:button:Send"},{"expect":"css:.thread","text":"Echo: TEST-hello from OpenCode","timeout":15000},{"shot":"opencode-session"}]'
```

### grok-command-asks-first
Expect at both viewports: a Grok session in Ask first shows the command's
approval card; Allow once runs it and the reply follows.

```sh
yv drive new --steps '[{"click":{"css":".picker .btn-quiet","nth":0}},{"click":"role:button:Grok · 2 models"},{"click":{"css":".picker-model","hasText":"Fake Small"}},{"fill":"label:Message","value":"[cmd] TEST-check with Grok"},{"click":"role:button:Send"},{"expect":"css:.thread","text":"Allow this command?","timeout":15000},{"shot":"approval"},{"click":"role:button:Allow once"},{"expect":"css:.thread","text":"Ran it.","timeout":15000}]'
```

### opencode-hands-off-from-its-picker
Expect on desktop: inside an OpenCode session the picker folds Claude, Codex
and Grok into rows that say switching hands off.

Viewports: desktop

```sh
yv drive new --viewport desktop --steps '[{"click":{"css":".picker .btn-quiet","nth":0}},{"click":"role:button:OpenCode · 1 model"},{"click":{"css":".picker-model","hasText":"Fake Free (opencode)"}},{"fill":"label:Message","value":"TEST-hand-off source"},{"click":"role:button:Send"},{"expect":"css:.thread","text":"Echo: TEST-hand-off source","timeout":15000},{"click":{"css":".picker .btn-quiet","nth":0}},{"expect":"role:button:Grok · 2 models · switching hands off"},{"expect":"role:button:Codex · 2 models · switching hands off"}]'
```

### queued-message-waits-for-next-turn
Expect at both viewports: a message sent while an OpenCode turn runs is
queued with "Queued: sent when the current turn ends", not the Claude/Codex
"reads it after its current step" (neither engine takes input mid-turn, so
yardd sends it as the next turn). Stop gives it back to the reply box.
```sh
for vp in mobile desktop; do
  yv api '{"op":"session.create","engine":"opencode","model":"opencode/fake-free","effort":"","cwd":"{{repo}}","worktree":true,"text":"[slow] TEST-opencode long job '$vp'"}' --wait '{"op":"created"}' --save oc_queue_sid=sessionId
  yv drive 'session:{{oc_queue_sid}}' --viewport $vp --steps '[{"expect":"css:.thread","text":"Working","timeout":15000},{"fill":"label:Message","value":"TEST-after the opencode job"},{"press":"Enter"},{"expect":{"css":".pending","hasText":"TEST-after the opencode job"}},{"expect":"css:.pending","text":"Queued: sent when the current turn ends"},{"shot":"queued"},{"click":{"role":"button","name":"Stop","exact":true}},{"expect":{"role":"button","name":"Stop","exact":true},"visible":false,"timeout":15000},{"expect":"label:Message","value":"TEST-after the opencode job"},{"expect":"css:.pending","count":0}]'
done
```

## Gotchas
- Neither engine reports plan usage, so the usage meters and the automations' usage limits ignore them.
- The fake's OpenCode lists one model until a provider (`fakeprov`) is logged in; the logins area adds one.
