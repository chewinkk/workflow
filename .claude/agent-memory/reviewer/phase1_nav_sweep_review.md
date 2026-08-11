---
name: phase1-nav-sweep-review
description: Review of Phase 1 "nav sweep + glass polish" (nav-glass, nav refraction, ambient noise/4th orb, badge unclip, credit-counter/notification-bell lg-btn swap) — FAIL, found a real cascade-layer regression
metadata:
  type: project
---

Reviewed 2026-07-19 (branch claude/phase-1-glass-primitives), against
`phase1-nav-sweep-plan.md`. Every file-by-file step (1a-1d globals.css, 2a-2f
side-nav.tsx, ambient-background.tsx restructure, notification-bell.tsx badge
move, credit-counter.tsx) matched the plan diff almost exactly, all three
open questions (Q1 gate all 4 orbs, Q2 `lg-btn lg-tint-accent`, Q3 nav
refraction GO) were answered as approved. `npm run build` (real typecheck,
no `ignoreBuildErrors`) and the two targeted vitest files passed. Scope was
clean — `git diff --stat` showed exactly the 5 named files, nothing in
`.lg-tint-*`, `button.tsx`, modal, inputs. **Verdict: FAIL** — one real
blocker found that both the plan and the reviewer brief explicitly claimed
was fine but isn't.

**Blocker — CSS cascade-layer bug breaks credit-counter's low-balance glow.**
`app/globals.css` has exactly one `@layer base { ... }` block (closes at
line 84); everything after that — `.liquid-glass`, `.lg-btn`, `.lg-tint-*`,
the new `.nav-glass` — is **unlayered** CSS. Tailwind v4's generated
utilities (`border-accent/50`, `shadow-[...]`, `text-accent`) are emitted
inside `@layer utilities`. Per the CSS Cascade Layers spec, an unlayered
normal-priority declaration *always* beats a layered one, regardless of
source order or specificity. Confirmed empirically by grepping byte offsets
in the built `.next` CSS: `.lg-btn{` compiles at a position after `@layer
utilities{...}` closes, while `.border-accent\/50{`, `.shadow-[0_0_20px_...]`,
and `.text-accent{` all compile *inside* that layer. So in
`components/ui/credit-counter.tsx`, adding `lg-btn` to the base classes means
the conditional `glowing && "border-accent/50 shadow-[...] text-accent"`
classes can never win — the low-balance warning indicator (border, glow
shadow, accent text) is silently dead code after this diff. The plan's own
rationale ("those utilities are layered and win over `.lg-btn`") asserted
the *opposite* of the real cascade-layer rule and was never verified against
compiled CSS. Same root cause would silently affect any future `lg-btn` +
conditional-Tailwind-utility pairing anywhere in the codebase — worth a
general rule: **never rely on a plain Tailwind utility class to override an
unlayered custom CSS class's properties; it cannot win.** A real fix needs a
dedicated unlayered class (e.g. a `.lg-glow-accent` sibling to
`.lg-tint-accent` in globals.css) or restructuring, not just adding the
utility class name — didn't fix it myself (reviewer role + needs a judgment
call on approach).

**Nit (pre-existing, not introduced by this diff, but newly exposed):**
`components/ui/use-glass-refraction.ts:113`
`parseFloat(getComputedStyle(el).borderTopLeftRadius) || 20` — the `|| 20`
fallback misfires for a legitimate computed radius of exactly `0` (falsy),
silently substituting 20px. `.nav-glass` (new consumer via `side-nav.tsx`)
has no `border-radius` at all, so the nav's displacement map now bevels its
four screen corners as if 20px-rounded even though they're square. Low
practical impact (only affects the outermost ~20px of the corner pixels of a
big rail, not the dominant vertical edge), but it's the first real-world
case since previously only `GlassCard` (actual radius = 20px, matching the
fallback by coincidence) used this hook. Not blocking; flag if this hook
gains more callers with non-20px/non-rounded surfaces.

Useful verification technique for future CSS-cascade-adjacent reviews: don't
trust a plan's cascade/specificity claim by reading source order alone —
build the app (`npm run build`) and grep byte offsets of the compiled CSS in
`.next/static/chunks/*.css` for `@layer utilities{` open/close vs. the
competing class's own position, to determine empirically whether a rule is
layered or unlayered. This is fast, deterministic, and doesn't need a
browser.

Related: [[phase1_pr1_liquid_glass_tokens]], [[phase1_glass_refraction_review]],
[[phase1_glass_settings_review]] (same globals.css/glass-hook family, all
prior PASSes in this phase — this is the first FAIL).
