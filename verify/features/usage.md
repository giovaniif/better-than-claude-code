# Plan usage and the model picker's sections

Both engines report how much of the plan is used: the 5-hour window (Claude
calls it the current session), the week and, for Claude, per-model weeks.
Switchyard shows each as a meter (bar, percent, when it resets), amber above
70% and red above 90%: in a compact strip at the foot of the sidebar, at every
viewport, and in the model picker, where the current engine's models are open
and the other engine is one row that expands. The fake Codex reports 12% of 5
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

### picker-meters-with-reset-times
Opening the model picker shows, per engine, bars with percent and the time to reset.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Fake Fast Low"},{"expect":{"css":".popover .usage-meter","hasText":"5-hour"}},{"expect":{"css":".popover .usage-meter","hasText":"12%"}},{"expect":{"css":".popover .usage-meter","hasText":"resets in 2 h"}},{"expect":{"css":".popover .usage-meter","hasText":"Week"}},{"expect":{"css":".popover .usage-meter","hasText":"34%"}},{"shot":"picker"}]'
yv drive 'session:{{sid_echo}}' --viewport mobile --steps '[{"click":"role:button:Fake Fast Low"},{"expect":{"css":".popover .usage-meter","hasText":"resets in 2 h"}},{"expect":{"css":".popover","inViewport":true}},{"shot":"picker"}]'
```

### picker-other-engine-collapsed
In a Codex session the Claude models are folded into one row; clicking it opens them and Escape closes the picker.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Fake Fast Low"},{"expect":{"css":".picker-fold","hasText":"Claude"}},{"expect":{"css":".picker-fold","hasText":"switching hands off"}},{"expect":{"role":"button","name":"Haiku 5.5","exact":true},"visible":false},{"click":{"css":".picker-fold"}},{"expect":{"role":"button","name":"Haiku 5.5","exact":true}},{"press":"Escape"},{"expect":{"css":".popover"},"visible":false}]'
```

### picker-current-model-marked
The current model is marked, and Effort stays a segmented control.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Fake Fast Low"},{"expect":{"css":".picker-item.active","hasText":"Fake Fast"}},{"expect":{"css":".efforts .effort.active","hasText":"Low"}}]'
```

### meters-zero-after-reset
Once a window's reset time has passed, its meter reads 0% and no longer says when it resets: nothing has been used since, or the engine would have sent a newer reset time. The page clock is moved 3 hours on (past both 5-hour resets, before the weeks) and the meters' 30-second tick redraws them.

```sh
yv drive new --viewport desktop --steps '[{"expect":{"css":".usage-line","hasText":"Codex"},"text":"12%"},{"eval":"(() => { const real = Date.now; Date.now = () => real() + 3 * 3600 * 1000; return 1; })()"},{"wait":31000},{"expect":{"css":".usage-line","hasText":"Codex"},"text":"0%"},{"expect":{"css":".usage-line","hasText":"Claude"},"text":"0%"},{"expect":{"css":".usage-strip","hasText":"34%"}},{"expect":{"css":".usage-strip","hasText":"17%"}},{"shot":"strip-after-reset"}]'
yv drive new --viewport mobile --steps '[{"click":"role:button:Open sessions"},{"expect":{"css":".usage-line","hasText":"Codex"},"text":"12%"},{"eval":"(() => { const real = Date.now; Date.now = () => real() + 3 * 3600 * 1000; return 1; })()"},{"wait":31000},{"expect":{"css":".usage-line","hasText":"Codex"},"text":"0%"},{"expect":{"css":".usage-line","hasText":"Claude"},"text":"0%"},{"expect":{"css":".usage-strip","hasText":"34%"}},{"expect":{"css":".usage-strip","hasText":"17%"}},{"shot":"strip-after-reset"}]'
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"eval":"(() => { const real = Date.now; Date.now = () => real() + 3 * 3600 * 1000; return 1; })()"},{"wait":31000},{"click":"role:button:Fake Fast Low"},{"expect":{"css":".popover .usage-meter","hasText":"5-hour"},"text":"0%"},{"expect":{"css":".popover"},"text":"resets in 3 d"},{"expect":{"css":".popover","hasText":"resets now"},"visible":false},{"shot":"picker-after-reset"}]'
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

## Gotchas
- The 5-hour and week limits come from the engines (Claude's `rate_limit_event`, Codex's `account/rateLimits`); a Claude plan reports them only after a session has run, so a yardd on a fresh data dir shows no Claude meters until then (later restarts keep the last ones, from `usage.json`).
