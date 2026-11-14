# Web version

The same Switchyard as a web page, in one container: yardd, the UI, the compiled Claude sidecar and pinned `codex`, `claude`, `gh` and `git`. Run it on a server and open it from any browser.

> **There is no sign-in.** Anyone who can reach the page can run any command in the container, as you, with your Claude, Codex and GitHub logins. Serve it only on a private network, such as a Tailscale tailnet, a VPN or a LAN you trust. Never put it on a public domain or open port.

## On Coolify

1. New resource > **Docker Compose**: either from the public repository `https://github.com/giovaniif/better-than-claude-code` (it picks up `docker-compose.yml` and can build the image itself), or **Empty Docker Compose** with the contents of [docker-compose.yml](docker-compose.yml) pasted (that pulls `ghcr.io/giovaniif/switchyard:latest`).
2. Set the service's domain to `https://<name>:47717`, for example `https://yard.example.com:47717`. The `:47717` tells Coolify's proxy which container port to route to; the page itself is served on 443.
3. Set `YARD_ALLOW_ORIGIN` to the URL you will open, without the port: `https://yard.example.com`. The WebSocket refuses every other browser origin, so the page shows "disconnected" until this matches. Several URLs can be listed, comma separated.
4. Optional: `YARD_HOST_NAME` (the name the UI shows for the machine, default `switchyard`), `GH_TOKEN` (for the PR pane and `git` over HTTPS) and `CLAUDE_CODE_OAUTH_TOKEN` (see below).
5. Deploy, open the URL, and log the engines in once from a session's terminal (they are saved in the home volume):
   - Codex: `codex login --device-auth`.
   - Claude: run `claude` and log in, or run `claude setup-token` anywhere and put the token in `CLAUDE_CODE_OAUTH_TOKEN`.
   - GitHub: `gh auth login`, unless `GH_TOKEN` is set. Also `git config --global user.name ...` and `user.email ...` for commits.

## With Docker Compose

```bash
YARD_ALLOW_ORIGIN=http://localhost:47717 docker compose up -d
```

Uncomment the `ports:` lines in `docker-compose.yml` first. They publish on `127.0.0.1` only; reach it from elsewhere through an SSH forward or a private interface, never `0.0.0.0` on a public machine. `docker compose build` builds the image from this checkout instead of pulling it.

## Projects

The container sees only its own disk. Projects get in one of three ways:

- The `/workspace` volume: `git clone` into it from a session's terminal, then pick it with the folder button on the new-session page (the picker starts at the home folder, `/home/yard`).
- A bind mount of a folder on the server: replace the `switchyard-workspace:/workspace` line with, say, `/srv/projects:/workspace`. Files there must be writable by uid 1000, the container's user.
- Anywhere under `/home/yard`, which is also a volume.

Worktrees and sessions live in `/home/yard/.yard`. Both volumes survive redeploys; deleting them loses the logins and sessions.

## Notes

- The image is built by `.github/workflows/docker.yml` on every push to `main` (`latest` and the short commit). A new GitHub package is private: make it public in the package settings, or log Coolify in to `ghcr.io`, before pasting the compose file.
- The engine versions are build arguments: `docker build --build-arg CODEX_VERSION=... --build-arg CLAUDE_VERSION=... .`. They are pinned on purpose, since `codex app-server` is experimental.
- In the container yardd listens on `0.0.0.0` (`YARD_BIND`). Everywhere else it stays on loopback.
- Codex runs with no sandbox of its own in the container (`YARD_CODEX_SANDBOX=danger-full-access`): its Linux sandbox needs namespaces that an unprivileged container does not get, so every command would fail. The container is the boundary, and Codex still asks before what it thinks needs approval. Set `YARD_CODEX_SANDBOX=workspace-write` to go back to the desktop default, for example on a container you run with relaxed seccomp and AppArmor.
