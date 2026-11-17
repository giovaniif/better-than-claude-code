# Plan usage and the model picker's sections

Both engines report how much of the plan is used: the 5-hour window (Claude
calls it the current session), the week and, for Claude, per-model weeks.
Switchyard shows each as a meter (bar and percent; when it resets is in the
line's tooltip), amber above 70% and red above 90%, in a compact strip at the
foot of the sidebar at every viewport, one block per engine account (named
when an engine has more than one). Claude's limits are read without a turn,
from Claude Code's usage report, at start, every 10 minutes and when an
account is added or logs in. The model picker shows models only: the current
engine's are open, the other engine is one row that expands, and it names the
account where an engine has more than one. The fake Codex reports 12% of 5
hours (resets in 2 h 10 min) and 34% of the week; the fake Claude sidecar
reports 47% / 17% and Sonnet 8%.

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

### usage-strip-in-sidebar
The sidebar's usage strip shows the Codex meters at both viewports.

```sh
yv drive new --viewport desktop --steps '[{"expect":{"css":".usage-strip","hasText":"Codex"}},{"expect":{"css":".usage-strip","hasText":"12%"}},{"expect":{"css":".usage-strip","hasText":"34%"}},{"expect":{"css":".usage-strip","inViewport":true}},{"shot":"strip"}]'
yv drive new --viewport mobile --steps '[{"click":"role:button:Open sessions"},{"wait":400},{"expect":{"css":".usage-strip","hasText":"Codex"}},{"expect":{"css":".usage-strip","hasText":"12%"}},{"expect":{"css":".usage-strip","hasText":"34%"}},{"expect":{"css":".usage-strip","inViewport":true}},{"shot":"strip"}]'
```

### usage-strip-claude
After a Claude session has started, the strip also shows the Claude meters.

```sh
yv drive new --viewport desktop --steps '[{"expect":{"css":".usage-strip","hasText":"Claude"}},{"expect":{"css":".usage-strip","hasText":"47%"}},{"expect":{"css":".usage-strip","hasText":"17%"}}]'
yv drive new --viewport mobile --steps '[{"click":"role:button:Open sessions"},{"expect":{"css":".usage-strip","hasText":"Claude"}},{"expect":{"css":".usage-strip","hasText":"47%"}},{"expect":{"css":".usage-strip","hasText":"17%"}}]'
```

### picker-has-no-meters
The model picker shows models only: plan limits live in the sidebar strip,
per account, where each line's tooltip says when it resets.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Model Fake Fast"},{"expect":{"css":".popover .picker-item","hasText":"Fake Fast"}},{"expect":"css:.popover .usage-meter","count":0},{"expect":"css:.popover [role=meter]","count":0},{"press":"Escape"},{"expect":{"css":".usage-line[title*=\"Codex 5-hour: 12% used, resets in 2 h\"]"}},{"expect":{"css":".usage-line[title*=\"Codex Week: 34% used, resets in 3 d\"]"}},{"shot":"picker-and-strip"}]'
yv drive 'session:{{sid_echo}}' --viewport mobile --steps '[{"click":"role:button:Model Fake Fast"},{"expect":{"css":".popover .picker-item","hasText":"Fake Fast"}},{"expect":"css:.popover .usage-meter","count":0},{"press":"Escape"},{"click":"role:button:Open sessions"},{"wait":400},{"expect":{"css":".usage-line[title*=\"Codex 5-hour: 12% used, resets in 2 h\"]"}},{"shot":"strip"}]'
```

### picker-other-engine-collapsed
In a Codex session the Claude models are folded into one row; clicking it opens them and Escape closes the picker.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Model Fake Fast"},{"expect":{"css":".picker-fold","hasText":"Claude"}},{"expect":{"css":".picker-fold","hasText":"switching hands off"}},{"expect":{"role":"button","name":"Haiku 5.5","exact":true},"visible":false},{"click":{"css":".picker-fold"}},{"expect":{"role":"button","name":"Haiku 5.5","exact":true}},{"press":"Escape"},{"expect":{"css":".popover"},"visible":false}]'
```

### picker-current-model-marked
The current model is marked; effort is its own chip, whose menu marks the current one.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Model Fake Fast"},{"expect":{"css":".picker-item.active","hasText":"Fake Fast"}},{"press":"Escape"},{"expect":"role:button:Effort Low"},{"click":"role:button:Effort Low"},{"expect":{"css":".effort-menu [aria-checked=\"true\"]","hasText":"Low"}},{"press":"Escape"}]'
```

### meters-zero-after-reset
Once a window's reset time has passed, its meter reads 0% and no longer says when it resets: nothing has been used since, or the engine would have sent a newer reset time. The page clock is moved 3 hours on (past both 5-hour resets, before the weeks) and the meters' 30-second tick redraws them. The tooltips drop the reset time of a window that has reset.

```sh
yv drive new --viewport desktop --steps '[{"expect":{"css":".usage-line","hasText":"Codex"},"text":"12%"},{"eval":"(() => { const real = Date.now; Date.now = () => real() + 3 * 3600 * 1000; return 1; })()"},{"wait":31000},{"expect":{"css":".usage-line","hasText":"Codex"},"text":"0%"},{"expect":{"css":".usage-line","hasText":"Claude"},"text":"0%"},{"expect":{"css":".usage-strip","hasText":"34%"}},{"expect":{"css":".usage-strip","hasText":"17%"}},{"shot":"strip-after-reset"}]'
yv drive new --viewport mobile --steps '[{"click":"role:button:Open sessions"},{"expect":{"css":".usage-line","hasText":"Codex"},"text":"12%"},{"eval":"(() => { const real = Date.now; Date.now = () => real() + 3 * 3600 * 1000; return 1; })()"},{"wait":31000},{"expect":{"css":".usage-line","hasText":"Codex"},"text":"0%"},{"expect":{"css":".usage-line","hasText":"Claude"},"text":"0%"},{"expect":{"css":".usage-strip","hasText":"34%"}},{"expect":{"css":".usage-strip","hasText":"17%"}},{"shot":"strip-after-reset"}]'
yv drive new --viewport desktop --steps '[{"eval":"(() => { const real = Date.now; Date.now = () => real() + 3 * 3600 * 1000; return 1; })()"},{"wait":31000},{"expect":{"css":".usage-line[title*=\"Codex 5-hour: 0% used\"]"}},{"expect":{"css":".usage-line[title*=\"Codex Week: 34% used, resets in 3 d\"]"}},{"expect":"css:.usage-line[title*=\"resets now\"]","count":0},{"shot":"strip-tooltips-after-reset"}]'
```

### claude-usage-after-restart
Viewports: both
Claude reports its limits only during a turn. After yardd restarts, the
sidebar strip still shows the Claude meters from before (saved in
`usage.json`), not Codex alone.

```sh
yv iso restart
yv drive new --viewport desktop --steps '[{"expect":{"css":".usage-strip","hasText":"Codex"}},{"expect":{"css":".usage-strip","hasText":"Claude"}},{"expect":{"css":".usage-strip","hasText":"47%"}},{"shot":"strip-after-restart"}]'
yv drive new --viewport mobile --steps '[{"click":"role:button:Open sessions"},{"expect":{"css":".usage-strip","hasText":"Codex"}},{"expect":{"css":".usage-strip","hasText":"Claude"}},{"expect":{"css":".usage-strip","hasText":"47%"}},{"shot":"strip-after-restart"}]'
```

### strip-names-every-account
Viewports: both
With a second Claude account the strip names both, Default included, each
over its own meters. The added account's limits arrive without it running a
turn: yardd reads them from Claude Code's usage report as soon as the account
is added (the fake reports 91% / 40% for an added account).

```sh
yv api '{"op":"account.add","engine":"claude","name":"TEST-Work"}' --wait '{"op":"accounts","accounts":[{"name":"TEST-Work"}]}' --save work_acct='accounts[name=TEST-Work].id'
yv drive new --viewport desktop --steps '[{"expect":{"css":".usage-line-account","hasText":"Claude \u00b7 Default"}},{"expect":{"css":".usage-line-account","hasText":"Claude \u00b7 TEST-Work"}},{"expect":{"css":".usage-line[title*=\"Claude (TEST-Work) 5-hour: 91% used\"]"}},{"expect":{"css":".usage-line[title*=\"Claude (Default) 5-hour: 47% used\"]"}},{"expect":{"css":".usage-strip"},"inViewport":true},{"shot":"strip-accounts"}]'
yv drive new --viewport mobile --steps '[{"click":"role:button:Open sessions"},{"wait":400},{"expect":{"css":".usage-line-account","hasText":"Claude \u00b7 Default"}},{"expect":{"css":".usage-line-account","hasText":"Claude \u00b7 TEST-Work"}},{"expect":{"css":".usage-line[title*=\"Claude (TEST-Work) 5-hour: 91% used\"]"}},{"expect":{"css":".usage-line[title*=\"Claude (Default) 5-hour: 47% used\"]"}},{"expect":{"css":".usage-strip"},"inViewport":true},{"shot":"strip-accounts"}]'
```

### picker-names-the-account
Viewports: desktop
The model picker says which account its models run on ("Default account",
then "TEST-Work account" once picked), and the closed picker names it too.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Model Opus 5.5"},{"expect":{"css":".picker-head-account","hasText":"Default account"}},{"click":"role:button:Use account TEST-Work"},{"expect":{"css":".picker-head-account","hasText":"TEST-Work account"}},{"expect":{"css":".popover .usage-meter"},"count":0},{"shot":"picker-account"},{"press":"Escape"},{"expect":{"css":".picker-account","hasText":"TEST-Work"}},{"click":"role:button:Model Opus 5.5 · TEST-Work"},{"click":"role:button:Use account Default"},{"press":"Escape"}]'
yv api '{"op":"account.remove","id":"{{work_acct}}"}' --wait '{"op":"accounts"}'
```

## Gotchas
- The 5-hour and week limits come from the engines (Claude's `rate_limit_event`, Codex's `account/rateLimits`); a Claude plan reports them only after a session has run, so a yardd on a fresh data dir shows no Claude meters until then (later restarts keep the last ones, from `usage.json`).
