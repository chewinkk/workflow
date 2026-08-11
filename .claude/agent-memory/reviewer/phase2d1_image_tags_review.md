---
name: phase2d1-image-tags-review
description: Review of Phase 2D-part-1 (image position tags in the new-listing wizard) — PASS, no blockers/should-fix/nits
metadata:
  type: project
---

2026-07-20, PASS. All plan decisions (D1-D5) implemented exactly as approved: `lib/image-meta.ts`
mirrors `garment-options.ts` style byte-for-byte (leading 2-line block comment, `as const` arrays,
labels record); `parseImageMeta` defensive on null/empty/malformed/non-array/bad-url/bad-tag;
`setTagForUrl`/`tagForUrl` pure and correct. `ProductInputSchema`/`toProductData` (create path)
untouched — confirmed via `.strip()` default zod behavior + a test that `imageMeta` is stripped on
create. `ProductUpdateSchema = ProductInputSchema.partial().extend({ imageMeta: ImageMetaSchema.nullish() })`
is the only change to the update schema. PATCH route maps `imageMeta` only when present, and the
`imagesLockedAt` guard correctly keys off `parsed.data.images` specifically (not the whole body) so
imageMeta slips past on a locked product while an `images` write still 409s — this is the same
"check the actual boundary, not the surface" pattern flagged in [[phase2c_listings_query_review]],
and it was done correctly here. Wizard's `goNext()` blocks step advance on PATCH failure via toast +
early return, `finally` still resets `savingTags`; select styling reuses the project's existing dark
form-field focus convention (`focus:outline-none focus:border-accent/60`, matches `input.tsx`/
`textarea.tsx`) rather than the button/carousel ring style — correct per this file's own established
convention, not a defect. `firstImage()` helper removal confirmed safe (only namesakes elsewhere are
unrelated local functions in `sync/orders/route.ts` and `inspect/route.ts`). Generation route
(`/api/listings/generate`) diff is empty — D5 out-of-scope boundary honored.

22/22 new tests pass (14 image-meta + 8 products), `npx tsc --noEmit` clean, `npx eslint` clean on all
6 changed/new files, `npm run build` clean, full `vitest run` shows exactly the same 8 pre-existing
failures across the same 3 files (ebay-research, trend-score, margin) — no new failures.

Known accepted tradeoff (approved in plan, not a bug): tiles/imageMeta are keyed by image URL, so
duplicate URLs in the same product's `images` array would collide (same tag applied to both, React
key warning). Explicit plan decision (D2), not worth flagging.

See [[phase2a_product_origin_review]] and [[phase2c_listings_query_review]] for the recurring
review pattern this task also satisfied: re-derive server-trust-boundary claims (create-path can't
inject a field, lock-guard scope) from the actual code, not just the plan's prose.
