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

## Gotchas
- The PR pane polls every 60 s while visible; Refresh pull request forces a reload.
