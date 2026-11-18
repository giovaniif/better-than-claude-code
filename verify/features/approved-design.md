# Approved Switchyard design

The conversation workspace contains Terminal and Processes. Any pull request
opens on GitHub from the conversation header. The composer has one toolbar row.
Connectors are grouped by account, and Usage starts with one compact summary.

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

### terminal-first-and-external-pr
Viewports: desktop
The Workspace contains exactly two tabs and opens on Terminal. The branch's PR
opens externally from the conversation header.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"expect":"css:.workspace-tabs .tab","count":2},{"expect":{"css":".workspace-tabs [aria-pressed=true]","hasText":"Terminal"}},{"expect":{"css":".thread .bar a[target=_blank]","hasText":"#4242"}},{"click":"role:button:Processes"},{"expect":"role:button:Refresh processes"},{"shot":"workspace"}]'
```

### one-row-composers
Viewports: both
Attachments, dictation, voice, session settings and Send fit on a single row.
On phones, the setup button opens all the settings.

```sh
yv drive new --steps '[{"expect":"role:button:Attach files"},{"expect":"role:button:Voice mode"},{"eval":"(() => { const row=document.querySelector(\".composer-row\"); const a=row.querySelector(\".attach-btn\").getBoundingClientRect(); const b=row.querySelector(\".send\").getBoundingClientRect(); return Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2) < 2 && b.right<=innerWidth; })()","equals":true},{"shot":"new-composer"}]'
yv drive 'session:{{sid_echo}}' --viewport mobile --steps '[{"click":"role:button:Session setup"},{"expect":"role:dialog:Session setup"},{"expect":"role:button:Ask first"},{"press":"Escape"},{"shot":"reply-composer"}]'
```

### account-card-separation
Viewports: both
A host's account cards are visible together and their connector lists stay
within their respective cards.

```sh
yv drive connectors --steps '[{"expect":{"css":".connectors-card","hasText":"Claude"}},{"expect":{"css":".connectors-card","hasText":"Codex"}},{"expect":"css:.connectors-card","count":2},{"shot":"per-account-connectors"}]'
```

### compact-usage
Viewports: desktop
One account is shown first and other accounts can be expanded.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Subscription usage"},{"expect":"role:dialog:Subscription usage"},{"expect":"role:button:Other accounts"},{"click":"role:button:Other accounts"},{"expect":"css:.compact-subscription"},{"click":"role:button:Refresh usage"},{"expect":"role:button:Refresh usage","enabled":true},{"shot":"usage"}]'
```
