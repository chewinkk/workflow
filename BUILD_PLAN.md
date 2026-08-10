# Backdrop Agent Workflow — Build Plan (v2, post-audit)

_Self-contained. Reads without any prior chat. Status: PLAN — nothing built until approved._

---

## 0. Legend — what every name is

| Name | Type | What it is |
|---|---|---|
| Haiku / Sonnet / Opus / Fable | Anthropic models | cheap→expensive tiers; set per role via `model:` in an agent file |
| Explorer / Planner / Executor / Reviewer / Adversary | **subagents** | `.claude/agents/<name>.md` = system prompt + tool allowlist + model + permission mode |
| Plan Keeper / Methodologist | planner sub-roles | plan-file owner; TDD/debug/brainstorm method |
| Critic desk | orchestration | a fan-out of read-only reviewers over one diff |
| Council | 5 subagents + judge | Contrarian/First-Principles/Expansionist/Outsider/Judge — a prose-decision panel |
| pr-review-toolkit | plugin | Anthropic plugin bundling 6 review agents (`anthropics/claude-code`) |
| security-guidance | plugin | Anthropic plugin; edit-time vuln scanner (`anthropics/claude-code`) |
| superpowers | plugin marketplace | `obra/superpowers-marketplace` — TDD, debugging, brainstorming, planning-with-files |
| frontend-design | skill/plugin | Anthropic aesthetic-direction skill (already enabled) |
| ui-ux-pro-max / impeccable | plugins | community taste skills (currently enabled — to be turned off) |
| the gate | CI check | `ci.yml` green **+** `prisma migrate diff` — the deterministic ship/no-ship decider |
| worktree | git feature | a second physical checkout on its own branch; lets parallel agents write without colliding |
| teleport | Claude Code command | `claude --teleport <id>` pulls a cloud session's branch to your machine |
| Responsively | desktop app | renders your dev URL in many device frames at once (Chromium, not real iOS) |
| MEMORY / GOTCHAS.md / DECISIONS.md | files | durable notes: bug lore, project traps, irreversible-decision log |

---

## 1. What this is, and the evidence behind it

A workflow to build **Backdrop** (a Next.js clothing-resale app: AI photos, cross-platform listing sync, Stripe billing) with AI agents, producing code you can trust without babysitting.

**Decisions locked:**
- **Host:** one **Railway dev box** (Console/SSH) runs both the agent and the dev server on a shared live filesystem, so the live UI mirror is reachable from any device while it codes (see §7).
- **Rollout:** phased; each phase independently shippable and reversible; respects the repo's "one concern per PR / ≤15 files" cap.
- **Risky parts hardened, not raw:** bounded adversary, memory with provenance+expiry, propose→review→commit tools, cheap-*Anthropic*-model routing (never free external tiers on repo code).

