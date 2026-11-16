# Connectors

The Connectors page (`#/connectors`, the plug row in the sidebar's top nav)
lists, per online host, every engine account's MCP servers: claude.ai
connectors, plugins, config files, project `.mcp.json` and, for Codex, ChatGPT
apps. Each row has the service's name, where it comes from, its state
(Connected, Needs sign-in, Not working with the server's error, Connecting,
Off), a tool count, and a "widgets" tag when some of its tools come with an MCP
Apps widget. Needs sign-in comes first, then Not working. Each card sums it up
("1 connected · 2 need sign-in · 1 not working").

Connect starts the CLI's own sign-in: a claude.ai connector opens claude.ai
and the row turns Connected by itself; a server that redirects to a page on the
host asks for that page's address to be pasted back (Claude Code takes it
directly; for Codex yardd delivers it to the loopback page on the host). A wrong
address is refused with the CLI's reason and Try again. A ChatGPT app links to
chatgpt.com. After a sign-in the account's running Claude sessions dial the
server again.

A tool with a widget (`_meta.ui.resourceUri`) shows it in the thread under its
call, in a frame with `sandbox="allow-scripts"`, and keeps it in view when the
turn folds, between "Worked for" and the answer.

The fakes: Claude's `connectors` mode lists `claude.ai Datadog` (signs in 1 s
after Connect), `plugin:engineering:sentry` (pasted address with `code=`),
`chart` and a failed `plugin:engineering:gmail`; Codex lists `chart`,
`fake-oauth` (a real loopback redirect page) and the ChatGPT app GitHub. A
`[chart]` prompt makes either engine call `chart`'s `show_chart`
(verify/fakes/mcp-chart).

## Setup

```sh
yv iso up
yv iso seed
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{plain}}","text":"[chart] TEST-p95 latency for checkout"}' --wait '{"op":"event","event":{"type":"turn_completed"}}'
yv api '{"op":"session.create","engine":"claude","model":"claude-haiku-5-5","effort":"low","cwd":"{{plain}}","text":"[chart] TEST-claude chart"}' --wait '{"op":"event","event":{"type":"turn_completed"}}'
```

## Cleanup

```sh
yv iso down
```

## Recipes

### connectors-list
The plug row opens the page. Claude's card: Datadog via
claude.ai needs sign-in, gmail is not working with its error, chart is
connected with the widgets tag. Codex's card: fake-oauth needs sign-in and
GitHub links to ChatGPT.

```sh
yv drive connectors --steps '[{"expect":"role:heading:Connectors"},{"expect":{"css":".connectors-card","hasText":"Claude"},"text":"1 connected \u00b7 2 need sign-in \u00b7 1 not working"},{"expect":{"css":".connector","hasText":"Datadog"},"text":"claude.ai"},{"expect":{"css":".connector","hasText":"Datadog"},"text":"Needs sign-in"},{"expect":{"css":".connector","hasText":"gmail"},"text":"No URL configured for this server"},{"expect":{"css":".connector","hasText":"chart"},"text":"widgets"},{"expect":{"css":".connectors-card","hasText":"Codex"},"text":"1 connected \u00b7 2 need sign-in"},{"expect":"role:link:Connect on ChatGPT"},{"shot":"connectors"}]'
```

### claude-sign-in
Viewports: desktop
Datadog connects by itself after Connect. sentry asks for the address: one
without `code=` is refused with Claude Code's reason, then the right one
connects it. The card then reads 3 connected.

