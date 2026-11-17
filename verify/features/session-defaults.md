# Session defaults

New sessions remember the last used host, project, model and effort, including
remote sessions and after a reload. Project folders and model choices remain
specific to their host.

## Setup

```sh
yv iso up
yv iso seed
yv var set remote_port "$(yv iso up --name map-defaults-remote --host-name TEST-remote | jq -r .iso.port)"
yv var set remote_work "$(yv var get work --iso map-defaults-remote | jq -er .value)"
yv api '{"op":"host.add","name":"TEST-remote","kind":"direct","url":"ws://127.0.0.1:{{remote_port}}/ws"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-remote","status":"connected"}]}' --save remote_id='hosts[name=TEST-remote].id'
```

## Cleanup

```sh
yv iso down --name map-defaults-remote
yv iso down
```

## Recipes

### remembers-remote-session
Start on a remote host with a non-default model and effort. New session and a
reload both restore those choices and the remote folder.

```sh
yv drive new --steps '[{"click":{"css":".new-chips button","hasText":"iso-host"}},{"click":{"role":"button","name":"TEST-remote","exact":true}},{"click":"role:button:Model Opus 5.5"},{"click":{"css":".picker-fold","hasText":"Codex"}},{"click":{"role":"button","name":"Fake Fast","exact":true}},{"press":"Escape"},{"click":"role:button:Effort High"},{"click":"role:menuitemradio:Low"},{"click":"role:button:work"},{"fill":"placeholder:Search folders, or type a path","value":"{{remote_work}}"},{"expect":"role:option:work Open work"},{"press":"Enter"},{"fill":"label:Message","value":"TEST-remember remote defaults"},{"click":{"role":"button","name":"Send","exact":true}},{"expect":"css:.thread","text":"Echo: TEST-remember remote defaults"},{"goto":"new"},{"expect":{"css":".new-chips button","hasText":"TEST-remote"}},{"expect":"role:button:Model Fake Fast"},{"expect":"role:button:Effort Low"},{"expect":{"css":".new-chips button","hasText":"work"}},{"reload":true},{"expect":{"css":".new-chips button","hasText":"TEST-remote"}},{"expect":"role:button:Model Fake Fast"},{"expect":"role:button:Effort Low"},{"shot":"remembered-defaults"}]'
```

### remembers-changes-in-existing-chat
Changing model and effort in an existing chat updates New session defaults;
the source project is restored rather than the generated worktree.

```sh
yv drive 'session:{{sid_echo}}' --steps '[{"expect":"css:.thread","text":"Echo:"},{"click":"role:button:Model Fake Fast"},{"click":{"role":"button","name":"Fake Deep","exact":true}},{"press":"Escape"},{"click":{"css":".composer button","hasText":"Low"}},{"click":"role:button:Effort High"},{"click":"role:menuitemradio:Low"},{"expect":"role:button:Model Fake Deep"},{"expect":"role:button:Effort Low"},{"expect":{"css":".new-chips button","hasText":"TEST-demo-app"}},{"reload":true},{"expect":"role:button:Model Fake Deep"},{"expect":"role:button:Effort Low"},{"shot":"existing-session-defaults"}]'
```
