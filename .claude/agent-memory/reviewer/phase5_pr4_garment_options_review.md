---
name: phase5_pr4_garment_options_review
description: Review notes for Phase 5 PR4 (garment options gating + preview parity), branch claude/phase5-4-garment-options
metadata:
  type: project
---

Passed, one cosmetic fix made directly (not a design issue).

- Preview parity (highest risk item) verified line-by-line: `app/api/swaps/prompt/route.ts` and
  `lib/reseller-generation.ts` both compute `gatedGarmentDirectives` from the SAME post-manual-override
  `inspection.item_category`, both append via the same exported `appendDirectivesBlock` with the same
  "PRESENTATION DIRECTIVES" header. Route never actually populates `params.extraDirectives` (still
  unused elsewhere), so `extraDirectives = [...(params.extraDirectives ?? []), ...garmentDirectives]`
  reduces to just `garmentDirectives` in practice — no drift between preview and generation.
- Gating (`lib/garment-options.ts` `applicableGarmentOptions`) is a plain `if (category === "footwear")
  ... else ...` over the 6-value `ITEM_CATEGORIES` enum (lib/inspection.ts) — exhaustive by construction,
  no fallthrough possible.
- `gatedGarmentDirectives` zeroes non-applicable fields to `null` before calling the untouched
  `garmentPromptDirectives`, so a leaked lace directive on a top is structurally impossible, not just
  untested. Tests pin this with `.not.toContain("Lace the shoes")`, not just a length check.
- Fixed directly: `npx prisma format` was used to fix Swap-model column alignment broken by the new
  `garmentOptionsJson` field, but that command reformats the WHOLE schema file (touched unrelated
  AppSetting/Listing models too). Reverted those two unrelated hunks by hand so the diff stayed scoped
  to the Swap model only. Lesson: never run `prisma format` as a blind fix — it's file-wide, hand-edit
  column alignment instead or diff-check after running it.
- Full suite: still exactly 8 pre-existing failures (ebay-research 6, trend-score 1, margin-route 1),
  confirmed by file with `npx vitest run lib/ebay-research.test.ts` breakdown — matches the running
  baseline noted in every Phase 3+/Phase 5 review so far.
