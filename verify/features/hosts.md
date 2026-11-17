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

### refused-add-keeps-the-form
Viewports: desktop
A value yardd refuses (remote port 99999) shows the error and keeps the form
with what was typed; fixing the field and adding again closes it once the host
appears.

```sh
yv drive hosts --viewport desktop --allow-errors --steps '[{"click":"role:button:Add host"},{"fill":"label:SSH destination","value":"test@TEST-devbox"},{"click":"role:button:Options"},{"fill":"label:Remote port","value":"99999"},{"click":"role:button:Add TEST-devbox"},{"expect":"css:.banner-error","text":"remote port must be a number"},{"expect":"label:SSH destination","value":"test@TEST-devbox"},{"expect":"label:Remote port","value":"99999"},{"shot":"refused"},{"fill":"label:Remote port","value":"2222"},{"click":"role:button:Add TEST-devbox"},{"expect":"role:region:TEST-devbox"},{"expect":"role:region:Add host","visible":false},{"shot":"added"}]'
```

### local-name-right-after-start
Viewports: desktop
Right after yardd starts, before its first stats sample (about 3 s), the
local host already shows its own name (`iso-host`, from YARD_HOST_NAME), not
"This Mac", in the sidebar's host row and the new-session host picker. The
daemon test `the_snapshot_names_this_machine_before_its_first_stats_sample`
pins the snapshot field without the timing.

```sh
yv iso restart
yv drive new --viewport desktop --steps '[{"expect":{"css":".host-row .host-name","hasText":"iso-host"}},{"expect":{"css":".main button","hasText":"iso-host"}},{"expect":{"css":".host-row .host-name","hasText":"This Mac"},"count":0}]'
```

### no-memory-limit-says-load-only
Viewports: both
With `YARD_MIN_FREE_GB=0` (no memory limit) the Sessions card says new sessions queue on load alone, not "or less than 0 GB of memory is free".

```sh
yv iso down --name map-hosts-nomem >/dev/null
yv iso up --name map-hosts-nomem --env YARD_MIN_FREE_GB=0 >/dev/null
yv drive hosts --iso map-hosts-nomem --steps '[{"expect":{"css":"section.usage","hasText":"New sessions are queued while load is above"}},{"expect":{"css":"section.usage","hasText":"GB of memory"},"visible":false},{"shot":"no-memory-limit"}]'
yv iso down --name map-hosts-nomem
```

### ip-destination-keeps-the-whole-address
Viewports: both
An SSH destination that is an IP address names the host by the whole address,
not its first part: `test@100.64.0.7` offers "Add 100.64.0.7" and saves that
name, and a second host on the same tailnet (`test@100.64.0.8`) is added too,
not refused as "a host named 100 already exists". A host name still gives its
first label (`TEST-devbox` in refused-add-keeps-the-form).

```sh
yv drive hosts --viewport mobile --steps '[{"click":"role:button:Add host"},{"fill":"label:SSH destination","value":"test@100.64.0.9"},{"expect":{"css":".add-host .btn-primary"},"text":"Add 100.64.0.9"},{"shot":"ip-label"}]'
yv drive hosts --viewport desktop --steps '[{"click":"role:button:Add host"},{"fill":"label:SSH destination","value":"test@100.64.0.7"},{"click":"role:button:Add 100.64.0.7"},{"expect":"role:region:100.64.0.7"},{"click":"role:button:Add host"},{"fill":"label:SSH destination","value":"test@100.64.0.8"},{"click":"role:button:Add 100.64.0.8"},{"expect":"role:region:100.64.0.8"},{"expect":{"css":".host-row","hasText":"100.64.0.8"}},{"expect":"css:.banner-error","count":0},{"shot":"two-ip-hosts"}]'
```

### install-on-host (manual: needs a real SSH server)
"Install Switchyard" runs scripts/remote-install.sh over ssh; the daemon suite
covers it with a fake ssh and a file:// release.

## Gotchas
- Isolated environments replace `ssh` with `verify/fakes/ssh`, which always fails like an unreachable host.
