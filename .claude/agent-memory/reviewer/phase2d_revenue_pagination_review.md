---
name: phase2d-revenue-pagination-review
description: Review of simple client-side pagination added to the Revenue sales feed table
metadata:
  type: project
---

Reviewed `app/(dashboard)/revenue/page.tsx` pagination fix for the 24fps sales-feed scroll regression (PAGE_SIZE=50, visibleCount state, reset effect keyed on [soldFilters, consolidateRepeatSales, sales]). Passed — reset effect correctly relies on `sales`'s new-array-reference-per-fetch to reset to page 1 on every load()/refresh; summary tiles correctly read from unpaginated `sales`, not `saleGroups`.

Found a pre-existing (not introduced by this diff) React key-collision bug: when `consolidateRepeatSales` is false, `saleGroups` maps one group per sale but keeps `listingId` as the key, so repeat sales of the same listing produce duplicate `Fragment key={g.listingId}` — worth a follow-up ticket, didn't block this PR since out of diff scope.

`npm run test -- --run` has 8 pre-existing failures (lib/ebay-research.test.ts, lib/trend-score.test.ts, app/api/analytics/margin/route.test.ts) present identically with the diff stashed — confirmed via `git stash`/`git stash pop` before treating them as unrelated noise. Good pattern: when tests fail and the diff looks unrelated, stash and re-run to confirm pre-existing failure rather than assuming.
