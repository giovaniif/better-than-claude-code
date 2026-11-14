#!/bin/bash
# Installs yardd on a Linux box as a remote host for Switchyard, from this
# checkout: a release yardd, the compiled Claude sidecar and the UI go to
# ~/.local/share/switchyard, and a systemd user unit keeps yardd running on
# 127.0.0.1:47717. Rerun it to update. Needs Rust, Bun, git and systemd.
#
# The engines are not installed here: `claude` and `codex` must already be on
# PATH, logged in (`claude setup-token`, `codex login --device-auth`).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$HOME/.local/share/switchyard"
unit="$HOME/.config/systemd/user/yardd.service"
port="${YARD_PORT:-47717}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"
cd "$root"

for tool in cargo bun git; do
  command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 1; }
done

echo "==> building"
export YARD_BUILD_ID="$(git rev-parse --short HEAD)"
(cd ui && bun install --frozen-lockfile && bunx vite build)
mkdir -p target/sidecar
(cd sidecar/yard-claude && bun install --frozen-lockfile \
  && bun build --compile src/main.ts --outfile "$root/target/sidecar/yard-claude")
CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}" cargo build --release -p yardd

# Copied out of the checkout: build folders get cleaned, the service must not break.
echo "==> installing to $dest"
mkdir -p "$dest/bin" "$dest/ui"
install -m 755 target/release/yardd "$dest/bin/yardd.new" && mv "$dest/bin/yardd.new" "$dest/bin/yardd"
install -m 755 target/sidecar/yard-claude "$dest/bin/yard-claude.new" && mv "$dest/bin/yard-claude.new" "$dest/bin/yard-claude"
rm -rf "$dest/ui/dist" && cp -R ui/dist "$dest/ui/dist"

# The service sees the PATH this login shell has, so it finds the same
# `claude`, `codex`, `node` and `gh`.
login_path="$(bash -lc 'printf %s "$PATH"')"
for engine in claude codex; do
  PATH="$login_path" command -v "$engine" >/dev/null || echo "warning: $engine is not on the login PATH" >&2
done

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
systemctl --user enable yardd.service >/dev/null
systemctl --user restart yardd.service
# Keep it running while logged out.
loginctl show-user "$USER" -p Linger | grep -q yes || loginctl enable-linger "$USER"

for _ in $(seq 1 20); do
  if health="$(curl -fsS "http://127.0.0.1:$port/health" 2>/dev/null)"; then
    echo "==> running: $health on 127.0.0.1:$port"
    echo "Add it in Switchyard: Hosts > Add host, SSH destination $USER@$(hostname), remote port $port."
    exit 0
  fi
  sleep 0.5
done
echo "yardd did not answer on port $port; see: journalctl --user -u yardd" >&2
exit 1
