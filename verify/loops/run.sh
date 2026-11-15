#!/usr/bin/env bash
# Starts one agent loop run. Installed as ~/.local/share/switchyard-loops/run
# by verify/loops/install.sh and called by the switchyard-loop@<kind> units.
# The loops' checkout is their own: it is reset to origin/main on every run,
# so never edit it by hand. Each run becomes a Switchyard session (in its own
# worktree) on the live yardd; this script only launches it and returns.
set -euo pipefail
kind="${1:?usage: run <patrol|maintain|review|verify|babysit> [args]}"
shift
dir="${YV_LOOPS_CHECKOUT:-$HOME/.local/share/switchyard-loops/switchyard}"
if [ ! -d "$dir/.git" ]; then
  mkdir -p "$(dirname "$dir")"
  git clone -q git@github.com:giovaniif/switchyard.git "$dir"
fi
git -C "$dir" fetch -q --prune origin
git -C "$dir" checkout -q --detach origin/main
git -C "$dir" reset -q --hard origin/main
(cd "$dir/verify" && bun install --silent --frozen-lockfile >/dev/null)
out="$("$dir/verify/yv" loop run "$kind" --checkout "$dir" "$@")" || true
echo "$out"
# A launch that failed (yardd down, bad config) should reach the owner, once per hour at most.
if ! printf '%s' "$out" | jq -e '.ok' >/dev/null 2>&1; then
  stamp="$HOME/.local/state/switchyard-verify/loops/$kind.alerted"
  mkdir -p "$(dirname "$stamp")"
  if [ ! -f "$stamp" ] || [ -n "$(find "$stamp" -mmin +60)" ]; then
    touch "$stamp"
    "$dir/verify/yv" notify "Loop $kind did not start: $(printf '%s' "$out" | jq -r '.problems[0].msg // "unknown error"' 2>/dev/null)" --title "Switchyard loops" >/dev/null || true
  fi
  exit 1
fi
