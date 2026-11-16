#!/usr/bin/env bash
# Installed as ~/.local/share/switchyard-loops/run by verify/loops/install.sh.
#   run tidy           every 5 minutes (switchyard-loop-tidy.timer): refresh the
#                      loops' checkout, then archive finished loop sessions
#   run <kind> [args]  one loop run by hand (switchyard-loop@<kind>.service)
# The loops' checkout is their own: it is reset to origin/main on every call,
# so never edit it by hand. The scheduled loops (patrol, maintain, review) are
# yardd automations that cut their worktrees from this checkout; the tidy
# refresh keeps its working tree (the `yv` that tidy and the land gate's hint
# use) at origin/main now that no hourly launch resets it.
set -euo pipefail
kind="${1:?usage: run tidy | run <patrol|maintain|review|verify|babysit> [args]}"
shift
dir="${YV_LOOPS_CHECKOUT:-$HOME/.local/share/switchyard-loops/switchyard}"
if [ ! -d "$dir/.git" ]; then
  mkdir -p "$(dirname "$dir")"
  git clone -q git@github.com:giovaniif/switchyard.git "$dir"
fi
if ! git -C "$dir" fetch -q --prune origin; then
  # yardd fetches in this checkout before each automation run; a clash or a
  # network blip must not stop the tidy pass.
  [ "$kind" = "tidy" ] || exit 1
fi
git -C "$dir" checkout -q --detach origin/main
git -C "$dir" reset -q --hard origin/main
(cd "$dir/verify" && bun install --silent --frozen-lockfile >/dev/null)
if [ "$kind" = "tidy" ]; then
  exec "$dir/verify/yv" loop tidy
fi
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
