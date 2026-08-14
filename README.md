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
- ⬜ Step 2 — Shared store (Serena)
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
plain `agents/<role>.md` file, its model comes from `src/models.ts` (§8), and
the previous stage's output is handed to it as input. No API key is needed
inside Claude Code — it uses the ambient auth.

## Layout (Step 1)

```
src/
  index.ts            CLI: orchestrate build <job.yaml>
  orchestrator.ts     the loop; logs each handoff (the Step 1 gate)
  runner.ts           runs one role as a headless `claude` call
  models.ts           model per role (§8) — one place to tune
  pipeline/{planner,executor,reviewer}.ts
agents/{planner,executor,reviewer}.md   agent prompts (plain, deletable)
jobs/liquid-glass-auth.yaml             the first job
```
