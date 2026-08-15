# Orchestrator box image (Step 6): an interactive Railway host you shell into,
# authenticated against your Max SUBSCRIPTION via `claude auth login` — no API key.
#
# Contents (per read-back): Node 22, the `claude` CLI, Serena BAKED at build time
# (pinned — no runtime PyPI), code-server (browser IDE/terminal), Tailscale
# (recommended private access), git.
#
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

# --- OS deps -------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip git curl ca-certificates openssh-client iproute2 \
    && rm -rf /var/lib/apt/lists/*

# --- Claude Code CLI -----------------------------------------------------
# Subscription auth happens at runtime (`claude auth login`), not here.
# Pin CLAUDE_CODE_VERSION for full reproducibility if you want.
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && claude --version

# --- Serena BAKED at build, version PINNED (Requirement 1) ---------------
# Installed into a venv now, so runs never fetch serena-agent from PyPI at
# runtime. `serena` is placed on PATH; bin/serena-mcp.sh uses it directly.
ARG SERENA_VERSION=1.7.0
RUN python3 -m venv /opt/serena \
    && /opt/serena/bin/pip install --no-cache-dir "serena-agent==${SERENA_VERSION}" \
    && ln -s /opt/serena/bin/serena /usr/local/bin/serena \
    && serena --version
# NOTE: Serena's optional LSP language-server binaries are a SEPARATE lazy
# download that our memory-only store usage never triggers. If your Railway
# network policy is fully closed and you want zero runtime fetches guaranteed,
# pre-warm them at build here (see docs/RAILWAY-STEP6.md § Serena language servers).

# --- code-server (browser IDE + interactive terminal), PINNED ------------
ARG CODE_SERVER_VERSION=4.96.4
RUN curl -fsSL https://code-server.dev/install.sh | sh -s -- --version "${CODE_SERVER_VERSION}"

# --- Tailscale (recommended private access; only used if TS_AUTHKEY set) --
RUN curl -fsSL https://tailscale.com/install.sh | sh

# --- App -----------------------------------------------------------------
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN chmod +x bin/box-init.sh bin/serena-mcp.sh bin/box-verify.sh

# code-server listens on 127.0.0.1:8080 (loopback only — reached via your Tailnet).
# Deliberately NO `EXPOSE` and NO public port: EXPOSE can prompt Railway to
# auto-generate a public domain, which is exactly what we must avoid. Reach the
# box only over Tailscale (or an SSH tunnel). See docs/RAILWAY-STEP6.md.
ENTRYPOINT ["bin/box-init.sh"]
