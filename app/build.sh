#!/bin/bash
# Builds a self-contained Switchyard.app: release yardd, the compiled Claude
# sidecar and the UI go inside it (app/src-tauri/tauri.bundle.json).
# The bundle config is merged only here, so `cargo build` of the workspace
# does not need these release inputs.
set -e

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
cd "$root"

# Tauri's release build is heavy; keep it off most cores unless asked.
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
if ! command -v cargo >/dev/null 2>&1 && [ -d /opt/homebrew/opt/rustup/bin ]; then
  export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
fi

# One id for yardd and the shell, so the shell can tell its own yardd from an
# older one already running.
YARD_BUILD_ID="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
if [ "$YARD_BUILD_ID" != dev ] && [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  YARD_BUILD_ID="$YARD_BUILD_ID-dirty"
fi
export YARD_BUILD_ID
echo "build id: $YARD_BUILD_ID"

echo "==> UI"
(cd ui && bun install --frozen-lockfile && bunx vite build)

echo "==> Claude sidecar"
mkdir -p target/sidecar
(cd sidecar/yard-claude && bun install --frozen-lockfile \
  && bun build --compile src/main.ts --outfile "$root/target/sidecar/yard-claude")

echo "==> yardd"
cargo build --release -p yardd

echo "==> app"
(cd app && bun install --frozen-lockfile \
  && bunx tauri build --bundles app --config src-tauri/tauri.bundle.json)

echo
echo "$root/target/release/bundle/macos/Switchyard.app"
