---
name: phase2d2-platform-fees-review
description: Phase 2D-2 platform fee correction + marketplace greying review outcome (2026-07-20)
metadata:
  type: project
---

Phase 2D-2 (eBay/Depop/Poshmark fee correction + non-active marketplace greying) passed review clean — no blockers, should-fixes, or nits. All 9 plan steps implemented as specified; independently recomputed every fee boundary (eBay $9/$10.00/$10.01/$11/$100/$8000, Poshmark $12/$14.99/$15.00/$20, Depop $50/$100) and all matched the code and test expectations exactly. `lib/sync-orders.ts`'s `estimateFee` correctly delegates to `computeProjectedMargin` (D2's key non-obvious finding: there were two independent fee-math implementations, and the plan's decision to unify them was correct and executed). `perOrderFee`/`flatUnderThreshold` never overlap or double-count with `fixedFee`. `revenue/page.tsx` (#80 pagination) and D1 files confirmed byte-untouched via `git diff`. Full suite showed only the 8 pre-existing known failures (ebay-research/trend-score/margin route) — see [[phase2d_revenue_pagination_review]] for why those are pre-existing. `npm run build` and targeted vitest runs both clean.

**Why worth remembering:** this is the first money-math-focused review pass in this repo (reviewer was explicitly told to recompute arithmetic by hand rather than trust tests) — confirms the hand-recompute approach is tractable via a quick python one-liner and worth doing for any future fee/pricing change, not just trusting that test expectations were derived independently.