**The audit that shaped the build order** (last ~39 PRs + both prod outages, classified):
- **Production failures: 2 of 2 were migration/schema drift** (`wallpaperPalette` column with no migration file; 11 tables never migrated). **Zero were undetected code bugs.**
- **Every code defect the loop caught, the single existing reviewer caught** (z-index crossfade, stale-response race, lost-update race). None reached prod.
- **Spec-churn is visible:** Settings rebuilt 4× (#120–#123); a "fix 23 issues from the brief" batch (#146); PRs that exist only to "stop claiming X that isn't true."
- **~38% of recent commits are already workflow/CI meta-work**, not product.
- Your own stated pain: *"I fix things multiple times"* (churn), *"I tell it to fully implement and it doesn't"* (incompleteness), *"lots of tokens for weak output"* (efficiency).

**Conclusion driving the plan:** the bottleneck is **migration-drift → spec-churn → incompleteness**, *not* undetected defects. So the build hardens those, and defers the big defect-catching org until a defect of that class actually ships.

---

## 2. Architecture — roles, the swarm line, the width dial

Six roles, each in its own fresh context passing a **distilled summary** forward (this is what keeps every model under its degradation threshold — not shared context windows, which don't exist).

**The swarm dividing line — who writes:**
- **Read-only roles fan out freely** (no write conflicts): Explorer, Critic, Adversary, Council.
- **Write roles fan out only their thinking, and funnel writes** through isolation + merge: Planner (parallel *approaches* → one authored plan), Executor (worktree-isolated chunks → merge).

**The width dial** — the orchestrator sets each role's fan-out from task risk/size; default is 1:

| Role | R/W | Default | Widen to a swarm when… | Model |
|---|---|---|---|---|
| Explorer | read | 1 | area unfamiliar / no code map → multi-angle sweep | Haiku |
| Planner | write 1 plan | 1 | design ambiguous/irreversible → N approaches → judge → 1 plan | Opus |
| Executor | write code | 1 | ≥2 disjoint file-sets → worktree-isolated chunks → merge | Sonnet |
| Critic | read | 1 lane | a defect of a new class has shipped → add that lane | Opus |
| Adversary | read | 1 | touches schema/auth/billing/concurrency → 2–3 diverse lenses | Opus |
| Council | read | off | the call is irreversible → 5 advisors + judge | Opus |

Read-only breadth still costs tokens, so widen on **risk**, not by default.

---

## 3. The gates — what makes "done" mean done

1. **Deterministic gate:** `ci.yml` green **+** `prisma migrate diff` clean. A machine decides ship/no-ship — never an agent's opinion. Covers the migration-drift class that is your only real outage history.
2. **Completeness:** TDD makes half-done logic *fail a test*; the Critic scans for stubs/TODOs. Directly fixes "it didn't fully implement."
3. **Adversary-survived:** ≤2 rounds; a finding counts only if it produces a real failing test.
4. **Memory ratchet:** every caught defect → a committed regression test **and** a provenance-stamped note. Bugs caught once stay caught. Memory is a hint to re-verify — never trusted as truth.

---

## 4. The pipeline (end to end)

```
TASK
 │            ┌─ irreversible call? → COUNCIL (5 → judge) → DECISIONS.md
 ▼            │
EXPLORER ─(map first; multi-angle only if unmapped)
 ▼
PLANNER ─(Plan Keeper: task_plan.md + acceptance criteria; widen to N approaches if ambiguous)
 ▼
[✋ you approve the plan]
 ▼
EXECUTOR ─(TDD: failing test → full logic → green)
 │   └─ optional fan-out: wide+partitionable → worktree A/B/C → INTEGRATE (merge)
 ▼
CRITIC ─(reviewer + completeness + security-guidance + migration assertion)
 ▼
ADVERSARY ─(≤2 rounds; 2–3 lenses on risky changes; must cite a real red test)
 ▼
GATE ─(CI green + prisma migrate diff) ── red → back to EXECUTOR
 │        every defect above → regression test + MEMORY note → strengthens the gate
 ▼
[✋ you approve the gate report] → MERGE
```

---

## 5. Build order

### PHASE 0 — Harden the core  *(BUILD NOW; touches `.claude/`, `ci.yml`, docs only)*

**0a — Two zero-risk settings wins.** Resolve the taste collision; add the official security scanner. See §6.1 for the exact `settings.json`.
- Files: `.claude/settings.json`. Exit: `ui-ux-pro-max` + `impeccable` off, `frontend-design` sole authority, `security-guidance` enabled.

**0b — Fence the migration gate.** The one class that hit prod; the check already exists — make it non-skippable.
- Add a required CI job running the fresh-DB replay; add a reviewer assertion (§6.4).
- Files: `.github/workflows/ci.yml`, `.claude/agents/reviewer.md`. Exit: a schema PR with no migration file goes red in CI.

**0c — Bounded adversary.** Add the 5th role + the gate loop (§6.2).
- Files: `.claude/agents/adversary.md`. Exit: on a real recent change, the adversary either writes a failing test for a genuine defect or reports "no reproducible break."

**0d — Memory hardening.** Provenance+expiry format; project logs; "hint not truth" rule (§6.3).
- Files: `.claude/agent-memory/README.md` (the format), `GOTCHAS.md`, `DECISIONS.md`, one line into `reviewer.md`. Exit: a new memory entry carries provenance + a verify command.

**0e — TDD + completeness.** Wire the fix for your actual bug.
- Add `superpowers-marketplace`, enable **only** TDD + debugging + brainstorming (Methodologist). Add a completeness clause to `executor.md` and `reviewer.md` (§6.5).
- Files: `.claude/settings.json`, `executor.md`, `reviewer.md`. Exit: an executor that stubs a branch fails its own test.

**0f — The width-dial convention.** Document the table in §2 as the orchestrator's rule (§6.6).
- Files: `CLAUDE.md` (a short "Agent width" section). Exit: the rule is written; default width 1.

> **Phase-0 exit gate (go/no-go for everything after):** run **two real Backdrop changes** through this. If the adversary finds ≥1 defect the old 4-role loop would have shipped, continue. If it can't, that's evidence the bottleneck is elsewhere — **stop here; the core is the whole project.**

### PHASE 1 — Extra critic lanes  *(DEFERRED — evidence-gated, one at a time)*
Install pr-review-toolkit, but enable a lane **only when a defect of its class actually ships**: `silent-failure-hunter`, `type-design-analyzer`, `comment-analyzer`, `code-simplifier`, `pr-test-analyzer`. Each addition cites the PR that justified it.

### PHASE 2 — Read-only swarms  *(DEFERRED — low risk)*
Turn on the width dial's fan-outs for read roles: multi-angle Explorer (only if the Graphify map is missing/stale — prefer *building the map*, which is deterministic and cheaper), 2–3 Adversary lenses on risky changes, Council on irreversible calls.

### PHASE 3 — Parallel execution  *(DEFERRED — needs the conflict machinery)*
Executor swarm for wide, partitionable work: worktree isolation per chunk, disjoint file-set partitioning from the plan, an INTEGRATE (merge) step, gate on the merged result. First real use likely a big cross-file migration sweep.

### PHASE 4 — Specialists  *(DEFERRED — mostly evidence-gated)*
Design specialists (Motion/Dataviz/Artifacts) when a real UI task needs them. Stamina skills (`ponytail`/`caveman`/`headroom`) pinned to a commit if added. Portability/distribution only after the single-project version has beaten the old loop twice.

### PHASE 5 — Environment: a separate Railway project  *(DEFERRED — set up whenever; independent of Phase 0)*
A **dedicated Railway project** for the workflow, isolated from prod, connected to the repo. Two viewing modes, both optional:
- **Per-PR preview (auto):** enable Railway **PR environments** — each agent PR auto-deploys its branch to its own isolated env + URL; the CI auto-merge gate promotes it to the project's main env on green; the PR env is torn down on merge/close. Per-push build, **not** live HMR.
- **Live dev box (HMR):** the §7 Console/SSH box running `next dev`, for watching the UI change as it codes.

Isolation requirements (non-negotiable): its **own database** and **test secrets** — never point preview envs at prod data or real Stripe/eBay/Depop keys. Keep the **human approval gate before anything reaches REAL prod**; auto-merge is fine only inside this sandbox project. Do **not** modify the existing prod `railway.json`/deploy. (Bonus: running `migrate-deploy-safe.ts` against this project's own DB continuously exercises the migration gate — your #1 real failure class.)

Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) only if you actually need supervised multi-session coordination.

---

## 6. Concrete artifacts (actual contents)

### 6.1 `.claude/settings.json` — `enabledPlugins` block
```json
"enabledPlugins": {
  "ui-ux-pro-max@ui-ux-pro-max-skill": false,
  "impeccable@impeccable": false,
  "frontend-design@claude-code-plugins": true,
  "security-guidance@claude-code-plugins": true
}
```
(`security-guidance` ships from the already-registered `anthropics/claude-code` marketplace — no new source needed.)

### 6.2 `.claude/agents/adversary.md`
```
---
name: adversary
description: Adversarial reviewer. Runs after the reviewer on a completed diff to try to break it before it ships. Read-only; writes failing tests, never fixes.
tools: Read, Grep, Glob, Bash
model: claude-opus-4-8
---
You are the ADVERSARY. A change passed the reviewer. Your only job is to break it
before it ships. You do not improve it, soften findings, or fix anything.

Rules of engagement:
- A finding counts ONLY if you produce a real failing test or reproducible tool
  result. No red test, no finding. Discard assertions without evidence.
- Hunt, in priority order: (1) incomplete implementation — stubs, TODOs,
  happy-path-only, branches that silently no-op; (2) the change's risk class —
  schema change → missing/incorrect migration; money/auth/marketplace → edge cases
  and races; (3) boundary math and off-by-one; (4) concurrency — read-merge-write
  lost updates, stale-response clobber.
- At most 2 rounds. R1: attack, write failing tests for every real break. If the
  executor fixes them, R2: attack the fix once. Then STOP — the deterministic gate
  (CI green + `prisma migrate diff`), not your opinion, decides shipping.
- Write failing tests as real colocated `*.test.ts` so they persist as regressions
  and enter the gate.
- Report each break as {file:line, the failing test, severity}. If you cannot break
  it after a genuine attempt, say "attacked X, Y, Z; no reproducible break" — a valid,
  valuable result.
- Never edit source. Never stash/reset/checkout the shared tree; use
  `git show HEAD:<path>`. Every test you add must actually run.
```

### 6.3 Memory entry format (`.claude/agent-memory/README.md`)
```
Every entry starts with this front-matter:
---
what:       <one-line lesson>
class:      bug-lore | convention | baseline | process
provenance: <agent> · <YYYY-MM-DD> · commit <sha> · PR #<n>
expires:    never | recheck-after:<date-or-condition>   # baselines are perishable
verify:     <exact command/test that confirms this is still true>
---
Rule: memory is a HINT to re-verify, never ground truth. Before acting on an entry,
run its `verify`. A `baseline` entry past its recheck condition is stale until re-run.
```
Plus project-level `GOTCHAS.md` (framework/domain traps) and `DECISIONS.md` (Council verdicts on irreversible calls).

### 6.4 Migration assertion (added to `reviewer.md` + CI)
- Reviewer, on any PR touching `prisma/schema.prisma`: run
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`
  and confirm a matching migration file exists under `prisma/migrations/`. A non-empty diff with no new migration file is a hard FAIL.
- CI required job: fresh-DB replay —
  `rm -f /tmp/mig.db && DATABASE_URL="file:/tmp/mig.db" npx tsx scripts/migrate-deploy-safe.ts` must exit clean.

### 6.5 Completeness clause (added to `executor.md` and `reviewer.md`)
```
Completeness: implement the FULL logic the plan asks for. No stubs, no TODOs, no
happy-path-only branches, no `throw new Error("not implemented")`. Every case named
in the acceptance criteria must have real, tested behavior. TDD: write the failing
test for each criterion first, then the code that makes it pass. The reviewer FAILS
any diff with an unimplemented branch or a criterion without a passing test.
```

### 6.6 Width-dial rule (added to `CLAUDE.md`)
The §2 table, stated as: "Default agent width is 1. Widen a role only per its trigger. Read-only roles (Explorer, Critic, Adversary, Council) may fan out; write roles (Planner, Executor) fan out only their thinking and funnel writes through worktree isolation + a merge step + the gate."

---

## 7. Hosting runbook — Railway dev box (all-in-one, live, from anywhere)
Run the agent AND the app in ONE Railway service you shell into, so edits and the dev server share a live filesystem — that is what makes the mirror live-while-coding.
1. Deploy a dev-container service (Node / code-server image) to Railway. **Mount a persistent volume at the repo dir** (e.g. `/home/coder/backdrop`) — the container FS is ephemeral, so uncommitted edits are wiped on redeploy/crash without it.
2. Service start command runs the dev server on Railway's port: `npm run dev -- -H 0.0.0.0 -p $PORT`. Railway routes its public domain to that port.
3. Open Railway's **Console** (or `Copy SSH command` → your own terminal) and run Claude Code there; authenticate once (`claude auth login`). Keep long-lived processes in `tmux` so disconnects don't kill them.
4. Agent edits files → `next dev` (same container) HMR-reloads → open the Railway **public URL in Responsively** from any device → live UI while it codes.
5. Persist work: **commit + push from the box** (git is the source of truth; the container is disposable).
6. iOS caveat: Responsively is Chromium device-frames (iPhone-sized, live), not Safari/WebKit — true iOS is a later add-on (Playwright WebKit / BrowserStack).

---

## 8. Cut & deferred
- **CUT — omni-route to free models:** blocked at the egress proxy (403/407) in the cloud host, and cheaper models produce *more* weak output — worsening your token complaint. Cheap-*Anthropic*-tier routing (Haiku explorer) already gives the safe version.
- **CUT (revisit only on cross-stack work) — the 66-skill developer fleet:** re-encodes what Claude + CLAUDE.md already know; largest supply-chain surface in a repo holding Stripe/auth/marketplace creds.
- **DEFERRED:** extra critic lanes (Phase 1), read-only swarms (Phase 2), parallel execution (Phase 3), design specialists + stamina + portability (Phase 4), hosting/agent-teams (Phase 5) — each gated on a demonstrated need.

---

## 9. Open items
1. Confirm `security-guidance` resolves from the `claude-code-plugins` marketplace (else register `anthropics/claude-plugins-official`).
2. Approve Phase 0 — or reorder its sub-steps.
3. After Phase 0's two-change exit gate, we decide together whether any deferred phase is justified by what it revealed.

---

## 10. Repo split (post-migration)

As of this migration, the agent-workflow tooling this plan describes lives here, in `chewinkk/workflow` — separate from `chewinkk/backdrop`, which is just the webapp (source, `railway.json`, `prisma/`, its own CI). Concretely:

- **Here (`workflow`):** `CLAUDE.md`, `MEMORY.md`, `MEMORY-INDEX.md`, this `BUILD_PLAN.md`, `.claude/agents/*.md`, `.claude/agent-memory/`, `.claude/settings.json`, `.claude/hooks/`.
- **Stays in `backdrop`:** all app code, `railway.json`, `package.json`, `prisma/**`, `.github/workflows/ci.yml`, `design/`, plus repo-specific tooling that isn't part of this loop (`AGENTS.md`, `.serena/`, `.agents/skills/`, `skills-lock.json`, `.claude/settings.local.json`) and backdrop's own product `BUILD_PLAN.md` (the reseller-platform feature roadmap — a different document from this one).
- **Split exception:** Phase 0 step 0b's CI job (the fresh-DB migration replay) has to live in `backdrop/.github/workflows/ci.yml`, since that's what actually runs backdrop's `prisma migrate`/`migrate-deploy-safe.ts` — the reviewer-side assertion text lives here in `reviewer.md`, but the CI job itself is a small `backdrop`-side change.
