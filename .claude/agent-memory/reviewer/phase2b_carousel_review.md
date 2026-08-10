---
name: phase2b-carousel-review
description: Review of Phase 2B (catalog ImageCarousel, hover-peek state machine, modal button restack) — PASS
metadata:
  type: project
---

2026-07-19, PASS, no blockers/should-fix/nits. All 4 focus areas (state machine, arrow
visibility, hover-fade, click-through) verified by direct reasoning through
`carouselDisplayIndex` (components/ui/image-carousel.tsx:14-23), not just trusting the 5
passing tests.

Non-obvious finding worth remembering: when a Tailwind `group` class exists on BOTH an
outer wrapper (GlassCard) and a nested inner wrapper (the carousel's own div), and a
`group-hover:` utility lives inside the inner one, it is NOT dead/shadowed code — CSS
`.group:hover .foo` is a plain descendant combinator, so hover on *either* ancestor
satisfies it. Don't flag nested `group` as redundant without checking this; first
instinct (nearest-ancestor-wins, like JS scoping) is wrong for CSS class selectors.

Full `vitest run` again showed exactly the 8 pre-existing failures (ebay-research,
trend-score, margin) named in the task brief — same set as [[phase2a_product_origin_review]].
This is now a repeated pattern across phases; safe to treat that trio as the fixed
"known failures" baseline for this repo unless a task explicitly says otherwise.
