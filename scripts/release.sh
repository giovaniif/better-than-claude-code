#!/usr/bin/env bash
# Cuts a release: sets the version everywhere, commits, tags vX.Y.Z and pushes.
# .github/workflows/release.yml then builds and publishes it.
#   scripts/release.sh 0.2.0
# Write the "## 0.2.0 (date)" section of CHANGELOG.md first.
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-}"
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "usage: scripts/release.sh X.Y.Z" >&2
  exit 1
fi
if ! grep -Eq "^## $version( |$)" CHANGELOG.md; then
  echo "CHANGELOG.md has no '## $version' section yet" >&2
  exit 1
fi
if [ "$(git rev-parse --abbrev-ref HEAD)" != main ]; then
  echo "release from main" >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  echo "v$version already exists" >&2
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
git tag -a "v$version" -m "Switchyard $version"
git push origin main "v$version"
echo "Pushed v$version. Follow it at https://github.com/giovaniif/better-than-claude-code/actions/workflows/release.yml"
