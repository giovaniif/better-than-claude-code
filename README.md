# Switchyard

One UI for Claude Code and Codex sessions on my own subscriptions. Design and decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run

Needs `codex` and `claude` installed and logged in, plus Bun and Rust. Run from the repo root.

```bash
(cd sidecar/yard-claude && bun install)
(cd ui && bun install && bunx vite build)
cargo run -p yardd
```

Then open http://127.0.0.1:47717.

`YARD_PORT` changes the port. Sessions are saved in `~/.yard/yard.db` (`YARD_DATA_DIR` moves it) and survive a restart.

Limits, all optional: `YARD_SESSION_MEM_CAP_GB` (default 8, `0` off) stops a session whose processes use more; `YARD_MIN_FREE_GB` (default 2) is the free memory below which new sessions queue.

## Tests

```bash
CARGO_BUILD_JOBS=2 cargo test -p yardd   # unit tests and the daemon integration suite
(cd ui && bun install && bun test)       # applyEvent and the store reducer
```

The integration tests in `crates/yardd/tests` start the built `yardd` on free ports with temp data dirs and drive it over its WebSocket. They put `crates/yardd/tests/fake-codex` first on `PATH`: a scripted `codex app-server` (Bun) whose turns are picked by markers in the prompt (`[cmd]`, `[edit]`, `[slow]`, `[fail]`), and a `claude` that only fails. No real engine runs, nothing needs a login or the network, and the suite is safe next to a running yardd. Needs `bun` and `git`.

## Desktop app

```bash
app/build.sh
open target/release/bundle/macos/Switchyard.app
```

`app/build.sh` (also `bun run build` in `app`) builds the UI, compiles the Claude sidecar to a binary with `bun build --compile`, builds yardd in release and bundles all three into `Switchyard.app/Contents/Resources/yard`. It caps Cargo at `CARGO_BUILD_JOBS=2` unless you set it. The `.app` runs anywhere on the Mac, without the repo, Bun or Rust; it still needs `codex` and `claude` installed and logged in. It is unsigned.

The app starts its bundled yardd if none is running and opens a window on its UI. Closing the app leaves yardd and its sessions running; `pkill -x yardd` stops them. yardd logs to `~/.yard/yardd.log` when the app starts it.

`/health` reports yardd's build id. If a yardd from another build is already running, the app does not stop it (it may hold live sessions): the title says an older daemon is running and the window uses it. Quit that yardd and reopen the app to update.

Without building: every push to `main` that changes code (or a manual run of the "macOS app" workflow) builds `Switchyard.dmg` on GitHub Actions, signed with a Developer ID and notarized, and puts it on the `latest` release: https://github.com/giovaniif/better-than-claude-code/releases/latest/download/Switchyard.dmg. Other builds are on each run's artifacts. Signing needs the repository secrets listed in `.github/scripts/macos-sign.sh`; without them the DMG is ad-hoc signed and named `-unsigned`, and needs `xattr -dr com.apple.quarantine /Applications/Switchyard.app` before it opens.

`SWITCHYARD_PORT` and `YARD_DATA_DIR` run a second copy next to the real one, for example `SWITCHYARD_PORT=47728 YARD_DATA_DIR=/tmp/yard-test Switchyard.app/Contents/MacOS/switchyard`; that copy logs to its data folder.

`cargo run -p switchyard` from the repo has no bundled files and falls back to the repo's `target/{release,debug}/yardd`, `ui/dist` and `bun run` of the sidecar script.

`bun run icon` in `app` redraws the icon set.

## Remote host

Sessions can run on another machine, such as a Linux box on your Tailscale network. The same yardd runs there; the yardd on your Mac reaches it through an SSH tunnel it starts itself. The remote yardd stays on loopback, so nothing new is exposed.

1. On the box, install `codex`, `claude`, Bun, Rust and git, clone this repo, and build:

   ```bash
   (cd sidecar/yard-claude && bun install)
   (cd ui && bun install && bunx vite build)
   cargo build --release -p yardd
   ```

2. Keep yardd running with a systemd user unit, `~/.config/systemd/user/yardd.service`:

   ```ini
   [Unit]
   Description=Switchyard daemon

   [Service]
   WorkingDirectory=%h/switchyard
   ExecStart=%h/switchyard/target/release/yardd
   Environment=PATH=%h/.local/bin:%h/.bun/bin:%h/.cargo/bin:/usr/local/bin:/usr/bin:/bin
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

   Then `systemctl --user enable --now yardd` and `loginctl enable-linger $USER`, so it keeps running when you are logged out. Adjust the paths to where you cloned the repo and where `codex`, `claude` and `bun` live.

3. Log the engines in without a browser: `claude setup-token` and `codex login --device-auth`.

4. Make `ssh <destination>` work from your Mac with no prompt: Tailscale SSH (`tailscale up --ssh` on the box) or a key in `~/.ssh/authorized_keys`. Check with `ssh -o BatchMode=yes <destination> true`. Accept the host key once by hand first.

5. In Switchyard, open Hosts, fill in Add host (name, SSH destination such as `devbox` or `user@100.x.y.z`, remote port `47717`), and add it. Its sessions appear in the sidebar with a cloud icon, and the new-session page lets you pick where a session runs.

Hosts are saved in `hosts.json` in yardd's data folder (`~/.yard`).
