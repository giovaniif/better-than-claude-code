# Hosts

The Hosts page lists this machine and every remote yardd with CPU, memory,
disk, a CPU sparkline, per-session use and each engine's login. A remote is
added by SSH destination (one tunnel, retried with backoff) or, for testing, a
direct WebSocket URL. Its sessions join the sidebar with a cloud icon.

## Setup

```sh
yv iso up
yv iso seed
yv var set remote_port "$(yv iso up --name map-hosts-remote --host-name TEST-remote | jq -r .iso.port)"
yv var set remote_work "$(yv var get work --iso map-hosts-remote | jq -er .value)"
```

## Cleanup

```sh
yv iso down --name map-hosts-remote
yv iso down
```

## Recipes

### hosts-page
Viewports: desktop
The heading, this host's card with its stats and both engines logged in. (At
390 px the page does not fit: see layout/mobile-hosts-page.)

```sh
yv drive hosts --viewport desktop --steps '[{"expect":"role:heading:Hosts"},{"expect":{"role":"region","name":"iso-host"},"text":"CPU"},{"expect":{"role":"region","name":"iso-host"},"text":"logged in as me@example.com"},{"expect":{"role":"region","name":"iso-host"},"text":"Codex"},{"shot":"hosts"}]'
```

### add-direct-host
A direct host connects; its card and sidebar row appear.

```sh
yv api '{"op":"host.add","name":"TEST-remote","kind":"direct","url":"ws://127.0.0.1:{{remote_port}}/ws"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-remote","status":"connected"}]}' --save remote_id='hosts[name=TEST-remote].id'
yv drive hosts --viewport desktop --steps '[{"expect":"role:region:TEST-remote"},{"expect":{"css":".host-row","hasText":"TEST-remote"}}]'
```

### remote-session
A session created on the remote runs there and shows in the hub's sidebar.

```sh
yv api '{"op":"session.create","host":"{{remote_id}}","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{remote_work}}","text":"TEST-on the remote"}' --wait '{"op":"created"}' --save rsid=sessionId
yv drive 'session:{{rsid}}' --steps '[{"expect":"css:.thread","text":"Echo: TEST-on the remote"}]'
yv state --iso map-hosts-remote --expect '{"sessions":[{"title":"TEST-on the remote","status":"idle"}]}'
```

### ssh-host-unreachable
An SSH host that cannot be reached reports an error instead of hanging.

```sh
yv api '{"op":"host.add","name":"TEST-ssh","kind":"ssh","destination":"test@unreachable.invalid"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-ssh","status":"error"}]}' --timeout 30000
yv drive hosts --viewport desktop --steps '[{"expect":"role:region:TEST-ssh"}]'
```

### remove-host
Viewports: desktop
"Remove host" asks for a second click ("Click again to remove", with "Its
sessions keep running there."); the second click drops the card and its
sidebar row. Read back: after a reload the card is still gone.

```sh
yv api '{"op":"host.add","name":"TEST-gone","kind":"ssh","destination":"test@gone.invalid"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-gone"}]}'
yv drive hosts --viewport desktop --steps '[{"expect":"role:region:TEST-gone"},{"click":{"css":"section.host-card[aria-label=\"TEST-gone\"] .host-foot button","hasText":"Remove host"}},{"expect":"role:region:TEST-gone","text":"Its sessions keep running there."},{"click":{"css":"section.host-card[aria-label=\"TEST-gone\"] .host-foot button","hasText":"Click again to remove"}},{"expect":"role:region:TEST-gone","count":0},{"expect":{"css":".host-row","hasText":"TEST-gone"},"count":0},{"reload":true},{"expect":"role:heading:Hosts"},{"expect":"role:region:TEST-gone","count":0}]'
```

### install-on-host (manual: needs a real SSH server)
"Install Switchyard" runs scripts/remote-install.sh over ssh; the daemon suite
covers it with a fake ssh and a file:// release.

## Gotchas
- Isolated environments replace `ssh` with `verify/fakes/ssh`, which always fails like an unreachable host.
