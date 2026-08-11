# Railway dev box — setup

The interactive coding environment from `BUILD_PLAN.md` §7: one Railway
service, built from this repo's `Dockerfile`, that clones `chewinkk/backdrop`
onto a persistent volume and runs its dev server. You shell into it via
Railway's Console/SSH and run `claude` there — it's already installed in the
image.

This is a different thing from the separate Railway project described in
`chewinkk/backdrop`'s `docs/railway-workflow-env.md`. That one auto-deploys
`backdrop` on every push, built by Nixpacks from `backdrop`'s own
`railway.json`. This one is a standing dev environment, built by Docker from
*this* repo, that you work inside interactively — it doesn't auto-deploy
anything on push.

## Required env vars

| Var | Why it's required |
|---|---|
| `GITHUB_TOKEN` | A GitHub personal access token with read access to `chewinkk/backdrop` (it's private — a plain clone fails without auth). `start.sh` uses it to clone on first boot. Fine-grained PAT, read-only on that one repo, is enough. |
| `ANTHROPIC_API_KEY` | Lets `claude` authenticate non-interactively inside the container. Without it, you'd need to run `claude auth login` by hand on every fresh container (volumes don't persist Claude Code's own auth state unless you point its config dir at the volume too). |

## Required infrastructure

- **A persistent Volume**, mounted at `/data`. Without this, the container filesystem is wiped on every redeploy/crash/restart, and `backdrop` gets re-cloned from scratch each time — uncommitted work in it is lost. `start.sh` clones into `/data/backdrop` by default (override with the `REPO_DIR` env var if you mount somewhere else).

## Connect steps

1. Create a new Railway service, connect it to GitHub repo `chewinkk/workflow`.
2. It should auto-detect the Dockerfile via this repo's `railway.json` (`"builder": "DOCKERFILE"`) — if Railway still tries Nixpacks/Railpack instead, set the builder to Dockerfile manually in the service's settings.
3. Add a Volume, mount path `/data`.
4. Set `GITHUB_TOKEN` and `ANTHROPIC_API_KEY`.
5. Deploy. First boot clones `backdrop` (takes a minute or two); the dev server then starts on Railway's assigned `$PORT`, and Railway routes its public domain to it.

## Using it

- Open Railway's **Console** (or `Copy SSH command` into your own terminal).
- `cd /data/backdrop` — that's the live clone the dev server is running from.
- Run `claude` there to work on `backdrop` interactively. Edits + the running `next dev` process share the same filesystem, so changes show up live at the service's public URL (HMR).
- **Commit and push from inside the container** when you're done — the container and its volume are both disposable; git is the only durable record of the work.

## What this does NOT do

- Doesn't auto-deploy `backdrop` anywhere — that's the separate `railway-workflow-env.md` service.
- Doesn't restart the dev server when you `git pull` inside the container — restart the service (or the process) yourself after pulling upstream changes.
- Doesn't give `workflow`'s own repo a running app — this container's whole point is to run `backdrop` from a clone, not to serve `workflow` itself.
