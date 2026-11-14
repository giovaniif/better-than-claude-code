# Switchyard web: yardd, the UI, the compiled Claude sidecar and pinned
# `codex`, `claude` and `gh` CLIs in one image. There is no sign-in: anyone who
# can reach the port can run commands in the container. Serve it only on a
# private network. See "Web version" in README.md.
#
#   docker build -t switchyard .
#   docker run -p 127.0.0.1:47717:47717 -e YARD_ALLOW_ORIGIN=http://localhost:47717 switchyard

ARG DEBIAN=trixie

# --- yardd -------------------------------------------------------------------
FROM rust:1-slim-${DEBIAN} AS yardd
# build.rs stamps this into /health. .git is not in the build context.
ARG YARD_BUILD_ID=docker
ENV YARD_BUILD_ID=${YARD_BUILD_ID}
WORKDIR /src
# app/src-tauri is a workspace member, so its manifest must be present for
# `-p yardd` to resolve. Only yardd is compiled: no Tauri or WebKit deps.
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY app/src-tauri app/src-tauri
# yardd compiles the remote installer in (include_str!).
COPY scripts/remote-install.sh scripts/remote-install.sh
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p yardd \
    && cp target/release/yardd /usr/local/bin/yardd

# --- UI and Claude sidecar ----------------------------------------------------
FROM oven/bun:1.4.4-debian AS web
WORKDIR /src
COPY ui/package.json ui/bun.lock ui/
RUN cd ui && bun install --frozen-lockfile
COPY sidecar/yard-claude/package.json sidecar/yard-claude/bun.lock sidecar/yard-claude/
RUN cd sidecar/yard-claude && bun install --frozen-lockfile
COPY ui ui
RUN cd ui && bunx vite build
COPY sidecar sidecar
# One binary with the Bun runtime inside, so the runtime image needs no Bun.
RUN cd sidecar/yard-claude && bun build --compile src/main.ts --outfile /out/yard-claude

# --- runtime -----------------------------------------------------------------
FROM node:24-${DEBIAN}-slim
# Defaults are the versions the image was last checked with. codex app-server
# is experimental, so move these on purpose, not by floating.
ARG CODEX_VERSION=0.164.0
ARG CLAUDE_VERSION=2.1.325

# gh comes from GitHub's apt repository. The last line makes git over HTTPS to
# GitHub use gh's login or GH_TOKEN.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bash ca-certificates curl git gnupg openssh-client procps tini \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system credential.https://github.com.helper '!/usr/bin/gh auth git-credential'

RUN npm install -g "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_VERSION}" \
    && npm cache clean --force

# The node image's uid 1000 user, renamed. Its home is meant to be a volume:
# it holds the engine logins (~/.claude, ~/.codex, ~/.config/gh), git config
# and yardd's database and worktrees (~/.yard).
RUN usermod -l yard -d /home/yard -m node \
    && groupmod -n yard node \
    && install -d -o yard -g yard /workspace

COPY --from=yardd /usr/local/bin/yardd /usr/local/bin/yardd
COPY --from=web /src/ui/dist /opt/switchyard/ui/dist
COPY --from=web /out/yard-claude /opt/switchyard/yard-claude

# DISABLE_AUTOUPDATER: the CLIs are pinned and installed as root; an update
# attempt as `yard` would only fail.
# YARD_CODEX_SANDBOX: Codex's own sandbox (bubblewrap) cannot create
# namespaces in an unprivileged container, so every command would fail. The
# container is the boundary instead. Approvals are still on-request.
ENV YARD_BIND=0.0.0.0 \
    YARD_CODEX_SANDBOX=danger-full-access \
    YARD_PORT=47717 \
    YARD_ROOT=/opt/switchyard \
    YARD_SIDECAR=/opt/switchyard/yard-claude \
    SHELL=/bin/bash \
    HOME=/home/yard \
    LANG=C.UTF-8 \
    DISABLE_AUTOUPDATER=1

USER yard
WORKDIR /workspace
VOLUME ["/home/yard", "/workspace"]
EXPOSE 47717

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${YARD_PORT}/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["yardd"]
