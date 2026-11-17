# iOS builds and TestFlight

Read this before declaring that Apple signing credentials are missing. This
server has shipped iOS builds through **Expo/EAS**, even though Switchyard's
native app uses SwiftUI and GitHub's macOS runners rather than Expo.

The app architecture and device checks are in [mobile/README.md](../mobile/README.md).
The build definition is [.github/workflows/ios-app.yml](../.github/workflows/ios-app.yml),
and the archive/upload script is [mobile/scripts/testflight.sh](../mobile/scripts/testflight.sh).

## Credential locations

These are locations and identifiers, not secret values. Never paste private
keys, certificate passwords, authentication cookies or tokens into this repo,
PRs, terminal output or chat.

| Location | What it contains |
| --- | --- |
| `~/.config/homelab/secrets.env` | `EXPO_TOKEN`, which can read the owner's EAS signing credentials |
| Expo account `giovaniif` | The reusable iOS distribution certificate/private key and an Admin App Store Connect API key |
| Expo project `@giovaniif/bolao` | The existing iOS build/submit setup that established these credentials |
| `~/www/bolao-app/mobile/eas.json` | Reference build profiles, Apple team ID and the **Bolão** app ID; read only, do not copy that app ID into Switchyard |
| `~/signing.env` and `~/signing.p12` | Desktop **Developer ID Application** signing/notarization; this `.p12` cannot sign an iOS app |
| `~/.app-store/auth/` | Cached Apple website login; it was expired when checked on 2026-11-17 |
| GitHub repository secrets | The credentials consumed by the Switchyard build workflow; secret values cannot be downloaded back from GitHub |

Verified on 2026-11-17:

- Apple Developer team: `827UMZ89C2` (Giovani Farias).
- EAS holds an **iPhone Distribution** certificate, including its private key,
  valid through **2027-10-20**. Apple confirmed it is valid for iOS distribution.
- EAS holds a working team App Store Connect API key with the **Admin** role.
  Its private key was recovered and authenticated against Apple's API without
  a new Apple login or two-factor prompt.
- Switchyard's bundle ID is **`sh.giovani.switchyard.mobile`**. It is registered
  with Apple, developer portal identifier `SGJL9X97W4`.
- Its **Switchyard TestFlight** App Store provisioning profile is active and
  expires on **2027-10-20**. It uses that existing distribution certificate.
- All seven required GitHub repository secret names are configured. Six iOS
  values were synced from EAS/the new profile; the existing team ID was reused.
- The Switchyard App Store Connect app record did **not** exist when checked.
  Do not confuse the registered bundle ID with the separate app record.

Do not revoke or replace the shared EAS certificate or API key to set up this
app: other apps already use them. Only the provisioning profile is specific
to Switchyard. An `iPhone Distribution` certificate is supported; the build
script selects the actual imported signing identity instead of requiring the
newer `Apple Distribution` label.

## Check and recover credentials safely

First check the existing encrypted GitHub secret names:

```sh
gh secret list --repo giovaniif/switchyard
```

To check the server's EAS access without printing the token:

```sh
(
  . "$HOME/.config/homelab/secrets.env"
  export EXPO_TOKEN
  bunx --bun eas-cli@27.10.0 whoami
)
```

EAS signing credentials can be inspected/downloaded with `eas credentials
--platform ios` in the existing Expo project. Do not run an Expo initialization
or build in Switchyard's Swift app, and do not modify the Bolão project.

For an automated recovery, the EAS CLI's read-only GraphQL queries are the
reference. They call `https://api.expo.dev/graphql` with `Authorization: Bearer
$EXPO_TOKEN` and an EAS CLI User-Agent. A request without that User-Agent was
refused with HTTP 403 during discovery; that did not mean the token was bad.
The relevant fields are:

- `account.byName(accountName: "giovaniif").appleDistributionCertificatesPaginated`:
  certificate metadata, `certificateP12` (already base64), `certificatePassword`,
  `developerPortalIdentifier`, and `appleTeam.appleTeamIdentifier`.
- `account.byName(...).appStoreConnectApiKeysPaginated`: API key metadata/roles.
- `appStoreConnectApiKey.byId`: `keyP8` (PEM text), `keyIdentifier`, and
  `issuerIdentifier` for the chosen key.

Choose the correct team and validate expiration and Apple API access before
using a credential. Do not dump entire query responses: they can contain the
private key and certificate password. Inspect only metadata or presence flags.
Keep recovered files in a temporary directory with mode `0700`, files `0600`.
Pipe values to `gh secret set NAME --repo giovaniif/switchyard` on stdin;
never put them in command arguments or log output. Remove temporary recovered
files after syncing the encrypted secrets.

