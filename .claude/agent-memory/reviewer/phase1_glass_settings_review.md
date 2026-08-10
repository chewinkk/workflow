---
name: phase1-glass-settings-review
description: Review of configurable Liquid Glass settings feature (glass-refraction-store, use-glass-refraction two-cache fix, app-settings glass column, preferences UI) — PASS
metadata:
  type: project
---

Reviewed 2026-07-19 (branch claude/phase-1-glass-primitives): 7-param live-tunable
GlassSettings, persisted per user, threaded through a framework-agnostic store +
SSR no-flash injection + a new "Liquid glass" preferences section. Matched the
approved plan (`glass-settings-plan.md`) essentially line-for-line across all 11
implementation steps + 12 (tests). Verdict: PASS.

Key things confirmed, useful for future glass/settings-shaped reviews:
- The cache-key split (`displacementKey` for the canvas/map, `filterKey` for the
  `<filter>` markup) is the actual fix for a real staleness bug — verified by reading
  `getOrBuildFilterId` in [[use-glass-refraction]] line by line, not just trusting the
  plan's description.
- `DATABASE_URL="file:./dev.db"` in `.env` resolves relative to the **repo root**
  (per `prisma.config.ts`), not `prisma/dev.db` — `prisma/dev.db` is a stale/empty
  decoy. If you go looking for the real sqlite file to verify a schema push, check
  `.env`'s `DATABASE_URL` first, don't assume `prisma/<name>.db`.
- When a plan lists an "Assumption" as opt-in/deferred (e.g. "I'll add the sheen only
  if you say so"), check whether the reviewer brief's focus-area wording already
  answers it — here focus area 7 explicitly described the sheen as expected, meaning
  the assumption had been resolved to "yes, add it" in an earlier conversation not
  visible in the plan file itself. Don't flag the addition as scope creep without
  checking this.
- Found one real but non-blocking gap: a settings `RangeInput` dimmed disabled sliders
  via CSS (`opacity-40 pointer-events-none`) without setting the native `disabled`
  attribute, so keyboard/arrow-key input still worked — inconsistent with
  `components/ui/button.tsx`'s pattern of pairing a real `disabled` attribute with a
  Tailwind `disabled:` variant. Not fixed because the plan explicitly permitted
  "or dim them" as optional polish — worth citing next time this exact pattern
  reappears, to see if it's become a recurring shortcut.
- Same 8 pre-existing unrelated `npm run test` failures as
  [[phase1_glass_refraction_review]] (ebay-research/trend-score/margin route) —
  third review in a row where these are confirmed unrelated; stop re-verifying
  from scratch each time, just cite the prior memory.

Related: [[phase1_glass_refraction_review]] (prior session in this same phase,
also PASS — this task builds directly on that one's store/hook).
