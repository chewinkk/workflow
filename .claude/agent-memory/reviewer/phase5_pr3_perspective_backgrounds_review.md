---
name: phase5-pr3-perspective-backgrounds-review
description: Review of Phase 5 PR3 (per-perspective backgrounds) — passed with one nice-to-have concurrency finding
metadata:
  type: project
---

Reviewed branch `claude/phase5-3-perspective-backgrounds` against the plan's PR3 section (D5/D6). PASS.

All plan steps done: schema + migration (`prisma/migrations/20260720140000_add_background_perspective_urls`,
additive `ALTER TABLE ... ADD COLUMN`), `lib/shot-perspective.ts` extended with `parsePerspectiveUrls`
(tolerant, `{}` on any malformed input) and `selectBackgroundUrl`'s `BackgroundLike.perspectiveUrls`
changed from a pre-parsed object to a raw `string | null` (only call site is `app/api/swaps/route.ts`,
compiles clean — grepped for stale callers, found none), new
`app/api/backgrounds/[id]/perspective/route.ts` (auth/dynamic-params signature matches
`app/api/backgrounds/[id]/approve/route.ts` exactly: `ctx: { params: Promise<{ id: string }> }`,
`await ctx.params`), swaps route resolves `bgSelectionPerspective` at route level with the documented
v1 limitation (Auto renders on flat-lay bg; only Manual follows the chosen angle), swap page adds a
"Generate this angle (3 credits)" button gated by `needsGeneratedAngle` (D6-aware, checks map + legacy
`perspectiveUrl`), Button's `loading` prop already sets `disabled={disabled || loading}` internally so
`loading={generatingAngle}` alone prevents same-tab double-submit (established codebase pattern, see
`components/ui/button.tsx`).

Verified: `npx vitest run lib/shot-perspective.test.ts` 12/12 pass, `npx tsc --noEmit` clean, full
`npm run test` shows exactly the same 8 pre-existing failures as documented baseline (ebay-research 6,
trend-score 1, margin-route 1) — no regressions. `npm run lint` shows zero new issues in touched files
(one pre-existing error in `swap-state-provider.tsx:312`, unrelated to this diff — confirmed via
`git show HEAD:<path>`, line was already there before PR3's changes).

One nice-to-have finding (not a blocker): `POST /api/backgrounds/[id]/perspective` does a
read-then-merge-then-write on `Background.perspectiveUrls` (reads `existing` map before the slow
network generation, writes `{...existing, [perspective]: url}` after). Two concurrent requests for
*different* perspectives on the same background (e.g. two tabs) can each read the same stale `existing`,
both charge 3 credits, and whichever persists last silently drops the other's generated URL from the
JSON map. The plan explicitly flagged this exact risk and deferred it; judged low severity for a
single-user action (worst case: one lost map entry + a redundant charge, recoverable by regenerating).
Not fixed — reported as a should-fix-later, not a blocker.

See planner's plan section D5/D6 in the phase5-plan.md scratchpad (PR3, lines ~248-307).
Link: [[phase5_pr1_shot_perspective_review]], [[phase5_pr2_footprint_crop_review]] for the earlier PRs
in this same sequential chain.
