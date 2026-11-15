# Engine logins

yardd reports each engine as installed or not and logged in or not
(`engines.status`). A logged-out engine shows a notice with **Log in** on the
new-session page and on the Hosts page. Codex logs in by device code on the
shared app-server; Claude Code runs `claude auth login` in a PTY and takes the
pasted code. This area starts with both fakes logged out.

## Setup

```sh
yv iso up --logged-out
yv iso seed --profile empty
```

## Cleanup

```sh
yv iso down
```

## Recipes

### hosts-page-shows-logged-out
Expect at both viewports: both engines listed as not logged in, each with Log in.

```sh
yv drive hosts --steps '[{"expect":"role:region:iso-host","text":"not logged in"},{"expect":"role:button:Log in"},{"shot":"logged-out"}]'
```

### codex-device-login
Log in to Codex: the dialog shows the device code; the fake completes and the
host shows Codex logged in.

```sh
yv drive hosts --viewport desktop --steps '[{"click":{"role":"button","name":"Log in","nth":1}},{"expect":"role:dialog","text":"Codex is logged in on iso-host","timeout":15000}]'
```

### claude-code-login
A wrong code is refused ("That code was not accepted. Start again…", which the UI also reports as a failed `login` reply, hence `--allow-errors`); after Try again the right one ("good-code" for the fake) logs in.

```sh
yv drive hosts --viewport desktop --allow-errors --steps '[{"click":{"role":"button","name":"Log in","nth":0}},{"expect":"role:dialog","text":"Log in to Claude"},{"fill":"label:Code from the sign-in page","value":"bad-code"},{"press":"Enter"},{"expect":"role:dialog","text":"That code was not accepted","timeout":15000},{"click":"role:button:Try again"},{"fill":"label:Code from the sign-in page","value":"good-code","timeout":15000},{"press":"Enter"},{"expect":"role:dialog","text":"Claude Code is logged in on iso-host","timeout":15000}]'
```

## Gotchas
- The fake Codex finishes a device login 300 ms after it starts, so the dialog with the code (FAKE-1234) is gone before a script can read it.
- The order of the Log in buttons on a host card is Claude Code, then Codex.
