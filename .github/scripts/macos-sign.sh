#!/bin/bash
# Signs Switchyard.app with a Developer ID, notarizes and staples it, then
# makes a signed, notarized DMG. Run after app/build.sh on a macOS runner.
#
# Secrets (env): MACOS_CERTIFICATE (base64 .p12 with the Developer ID
# Application cert and key), MACOS_CERTIFICATE_PASSWORD, MACOS_NOTARY_APPLE_ID,
# MACOS_NOTARY_PASSWORD (app-specific password), MACOS_TEAM_ID.
# They are not named APPLE_* so that `tauri build` does not sign on its own.
#
# Without MACOS_CERTIFICATE it signs ad-hoc, so the build still yields a DMG;
# that one needs its quarantine flag cleared before macOS opens it.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
app="target/release/bundle/macos/Switchyard.app"
bin="$app/Contents/Resources/yard/bin"
sha="$(git rev-parse --short HEAD)"
tmp="${RUNNER_TEMP:-$(mktemp -d)}"

make_dmg() {
  stage="$tmp/dmg"
  rm -rf "$stage"
  mkdir -p "$stage"
  cp -R "$app" "$stage/"
  ln -s /Applications "$stage/Applications"
  hdiutil create -volname Switchyard -srcfolder "$stage" -ov -format UDZO "$1"
}

if [ -z "${MACOS_CERTIFICATE:-}" ]; then
  echo "::warning::MACOS_CERTIFICATE is not set: ad-hoc signature, not notarized"
  codesign --force --deep --sign - "$app"
  make_dmg "Switchyard-$sha-unsigned.dmg"
  exit 0
fi

for v in MACOS_CERTIFICATE_PASSWORD MACOS_NOTARY_APPLE_ID MACOS_NOTARY_PASSWORD MACOS_TEAM_ID; do
  if [ -z "${!v:-}" ]; then
    echo "::error::$v is not set"
    exit 1
  fi
done

# A throwaway keychain holding only the signing identity.
keychain="$tmp/signing.keychain-db"
kc_pass="$(uuidgen)"
trap 'security delete-keychain "$keychain" 2>/dev/null || true; rm -f "$tmp/cert.p12"' EXIT
security create-keychain -p "$kc_pass" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$kc_pass" "$keychain"
printf %s "$MACOS_CERTIFICATE" | base64 --decode > "$tmp/cert.p12"
security import "$tmp/cert.p12" -k "$keychain" -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
rm -f "$tmp/cert.p12"
security set-key-partition-list -S apple-tool:,apple: -s -k "$kc_pass" "$keychain" >/dev/null
# shellcheck disable=SC2046
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')

identity="$(security find-identity -v -p codesigning "$keychain" \
  | awk -F'"' '/Developer ID Application/ { print $2; exit }')"
if [ -z "$identity" ]; then
  echo "::error::The certificate holds no Developer ID Application identity"
  security find-identity -v -p codesigning "$keychain"
  exit 1
fi
echo "Signing as: $identity"

sign() { codesign --force --timestamp --options runtime --sign "$identity" "$@"; }

# Inside out: nested executables first, the bundle last, no --deep.
sign "$bin/yardd"
sign --entitlements "$here/bun-entitlements.plist" "$bin/yard-claude"
sign "$app"
codesign --verify --deep --strict --verbose=2 "$app"

notarize() {
  out="$tmp/notary.json"
  xcrun notarytool submit "$1" \
    --apple-id "$MACOS_NOTARY_APPLE_ID" --password "$MACOS_NOTARY_PASSWORD" \
    --team-id "$MACOS_TEAM_ID" --wait --timeout 45m --output-format json | tee "$out"
  status="$(plutil -extract status raw -o - "$out")"
  if [ "$status" != Accepted ]; then
    id="$(plutil -extract id raw -o - "$out")"
    echo "::error::Notarization of $1 ended as $status"
    xcrun notarytool log "$id" \
      --apple-id "$MACOS_NOTARY_APPLE_ID" --password "$MACOS_NOTARY_PASSWORD" \
      --team-id "$MACOS_TEAM_ID" || true
    exit 1
  fi
}

# The app gets its own ticket so it opens offline once copied out of the DMG.
ditto -c -k --keepParent "$app" "$tmp/Switchyard.zip"
notarize "$tmp/Switchyard.zip"
xcrun stapler staple "$app"

dmg="Switchyard-$sha.dmg"
make_dmg "$dmg"
codesign --force --timestamp --sign "$identity" "$dmg"
notarize "$dmg"
xcrun stapler staple "$dmg"

spctl --assess --type execute --verbose=2 "$app"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
