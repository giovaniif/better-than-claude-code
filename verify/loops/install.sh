#!/usr/bin/env bash
# Installs the agent loops as systemd user timers on this machine:
#   switchyard-loop@patrol    hourly at :37
#   switchyard-loop@maintain  daily 03:30 America/Sao_Paulo
#   switchyard-loop@review    Mondays 08:00 America/Sao_Paulo
# Usage: verify/loops/install.sh [--enable]   (without --enable, units are written but timers stay off)
# Pause every loop without touching systemd: verify/yv loop pause / resume.
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

timer() { # kind, OnCalendar, description
  cat > "$units/switchyard-loop-$1.timer" <<UNIT
[Unit]
Description=Switchyard $3

[Timer]
OnCalendar=$2
Unit=switchyard-loop@$1.service
RandomizedDelaySec=2min
Persistent=false

[Install]
WantedBy=timers.target
UNIT
}
timer patrol "*-*-* *:37:00" "patrol loop, hourly"

# Finished loop sessions are archived within minutes, so only running ones
# sit in the sidebar. Read-only for the checkout: no reset, no fetch.
cat > "$units/switchyard-loop-tidy.service" <<UNIT
[Unit]
Description=Switchyard: archive finished agent-loop sessions
After=yardd.service

[Service]
Type=oneshot
Environment="PATH=$path"
ExecStart=%h/.local/share/switchyard-loops/switchyard/verify/yv loop tidy
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
timer maintain "*-*-* 03:30:00 America/Sao_Paulo" "feature-map maintenance loop, daily"
timer review "Mon *-*-* 08:00:00 America/Sao_Paulo" "land gate weekly review"

systemctl --user daemon-reload
if [ "${1:-}" = "--enable" ]; then
  systemctl --user enable --now switchyard-loop-patrol.timer switchyard-loop-maintain.timer switchyard-loop-review.timer switchyard-loop-tidy.timer
fi
systemctl --user list-timers --all --no-pager | grep -E "NEXT|switchyard-loop" || true
