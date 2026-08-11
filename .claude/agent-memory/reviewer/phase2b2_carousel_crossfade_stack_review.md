---
name: phase2b2-carousel-crossfade-stack-review
description: Review of ImageCarousel's AnimatePresence-to-always-mounted-stack rewrite (gapless crossfade fix) — FAIL, found direction-dependent stacking-order asymmetry
metadata:
  type: project
---

Reviewed 2026-07-20 (uncommitted working changes on claude/phase-2d-wizard, 4 files:
components/ui/image-carousel.tsx, app/globals.css, components/ui/glass-card.tsx,
app/(dashboard)/listings/page.tsx). Verdict: **FAIL** — one real should-fix bug on the
carousel, everything else (CSS sheen softening, listings checkbox fade) was clean.

**Should-fix — crossfade stacking order is NOT direction-symmetric.**
`components/ui/image-carousel.tsx:97-113` now renders every frame via `images.map`,
each `position:absolute inset:0` with `z-index:auto`. Per CSS 2.1 Appendix E, positioned
descendants with `z-index:auto` paint in **DOM tree order** among themselves — so the
literal array index, not recency, decides who's on top. Effect: going forward (low index
→ high index), the higher (incoming) index is later in the DOM and paints on top —
correct, standard "new fades in over old" look. Going backward (high index → low index),
the higher (now-outgoing) index is *still* later in the DOM and still paints on top — so
backward nav looks like "old image fades away to reveal new one underneath" instead of
matching the forward direction's look. Both are gapless (the stated goal), but the two
directions don't feel the same, and the task's own verification checklist explicitly
asked to confirm this. Fix would need a z-index tied to navigation recency (e.g.
`z-index: i === displayIndex ? 1 : 0` isn't enough either — need the *previous* displayIndex
to stay on top during its own fade-out, e.g. track prev index and bump its z-index while
transitioning) rather than relying on array-order tree stacking.

**Material but consciously-accepted tradeoff — eager multi-image loading.**
`components/ui/smart-image.tsx:31` hardcodes `loading="eager"` (pre-existing, not part of
this diff). Previously only the currently-displayed frame was ever mounted (AnimatePresence
keyed swap), so each catalog card issued one eager image fetch. Now every frame in
`images.map` mounts immediately, so a catalog grid page (`app/(dashboard)/catalog/page.tsx`,
confirmed **unpaginated** — `visibleProducts` renders the full filtered list, no
slice/limit) eager-fetches every image of every product on initial paint, not just the
first. This compounds because `loading="eager"` also defeats native browser lazy-loading
for the off-screen extra frames. Flagged per the task's own instruction ("flag if
material, note it's the intended gaplessness tradeoff") — not blocking, but worth raising
if catalog product image counts grow.

**Clean / verified correct:**
- No remaining `AnimatePresence`/`displaySrc` references anywhere (grepped whole repo).
- `carouselDisplayIndex` (image-carousel.tsx:14-23) and its test file (`image-carousel.test.ts`)
  untouched — diff and 5/5 passing tests confirm.
- New `pointer-events: none` on non-current frames (image-carousel.tsx:104) is a necessary
  correctness addition (not just polish) — without it, a higher-index invisible frame
  stacked on top would swallow clicks/hover meant for the visible frame underneath, a bug
  that couldn't exist under the old keyed-swap approach since only one frame was ever mounted.
- `app/globals.css` sheen/shadow changes confined to exactly the two named rules
  (`--glass-shadow`, `.liquid-glass` background) — grepped for all `135deg` occurrences,
  confirmed the third hit (`.nav-glass` at globals.css:261, values 0.18/42%) is a
  pre-existing, deliberately distinct constant for the side-nav, not a missed spot.
- `components/ui/glass-card.tsx` low/high branches match globals.css exactly (0.22, 46%).
- `app/(dashboard)/listings/page.tsx` `mt-2` + `duration-300 ease-out` changes: no layout
  regression (checkbox is `absolute`, doesn't consume flow space; `mt-2` only pushes the
  sibling image div down 8px for clearance).
- `npx tsc --noEmit` clean, zero errors.
- `npm run test` reproduced the exact same 8 pre-existing failures (ebay-research,
  trend-score, margin route) documented in [[phase2b_carousel_review]] and
  [[phase1_glass_refraction_review]] — now confirmed unrelated across 4+ review sessions,
  safe to keep treating as the fixed baseline.

Related: [[phase2b_carousel_review]] (original carousel review, PASS — this is a follow-up
fix to that same component after a real gap bug was found in production use).
