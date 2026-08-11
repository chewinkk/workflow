---
name: environment-concurrent-agent-sessions
description: This repo's working tree can be shared by multiple concurrent agent conversations — expect transient git state changes mid-review that you didn't cause
metadata:
  type: project
---

Observed 2026-07-20 during the Phase 2D1 image-tags review: mid-session, the diff files under review
(`lib/products.ts`, `app/api/products/[id]/route.ts`, `app/(dashboard)/listings/new/page.tsx`) briefly
showed as clean (matching HEAD) via `git status`/`git diff`, then a few commands later reappeared as
modified — because a *different*, concurrently-running reviewer conversation (reviewing the unrelated
Revenue-page pagination WIP) ran `git stash` / `git stash pop` on the same working tree as part of its
own "stash-and-rerun to confirm pre-existing test failures" pattern (see
[[phase2d_revenue_pagination_review]]). Confirmed via the stash list and a second concurrent memory
file (`phase2d_revenue_pagination_review.md`) that appeared on disk mid-session, written by that other
conversation.

**How to apply:** if git state looks inconsistent with what a task's own preamble/system-reminder
described (files clean that should be dirty, or vice versa), don't assume you broke something —
check `git stash list` and `git log --all --oneline` for a stash/WIP commit first, and re-verify
against the commit your diff should sit on top of (e.g. `git diff <parent-commit> <candidate-commit>
-- <path>`) rather than trusting only the live working tree at any single instant. Don't run
`git stash pop`/`apply` yourself to "fix" this — another conversation's stash is not yours to resolve,
and it may include unrelated files (e.g. `app/(dashboard)/revenue/page.tsx`) you were told not to touch.
