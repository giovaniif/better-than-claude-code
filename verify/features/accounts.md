# Accounts

More than one login per engine and per host, for example a personal and a
company Claude Code subscription. Each engine has its **Default** account (the
login the CLI already has) plus added accounts, each with its own config
folder under yardd's data dir (`CLAUDE_CONFIG_DIR` for Claude Code,
`CODEX_HOME` for Codex). The Hosts page lists them per engine with Add
account, Log in and Remove; the model picker offers the account under an
engine, but only where that engine has more than one. A session keeps the
account it was created with (shown in its header and sidebar row); it cannot
be changed mid-session. The fakes keep login state per config folder and log
which folder a sidecar started under (`config=` in `sidecar.log`).

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

### add-account
Viewports: desktop
Adding a Claude Code account on this host lists it under Claude Code, not
logged in, with Log in and Remove. Default keeps its own row. (At 390 px the
Hosts page does not fit: see layout/mobile-hosts-page.)

```sh
yv drive hosts --viewport desktop --steps '[{"click":"role:button:Add Claude Code account"},{"fill":"label:Account name","value":"TEST-Work"},{"press":"Enter"},{"expect":{"css":".account-row","hasText":"TEST-Work"},"text":"not logged in"},{"expect":{"css":".engine-row","hasText":"Claude Code"},"text":"logged in as me@example.com"},{"shot":"account-added"}]'
```

### log-in-account
Viewports: desktop
Log in to the added account with its own dialog; the fake accepts `good-code`.
The account then shows as logged in under its own email and Default is
unchanged.

```sh
yv drive hosts --viewport desktop --steps '[{"click":"role:button:Log in TEST-Work"},{"expect":"role:dialog","text":"Log in to Claude Code (TEST-Work) on iso-host"},{"fill":"label:Code from the sign-in page","value":"good-code","timeout":15000},{"press":"Enter"},{"expect":"role:dialog","text":"Claude Code (TEST-Work) is logged in on iso-host","timeout":15000},{"expect":{"css":".account-row","hasText":"TEST-Work"},"text":"logged in as","timeout":15000},{"expect":{"css":".engine-row","hasText":"Claude Code"},"text":"logged in as me@example.com"}]'
test -f "$(v fake)/claude.log"
grep -q "auth login config=.*/accounts/" "$(v fake)/claude.log"
```

### pick-account-desktop
Viewports: desktop
With two Claude Code accounts the model picker shows an account row under
Claude Code. Choosing TEST-Work and sending starts the session under that
account: its header and sidebar row name it, and the sidecar started with the
account's config folder.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Opus 5.5 High"},{"expect":"role:button:Use account TEST-Work"},{"shot":"picker-accounts"},{"click":"role:button:Use account TEST-Work"},{"press":"Escape"},{"expect":{"css":".picker .btn-quiet","hasText":"TEST-Work"}},{"click":{"role":"button","name":"work","exact":true}},{"fill":"label:Folder","value":"{{repo}}"},{"press":"Enter"},{"fill":"label:Message","value":"TEST-account pick desktop"},{"click":"role:button:Send"},{"expect":"role:heading:TEST-account pick desktop"},{"expect":"css:.thread","text":"Echo: TEST-account pick desktop"},{"expect":"css:.session-account","text":"TEST-Work"},{"expect":{"css":".session-row","hasText":"TEST-account pick desktop"},"text":"TEST-Work"},{"shot":"session-on-account"}]'
grep -q "start .*config=.*/accounts/" "$(v fake)/sidecar.log"
```

### pick-account-mobile
Viewports: mobile
The same at 390 px: the account row is in the picker and the session's sidebar row names it. (The session header is pushed off screen there: see the Gotchas.)

```sh
yv drive new --viewport mobile --steps '[{"click":"role:button:Opus 5.5 High"},{"click":"role:button:Use account TEST-Work"},{"press":"Escape"},{"click":{"role":"button","name":"work","exact":true}},{"fill":"label:Folder","value":"{{repo}}"},{"press":"Enter"},{"fill":"label:Message","value":"TEST-account pick mobile"},{"click":"role:button:Send"},{"expect":"css:.thread","text":"Echo: TEST-account pick mobile"},{"expect":{"css":".session-row","hasText":"TEST-account pick mobile"},"text":"TEST-Work"},{"shot":"session-on-account"}]'
```

### default-has-no-account-row-without-a-choice
Viewports: desktop
Codex has only Default, so its group in the picker shows no account row.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Opus 5.5 High"},{"expect":"role:button:Use account TEST-Work"},{"expect":"role:button:Use account Default","count":1},{"shot":"one-engine-with-a-choice"}]'
```

### remove-refused-while-in-use
Viewports: desktop
An account with sessions cannot be removed: yardd says so and the row stays.
(The refusal is also an API error, hence `--allow-errors`.)

```sh
yv drive hosts --viewport desktop --allow-errors --steps '[{"click":"role:button:Remove TEST-Work"},{"click":"role:button:Remove TEST-Work"},{"expect":"css:.banner-error","text":"session"},{"expect":{"css":".account-row","hasText":"TEST-Work"}}]'
```

### remove-account
Viewports: desktop
Once its sessions are deleted the account can be removed: the row goes, and
Default is untouched.

```sh
for t in "TEST-account pick desktop" "TEST-account pick mobile"; do
  sid="$(yv state | jq -r --arg t "$t" '.sessions[] | select(.title == $t) | .id')"
  yv api "{\"op\":\"session.delete\",\"sessionId\":\"$sid\"}" --wait '{"op":"session.deleted"}'
done
yv drive hosts --viewport desktop --steps '[{"click":"role:button:Remove TEST-Work"},{"click":"role:button:Remove TEST-Work"},{"expect":{"css":".account-row","hasText":"TEST-Work"},"visible":false},{"expect":{"css":".engine-row","hasText":"Claude Code"},"text":"logged in as me@example.com"},{"shot":"account-removed"}]'
```

## Gotchas
- At 390 px the session header, and with it the account name beside the branch, is off screen (the known mobile layout gap); the sidebar row still names the account.
- An account's folder is deleted with it, login included. There is no "log out" separate from Remove.
- The account of a session cannot be changed after it starts.
