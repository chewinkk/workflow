---
name: phase5_pr5b_bulk_ui_review
description: Review notes for Phase 5 PR5b (bulk-swap UI slice - upload-zone multi-select, swap page bulk queue/results, provider gap-fixes), branch claude/phase5-5b-bulk-ui
metadata:
  type: project
---

Passed after one direct fix. See [[phase5_pr5a_bulk_swaps_review]] for the backend slice this
built on and the two nice-to-have gaps it was asked to close.

- UploadZone regression check: verified all 5 existing callers (seller-ops size-chart-tab,
  catalog/page x2, backgrounds/page, revenue/import-tracker-modal) pass neither `multiple` nor
  `onFiles`, so the `<input multiple={multiple}>` attribute is never set for them — old
  single-file behavior is structurally unreachable to regress. `handleFiles` only ever routes to
  `onFiles` when `files.length > 1 AND onFiles` is provided; a lone file always goes through
  `onFile`, confirmed by reading the extracted `readFile`/`handleFiles` helpers directly.
- Inflight-lock back-compat (`readInflight`) hand-traced for old bare-number, new JSON, empty
  string, and garbage input — all handled without throwing, matches claim exactly.
- Cost/cap math hand-verified: `maxBulkItems = floor(8 / clampBatch(batchSize))` on the page
  matches `assertBulkJobSize`/`MAX_BULK_JOB_RENDERS=8` in lib/swap-pipeline.ts exactly (e.g.
  batchSize 3 → clampBatch 3 → max 2 items; server would reject itemCount 3 × batchSize 3 = 9 > 8).
  `bulkTotalCost = totalCost * bulkQueue.length` matches the bulk route's `perItemTotal *
  items.length` (same `computeCost(RENDER_COST=2, settings, {applyQuality:true})` call).
- **Found and fixed directly**: the "gap 1" fix (mirror startSwap's fire-and-forget
  `/api/log-error` report) only wired `report()` into the network-catch branch of
  `startBulkSwap` in components/state/swap-state-provider.tsx. `startSwap` actually has 4
  report() call sites (fetch-catch, non-business HTTP-error-with-code, uncoded/non-JSON HTTP
  error, unparseable 2xx JSON) — the bulk path was missing the latter 3. This meant real bulk
  failures (a genuine server code that isn't LIMIT_REACHED/NO_CREDITS/BULK_TOO_LARGE, an uncoded
  5xx, or a malformed 2xx body) still never reached the admin log — the exact gap the task said to
  close, just not fully. Added the three missing `report()` calls mirroring startSwap's
  isBusiness-gated pattern (bulk business codes: LIMIT_REACHED, NO_CREDITS, BULK_TOO_LARGE). Full
  suite + tsc re-run clean afterward — still exactly the 8 known pre-existing failures.
- Nice-to-have (not fixed): "Bulk generate" button uses `loading={busy}` (excludes inflightLock)
  while the main "Generate" button uses `loading={generateLocked}` (includes it) — after a
  mid-bulk-job page reload the bulk button is correctly disabled but shows no spinner. Cosmetic.
- Nice-to-have (not fixed): `maxBulkItems` is only enforced when items are ADDED to the queue; if
  the user grows the queue then increases batchSize afterward, the queue can exceed the per-job
  cap and the click fails safely server-side (clear "too large" toast) rather than being
  pre-blocked client-side.
- Confirmed `bulkQueue` (grep for the identifier across the repo) exists ONLY as page-local
  `useState` in app/(dashboard)/swap/page.tsx — never touches SwapState, IndexedDB, or
  lib/swap-session.ts. Confirmed backend files (app/api/swaps/bulk/route.ts,
  app/api/swaps/route.ts, lib/swap-pipeline.ts, prisma/) are fully untouched via `git diff --stat`.
- The `MAX_BULK_JOB_RENDERS = 8` local-constant-not-imported justification (importing
  lib/swap-pipeline.ts into the client page would pull lib/claude.ts's top-level `import sharp
  from "sharp"` via inspection.ts's dynamic import) is documented in a comment and is plausible
  given lib/claude.ts genuinely top-level-imports `sharp`; did not reproduce a full `next build`
  break to confirm (time tradeoff) — flag for a future reviewer to actually reproduce if this
  pattern recurs elsewhere.
