# Terminal

The Terminal tab runs the user's shell in the session folder through yardd's
PTY. Several terminals per session ("1", "2"...), 256 KB of scrollback replayed
after a reload, and "Add to message" for a selection. Desktop only (the pane
is hidden below 1100 px).

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

### runs-command
Viewports: desktop
Typing a command shows its output.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"wait":"label:Terminal input"},{"type":"echo TEST-$((40+2))\n","target":"label:Terminal input"},{"expect":"css:.xterm","text":"TEST-42"},{"shot":"terminal"}]'
```

### second-terminal
Viewports: desktop
"New terminal" adds tab 2 and selects it.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"click":"role:button:New terminal"},{"expect":{"role":"tab","name":"2"}},{"eval":"document.querySelector(\"[role=tab][aria-selected=true]\")?.textContent?.trim()","equals":"2"}]'
```

### scrollback-after-reload
Viewports: desktop
Output from before a reload is still there after it.

```sh
yv drive 'session:{{sid_think}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"$"},{"type":"echo TEST-before-$((6*7))\n","target":"label:Terminal input"},{"expect":"css:.xterm","text":"TEST-before-42"},{"reload":true},{"goto":"session:{{sid_think}}"},{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm-rows","text":"TEST-before-42","timeout":20000}]'
```

### scrollback-keeps-wrapped-lines
Viewports: desktop
A prompt line longer than the pane wraps; after a reload the replay must show
it exactly as before: both prompts intact, the command after the first one.
Found 2026-11-15: the replay came back as `…/yard-test-say$((6*7))735$ echo TEST-before-`.

```sh
yv drive 'session:{{sid_fail}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"$"},{"type":"echo TEST-wrap-$((6*7))\n","target":"label:Terminal input"},{"expect":"css:.xterm","text":"TEST-wrap-42"},{"eval":"document.querySelector(\".xterm-rows\").innerText.replace(/\\s+/g, \"\").includes(\"$echoTEST-wrap-$((6*7))TEST-wrap-42\")","equals":true},{"reload":true},{"goto":"session:{{sid_fail}}"},{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"TEST-wrap-42"},{"eval":"document.querySelector(\".xterm-rows\").innerText.replace(/\\s+/g, \"\").includes(\"$echoTEST-wrap-$((6*7))TEST-wrap-42\")","equals":true}]'
```

### add-to-message (manual: needs a mouse selection inside xterm)
Select text in the terminal, press "Add to message": the reply box gets a
fenced block. Selecting through xterm's renderer is not scripted yet.

## Gotchas
- Product bug (2026-11-15): after a page reload the scrollback replay garbles wrapped lines and can drop output (a prompt overwrites the "TEST-before-42" line). Suspected cause: the snapshot is written before the terminal is fit to the pane, so it is laid out at the default 80 columns and then reflowed. scrollback-after-reload and scrollback-keeps-wrapped-lines fail until it is fixed.
- Wait for the prompt (`expect` text `$`) before typing: keys sent before the shell is ready are echoed out of order.
- xterm ignores `fill`; use the `type` step with `target: "label:Terminal input"`.
