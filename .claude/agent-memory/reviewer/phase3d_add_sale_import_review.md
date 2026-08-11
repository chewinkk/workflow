---
name: phase3d_add_sale_import_review
description: Review of Phase 3 Chunk D (Add Sale modal, POST /api/sales, import-tracker file tab + inline error panel) — passed
metadata:
  type: project
---

Reviewed 2026-07-20, branch claude/phase-3d-add-sale-import (uncommitted, diff vs main which already
has Chunks A-C). Result: PASS, no blockers/should-fix. One nit only.

What I verified directly (not just read):
- `createManualSale` (lib/sync-orders.ts) hand-traced against `normalizeOrder`/`applySellerCost`: fee
  estimate-when-omitted vs honored-when-provided, netPayout math, and `sellerCost` persistence all match
  how `ingestOneOrder` computes the same fields for synced sales — the only deliberate divergence
  (user-entered cost instead of a matched Product's cost) is called out in the doc comment and is correct.
- Modal (components/revenue/add-sale-modal.tsx) sends `null` (not `0`) for blank fee/cost —
  `sellerCost.trim() ? parseFloat(sellerCost) : null` — so a blank cost does NOT wrongly qualify a sale
  for Avg ROI (revenue-stats.ts's `avgRoi` only counts `sellerCost > 0`). This was an explicit thing the
  planner flagged as a risk to check; confirmed not present.
- Submit guard: `setSubmitting(true)` before `await fetch`, button `disabled={submitting}` AND
  `loading={submitting}` — Button component's own `disabled: disabled || loading` (components/ui/button.tsx)
  double-covers it. Real double-POST guard, not just a visual spinner.
- API route (app/api/sales/route.ts) auth pattern (`auth()` + `session?.user?.id` 401 check) is
  byte-identical to the neighboring `/api/sync/import-tracker/route.ts` and `/api/settings/preferences/route.ts`.
  zod bounds mirror `RawOrderSchema` exactly (item max 300, salePrice/platformFee 0..1_000_000).
- Fee-preview string format (`fees $X · net $X · margin Y%`) is byte-for-byte the same template used in
  the wizard review step (`app/(dashboard)/listings/new/page.tsx:407`) — genuine reuse, not just "looks similar."
- import-tracker-modal.tsx file tab: 2MB cap enforced before any state write, error panel wiring
  (`error` state cleared at submit start, set in catch, cleared in `reset()`) traces correctly from the
  Link tab's 422 (`import-tracker/route.ts` wraps `tracker-import.ts:131`) through to the inline red panel.
- Ran `npx vitest run lib/sync-orders.test.ts` (12/12 pass, no new tests added — matches plan, which said
  `createManualSale` is DB-touching and not unit-testable, no pure helper was extracted to need one),
  `npx tsc --noEmit` (clean), `npm run test` (same pre-existing 8-failure baseline as
  [[phase3a_revenue_widgets_review]] — ebay-research/trend-score/margin-route, zero new failures),
  `npm run build` (clean, `/api/sales` registered in the route list).

One nit (not blocking): import-tracker-modal.tsx's oversized-file guard (`handleFileSelect`) toasts an
error and returns BEFORE touching `fileText`/`fileName` state — so if a user had already selected a valid
file and then picks an oversized one, the old file silently stays selected/submittable while the toast
implies the new pick failed. Not required by the plan, cosmetic only.

No repeat of past mistakes: no destructive shell commands used ([[feedback_no_destructive_shell_chaining]]),
tree left exactly as found, didn't touch the concurrent-session stash ([[environment_concurrent_agent_sessions]]).
