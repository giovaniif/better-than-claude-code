#!/bin/bash
# Installs or updates yardd on a Linux machine from the prebuilt release, so
# Switchyard can use it as a remote host. The desktop app runs this over SSH
# (`ssh <host> bash -s -- <port> < remote-install.sh`); it also works by hand:
#
#   curl -fsSL https://raw.githubusercontent.com/giovaniif/better-than-claude-code/main/scripts/remote-install.sh | bash -s -- 47717
#
# It installs to ~/.local/share/switchyard, runs yardd on 127.0.0.1:<port> as a
# systemd user service (or in the background where there is no user systemd),
# and reports whether `claude` and `codex` are there and logged in. Lines that
# start with `@@` are for the app; the rest is progress for people.
set -euo pipefail

port="${1:-47717}"
release="${SWITCHYARD_RELEASE_URL:-https://github.com/giovaniif/better-than-claude-code/releases/latest/download}"
dest="$HOME/.local/share/switchyard"

fail() {
  echo "@@fail $*"
  echo "error: $*" >&2
  exit 1
}

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64 | Linux-amd64) asset=switchyard-linux-x64.tar.gz ;;
  Linux-aarch64 | Linux-arm64) asset=switchyard-linux-arm64.tar.gz ;;
  Darwin-*) fail "this is a Mac: install the Switchyard app on it instead" ;;
  *) fail "unsupported system $(uname -s) $(uname -m)" ;;
esac

fetch() {
  if command -v curl >/dev/null; then
    curl -fsSL --retry 2 "$1" -o "$2"
  elif command -v wget >/dev/null; then
    wget -q "$1" -O "$2"
  else
    fail "needs curl or wget to download Switchyard"
  fi
}

echo "Downloading $asset"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fetch "$release/$asset" "$tmp/switchyard.tar.gz" || fail "could not download $release/$asset"
tar -xzf "$tmp/switchyard.tar.gz" -C "$tmp" || fail "the download is not a valid archive"
[ -x "$tmp/switchyard/bin/yardd" ] || fail "the archive has no yardd"

echo "Installing to $dest"
mkdir -p "$(dirname "$dest")"
# Swap the whole folder so a running yardd never sees half an update. The
# pid file of a background yardd moves along with it.
rm -rf "$dest.new" "$dest.old"
mv "$tmp/switchyard" "$dest.new"
if [ -e "$dest" ]; then
  mv "$dest" "$dest.old"
  [ -f "$dest.old/yardd.pid" ] && mv "$dest.old/yardd.pid" "$dest.new/yardd.pid"
fi
mv "$dest.new" "$dest"
rm -rf "$dest.old"
echo "Installed $(cat "$dest/VERSION" 2>/dev/null || echo "an unknown version")"

# The service must find the same `claude`, `codex`, `node` and `gh` an
# interactive shell finds; tools installed by nvm or the like only show up
# there, so ask an interactive login shell and fall back to a plain one.
user_shell="${SHELL:-/bin/bash}"
login_path="$("$user_shell" -ilc 'printf "\n__PATH__%s\n" "$PATH"' </dev/null 2>/dev/null | sed -n 's/^__PATH__//p' | tail -1 || true)"
[ -n "$login_path" ] || login_path="$("$user_shell" -lc 'printf %s "$PATH"' </dev/null 2>/dev/null || true)"
[ -n "$login_path" ] || login_path="$PATH"
login_path="$HOME/.local/bin:$login_path"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [ -z "${SWITCHYARD_NO_SYSTEMD:-}" ] && systemctl --user show-environment >/dev/null 2>&1; then
  unit="$HOME/.config/systemd/user/yardd.service"
  mkdir -p "$(dirname "$unit")"
  cat > "$unit" <<EOF
[Unit]
Description=Switchyard daemon (yardd)
After=network-online.target

[Service]
WorkingDirectory=$HOME
ExecStart=$dest/bin/yardd
Environment=YARD_PORT=$port
Environment=YARD_ROOT=$dest
Environment=YARD_SIDECAR=$dest/bin/yard-claude
Environment=PATH=$login_path
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable yardd.service >/dev/null 2>&1
  systemctl --user restart yardd.service
  # Without lingering, user services stop when the last SSH session ends.
  if ! loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q yes; then
    loginctl enable-linger "$(id -un)" 2>/dev/null \
      || echo "warning: could not enable lingering; yardd stops when you log out. Ask an admin to run: loginctl enable-linger $(id -un)"
  fi
  echo "Started the yardd user service"
  logs="journalctl --user -u yardd"
else
  # No user systemd (a container, or a system without it): run it detached.
  pidfile="$dest/yardd.pid"
  if [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null; then
    sleep 1
  fi
  mkdir -p "$HOME/.yard"
  (
    cd "$HOME"
    YARD_PORT="$port" YARD_ROOT="$dest" YARD_SIDECAR="$dest/bin/yard-claude" PATH="$login_path" \
      nohup "$dest/bin/yardd" >>"$HOME/.yard/yardd.log" 2>&1 </dev/null &
    echo $! > "$pidfile"
  )
  echo "Started yardd in the background (no systemd user session here, so it will not restart after a reboot)"
  logs="$HOME/.yard/yardd.log"
fi

health=""
for _ in $(seq 1 30); do
  if command -v curl >/dev/null; then
    health="$(curl -fsS "http://127.0.0.1:$port/health" 2>/dev/null || true)"
  else
    health="$(wget -qO- "http://127.0.0.1:$port/health" 2>/dev/null || true)"
  fi
  [ -n "$health" ] && break
  sleep 0.5
done
[ -n "$health" ] || fail "yardd did not answer on port $port; see $logs"
echo "Running: $health"

# What the engines look like from the service's PATH.
for engine in claude codex; do
  bin="$(PATH="$login_path" command -v "$engine" || true)"
  if [ -z "$bin" ]; then
    echo "@@engine $engine missing"
    continue
  fi
  state=ok
  if [ "$engine" = codex ] && ! PATH="$login_path" codex login status >/dev/null 2>&1; then
    state=logged-out
  fi
  if [ "$engine" = claude ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ ! -s "$HOME/.claude/.credentials.json" ]; then
    state=logged-out
  fi
  echo "@@engine $engine $state"
done
echo "@@ok $health"
