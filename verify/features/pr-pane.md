# Pull request pane

The Pull request tab shows the branch's PR through `gh`: state, base, review
decision, checks and review threads (unresolved first). "Send to session"
turns a thread into a prompt; "Review with <other engine>" starts a read-only
review session. In isolated environments `gh` is `verify/fakes/gh`, which
answers PR #4242 for the seeded edit session's branch only. Desktop only.

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

### shows-pr
Viewports: desktop
PR #4242 with one failed, one passed and one running check, and one unresolved thread.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"expect":"role:heading:TEST-fix the greeting"},{"expect":"role:link:#4242"},{"expect":{"role":"region","name":"Checks"},"text":"1 failed"},{"expect":{"role":"region","name":"Review comments"},"text":"1 unresolved"},{"shot":"pr"}]'
```

### no-pr
Viewports: desktop
A branch without a PR says so and names the branch.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"expect":"text:No pull request for"}]'
```

### send-thread-to-session
Viewports: desktop
"Send to session" on the unresolved thread sends a prompt quoting it.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"click":"role:button:Send to session"},{"expect":"css:.thread","text":"greet should trim the name","timeout":15000}]'
```

### review-with-other-engine
Viewports: desktop
"Review with Claude" starts a Claude session in the same folder.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"click":"role:button:Review with Claude"},{"wait":1500}]'
yv state --expect '{"sessions":[{"engine":"claude","title":"~Review"}]}'
```

### double-click-send-to-session
Viewports: desktop
A double click on "Send to session" sends the thread once: the buttons are
disabled from the click until yardd answers, so the second click does nothing.
(They stayed live until the session showed as running, and the agent got the
same review comment twice, as two turns.) The clicks are a task apart, as in
the approvals recipe.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"expect":"role:button:Send to session","enabled":true},{"eval":"(async () => { const n = () => [...document.querySelectorAll(\".thread .bubble\")].filter((b) => b.textContent.includes(\"Review comment on src/greet.ts:1\")).length; const before = n(); const b = [...document.querySelectorAll(\"button\")].find((x) => x.textContent.trim() === \"Send to session\"); b.click(); await new Promise((r) => setTimeout(r, 0)); b.click(); await new Promise((r) => setTimeout(r, 3000)); return `sent ${n() - before}`; })()","equals":"sent 1"}]'
```

### double-click-review-with-other-engine
Viewports: desktop
A double click on "Review with Claude" starts one review session and no error.
(The second click used to ask yardd for another session in the same folder,
which refused: "Another session is working in this folder. Stop it first, or
tick New worktree.", a box this pane does not have.)

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"expect":"role:button:Review with Claude","enabled":true},{"eval":"(async () => { const b = [...document.querySelectorAll(\"button\")].find((x) => x.textContent.trim() === \"Review with Claude\"); b.click(); await new Promise((r) => setTimeout(r, 0)); b.click(); return \"clicked twice\"; })()","equals":"clicked twice"},{"expect":"role:heading:Review this branch","timeout":15000},{"wait":1500}]'
```

## Gotchas
- The PR pane polls every 60 s while visible; Refresh pull request forces a reload.
