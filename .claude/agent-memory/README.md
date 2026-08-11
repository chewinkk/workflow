# Agent memory — entry format

Every memory entry (in `MEMORY.md`, `.claude/agent-memory/reviewer/*`,
`GOTCHAS.md`, `DECISIONS.md`, or anywhere else agent memory gets written)
starts with this front-matter:

```
---
what:       <one-line lesson>
class:      bug-lore | convention | baseline | process
provenance: <agent> · <YYYY-MM-DD> · commit <sha> · PR #<n>
expires:    never | recheck-after:<date-or-condition>   # baselines are perishable
verify:     <exact command/test that confirms this is still true>
---
```

**Rule: memory is a HINT to re-verify, never ground truth.** Before acting on
an entry, run its `verify`. A `baseline` entry past its recheck condition is
stale until re-run.

## Classes

- **bug-lore** — a specific defect and how it was caught. Usually `expires: never`.
- **convention** — a codebase-wide pattern to follow. Usually `expires: never`
  unless the convention itself changes.
- **baseline** — a fact about current state (dependency versions, schema
  shape, test count) that WILL drift. Always set a real `recheck-after:`.
- **process** — a lesson about how the agents themselves should operate, not
  about the target codebase.

## Related files

- `GOTCHAS.md` (repo root) — framework/domain traps specific to `backdrop`.
- `DECISIONS.md` (repo root) — Council verdicts on irreversible calls.
- `MEMORY.md` / `MEMORY-INDEX.md` / `.claude/agent-memory/reviewer/*` — the
  accumulated lore migrated from `backdrop` (see `BUILD_PLAN.md` §10).
  Pre-existing entries there predate this format and aren't being rewritten
  retroactively — apply this format going forward.
