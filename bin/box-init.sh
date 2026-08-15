#!/usr/bin/env bash
# Railway container entrypoint (Step 6).
#
# Responsibilities, in order:
#   1. Wire the persistent volume so the Claude login credential and the Serena
#      shared store survive redeploys.
#   2. (Recommended) Join your private Tailscale network for access.
#   3. Start code-server bound to LOOPBACK ONLY, password auth mandatory.
#   4. Publish code-server to your tailnet only — never the public internet.
#
# This script does NOT log in to Claude and does NOT deploy anything — you do the
# interactive `claude auth login` yourself, inside code-server, AFTER lockdown.
set -euo pipefail

VOL="${DATA_DIR:-/data}"          # Railway persistent volume mount point
APP="${APP_DIR:-/app}"            # baked working tree (repo)

echo "[box-init] wiring persistent volume at ${VOL}"
mkdir -p "${VOL}/claude" "${VOL}/serena/memories"

# 1a) Claude login credential dir  ->  ${VOL}/claude  (holds .credentials.json)
if [ -e /root/.claude ] && [ ! -L /root/.claude ]; then
  cp -an /root/.claude/. "${VOL}/claude/" 2>/dev/null || true
  rm -rf /root/.claude
fi
ln -sfn "${VOL}/claude" /root/.claude

# 1b) Claude account/config file  ->  ${VOL}/claude.json
if [ -e /root/.claude.json ] && [ ! -L /root/.claude.json ]; then
  mv -n /root/.claude.json "${VOL}/claude.json" 2>/dev/null || true
fi
[ -e "${VOL}/claude.json" ] || : > "${VOL}/claude.json"
ln -sfn "${VOL}/claude.json" /root/.claude.json

# 1c) Serena project store (lives INSIDE the gitignored working tree) -> volume
#     This is the one a re-clone would wipe; the symlink puts it on the volume.
rm -rf "${APP}/.serena"
ln -sfn "${VOL}/serena" "${APP}/.serena"
echo "[box-init] /root/.claude -> ${VOL}/claude   |   ${APP}/.serena -> ${VOL}/serena"

# 1d) Workspace scaffolding (gitignored runtime state — a rebuilt image has none).
#     The harness also provisions workspace/tsconfig.json at run time (the single
#     source of truth is src/verify/gates.ts), but creating the tree here means a
#     fresh boot is already sane before the first job runs.
mkdir -p "${APP}/workspace/src"
# Defensive belt-and-suspenders for the store split: agents that (mis)resolve the
# Serena project to <workspace> must still land in the REAL store, never a dead
# dir. The authoritative fix is SERENA_PROJECT in src/runner.ts; this symlink is
# cheap insurance for exactly the bug that just bit.
rm -rf "${APP}/workspace/.serena"
ln -sfn "${VOL}/serena" "${APP}/workspace/.serena"
echo "[box-init] ${APP}/workspace/src ready   |   ${APP}/workspace/.serena -> ${VOL}/serena (defensive)"

# 2) Private access via Tailscale (recommended). Only if you supplied an authkey.
if [ -n "${TS_AUTHKEY:-}" ]; then
  echo "[box-init] starting tailscale (userspace networking)"
  mkdir -p /var/run/tailscale "${VOL}/tailscale"
  tailscaled --tun=userspace-networking \
    --state="${VOL}/tailscale/tailscaled.state" \
    --socket=/var/run/tailscale/tailscaled.sock >/tmp/tailscaled.log 2>&1 &
  sleep 2
  tailscale up --authkey="${TS_AUTHKEY}" \
    --hostname="${TS_HOSTNAME:-orchestrator-box}" --ssh \
    || echo "[box-init] WARN: 'tailscale up' failed — check TS_AUTHKEY"
else
  echo "[box-init] WARN: TS_AUTHKEY not set — private Tailscale access is OFF."
  echo "[box-init]        Reach code-server ONLY via an SSH tunnel; do NOT attach"
  echo "[box-init]        a public Railway domain to port 8080 (see docs/RAILWAY-STEP6.md)."
fi

# 3) code-server — password auth is MANDATORY; refuse to start without it.
if [ -z "${PASSWORD:-}${HASHED_PASSWORD:-}" ]; then
  echo "[box-init] FATAL: set a strong PASSWORD (or HASHED_PASSWORD) before boot." >&2
  echo "[box-init]        code-server will not start without it." >&2
  exit 1
fi
export PASSWORD HASHED_PASSWORD
echo "[box-init] starting code-server on 127.0.0.1:8080 (auth=password, loopback only)"
code-server --bind-addr 127.0.0.1:8080 --auth password "${APP}" &
CS_PID=$!

# 4) Publish code-server to your TAILNET ONLY (authenticated devices, HTTPS).
if [ -n "${TS_AUTHKEY:-}" ]; then
  sleep 3
  tailscale serve --bg --https=443 http://127.0.0.1:8080 \
    || echo "[box-init] WARN: 'tailscale serve' failed — reach code-server via the box's tailscale IP:8080."
fi

wait "${CS_PID}"
