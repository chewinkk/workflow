# Orchestrator

A multi-agent build orchestrator that itself builds web apps. Built in the
**gated order of the spec's §9** — one layer at a time, proving each gate
before adding the next.

> This repo is the *orchestrator*, not the app it builds. The first job fed
> through it (`jobs/liquid-glass-auth.yaml`) is the vertical slice that proves
> the machine.

## Status

- ✅ **Step 1 — Bare loop.** Planner → Executor → Reviewer, one model each
  (§8). No shared store, no swarm, no council, no verification loop.
  *Gate: an agent finishes, hands off, and the next picks up.*
- ✅ **Step 2 — Shared store (Serena).** Base loop is now
  Explorer → Planner → Executor → Reviewer, mediated by the Serena-backed
  store (§3). Each stage reads/writes its slice (`goal`, `explored`, `plan`,
  `done`, `blocked`) via Serena MCP instead of passing raw text hand-to-hand.
  *Gate: the Executor pulls `plan` from the store and re-derives nothing —
  proven by logging every tool each agent actually calls.*
- ✅ **Step 3 — Verification (§7).** The Executor writes REAL files to a
  gitignored `workspace/`; `src/verify/build-test-fix.ts` actually runs the
  code (real `tsc` build + `node --test`), and on failure bounces the real
  stderr back to an Executor-fix pass that edits the files, then re-runs —
  escalating to the Planner after `MAX_BOUNCES`.
  *Gate: a deliberately broken build (`--seed-break`) is caught from real
  stderr and fixed with no human help; the re-run goes green.*
- ✅ **Step 4 — Fan-out + Reconciler (§6/§2).** After the Planner the pipeline
  fans out into **Frontend** + **Backend** specialists (agency-agents roster
  personalities, vendored under `agents/roster/`) running in parallel and
  **blind** — each reads only `goal`+`plan`, builds its half to
  `workspace/{client,server}`, and declares its own auth payload contract into
  its slice. The **Reconciler** (`engineering-senior-developer`) reads both and
  flags the seams.
  *Gate: the Reconciler catches a real payload-contract seam no single-side
  reviewer could — natural divergence when it arises, else a `--diverge`
  fallback injects one.*
- ✅ **Step 5 — LLM Council (§6).** When a plan is consequential (`council:true`),
  four critics (Contrarian, First-Principles, Expansionist, Outsider) fire in
  parallel with fresh context, **blind to each other**, all reading only
  `goal`+`plan`; the **Judge** (Opus 4.8) runs last with all four verdicts and
  **rules without hedging**, writing its ruling to `council` and the revised
  plan back to `plan`. Fresh `.md` prompts under `src/council/roles/` — not
  roster hires. Critics: Sonnet 5.
  *Gate: the Council produces a real ruling that changes the plan slice and the
  Judge doesn't split the difference.*
- 🚧 **Step 6 — Railway deploy (artifacts staged; not deployed).** An interactive
  box you shell into via code-server and authenticate against your Max
  subscription (`claude auth login`) — no API key. Serena is baked into the image
  (pinned), and a `/data` persistent volume covers the Claude login credential
  (`/root/.claude` + `/root/.claude.json`) and the Serena store (`/app/.serena`).
  code-server is loopback-only behind Tailscale + mandatory password. See
  `docs/RAILWAY-STEP6.md`. *Deploy, volume attach, and login are performed by the
  operator; nothing here deploys on its own.*
- ⬜ Step 6 — Railway deploy

## Run it

```bash
npm install
npm run orchestrate -- build jobs/liquid-glass-auth.yaml
# prove the Step 3 verification loop by injecting a deliberate build break:
npm run orchestrate -- build jobs/liquid-glass-auth.yaml --seed-break
```

Each pipeline role runs as a headless `claude` call: its system prompt is the
plain `agents/<role>.md` file, its model comes from `src/models.ts` (§8), and —
as of Step 2 — it reads its input slice(s) and writes its output slice through
the **Serena MCP shared store** rather than being handed raw text. No API key is
needed inside Claude Code — it uses the ambient auth.

### The shared store (Serena)

Serena runs as an MCP server (`mcp/serena.config.json`), installed on demand via
`uvx --from serena-agent`. The store slices are Serena *memories*, persisted at
`.serena/memories/<slice>.md` (gitignored — runtime state). Agents reach them
with `read_memory`/`write_memory`; the orchestrator seeds `goal` and reads
slices back through `src/store/client.ts`. Same files, one source of truth (§3).

The Step 2 gate is enforced in code: the orchestrator captures **every tool each
agent calls** (via `--output-format stream-json`) and asserts the Executor read
`plan` from the store and re-opened neither `explored` nor the repo.

## Layout (through Step 2)

```
src/
  index.ts            CLI: orchestrate build <job.yaml>
  orchestrator.ts     the loop; logs every source each agent reads (the gate)
  runner.ts           runs one role headless, wired to Serena MCP, captures tool calls
  models.ts           model per role (§8) — one place to tune
  store/
    schema.ts         the five slices + who reads/writes each (§3)
    client.ts         thin Serena-backed store client (orchestrator side)
  verify/
    build-test-fix.ts real build+test loop; bounces real stderr to the Executor (§7)
    gates.ts          workspace build config + recursive .ts discovery
    seed-break.ts     deliberate fault injection for the Step 3 gate
  swarm/
    fanout.ts         blind parallel Frontend/Backend specialists (§6/§2)
    reconciler.ts     integration pass; flags payload-contract seams
  council/
    council.ts        4 blind critics ∥ + a Judge that rules (§6)
    roles/*.md        Contrarian, First-Principles, Expansionist, Outsider, Judge
  pipeline/{explorer,planner,executor,reviewer}.ts
agents/{explorer,planner,executor,reviewer}.md   pipeline agent prompts (plain, deletable)
agents/roster/*.md                               vendored agency-agents personalities (§5)
mcp/serena.config.json                           Serena MCP server wiring
jobs/liquid-glass-auth.yaml                       the first job
workspace/                                        (gitignored) where specialists build
```

### Note on the §5 roster

Half of the agent names in the spec's §5 don't exist in the real `agency-agents`
roster (they were written from design notes). Every hire is verified against the
cloned roster before use; confirmed substitutions so far:
`minimal-change-engineer`→`engineering-senior-developer`,
`specialized-codebase-archaeologist` (Reconciler)→`engineering-senior-developer`.
The npm `agency-agents` package is an empty stub — the roster lives in the
GitHub repo (`git clone`, then copy `.md` files).
