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
- ⬜ Step 3 — Verification (Reviewer runs the code)
- ⬜ Step 4 — Fan-out + Reconciler
- ⬜ Step 5 — LLM Council
- ⬜ Step 6 — Railway deploy

## Run it

```bash
npm install
npm run orchestrate -- build jobs/liquid-glass-auth.yaml
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
  pipeline/{explorer,planner,executor,reviewer}.ts
agents/{explorer,planner,executor,reviewer}.md   agent prompts (plain, deletable)
mcp/serena.config.json                           Serena MCP server wiring
jobs/liquid-glass-auth.yaml                       the first job
```
