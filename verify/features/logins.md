# Engine logins

yardd reports each engine as installed or not and logged in or not
(`engines.status`). A logged-out engine shows a notice with **Log in** on the
new-session page and on the Hosts page. Codex logs in by device code on the
shared app-server; Claude Code runs `claude auth login` in a PTY and takes the
pasted code. Grok runs `grok login --device-auth` in a PTY and shows its link
and code. OpenCode works with its free models alone, so it is never "logged
out": its **Add provider** runs a short-lived `opencode serve` and offers its
providers, then an API key or the provider's sign-in. This area starts with
the fakes logged out.

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

### grok-device-login
Log in to Grok: the dialog shows the device link and code (GROK-1234 for the
fake, which confirms 2.5 s later), then the host shows Grok logged in.

```sh
yv drive hosts --viewport desktop --steps '[{"click":"css:.engine-block:nth-child(4) .engine-login"},{"expect":"role:dialog","text":"GROK-1234"},{"expect":"role:dialog","text":"Grok is logged in on iso-host","timeout":15000},{"wait":2500},{"expect":{"css":".engine-block:nth-child(4)","hasText":"logged in as default@grok.example"}}]'
```

### opencode-api-key
Expect at both viewports: Add provider lists OpenCode's providers with a
filter; picking Fake Provider asks for its API key; saving adds it, and the
host lists it among OpenCode's providers. Viewports: mobile adds the key,
desktop then finds it marked added.

```sh
yv drive hosts --viewport mobile --steps '[{"click":"role:button:Add provider"},{"fill":"label:Filter providers","value":"fake prov"},{"click":{"css":".provider-row","hasText":"Fake Provider"}},{"expect":"css:.login-key","text":"API key for fakeprov"},{"fill":"css:#login-key","value":"sk-TEST-not-real"},{"click":"role:button:Save"},{"expect":"role:dialog","text":"OpenCode can use the provider","timeout":15000},{"wait":2500},{"expect":{"css":".engine-block:nth-child(3)","hasText":"providers: opencode, fakeprov"}}]'
yv drive hosts --viewport desktop --steps '[{"click":"role:button:Add provider"},{"expect":{"css":".provider-row","hasText":"Fake Provider"},"text":"added"}]'
```

### opencode-device-sign-in
A provider with two ways in shows both; its device code (FAKE-4321) shows
until the fake's server finishes, 2.5 s later.

```sh
yv drive hosts --viewport desktop --steps '[{"click":"role:button:Add provider"},{"click":{"css":".provider-row","hasText":"Fake Sign-in"}},{"click":"role:button:Device code"},{"expect":"role:dialog","text":"FAKE-4321"},{"expect":"role:dialog","text":"OpenCode can use the provider","timeout":15000}]'
```

## Gotchas
- The fake Codex finishes a device login 300 ms after it starts, so the dialog with the code (FAKE-1234) is gone before a script can read it.
- The order of the Log in buttons on a host card is Claude Code, then Codex, then Grok; OpenCode's button is Add provider.
- The fake OpenCode lists models only for `fakeprov`, so a provider added by sign-in (`fakeauth`) does not show among the host's providers.
