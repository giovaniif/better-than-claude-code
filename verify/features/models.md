# Models, efforts and permission modes

The composer's model button lists the current engine's models (each other
engine folded into a row of its own) and the current model's efforts.
Same-engine switches apply from the next turn. Picking another
engine's model asks to hand off, then starts a new session in the same folder
with a brief of the work so far. The permission picker (Ask first, Accept
edits, Plan only, Full access) changes the session at once.

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

### switch-model-same-engine
Choosing Fake Deep in a Codex session saves the new model.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Fake Fast Low"},{"click":{"role":"button","name":"Fake Deep","exact":true}},{"press":"Escape"},{"expect":"role:button:Fake Deep"}]'
yv state --expect '{"sessions":[{"id":"{{sid_echo}}","model":"fake-deep"}]}'
```

### permission-mode
Full access is saved on the session.

```sh
yv drive 'session:{{sid_think}}' --viewport desktop --steps '[{"click":"role:button:Ask first"},{"click":"role:menuitemradio:Full access"},{"expect":"role:button:Full access"}]'
yv state --expect '{"sessions":[{"id":"{{sid_think}}","permission":"full"}]}'
```

### hand-off-to-claude
Picking a Claude model asks first; "Hand off" starts a Claude session with the
same title in the same folder.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"click":"role:button:Fake Fast Low"},{"click":{"css":".picker-fold"}},{"click":{"role":"button","name":"Haiku 5.5","exact":true}},{"expect":"role:group:Confirm hand-off"},{"click":{"role":"button","name":"Hand off","exact":true}},{"expect":"role:button:Haiku 5.5","timeout":15000}]'
yv state --expect '{"sessions":[{"engine":"claude","title":"[edit] TEST-fix the greeting"}]}'
```

### hand-off-notes-link-both-sessions
Both sessions keep the same title, so each hand-off note opens the other
session: "Handed off from Codex." goes back to the source, "Handed off to
Claude." goes to the new one.

```sh
yv drive 'session:{{sid_fail}}' --viewport desktop --steps '[{"click":"role:button:Fake Fast Low"},{"click":{"css":".picker-fold"}},{"click":{"role":"button","name":"Sonnet 5.5","exact":true}},{"click":{"role":"button","name":"Hand off","exact":true}},{"expect":"role:button:Sonnet 5.5","timeout":15000},{"expect":{"css":".note","hasText":"Handed off from Codex."}},{"click":{"role":"button","name":"Open session","exact":true}},{"expect":"role:button:Fake Fast Low"},{"expect":"css:.thread","text":"Handed off to Claude."},{"click":{"role":"button","name":"Open session","exact":true}},{"expect":"role:button:Sonnet 5.5"}]'
```

### effort-change-claude-mid-session (manual: not built, see ARCHITECTURE "Engines")
Changing a Claude session's effort mid-session goes through `applyFlagSettings`, which is not wired yet.

## Gotchas
- The model menu opens on the current engine; the other engine is one row ("Claude · N models · switching hands off") that expands, and its models are labelled "Picking one hands off to a new session." Plan usage in the picker is covered in [usage](usage.md).
