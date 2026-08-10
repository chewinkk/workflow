# Project: Backdrop — Agent Workflow

## What this is
This repo is the multi-agent coding workflow that builds and maintains
**Backdrop** — a Next.js app for clothing resellers (AI product photos and
listing copy, cross-platform listing/sales sync, pricing intelligence, Stripe
billing). The webapp's actual code lives in a separate repo, `chewinkk/backdrop`
— this repo holds the agents, memory, and process, not the app. Read
`BUILD_PLAN.md` first: it's the authoritative source for the architecture
(roles, gates, phased rollout) that everything below implements.

## Target codebase
Any task that touches the app works against `chewinkk/backdrop`, not this
repo — clone/attach it, branch, commit, and push there. This repo never holds
app code. `backdrop`'s own `CLAUDE.md`/`AGENTS.md` govern its build/run/test/
lint commands and Next.js-specific conventions; they aren't duplicated here.

## Workflow rule
For any task touching more than 3 files, or any refactor, or anything not
fully clear how to approach:

1. Invoke the explorer agent first to map the relevant files, in whichever
   repo the task targets.
2. Invoke the planner agent with that output. It writes a plan and STOPS.
3. Read the plan. Approve it or send it back with corrections.
4. Only after approval, invoke the executor agent to make changes.
5. Invoke the reviewer agent before you consider the task done.

Do not jump straight to editing files on anything nontrivial. The plan review
step is where most wasted fix cycles get caught before they happen. (The
adversary role and its trigger conditions land in Phase 0c — see
`BUILD_PLAN.md`.)

## Scope
One PR fixes one issue. Never open a PR titled "fix N issues" or "revamp." A
PR that touches a schema file changes **only** that schema concern. Hard cap:
if a single PR exceeds ~15 non-generated files, stop and split it. Touch only
the files each step names — no "while I'm here" edits. `rm` is never allowed
on a file that is not the explicit subject of an approved change.

If two consecutive commits re-do the same file/surface, stop — the
requirement is unsettled; get it specified before touching code again. Cap a
working session at ~2 hours or ~5 merged PRs, whichever comes first. A revert
within 24h of a merge is a signal the change skipped the plan/review step —
treat it as a process failure, not a normal commit.

## Memory
`MEMORY.md`, `MEMORY-INDEX.md`, and `.claude/agent-memory/reviewer/*` are the
accumulated lore from work on `backdrop` — read as a hint to re-verify, never
as ground truth. The provenance+expiry entry format
(`.claude/agent-memory/README.md`) and `GOTCHAS.md`/`DECISIONS.md` land in
Phase 0d.

## Definition of done
For work on `backdrop`: done only when `backdrop`'s own `ci.yml` is green on
the PR — "GitHub says mergeable" is not done, and a squash-merge is not proof
tests ran. For changes to this repo's own tooling: shown as a diff and
approved, per the workflow rule above and the phased plan in `BUILD_PLAN.md`.
