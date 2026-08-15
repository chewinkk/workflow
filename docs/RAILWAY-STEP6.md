# Step 6 — Railway box (subscription auth, hardened) — first-boot runbook

This box is deployed so you can **shell into it in the browser** (code-server) and
authenticate it against your **Max subscription** with `claude auth login` — **no
API key**, subscription pricing. Serena is **baked into the image at build time
(pinned `serena-agent==1.7.0`)**, so runs never fetch from PyPI at runtime.

> **You perform every step below.** These artifacts do not deploy anything, do not
> create the Railway service, do not attach the volume, and do not log in. The
> steps that need your credentials or a browser are marked **[YOU]**.

---

## What the volume must cover (mount layout)

Attach **one Railway persistent volume mounted at `/data`**. On boot,
`bin/box-init.sh` wires these onto it (idempotent, survives redeploys):

| Persisted thing | Path on box | → Volume path |
|---|---|---|
| Claude login credential dir (holds `.credentials.json`) | `/root/.claude` | `/data/claude` |
| Claude account/config file | `/root/.claude.json` | `/data/claude.json` |
| Serena shared store (the Step-2 slices, inside the gitignored working tree) | `/app/.serena` | `/data/serena` |
| Tailscale state (if used) | — | `/data/tailscale` |

The **app code stays baked in the image** at `/app` (so a redeploy ships fresh
code); only the credential and the store live on the volume. The Serena store is
the trap we flagged — it lives *inside* `/app/.serena` which is gitignored, so the
symlink to `/data/serena` is what keeps your shared memory from being wiped.

---

## Order of operations — LOCK DOWN, THEN LOG IN

Do these in order. **Do not run `claude auth login` (Step 7) until Steps 1–6 are
done** — that terminal will be logged into your subscription with root shell on a
box that can spend your plan.

### 1. [YOU] Create the Railway service from this repo
- New Railway project → deploy this repo. Railway reads `railway.json` and builds
  the `Dockerfile`. **Do not add a public domain / HTTP route to the service.**
  (Railway only exposes a port publicly if you attach a domain or TCP proxy —
  leaving it unattached is what keeps code-server off the internet.)

### 2. [YOU] Attach the persistent volume
- Add a volume to the service, **mount path `/data`**. (This is the only volume;
  it covers all four rows in the table above.)

### 3. [YOU] Set the code-server password — the floor, and it is mandatory
- Set a Railway service variable **`PASSWORD`** to a long random string
  (e.g. `openssl rand -base64 32`), **or** better, **`HASHED_PASSWORD`** to an
  argon2 hash so the plaintext never lives in env
  (`echo -n 'yourpass' | npx argon2-cli -e`).
- `bin/box-init.sh` **refuses to start code-server** if neither is set — a strong
  password is a hard requirement, not a suggestion.

### 4. [YOU] Set up private access — recommended: Tailscale (keep it off the open internet)
code-server is bound to **`127.0.0.1:8080` (loopback only)** — it never listens on
a public interface. You reach it privately one of two ways:

- **Recommended — Tailscale.** In your Tailscale admin, generate an **auth key**
  (ephemeral + reusable is fine) and set it as the Railway variable **`TS_AUTHKEY`**
  (optionally `TS_HOSTNAME`). On boot the box joins *your* tailnet and runs
  `tailscale serve` to publish code-server over HTTPS to your authenticated
  devices only — **zero public exposure, no inbound port** (the box dials out).
  You then open `https://<box-name>.<your-tailnet>.ts.net/` from a device on your
  tailnet.
  - *Why this over a password-only public URL:* identity-based network access means
    the login page is not even reachable by the internet — password + tailnet is
    two independent gates, and a leaked password alone buys nothing.
- **Alternative — SSH tunnel, no Tailscale.** Leave `TS_AUTHKEY` unset. Reach the
  loopback port with `railway ssh` (or `railway run`) forwarding
  `localhost:8080` → the box's `127.0.0.1:8080`. Still never attach a public domain.
- **Not recommended:** attaching a public Railway domain to port 8080 and relying
  on the code-server password alone. That puts an auth page on the open internet.
  If you ever do this, it must be in addition to — not instead of — a strong
  `HASHED_PASSWORD`, and ideally behind an auth proxy (e.g. Cloudflare Access).

### 5. [YOU] Deploy, and watch the boot log
- Deploy. In the logs you should see `box-init` wire the volume symlinks
  (`/root/.claude -> /data/claude`, `/app/.serena -> /data/serena`), Tailscale come
  up (if used), and `code-server ... 127.0.0.1:8080`.

### 6. [YOU] Verify it is NOT publicly reachable — before you log in
- Confirm the service has **no public domain** attached in Railway.
- From a device **not** on your tailnet, confirm there is no reachable URL.
- Open code-server via Tailscale (or the SSH tunnel) and confirm it **prompts for
  the password**. Only proceed once this is true.

### 7. [YOU] NOW log in to your subscription — interactive
- In the code-server terminal:
  ```
  claude auth status      # expect: logged out
  claude auth login       # opens browser OAuth — authenticate your Max account
  claude auth status      # expect: logged in
  ```
  There is **no API key**; this is the subscription login. It writes
  `/root/.claude/.credentials.json`, which is on the volume.

### 8. [YOU] Prove persistence
- `ls -la /data/claude/` should show the credential; `ls -la /data/serena/memories/`
  will fill in after your first run.
- Trigger a redeploy, then `claude auth status` again — you should **still be
  logged in** (no re-login), confirming the volume covers the credential.

### 9. [YOU] Run a job — the one-off exec model (still a CLI)
- In the code-server terminal:
  ```
  cd /app
  npm run orchestrate -- build jobs/liquid-glass-auth.yaml
  ```
- No HTTP endpoint, no cron — you trigger a run by shelling in and invoking the
  CLI, exactly as locally. The Serena store at `/app/.serena` (→ `/data/serena`)
  persists across runs and redeploys.

---

## Serena language servers (only if your network policy is fully closed)

Serena's *package* is fully baked. Serena also has optional **LSP language-server**
binaries it downloads lazily **only when code-navigation tools are used** — which
this orchestrator never does (it uses Serena purely for the memory store, and the
specialists write files with Claude's own tools). So a normal run needs no runtime
fetch. If your Railway egress is locked down and you want a hard guarantee of zero
runtime downloads, pre-warm them at build by adding a warm step to the `Dockerfile`
after the Serena install (documented inline there); otherwise leave it off to keep
the image small.

---

## Quick reference — what needs YOUR credentials / an interactive step

- Creating the Railway service + **not** attaching a public domain — **[YOU]**
- Attaching the `/data` volume — **[YOU]**
- `PASSWORD`/`HASHED_PASSWORD` and `TS_AUTHKEY` (from your Tailscale) — **[YOU]**
- Verifying no public reachability — **[YOU]**
- `claude auth login` browser OAuth against your Max subscription — **[YOU]**

The image, `railway.json`, `bin/box-init.sh`, and `bin/serena-mcp.sh` are the only
moving parts on our side; everything account-, secret-, and login-related is yours.
