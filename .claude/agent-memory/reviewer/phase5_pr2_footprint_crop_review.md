---
name: phase5-pr2-footprint-crop-review
description: Phase 5 PR2 (footprint-driven detail-crop padding) review — passed clean, no findings
metadata:
  type: project
---

Reviewed branch `claude/phase5-2-footprint-crop` (2026-07-20) against
`/tmp/.../scratchpad/phase5-plan.md` PR2 steps 1-6. Result: PASS, no must-fix or should-fix findings.

**Why it passed cleanly:** every step traced 1:1 to a diff hunk across the 6 modified files
(`lib/inspection.ts`, `lib/detail-regions.ts`, `lib/reseller-generation.ts` + their 3 test files).
`lib/composite.ts` was correctly left untouched — the plan's claim that `cropDetailRegion`'s existing
`paddingFraction = 0.2` default already covers the "med" case was verified true by reading the function
signature directly, not just trusted. The med-default byte-identity chain was verified at three levels:
(1) `footprintPad("med")` unit-tested to equal `{ relPad: 0.15, absPad: 0.025 }` — the literal padBox
defaults, not a tautological self-comparison; (2) `detectedToRegions(inspection)` with no footprint arg
tested equal to `padBox(bbox)` with padBox's own defaults; (3) `cropPaddingFraction = (footprintRelPad /
footprintPad("med").relPad) * 0.2` algebraically simplifies to exactly 0.2 when footprint is "med" (ratio
is 1, no float traps). Pad ordering (small/flat tighter, big/angled looser than med) hand-verified
numerically and matches plan intent. `FOOTPRINT_PAD` is a `Record<Inspection["footprint"], ...>` so
TS enforces exhaustiveness over the 5-value enum (confirmed via clean `tsc --noEmit`). No schema/prisma/
migration/route/UI changes — correctly lib-only, matching the plan's explicit "no schema/migration
change" step. `npx vitest run lib/detail-regions.test.ts lib/inspection.test.ts
lib/reseller-generation.test.ts` → 58/58 pass; full suite → same 8 pre-existing failures as documented in
[phase5_pr1_shot_perspective_review](phase5_pr1_shot_perspective_review.md) (ebay-research 6, trend-score
1, margin-route 1), confirmed not regressions. The one pre-existing eslint `no-explicit-any` in
`lib/inspection.ts` (now line 157, was ~152 in PR1's review) is unchanged code just shifted by the new
footprint lines — confirmed via `git show HEAD:lib/inspection.ts`, not introduced by this diff.

**How to apply:** for PR3-PR5 in this same plan, keep applying the "verify claimed no-change files by
reading the actual code, not trusting the plan's assertion" habit — it paid off here (composite.ts) and in
PR1 (D7 safety bar). Also: this repo's working tree accumulates stray untracked files from other
concurrent sessions/users (screenshots, a `fixes.pages` doc) — these are noise, not part of the diff
(`git diff` only shows tracked changes), consistent with
[environment_concurrent_agent_sessions](environment_concurrent_agent_sessions.md); don't flag them as
PR scope violations, just note they exist.
