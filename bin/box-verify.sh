#!/usr/bin/env bash
# Step 6 — lockdown VERIFY + converge. Run this on the box, in the Railway shell
# (the code-server terminal, or `railway ssh`). It is idempotent and safe to run
# repeatedly.
#
# It does NOT log in, and it exposes nothing. The container entrypoint
# (bin/box-init.sh) already performed the locked-down bring-up at boot; this
# script confirms every lock is in place, converges anything missing (without
# ever double-starting code-server), then STOPS and hands you the two manual
# steps: verify the door is locked, then run `claude auth login` yourself.
set -uo pipefail   # not -e: we want to report every check, not abort on the first miss

VOL="${DATA_DIR:-/data}"
APP="${APP_DIR:-/app}"
PASS=0; FAIL=0
ok(){ printf '  \033[32m[ OK ]\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
no(){ printf '  \033[31m[FAIL]\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
step(){ printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "1/5  Persistent-volume symlinks (idempotent re-assert)"
mkdir -p "$VOL/claude" "$VOL/serena/memories"
ln -sfn "$VOL/claude" /root/.claude
[ -s "$VOL/claude.json" ] || printf '{}\n' > "$VOL/claude.json"   # valid JSON, not empty
ln -sfn "$VOL/claude.json" /root/.claude.json
[ -L "$APP/.serena" ] || { rm -rf "$APP/.serena"; ln -sfn "$VOL/serena" "$APP/.serena"; }
[ "$(readlink /root/.claude)" = "$VOL/claude" ]           && ok "/root/.claude -> $VOL/claude"           || no "/root/.claude symlink wrong"
[ "$(readlink /root/.claude.json)" = "$VOL/claude.json" ] && ok "/root/.claude.json -> $VOL/claude.json" || no "/root/.claude.json symlink wrong"
[ "$(readlink "$APP/.serena")" = "$VOL/serena" ]          && ok "$APP/.serena -> $VOL/serena"            || no "$APP/.serena symlink wrong"

step "2/5  Serena baked at build (no runtime PyPI)"
if command -v serena >/dev/null 2>&1; then
  ok "serena on PATH: $(command -v serena)"
  serena --version 2>/dev/null | sed 's/^/         /' || true
else
  no "serena NOT on PATH — image did not bake it; runs would fall back to network"
fi

step "3/5  Tailscale (private access)"
if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
  ok "tailscale is up"
  tailscale status 2>/dev/null | head -1 | sed 's/^/         /'
  if tailscale serve status >/dev/null 2>&1; then
    ok "code-server published to your tailnet (tailscale serve active)"
  else
    no "tailscale serve not active — reach code-server via the box's tailscale IP:8080, or fix serve (see notes)"
  fi
else
  no "tailscale not up — set TS_AUTHKEY in Railway and redeploy (or: tailscale up --authkey=<key> --ssh)"
fi

step "4/5  code-server: password required, LOOPBACK only, not public"
if [ -z "${PASSWORD:-}${HASHED_PASSWORD:-}" ]; then
  no "neither PASSWORD nor HASHED_PASSWORD is set — set one in Railway (code-server must never run without it)"
fi
LISTEN="$(ss -tlnH 2>/dev/null | awk '{print $4}' | grep ':8080$' || true)"
if [ -z "$LISTEN" ]; then
  if [ -n "${PASSWORD:-}${HASHED_PASSWORD:-}" ]; then
    echo "         code-server not listening — starting it loopback-only..."
    nohup code-server --bind-addr 127.0.0.1:8080 --auth password "$APP" >/tmp/code-server.log 2>&1 &
    sleep 3
    LISTEN="$(ss -tlnH 2>/dev/null | awk '{print $4}' | grep ':8080$' || true)"
  else
    no "cannot start code-server without a password"
  fi
fi
printf '         listeners on :8080 ->\n'; printf '           %s\n' ${LISTEN:-"(none)"}
echo "$LISTEN" | grep -q '^127\.0\.0\.1:8080$'                        && ok "listening on 127.0.0.1:8080 (loopback)"          || no "not bound to loopback"
if echo "$LISTEN" | grep -qE '^(0\.0\.0\.0|\*|\[::\]):8080$'; then no "ALSO listening on a public interface — DO NOT LOGIN; fix --bind-addr to 127.0.0.1"; else ok "no non-loopback :8080 listener on the box"; fi

step "5/5  Result"
printf '  checks passed: %s   failed: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '\n  \033[31mOne or more locks are not in place. Fix the FAILs above BEFORE logging in.\033[0m\n'
fi

cat <<'NEXT'

────────────────────────────────────────────────────────────────────────────
STOP — the box is locked down on its side. This script did NOT log you in.
Now do these TWO manual steps yourself, in order:

 (a) VERIFY THE DOOR IS LOCKED
     • Railway dashboard → your service → Settings → Networking:
       confirm there is NO Public Networking domain (none generated).
     • Confirm you can open code-server ONLY over Tailscale
       (https://<box-hostname>.<your-tailnet>.ts.net/) and that a device NOT on
       your tailnet cannot reach it at all.
     • code-server must prompt for your password.

 (b) LOG IN — only after (a) passes. In this terminal:
       claude auth status     # expect: logged out
       claude auth login      # complete the browser OAuth (your Max account)
       claude auth status      # expect: logged in

 Then run a job:
       cd /app && npm run orchestrate -- build jobs/liquid-glass-auth.yaml
────────────────────────────────────────────────────────────────────────────
NEXT
