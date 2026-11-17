# Mobile app

The iOS app shares the host UI. Setup is always on Hosts; the phone shortcut
appears in session headers until an actual phone connection is recorded by the
hub. The workspace tabs remain accessible on narrow screens.

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

### setup-entry-points
Viewports: both
The shortcut is present on new and existing sessions. It opens the persistent
Hosts card, with no false TestFlight URL before the beta has an invitation.

```sh
yv drive new --steps '[{"expect":"role:button:Set up iPhone app"},{"click":"role:button:Set up iPhone app"},{"expect":"role:region:iPhone app","text":"TestFlight beta"},{"expect":"role:region:iPhone app","text":"first build is available"},{"fill":"label:Enter your host’s HTTPS address in the iPhone app.","value":"https://yard.test"},{"expect":"role:link:Open in Switchyard on this iPhone"},{"fill":"label:Enter your host’s HTTPS address in the iPhone app.","value":"http://localhost:47717"},{"expect":"role:link:Open in Switchyard on this iPhone","count":0},{"expect":"css:.mobile-setup","text":"Localhost points to the phone itself"},{"shot":"setup"}]'
yv drive 'session:{{sid_echo}}' --steps '[{"expect":"role:button:Set up iPhone app"},{"shot":"session-shortcut"}]'
```

### phone-workspace
Viewports: mobile
All workspace tabs can be reached and the conversation can be reopened without
losing its composer. The terminal starts only when opened.

```sh
yv drive 'session:{{sid_echo}}' --viewport mobile --steps '[{"fill":"label:Message","value":"TEST-draft on phone"},{"click":"role:button:Workspace"},{"expect":"role:region:Workspace"},{"expect":"role:button:Changes"},{"click":"role:button:Terminal"},{"expect":"css:.xterm"},{"click":"role:button:Pull request"},{"click":"role:button:Processes"},{"expect":"role:button:Refresh processes"},{"click":"role:button:Back to conversation"},{"expect":"label:Message","value":"TEST-draft on phone"},{"shot":"conversation-restored"}]'
```

### successful-connection-removes-shortcuts
Viewports: both
A native connection is persisted by the hub. Reloading and reopening another
session retains setup status; Hosts keeps its card for additional devices.

```sh
yv api '{"op":"mobile.connected"}' --wait '{"op":"mobile.status","mobile":{"configured":true}}'
yv drive new --steps '[{"expect":"role:button:Set up iPhone app","count":0}]'
yv drive 'session:{{sid_echo}}' --steps '[{"expect":"role:button:Set up iPhone app","count":0},{"reload":true},{"expect":"css:.thread"},{"expect":"role:button:Set up iPhone app","count":0},{"shot":"configured-session"}]'
yv drive hosts --steps '[{"expect":"role:region:iPhone app","text":"Connected"},{"shot":"configured-host"}]'
```

### native-device (manual: requires a signed build and physical iPhone)
Follow `mobile/README.md` for device voice, permissions, attachments, lifecycle,
network and TestFlight checks. JavaScript bridge tests cover callback routing
and cancellation; Swift unit tests cover host and deep-link validation.

## Gotchas

- No push delivery while the app is suspended; no APNs service exists.
- The TestFlight invitation stays pending until Apple signing and beta setup
  are completed. A simulator artifact cannot be installed with TestFlight.
