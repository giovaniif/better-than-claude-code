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

1. On the box, install `codex`, `claude`, Bun, Rust and git, and clone this repo.

2. Run `scripts/install-host.sh` from the clone. It builds yardd, the compiled Claude sidecar and the UI, copies them to `~/.local/share/switchyard` (so cleaning the checkout cannot break the service), writes a systemd user unit `yardd.service` with your login shell's `PATH`, enables lingering so it runs while you are logged out, and checks `/health` on `127.0.0.1:47717`. Rerun it to update. Logs: `journalctl --user -u yardd`.

3. Log the engines in without a browser: `claude setup-token` and `codex login --device-auth`.

4. Make `ssh <destination>` work from your Mac with no prompt: Tailscale SSH (`tailscale up --ssh` on the box) or a key in `~/.ssh/authorized_keys`. Check with `ssh -o BatchMode=yes <destination> true`. Accept the host key once by hand first.

5. In Switchyard, open Hosts, fill in Add host (name, SSH destination such as `devbox` or `user@100.x.y.z`, remote port `47717`), and add it. Its sessions appear in the sidebar with a cloud icon, and the new-session page lets you pick where a session runs.

Hosts are saved in `hosts.json` in yardd's data folder (`~/.yard`).

## Web version

The same Switchyard as a web page, in one container: yardd, the UI, the compiled Claude sidecar and pinned `codex`, `claude`, `gh` and `git`. Run it on a server and open it from any browser.

> **There is no sign-in.** Anyone who can reach the page can run any command in the container, as you, with your Claude, Codex and GitHub logins. Serve it only on a private network, such as a Tailscale tailnet, a VPN or a LAN you trust. Never put it on a public domain or open port.

### On Coolify

1. New resource > **Docker Compose**: either from the public repository `https://github.com/giovaniif/better-than-claude-code` (it picks up `docker-compose.yml` and can build the image itself), or **Empty Docker Compose** with the contents of [docker-compose.yml](docker-compose.yml) pasted (that pulls `ghcr.io/giovaniif/switchyard:latest`).
2. Set the service's domain to `https://<name>:47717`, for example `https://yard.example.com:47717`. The `:47717` tells Coolify's proxy which container port to route to; the page itself is served on 443.
3. Set `YARD_ALLOW_ORIGIN` to the URL you will open, without the port: `https://yard.example.com`. The WebSocket refuses every other browser origin, so the page shows "disconnected" until this matches. Several URLs can be listed, comma separated.
4. Optional: `YARD_HOST_NAME` (the name the UI shows for the machine, default `switchyard`), `GH_TOKEN` (for the PR pane and `git` over HTTPS) and `CLAUDE_CODE_OAUTH_TOKEN` (see below).
5. Deploy, open the URL, and log the engines in once from a session's terminal (they are saved in the home volume):
   - Codex: `codex login --device-auth`.
   - Claude: run `claude` and log in, or run `claude setup-token` anywhere and put the token in `CLAUDE_CODE_OAUTH_TOKEN`.
   - GitHub: `gh auth login`, unless `GH_TOKEN` is set. Also `git config --global user.name ...` and `user.email ...` for commits.

### With Docker Compose

```bash
YARD_ALLOW_ORIGIN=http://localhost:47717 docker compose up -d
```

Uncomment the `ports:` lines in `docker-compose.yml` first. They publish on `127.0.0.1` only; reach it from elsewhere through an SSH forward or a private interface, never `0.0.0.0` on a public machine. `docker compose build` builds the image from this checkout instead of pulling it.

### Projects

The container sees only its own disk. Projects get in one of three ways:

- The `/workspace` volume: `git clone` into it from a session's terminal, then pick it with the folder button on the new-session page (the picker starts at the home folder, `/home/yard`).
- A bind mount of a folder on the server: replace the `switchyard-workspace:/workspace` line with, say, `/srv/projects:/workspace`. Files there must be writable by uid 1000, the container's user.
- Anywhere under `/home/yard`, which is also a volume.

Worktrees and sessions live in `/home/yard/.yard`. Both volumes survive redeploys; deleting them loses the logins and sessions.

### Notes

- The image is built by `.github/workflows/docker.yml` on every push to `main` (`latest` and the short commit). A new GitHub package is private: make it public in the package settings, or log Coolify in to `ghcr.io`, before pasting the compose file.
- The engine versions are build arguments: `docker build --build-arg CODEX_VERSION=... --build-arg CLAUDE_VERSION=... .`. They are pinned on purpose, since `codex app-server` is experimental.
- In the container yardd listens on `0.0.0.0` (`YARD_BIND`). Everywhere else it stays on loopback.
- Codex runs with no sandbox of its own in the container (`YARD_CODEX_SANDBOX=danger-full-access`): its Linux sandbox needs namespaces that an unprivileged container does not get, so every command would fail. The container is the boundary, and Codex still asks before what it thinks needs approval. Set `YARD_CODEX_SANDBOX=workspace-write` to go back to the desktop default, for example on a container you run with relaxed seccomp and AppArmor.
