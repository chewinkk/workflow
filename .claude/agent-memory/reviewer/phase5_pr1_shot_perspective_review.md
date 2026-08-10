---
name: phase5-pr1-shot-perspective-review
description: Phase 5 PR1 (shot-perspective control) review — passed clean; D7 byte-identical safety bar hand-verified against the removed template literal
metadata:
  type: project
---

Reviewed branch `claude/phase5-1-shot-perspective` (2026-07-20) against
`/tmp/.../scratchpad/phase5-plan.md` PR1 steps 1-13 and design decisions D1-D3, D6, D7. Result: PASS,
no must-fix or should-fix findings.

**Why it passed cleanly:** all 13 steps traced 1:1 to diff hunks; the D7 safety-bar frozen prompt string
in `lib/backdrop-prompts.test.ts` was verified two ways — (1) `git diff lib/backdrop-prompts.ts` shows
the ONLY template change is `"Overhead flat lay, lens square to surface"` moving from a hardcoded FRAMING
line into `PERSPECTIVE_FRAMING.flat_lay`, byte-identical; (2) the test actually passes. D3 (inert
detailingMode/manualDetailing) confirmed via grep — fields remain in `SwapState`, both `startSwap`/
`loadPromptPreview` bodies, and both API routes; only the swap-page UI control was swapped out. D6
precedence (`selectBackgroundUrl`) matches the plan's 4-branch order exactly, with full test coverage.
`app/api/swaps/prompt/route.ts` resolves perspective with the identical auto/manual expression as
`lib/reseller-generation.ts` (preview parity, plan step 11/checklist item 5).

**How to apply:** for future Phase 5 PRs (PR2-PR5) in this same plan, expect the same pattern — a new
pure `lib/*.ts` helper module + colocated test, additive Prisma migration, parallel threading through
both `/api/swaps/route.ts` and `/api/swaps/prompt/route.ts` for preview parity, and `SwapState` fields
added to both `startSwap` and `loadPromptPreview` bodies. Check preview-parity explicitly each time —
it's an easy thing to thread into one route and forget the other. See planner's plan file for D1-D7 and
the PR2-PR5 breakdown (per-perspective backgrounds, garment options, bulk swaps) if reviewing those next.
Pre-existing baseline: 8 known failures in `lib/ebay-research.test.ts`, `lib/trend-score.test.ts`,
`app/api/analytics/margin/route.test.ts` — unrelated to Phase 5, confirmed unchanged, consistent with
[phase3a_revenue_widgets_review](phase3a_revenue_widgets_review.md) and earlier reviews. Also confirmed
two pre-existing eslint errors in `components/state/swap-state-provider.tsx` (line ~310, setState-in-
effect) and `lib/inspection.ts` (line ~152, `any`) predate this diff (checked via `git show HEAD:<path>`)
— not introduced by PR1.
