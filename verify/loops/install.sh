#!/usr/bin/env bash
# Installs the agent loops on this machine.
#   patrol (hourly), maintain (daily 03:30), review (Mondays 08:00) are yardd
#   automations on the live yardd: `verify/yv loop automations --apply`
#   creates or updates them from verify/loops.json and turns off the systemd
#   timers that used to start them. They are not written here any more.
#   switchyard-loop-tidy.timer, every 5 minutes: refreshes the loops' checkout
#   and archives finished loop sessions (`verify/yv loop tidy`).
#   switchyard-loop@.service: one run by hand (`systemctl --user start switchyard-loop@patrol`).
# Usage: verify/loops/install.sh [--enable]   (--enable turns the tidy timer on and applies the automations)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
share="$HOME/.local/share/switchyard-loops"
units="$HOME/.config/systemd/user"
mkdir -p "$share" "$units"
install -m 755 "$here/run.sh" "$share/run"
if [ ! -d "$share/switchyard/.git" ]; then
  git clone -q git@github.com:giovaniif/switchyard.git "$share/switchyard"
fi

path="$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin"
cat > "$units/switchyard-loop@.service" <<UNIT
[Unit]
Description=Switchyard agent loop: %i (starts a session on the live yardd)
After=yardd.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment="PATH=$path"
ExecStart=%h/.local/share/switchyard-loops/run %i
TimeoutStartSec=10min
Nice=10
UNIT

# Finished loop sessions are archived within minutes, so only running ones
# sit in the sidebar. It also keeps the loops' checkout at origin/main.
cat > "$units/switchyard-loop-tidy.service" <<UNIT
[Unit]
Description=Switchyard: archive finished agent-loop sessions
After=yardd.service

[Service]
Type=oneshot
Environment="PATH=$path"
ExecStart=%h/.local/share/switchyard-loops/run tidy
TimeoutStartSec=5min
Nice=10
UNIT
cat > "$units/switchyard-loop-tidy.timer" <<UNIT
[Unit]
Description=Switchyard: archive finished agent-loop sessions every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=false

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
if [ "${1:-}" = "--enable" ]; then
  systemctl --user enable --now switchyard-loop-tidy.timer
  "$here/../yv" loop automations --apply
fi
systemctl --user list-timers --all --no-pager | grep -E "NEXT|switchyard-loop" || true
