---
name: phase2c-listings-query-review
description: Review of Phase 2C server-driven listings sort/filter (lib/listings-query.ts) — PASS with one should-fix on platform allowlist scope.
metadata:
  type: project
---

2026-07-19, PASS overall, one should-fix. All 5 planned files present, byte-identical GET response
`.map()`/DELETE untouched, `orderBy`/`where` composition correct (no clobbering, no raw param reaches
Prisma), page wiring correct (bar above selection row, visible at 0 results, `applyQuery` clears
selection before `setQuery`, single effect keyed on `query`). 18/18 new unit tests pass, `npm run build`
clean, full suite shows the same 8 pre-existing unrelated failures (ebay-research, trend-score, margin
analytics) — no new failures.

**Should-fix found:** confirmed decision was "platform filter = ONLY the 3 active platforms"
(`["ebay","depop","poshmark"]`). The lib correctly added `ACTIVE_LISTING_PLATFORMS` and the UI component
(`listings-filter-bar.tsx`) correctly only offers those 3 — but `parseListingsQuery` in
`lib/listings-query.ts` still validates incoming `?platform=` values against the generic `isPlatform`
from `lib/platform-fees.ts`, which allowlists all 12 canonical platforms, not the restricted 3. A
hand-crafted URL (`?platform=mercari`) passes server-side validation even though the UI can never produce
it. Not a security hole (still a legitimate enum member, not injection) and currently inert (no Listing
rows exist for platforms outside the 3 active ones today), but it violates the explicit confirmed
decision and the new export is unused for its own stated purpose. Fix: filter against
`ACTIVE_LISTING_PLATFORMS` in `parseListingsQuery`, not `isPlatform`.

**Pattern to remember:** when a plan introduces a narrower allowlist constant for a UI-vs-full-domain
distinction (e.g. "3 active platforms" vs. the canonical 12), don't just check that the *component* uses
the narrow list — separately verify the *parse/validation* layer (the actual server-input boundary) also
enforces the narrow list. A correct-looking UI can mask a validation function that quietly reverts to the
broader domain type. See [[phase2b_carousel_review]] for a related "check the actual boundary, not the
surface" lesson (CSS cascade vs JS scoping there; allowlist scope here).
