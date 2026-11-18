#!/usr/bin/env bash
# Prepare versions on a release branch, merge its PR, then publish from main.
# .github/workflows/release.yml builds and publishes the version tag.
#   scripts/release.sh 0.11.0 --prepare
#   scripts/release.sh 0.11.0
# Write the version's CHANGELOG.md section before preparing.
set -euo pipefail
cd "$(dirname "$0")/.."
# Cargo is often only in a login shell's PATH (rustup on Homebrew, ~/.cargo).
PATH="$PATH:$HOME/.cargo/bin:/opt/homebrew/opt/rustup/bin"

version="${1:-}"
mode="${2:-}"
if [ "$#" -gt 2 ] || { [ -n "$mode" ] && [ "$mode" != --prepare ]; }; then
  echo "usage: scripts/release.sh X.Y.Z [--prepare]" >&2
  exit 1
fi
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "usage: scripts/release.sh X.Y.Z [--prepare]" >&2
  exit 1
fi
if ! grep -Eq "^## $version( |$)" CHANGELOG.md; then
  echo "CHANGELOG.md has no '## $version' section yet" >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  echo "v$version already exists" >&2
  exit 1
fi

if [ "$mode" != --prepare ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "publish from a clean checkout of the merged release commit" >&2
    exit 1
  fi
  git fetch origin main --tags
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "publish from the current origin/main (a detached checkout is fine)" >&2
    exit 1
  fi
  for manifest in crates/yardd/Cargo.toml app/src-tauri/Cargo.toml; do
    have="$(sed -n 's/^version = "\(.*\)"/\1/p' "$manifest" | head -1)"
    [ "$have" = "$version" ] || { echo "$manifest is $have; prepare and merge the release PR first" >&2; exit 1; }
  done
  have="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' app/src-tauri/tauri.conf.json)"
  [ "$have" = "$version" ] || { echo "the app config is $have; prepare and merge the release PR first" >&2; exit 1; }
  git tag -a "v$version" -m "Switchyard $version"
  git push origin "refs/tags/v$version"
  echo "Pushed v$version. Follow it at https://github.com/giovaniif/switchyard/actions/workflows/release.yml"
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" = main ] || [ "$branch" = HEAD ]; then
  echo "prepare on a release branch, then merge its PR with required CI" >&2
  exit 1
fi
if ! git diff --cached --quiet; then
  echo "commit or unstage existing staged changes before preparing a release" >&2
  exit 1
fi

# The first "version" line in each file is the package's own.
set_version() { # file, prefix before the quoted version
  awk -v p="$2" -v v="$version" '!done && index($0, p "\"") == 1 { print p "\"" v "\"" (index($0, "\",") ? "," : ""); done = 1; next } { print }' "$1" > "$1.tmp"
  mv "$1.tmp" "$1"
}
set_version crates/yardd/Cargo.toml 'version = '
set_version app/src-tauri/Cargo.toml 'version = '
set_version app/src-tauri/tauri.conf.json '  "version": '
cargo metadata --format-version 1 >/dev/null # refreshes Cargo.lock

git add CHANGELOG.md crates/yardd/Cargo.toml app/src-tauri/Cargo.toml app/src-tauri/tauri.conf.json Cargo.lock
if ! git diff --cached --quiet; then
  git commit -m "release: $version"
fi
echo "Prepared $version. Push $branch, merge its PR after CI passes, then run scripts/release.sh $version from the merged main commit."
