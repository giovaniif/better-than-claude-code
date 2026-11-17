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

### title-and-number-open-github
Viewports: desktop
Both the PR title and its number are links to the PR that open in a new tab
(the desktop app hands new-tab links to the browser). Before, only the small
number was a link.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"expect":"role:link:TEST-fix the greeting"},{"expect":"role:link:#4242"},{"eval":"[...document.querySelectorAll(\".pr-head a\")].map((a) => a.getAttribute(\"href\") + \" \" + a.getAttribute(\"target\")).join(\" | \")","equals":"https://github.com/test-owner/test-demo-app/pull/4242 _blank | https://github.com/test-owner/test-demo-app/pull/4242 _blank"},{"shot":"pr-links"}]'
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

### review-offered-when-the-pr-cannot-be-read
Viewports: desktop
A session on a detached HEAD (no branch, so `gh` cannot look up a PR) still
offers "Review with Claude": the review reads `git diff`, not GitHub. (The
pane said only "Cannot read the pull request: no branch is checked out." and
hid the button; the same happened when `gh` was logged out or the remote was
not GitHub.) A folder that is not a git repository has nothing to review, so
there the button stays hidden. Its own session, so the other recipes keep
their branches. (yv counts the `pr` reply's error as a failed API call,
hence `--allow-errors`: that error is the state under test.)

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"TEST-detached"}' --wait '{"op":"created"}' --save det_sid=sessionId
yv state --save det_cwd='sessions[id={{det_sid}}].cwd'
git -C "$(v det_cwd)" checkout -q --detach
yv drive 'session:{{det_sid}}' --viewport desktop --allow-errors --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"expect":"text:Cannot read the pull request: no branch is checked out."},{"expect":"role:button:Review with Claude","enabled":true},{"shot":"detached"},{"click":"role:button:Review with Claude"},{"expect":"role:heading:Review this branch","timeout":15000}]'
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{plain}}","worktree":false,"text":"TEST-plain pr"}' --wait '{"op":"created"}' --save plainpr_sid=sessionId
yv drive 'session:{{plainpr_sid}}' --viewport desktop --allow-errors --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"expect":"text:Cannot read the pull request: not a git repository."},{"expect":"role:button:Review with Claude","visible":false}]'
```

### review-without-a-remote-names-a-local-base
Viewports: desktop
A repository with no remote (`git init` and a `feature` branch) has no
`origin/HEAD`. The fake gh finds no PR, so the pane offers "Review with
Claude", and the review session's prompt must diff against `main`, the
branch the repository has. (It read `git diff origin/HEAD...HEAD`, a command
that fails there, and told the reviewer to fetch from a remote that does not
exist.)

```sh
nr=$(mktemp -d /tmp/TEST-no-remote-XXXXXX)
yv var set noremote "$nr"
git -C "$nr" init -q -b main
git -C "$nr" -c user.name=TEST -c user.email=test@example.invalid commit -q --allow-empty -m "TEST first"
git -C "$nr" checkout -q -b feature
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{noremote}}","worktree":false,"text":"TEST-no-remote"}' --wait '{"op":"created"}' --save nr_sid=sessionId
yv drive 'session:{{nr_sid}}' --viewport desktop --steps '[{"click":{"role":"button","name":"Pull request","exact":true}},{"expect":"role:button:Review with Claude","enabled":true},{"click":"role:button:Review with Claude"},{"expect":"role:heading:Review this branch","timeout":15000},{"expect":"text:git diff main...HEAD"},{"shot":"review-prompt"}]'
rm -rf "$nr"
```

## Gotchas
- The PR pane polls every 60 s while visible; Refresh pull request forces a reload.
