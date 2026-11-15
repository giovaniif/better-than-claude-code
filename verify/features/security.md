# Security

yardd binds loopback by default and refuses any browser Origin other than its
own page (and the Tauri window); requests with no Origin (scripts) are allowed.
Agent output is untrusted and is rendered as React elements, never HTML.

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

### foreign-origin-refused
A WebSocket upgrade from another site's origin gets 403.

```sh
P=$(v port)
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Origin: https://evil.example' "http://127.0.0.1:$P/ws")
test "$code" = 403
```

### own-origin-accepted
The page's own origin upgrades (101).

```sh
P=$(v port)
code=$(curl -s -o /dev/null -m 2 -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: http://127.0.0.1:$P" "http://127.0.0.1:$P/ws" || true)
test "$code" = 101
```

### host-header-not-trusted
An Origin that only matches a forged Host header is still refused (DNS rebinding).

```sh
P=$(v port)
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: rebind.example:$P" -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: http://rebind.example:$P" "http://127.0.0.1:$P/ws")
test "$code" = 403
```

### binds-loopback
The daemon listens on 127.0.0.1 only.

```sh
P=$(v port)
ss -ltn | grep -q "127.0.0.1:$P "
! ss -ltn | grep -E "(0\.0\.0\.0|\*|\[::\]):$P "
```

### agent-markup-is-text
Markup in agent output shows as text and never runs.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"TEST-markup <img src=x onerror=window.__pwned=1>"}' --wait '{"op":"created"}' --save xss_sid=sessionId
yv drive 'session:{{xss_sid}}' --steps '[{"expect":"css:.thread","text":"<img src=x onerror"},{"eval":"document.querySelectorAll(\".thread img[src=x]\").length + (window.__pwned ? 100 : 0)","equals":0}]'
```

## Gotchas
- Scripts (and `yv`) send no Origin header; yardd allows that on purpose.