```sh
yv drive connectors --viewport desktop --allow-errors --steps '[{"click":{"css":".connector:has-text(\"Datadog\") button","hasText":"Connect"}},{"expect":{"css":".connector","hasText":"Datadog"},"text":"Running sessions pick it up now"},{"expect":{"css":".connector","hasText":"Datadog"},"text":"12 tools"},{"click":{"css":".connector:has-text(\"sentry\") button","hasText":"Connect"}},{"expect":"role:link:Open the sign-in page"},{"expect":{"css":".connector","hasText":"sentry"},"text":"paste that page"},{"fill":"css:#connector-paste","value":"http://localhost:39999/callback"},{"click":"role:button:Finish"},{"expect":{"css":".connector","hasText":"sentry"},"text":"missing authorization code"},{"click":{"css":".connector:has-text(\"sentry\") button","hasText":"Try again"}},{"fill":"css:#connector-paste","value":"http://localhost:39999/callback?code=TEST"},{"click":"role:button:Finish"},{"expect":{"css":".connector","hasText":"sentry"},"text":"Running sessions pick it up now"},{"expect":{"css":".connectors-card","hasText":"Claude"},"text":"3 connected \u00b7 1 not working"},{"shot":"claude-signed-in"}]'
```

### codex-sign-in-pasted
Viewports: desktop
fake-oauth's sign-in page redirects to a loopback page on the host; pasting
that address finishes it through yardd and the card reads 2 connected.

```sh
yv drive connectors --viewport desktop --steps '[{"click":{"css":".connector:has-text(\"fake-oauth\") button","hasText":"Connect"}},{"expect":{"css":".connector","hasText":"fake-oauth"},"text":"paste that page"},{"eval":"(() => { const a = [...document.querySelectorAll('a')].find((x) => x.textContent.includes('Open the sign-in page')); const cb = new URL(a.href).searchParams.get('redirect_uri') + '?code=TEST-code&state=s1'; const i = document.querySelector('#connector-paste'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, cb); i.dispatchEvent(new Event('input', { bubbles: true })); return cb.startsWith('http://127.0.0.1:'); })()","equals":true},{"click":"role:button:Finish"},{"expect":{"css":".connector","hasText":"fake-oauth"},"text":"Running sessions pick it up now"},{"expect":{"css":".connectors-card","hasText":"Codex"},"text":"2 connected \u00b7 1 needs sign-in"},{"shot":"codex-signed-in"}]'
```

### codex-chart
The `[chart]` session shows the chart under its call in a sandboxed frame,
outside the folded work, above "Here is the chart.".

```sh
yv drive 'session:TEST-p95 latency' --allow-errors --steps '[{"expect":"css:.thread","text":"Here is the chart."},{"expect":{"css":".fold-row"}},{"expect":"css:.widget iframe.widget-frame[sandbox=\"allow-scripts\"]"},{"expect":{"css":".widget iframe"},"inViewport":true},{"wait":1000},{"shot":"chart"}]'
```

### claude-chart
The same for a Claude session.

```sh
yv drive 'session:TEST-claude chart' --allow-errors --steps '[{"expect":"css:.thread","text":"Here is the chart."},{"expect":{"css":".fold-row"}},{"expect":"css:.widget iframe.widget-frame[sandbox=\"allow-scripts\"]"},{"expect":{"css":".widget iframe"},"inViewport":true},{"wait":1000},{"shot":"chart"}]'
```

### widget-calls-and-sandbox (manual: `yv drive` cannot reach inside a frame)
Inside each chart, "More
points" goes through `widget.call` to the server and redraws with 12 points;
"Open docs" opens a new tab; the widget's `fetch` is blocked by its CSP and it
cannot read `window.parent.document` (SecurityError). Checked with a Playwright
script against `iso` on 2026-11-16; yardd's side is covered by
`crates/yardd/tests/connectors.rs`.

## Gotchas
- claude-sign-in passes `--allow-errors`: the refused address is an `mcp.auth`
  failure on purpose.
- The chart recipes pass `--allow-errors`: the fake widget tries
  `fetch("https://example.com/")` on purpose, and the console error that the
  CSP blocked it is the proof the sandbox holds.
- Sign-ins persist in the fake's state for the life of the isolated yardd, so
  the sign-in recipes run once per `iso up`.
