---
name: phase5_pr5a_bulk_swaps_review
description: Review notes for Phase 5 PR5a (bulk-swap backend slice - lib/swap-pipeline.ts extraction + app/api/swaps/bulk/route.ts), branch claude/phase5-5-bulk-swaps
metadata:
  type: project
---

Passed, no must-fix. Two nice-to-have findings left unfixed (design/observability gaps, not
correctness bugs).

- The `runOneSwapRender` extraction (lib/swap-pipeline.ts) was verified STATEMENT BY STATEMENT
  against `git show HEAD:app/api/swaps/route.ts`'s old mapWithConcurrency worker body — identical
  deps wiring, identical Swap.create fields, identical timing/error/refund logic. The one
  historically-risky detail (Swap.itemImageUrl uses the ORIGINAL `itemImageBase64`, not the
  downscaled `productBase64` used for generation) survived correctly in both the single route and
  the new bulk route's per-item ctx.
- Bulk credit math hand-traced for every path (success, N-failure, upfront-prep-failure with full
  refund, deduct-failure, size-cap/validation-before-deduct) — all correct, no double-refund path
  possible (prep failures abort before any task/render starts; per-render refunds only happen
  inside `runOneSwapRender`, called exactly once per task via `mapWithConcurrency`, which does not
  retry).
- `clampBatch` is applied once inside `parseSettings` (lib/generation-settings.ts), so
  `settings.batchSize` is ALREADY clamped everywhere it's read (assertBulkJobSize, computeCost,
  planBulkTasks) — no risk of an unclamped value sneaking into the size cap vs. cost math.
- Nice-to-have (not fixed): `startBulkSwap` in components/state/swap-state-provider.tsx has no
  equivalent to `startSwap`'s `report()` fire-and-forget POST to `/api/log-error` — so client-side
  bulk failures (timeout, dropped connection, bad JSON) never reach the admin error log, unlike
  single-swap failures. Shows up as an unused `catch (err)` param (lint warning, not error).
  Flagged for 5b since 5a ships no UI to trigger this path yet.
- Nice-to-have (not fixed): the pre-existing inflight-recovery poll effect (reload mid-render)
  only ever restores into `results`/`resultUrl` — a reload mid-bulk-job would misfile into the
  single-swap result fields instead of `bulkResults`/`bulkFailures`. Harmless today since 5a has no
  bulk UI yet; worth revisiting in 5b.
- Full suite: still exactly 8 pre-existing failures (ebay-research 6, trend-score 1, margin-route
  1) — matches the running baseline noted in every Phase 3+/Phase 5 review so far. `npx tsc --noEmit`
  clean. 29/29 in lib/swap-pipeline.test.ts + lib/reseller-generation.test.ts.
- Confirmed scope discipline: app/(dashboard)/swap/page.tsx and prisma/schema.prisma both fully
  untouched (git status showed no `M`, no new migration dir) — matches the plan's explicit "5a is
  backend-only, 5b is UI" split. `startSwap` body untouched (diff hunks only touch new
  additions, verified via `git diff` hunk headers, not by eye).
