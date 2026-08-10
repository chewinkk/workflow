---
name: phase6-pr1-test-baseline-category-insights-review
description: Review of Phase 6 PR1 (ebay-research/trend-score hermeticity fix + category_insights hard removal) on claude/phase6-1-category-insights-removal
metadata:
  type: project
---

Passed clean, no findings (must-fix or nice-to-have).

Verified:
- `git diff lib/ebay-research.ts lib/trend-score.ts` empty — Part A really was test-only.
- Diffed each test file against `git show HEAD:<path>` line by line: every changed line only added `prismaClient: makeFakeCacheClient()` (or the helper itself); zero assertions touched.
- `lib/ebay-research.ts`'s `researchSoldListings` calls `client.findUnique` on the cache BEFORE checking `RAPIDAPI_KEY`/`hasEbayProdCredentials` — so even the "no credentials" trend-score test needed a fake client to stay hermetic. Executor correctly added it there too, beyond what the plan literally spelled out (plan only named the "combines demand + momentum" test) — this is a case where following the *intent* (hermeticity) rather than the literal step list was correct.
- Every `researchSoldListings(`/`computeTrendScore(` call site in both test files passes `prismaClient` — grepped exhaustively, no gaps.
- D1: `ProductProfileSchema` still non-`.strict()`, `parseStoredProfile` still `return o`, new regression test in `lib/product-profile.test.ts` genuinely round-trips an old-shape JSON with `category_insights` present.
- Repo-wide grep for `category_insights`/`CategoryInsightsSchema` found matches ONLY inside the new regression test's fixture — no stray references anywhere else (route handlers, listing-copy, other fixtures).
- Catalog grid: `md:grid-cols-3` → `md:grid-cols-2` leaves exactly two blocks (Market positioning, Material assessment) — renders sensibly, no orphan.
- Ran the flakiness spot-check (`npx vitest run lib/ebay-research.test.ts lib/trend-score.test.ts` twice) — both green, confirming the fix (not just luck on one run).
- Full `npm run test`: 773 passed, 1 failed (`app/api/analytics/margin/route.test.ts`) — matches the new expected baseline exactly. `npx tsc --noEmit` and `npm run build` both clean.

New baseline going forward for this repo (post phase6-1): the ONLY expected `npm run test` failure is `app/api/analytics/margin/route.test.ts` (1 test). Do NOT excuse `lib/ebay-research.test.ts` or `lib/trend-score.test.ts` failures as "pre-existing" anymore — see [[phase2d_revenue_pagination_review]] for the old (now-superseded) baseline note about stash-and-rerun for pre-existing failures.
