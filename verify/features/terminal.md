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

### keys-arrive-in-order
Viewports: desktop
Keys typed in a quick run reach the shell in the order typed: the echoed
command and its output both match what was typed. Found 2026-11-15: the shell
got `…qrstuvxwyz…` (keys swapped), about half the runs; yardd handled each
keystroke in its own task.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"$"},{"type":"echo TEST-order-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxyz0123456789\n","target":"label:Terminal input"},{"expect":"css:.xterm","text":"TEST-order-"},{"wait":1000},{"eval":"document.querySelector(\".xterm-rows\").innerText.replace(/\\s+/g, \"\").includes(\"$echoTEST-order-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxyz0123456789TEST-order-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxyz0123456789\")","equals":true}]'
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
Found 2026-11-15 (fixed the same day): the replay came back as `…/yard-test-say$((6*7))735$ echo TEST-before-`.

```sh
yv drive 'session:{{sid_fail}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"$"},{"type":"echo TEST-wrap-$((6*7))\n","target":"label:Terminal input"},{"expect":"css:.xterm","text":"TEST-wrap-42"},{"eval":"document.querySelector(\".xterm-rows\").innerText.replace(/\\s+/g, \"\").includes(\"$echoTEST-wrap-$((6*7))TEST-wrap-42\")","equals":true},{"reload":true},{"goto":"session:{{sid_fail}}"},{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"TEST-wrap-42"},{"eval":"document.querySelector(\".xterm-rows\").innerText.replace(/\\s+/g, \"\").includes(\"$echoTEST-wrap-$((6*7))TEST-wrap-42\")","equals":true}]'
```

### scrollback-matches-after-reloads
Viewports: desktop
A terminal with history keeps exactly the same text across two reloads, after
a long command that wraps over three rows. Found by the verifier on PR #1: an
attach at xterm's default 80 columns made the shell redraw into the scrollback.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"$"},{"type":"echo TEST-first\n","target":"label:Terminal input"},{"expect":"css:.xterm","text":"TEST-first"},{"reload":true},{"goto":"session:{{sid_edit}}"},{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"TEST-first"},{"wait":1500},{"type":"for i in 1 2 3; do echo TEST-row-$i-$(printf ab%.0s $(seq 1 40)); done; echo TEST-done-$((5*5))\n","target":"label:Terminal input"},{"expect":"css:.xterm","text":"TEST-done-25"},{"wait":1000},{"eval":"(() => { const t = document.querySelector(\".xterm-rows\").innerText.split(\"\\n\").map((l) => l.trimEnd()).join(\"\\n\").trimEnd(); localStorage.setItem(\"yv-term\", t); return t.length > 0; })()","equals":true},{"reload":true},{"goto":"session:{{sid_edit}}"},{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"TEST-done-25"},{"wait":2000},{"eval":"document.querySelector(\".xterm-rows\").innerText.split(\"\\n\").map((l) => l.trimEnd()).join(\"\\n\").trimEnd() === localStorage.getItem(\"yv-term\")","equals":true},{"reload":true},{"goto":"session:{{sid_edit}}"},{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"TEST-done-25"},{"wait":2000},{"eval":"document.querySelector(\".xterm-rows\").innerText.split(\"\\n\").map((l) => l.trimEnd()).join(\"\\n\").trimEnd() === localStorage.getItem(\"yv-term\")","equals":true}]'
```

### exited-shell-survives-reload
Viewports: desktop
A tab whose shell exited keeps its scrollback and the exited line after a
reload, with no error. Found 2026-11-16: the fit before the attach resized
the exited terminal and yardd's refusal showed as a "terminal is closed"
banner.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm","text":"$"},{"type":"echo TEST-gone-$((6*7)); exit\n","target":"label:Terminal input"},{"expect":"css:.xterm","text":"shell exited"},{"reload":true},{"goto":"session:{{sid_echo}}"},{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.xterm-rows","text":"TEST-gone-42"},{"expect":"css:.xterm-rows","text":"shell exited"},{"wait":1500},{"expect":"text:terminal is closed","count":0},{"shot":"exited-after-reload"}]'
```

### close-terminal
Viewports: desktop
The selected tab has a "Close terminal" cross. Closing tab 2 removes it and
selects tab 1 again. Read back: the daemon lists one terminal for the session.

```sh
yv drive 'session:{{sid_fail}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":{"role":"tab","name":"1"}},{"click":"role:button:New terminal"},{"expect":{"role":"tab","name":"2"}},{"click":"role:button:Close terminal"},{"expect":{"role":"tab","name":"2"},"count":0},{"eval":"document.querySelector(\"[role=tab][aria-selected=true]\")?.textContent?.trim()","equals":"1"}]'
yv api '{"op":"term.list","sessionId":"{{sid_fail}}"}' --wait '{"op":"term.list"}' | jq -e '.reply.terms | length == 1'
```

### folder-gone
Viewports: desktop
When the session's folder was removed outside Switchyard, the Changes pane and
the terminal say the folder no longer exists. Before, the pane said "Not a git
repository." and the terminal quietly opened a shell in the home folder. The
refused terminal is an API error, hence `--allow-errors`.

```sh
yv state --save cmd_cwd='sessions[id={{sid_cmd}}].cwd'
rm -rf "$(v cmd_cwd)"
yv drive 'session:{{sid_cmd}}' --viewport desktop --allow-errors --steps '[{"expect":{"role":"region","name":"Workspace"},"text":"no longer exists"},{"expect":"text:Not a git repository.","count":0},{"click":{"role":"button","name":"Terminal","exact":true}},{"expect":"css:.banner-error","text":"no longer exists"},{"expect":{"role":"tab","name":"1"},"count":0},{"shot":"folder-gone"}]'
yv api '{"op":"term.list","sessionId":"{{sid_cmd}}"}' --wait '{"op":"term.list"}' | jq -e '.reply.terms | length == 0'
```

### add-to-message (manual: needs a mouse selection inside xterm)
Select text in the terminal, press "Add to message": the reply box gets a
fenced block. Selecting through xterm's renderer is not scripted yet.

## Gotchas
- Fixed 2026-11-15: the scrollback replayed after a reload used to be written at xterm's default 80 columns before the first fit and then reflowed, garbling wrapped lines and overwriting output. scrollback-after-reload and scrollback-keeps-wrapped-lines guard it.
- Wait for the prompt (`expect` text `$`) before typing: keys sent before the shell is ready are echoed out of order.
- xterm ignores `fill`; use the `type` step with `target: "label:Terminal input"`.