The workflow expects these names (repository secrets work; an environment
named `testflight` can override them):

| Secret | Encoding |
| --- | --- |
| `IOS_CERTIFICATE` | Base64 `.p12`, including the private key |
| `IOS_CERTIFICATE_PASSWORD` | Plain certificate password |
| `IOS_PROVISION_PROFILE` | Base64 of Switchyard's App Store `.mobileprovision` |
| `MACOS_TEAM_ID` | Apple Developer team ID, shared with the desktop build |
| `APP_STORE_CONNECT_KEY_ID` | API key identifier |
| `APP_STORE_CONNECT_ISSUER_ID` | Team API issuer identifier |
| `APP_STORE_CONNECT_API_KEY` | Base64 of the `.p8` PEM text |

The API key signs short-lived ES256 JWTs with audience `appstoreconnect-v1` for
Apple's REST API. It can register bundle IDs and create App Store provisioning
profiles using the existing certificate. Check for an existing resource before
creating another, and check the profile's certificate and bundle ID match.

## Create the App Store Connect record once

Apple's [Apps API](https://developer.apple.com/documentation/appstoreconnectapi/apps)
explicitly requires creating new app records on its website. A working API key
does not remove that step. An expired `~/.app-store` session is not a reason to
replace the API key or signing certificate.

At [App Store Connect → Apps](https://appstoreconnect.apple.com/apps), choose
**New App**:

| Field | Value |
| --- | --- |
| Platform | iOS |
| Name | Switchyard (if Apple reports a name conflict, resolve that before uploading) |
| Primary language | English (U.S.) |
| Bundle ID | `sh.giovani.switchyard.mobile` |
| SKU | `switchyard-mobile` |

Record the new numeric App Store Connect app ID here once created. Do not use
the Bolão app's numeric ID. No public App Store release is needed to use
TestFlight.

## Build and upload

The Linux server does not have Xcode. Run the build on the workflow's macOS 26
runner, or on a Mac with Xcode 26+ selected. Apple requires an iOS 26+ SDK for
uploads; the minimum supported device OS can still be iOS 16.

```sh
# Simulator build and unit tests, without signing or uploading:
gh workflow run ios-app.yml --repo giovaniif/switchyard \
  --ref <reviewed-branch-or-main> -f testflight=false

# After the app record and all signing secrets exist:
gh workflow run ios-app.yml --repo giovaniif/switchyard \
  --ref <reviewed-branch-or-main> -f testflight=true

gh run list --repo giovaniif/switchyard --workflow ios-app.yml --limit 5
gh run watch <run-id> --repo giovaniif/switchyard --exit-status
```

The simulator job must pass before the signing job starts. Signing imports the
certificate into a temporary keychain, installs the provisioning profile,
archives the Release app and uploads it to App Store Connect. The script
cleans up temporary signing material. The build number uses the workflow run
number and attempt; do not reuse a previously uploaded build number.

If GitHub refuses dispatch because the new workflow is not on the default
branch, land its reviewed PR first. Do not temporarily change an unrelated
workflow, reuse another app's bundle ID or upload this app to another app record.

The simulator artifact is **not** an installable iPhone/TestFlight build.
Upload success is also not proof of installation: wait for Apple processing,
then attach the build to a TestFlight group. Internal testers can test first;
external testers require Apple's beta review.

## Show the installation link in Switchyard

Once a real TestFlight public invitation exists, set
`YARD_TESTFLIGHT_URL=https://testflight.apple.com/join/<8-character-code>` on
the **hub serving the page**. Never invent a code or use another app's link.
Hosts then offers Install with TestFlight. The session-corner shortcut remains
until the native app actually connects and the hub saves that setup state.

On this server, the live hub is the `yardd` **systemd user service**, configured
by `~/.config/systemd/user/yardd.service.d/web.conf`; it is not a Coolify app.
Do not restart the user's live daemon just to test this setting. Coordinate a
normal app/service update when ready; verify changes using isolated daemons.
For Docker deployments, `docker-compose.yml` passes `YARD_TESTFLIGHT_URL` through.

The phone connects to the existing private HTTPS host, for example
`https://switchyard.giovani.sh`, over the owner's tailnet. Do not expose the
daemon publicly, change its loopback defaults, weaken Origin checks or enable
Tailscale Serve on this server (Traefik already owns port 443).

Before inviting testers, complete the physical-device checks in
[mobile/README.md](../mobile/README.md), especially voice permissions,
dictation/readback, attachments and foreground recovery. There is no APNs
push delivery while the app is suspended.
