# Switchy

Switchy is one persistent conversation outside the session list. Each question
collects bounded, timestamped host evidence and starts a fresh restricted engine
thread. The host scope and model selectors are separate. Context opens the host
rail; source disclosure shows the evidence used. Stop, reconnect and reload keep
the conversation. The composer uses the same `.composer` class as sessions.

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

### ask-and-reload
Viewports: both
A question runs through the scripted Codex, sources expand, and the answer
survives reloading without creating a session row.

```sh
yv drive switchy --steps '[{"expect":"role:heading:Switchy"},{"expect":"label:Switchy model","enabled":true},{"fill":"label:Ask Switchy","value":"TEST-What is happening on this host?"},{"click":"role:button:Send question"},{"wait":"text:This is a scripted Switchy answer."},{"expect":"css:.assistant-answer","text":"TEST-What is happening on this host?"},{"click":"css:.assistant-source-list > summary"},{"click":"css:.assistant-evidence > summary"},{"expect":"css:.assistant-evidence[open] pre"},{"shot":"switchy-answer"},{"reload":true},{"expect":"css:.assistant-answer","text":"This is a scripted Switchy answer."},{"eval":"getComputedStyle(document.querySelector(\".assistant-compose\")).borderRadius","equals":"16px"},{"eval":"getComputedStyle(document.querySelector(\".assistant-compose textarea\")).resize","equals":"none"},{"eval":"document.documentElement.scrollWidth <= innerWidth","equals":true}]'
```

### context-and-followup
Viewports: both
The context panel starts closed, opens on demand, and the conversation accepts
a follow-up without changing routes.

```sh
yv drive switchy --steps '[{"click":"role:button:Context"},{"expect":"css:.assistant-context","text":"Saved terminal activity"},{"shot":"switchy-context"},{"click":"role:button:Context"},{"fill":"label:Ask Switchy","value":"TEST-Which processes are using CPU?"},{"press":"Enter","target":"label:Ask Switchy"},{"wait":"text:This is a scripted Switchy answer."},{"expect":"css:.assistant-conversation","inViewport":true}]'
```

## Gotchas

- Model inference is scripted in this map. Live Claude/Codex output is not proven
  by it. Grok and OpenCode are not exposed until their tool restrictions have a
  supported enforcement path.
- Host collectors are read-only, bounded and timeout-limited. Missing systemctl,
  Docker or ss are unavailable sources, never evidence that no services exist.
- Integration tests cover remote scope, offline coverage, stop, concurrent asks,
  restart persistence, fresh threads, bounded follow-ups and enforced policies.
