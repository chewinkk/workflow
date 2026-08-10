# Reviewer memory

Notes from past reviews. Check this before reviewing; link entries with [[filename]] syntax.

## Liquid-glass WebGL UI (branch claude/liquid-glass-ui-st4iol, reviewed 2026-07-21)

**All four findings below were fixed after this review** via a shared
[[components/ui/glass-canvas-state.ts]] flag (DashboardClient publishes whether the canvas is truly
mounted; the runtime bridge gates `body.glass-webgl` on it, and GlassCard gates the SVG hook on it),
plus a `disabled` arg on `useGlassRefraction`, a `webglcontextlost` handler in SilkCanvas, and
un-disabling the corner-radius slider. The entries are kept as recurring *lessons*, not open bugs.

- [[components/ui/glass-card.tsx]] calls `useGlassRefraction(innerRef)` (in [[components/ui/use-glass-refraction.ts]])
  unconditionally, even when `webgl` is true. That hook sets an *inline* `el.style.backdropFilter`,
  which beats any stylesheet rule without `!important` — so the "punch a transparent hole" CSS in
  [[app/globals.css]] (`body.glass-webgl .liquid-glass[data-glass-panel]{backdrop-filter:none}`) never
  actually wins on Chromium. Any future "opt a card out of the CSS/SVG glass path" prop needs the hook
  itself gated (early-return), not just a class added elsewhere — inline styles from an unrelated hook
  will silently override class-based CSS every time.
- Watch for two independent pieces of code computing "is the fancy background actually active" and
  expecting them to agree without an explicit shared source of truth. Here, [[components/layout/dashboard-client.tsx]]
  decides whether `<SilkCanvas>` mounts (WebGL support + reduced-transparency + wallpaper), while
  [[components/settings/glass-runtime-bridge.tsx]] independently decides the `body.glass-webgl` CSS class
  from `glassType` alone — no wallpaper/support awareness. They diverge exactly on the two fallback paths
  (no-WebGL, custom wallpaper) that the task explicitly required to degrade gracefully. Same lesson as
  the primer above: when a design has a "one canvas decides the visual, CSS classes describe it"
  split, the class-setting code must consult the *same* gating condition as the mount code, not a subset.
- WebGL context-loss (`webglcontextlost`/`webglcontextrestored`) is easy to forget: the setup path
  ([[components/layout/silk-canvas.tsx]]) correctly calls `onUnsupported()` for compile/link failures at
  mount, but nothing listens for a runtime context loss — GL calls just silently no-op and the canvas
  freezes on its last frame with no fallback. If "fall back to CSS glass on WebGL failure" is a stated
  requirement, check both the initial-probe path and the runtime-loss path.
- Settings sliders that are conditionally disabled per glass "mode" need to be checked against what
  CSS variable they actually drive — `cornerRadius` in [[components/settings/preferences-panel.tsx]] is
  disabled for glassType "three" under an "WebGL-only" comment, but `--glass-radius` (which it sets, via
  [[components/settings/glass-runtime-bridge.tsx]]) is consumed by the base `.liquid-glass` rule in
  [[app/globals.css]] that applies to *every* glass type, including "three".
- This codebase's convention: only `lib/` gets colocated `*.test.ts`; `components/` is essentially
  untested (one pre-existing exception). The bugs above all live in component/hook wiring that has zero
  test coverage — expect this pattern (correctness bugs in effect/store/CSS-class wiring, not in the
  well-tested `lib/` pure functions) to recur on any future glass/canvas work.

## Re-review of commit e9af15c (fixes for the four findings above, reviewed 2026-07-21)

**PASS.** Verified each fix in isolation against the finding it targets — see the commit's own
diff, not a full re-audit. `npx tsc --noEmit` clean; `lib/glass-displacement.test.ts` +
`lib/app-settings.test.ts` 21/21; full `npx vitest run` only fails the three pre-existing/unrelated
files (`lib/ebay-research.test.ts`, `lib/trend-score.test.ts`,
`app/api/analytics/margin/route.test.ts`) — no new failures.

- Finding 1 (double refraction on webgl cards) and finding 2 (holes punched with no canvas) are both
  actually fixed: [[components/ui/glass-canvas-state.ts]] is the single shared boolean, and
  [[components/ui/use-glass-refraction.ts]]'s new `disabled` param does an early-return that clears
  inline styles *and* has `[ref, disabled]` in its effect deps, so flipping the flag both directions
  (SVG on -> off -> on again) re-applies correctly — no stale closure.
- Effect-ordering check worth remembering for any canvas/CSS-class-gating pair: React runs a child's
  effects before its parent's in the same commit, so [[components/layout/silk-canvas.tsx]] (child)
  always mounts/creates its GL context before [[components/layout/dashboard-client.tsx]] (parent)
  publishes `setGlassCanvasActive(true)` — the hole-punch class genuinely can't apply before the canvas
  exists. Confirm this ordering explicitly rather than assuming it; it's easy to get backwards if the
  publisher is the child instead of the parent.
- Incidental, not a regression from this diff, not one of the four findings, but worth flagging for
  whoever next touches Glass Three: [[components/ui/use-glass-refraction.ts]]'s `apply()` never checks
  `glassType` at all — only `p.enabled`/reduced-transparency. For a `webgl`-marked card (e.g.
  `app/(dashboard)/catalog/page.tsx`), `disabled = webgl && canvasActive`, and `canvasActive` is true
  under glassType "three" too (SilkCanvas mounts for "three", it just skips drawing panels), so the
  SVG hook happens to stay off and the flat `.glass-flat` CSS wins — correct by coincidence. But if a
  browser has no WebGL support (canvasActive false) while a user is on "three", `disabled` is false and
  the SVG lens-refraction filter comes back and beats the flat CSS again (inline-over-class, same class
  of bug as finding 1). Not introduced by e9af15c; pre-dates it; still open.
- `npx eslint components/layout/dashboard-client.tsx` reports one `react-hooks/set-state-in-effect`
  error at the `setWebglOn(false)` early-return inside the wallpaper effect — confirmed pre-existing
  (present at e9af15c~1 too), not something this fix introduced. Don't mistake this for new breakage
  when re-running lint on this file.
- Stale comments not touched by this diff, still misleading: [[app/globals.css]] line ~273 says "No
  panel opts into `webgl` yet, so this selector currently matches nothing" and
  [[components/ui/glass-card.tsx]]'s `webgl` prop doc says "No page opts into this yet" — both false,
  `webgl` is used on 13+ pages already. Cosmetic, but flag if touching either file next.

## Color-theme glass tint (branch claude/color-theme-glass-tint-f1mafr, reviewed 2026-07-22)

**PASS**, one minor non-blocking finding (test-coverage gap, not a correctness bug). `tsc --noEmit`
clean, `npx eslint` on every touched file shows zero new errors (the 2 pre-existing errors + 1 warning
in [[app/(dashboard)/settings/page.tsx]] reproduce identically on the pre-diff version — confirmed via
`git stash`), targeted tests 44/44, full `npx vitest run` 802 passed/2 skipped with only the one
pre-existing DB-not-provisioned failure (`app/api/analytics/margin/route.test.ts`, matches CLAUDE.md's
documented libSQL/dev.db gotcha). Note for the baseline: `lib/ebay-research.test.ts` and
`lib/trend-score.test.ts`, flagged as failing in the 2026-07-21 liquid-glass re-review below, are green
now on both a standalone run and inside the full suite — unrelated to this diff, don't re-flag them.

- [[lib/glass-displacement.ts]]'s new `hexToHsl`'s hue-wraparound branch (`h < 0 -> h += 360`, hit
  whenever the max RGB channel is red and blue > green, i.e. any magenta/pink accent) has no direct test
  in [[lib/glass-displacement.test.ts]], even though the plan explicitly asked to confirm hue wraparound
  was tested. All the hue tests use primary colors (0/120/240) which never touch that branch. I hand-
  verified it against Python's `colorsys.rgb_to_hls` for the actual palette accents that hit it
  (Midnight Rose `#E040A0`, Neon Pink `#EC4899`, Rose Quartz `#F472B6` in `BUILT_IN_PALETTES` in
  [[app/(dashboard)/settings/page.tsx]]) and the math is correct — this is a coverage gap, not a bug, but
  a plan's own verification checklist item that didn't actually get checked. Lesson: a test file can grow
  by 60+ lines and look thorough while still missing the one case the plan called out by name — diff the
  checklist against actual `it(...)` bodies, not just file-size/count. (Follow-up: closed in the same
  commit — [[lib/glass-displacement.test.ts]] now has a `#E040A0` -> hue 324 wraparound test.)
- New gotcha for any future "read the live theme color into JS" code: `--accent` in [[app/globals.css]]
  is defined as `var(--color-blue)` — an unresolved var() token. `getComputedStyle(el).getPropertyValue("--accent")`
  returns the literal string `"var(--color-blue)"`, not a color. Always read the leaf custom property
  (`--color-blue`) that actually holds a hex literal, written by both the SSR `:root{}` block in
  [[components/layout/dashboard-shell.tsx]] and `applyThemeColors` in [[app/(dashboard)/settings/page.tsx]].
  This diff's [[components/layout/silk-canvas.tsx]] got it right and even comments on why.
- `getComputedStyle().getPropertyValue()` on a custom property can come back with a leading space in
  Chromium depending on how it was set. `hexToHsl` in [[lib/glass-displacement.ts]] already `.trim()`s
  and has a dedicated test for it — a good pattern to expect/require in any future code that reads a CSS
  custom property into JS in this codebase.
- Confirmed precedent for the next additive `GlassSettings` field: [[components/settings/preferences-panel.tsx]]'s
  `saveGlass` always re-serializes the *whole* merged glass object (pre-existing, documented in a comment
  there), and `/api/settings/preferences` persists whatever `parseGlassSettings` in [[lib/app-settings.ts]]
  produces — so a new field only needs the type, the default, and the parse/clamp line; no API route
  change. Held true for `tintFromTheme`.

## Animated-wallpaper library (branch claude/liquid-glass-ui-st4iol, commit d23a303, reviewed 2026-07-22)

**FAIL** — one concrete, narrow, easily-fixable bug in exactly the area the task asked me to scrutinize;
everything else (uniform re-upload after rebuild, `bg()` uv wrapper, follow-theme math, store-seeding
order, persistence wiring) checked out correct. `tsc --noEmit` clean, `npm run build` compiles, full
`npx vitest run` 804/805 passed (the one failure, `app/api/analytics/margin/route.test.ts`, is the same
pre-existing DB-not-provisioned issue noted in the two entries above — needed a local `prisma db push`
to pick up the new `User.wallpaperShader/wallpaperHue/wallpaperFollowTheme` columns first; not a diff bug).

- **Real leak**: [[components/layout/silk-canvas.tsx]]'s `buildProgram()` never calls
  `gl.deleteShader()` on the vertex/fragment shader objects it creates, on either the success or the
  failure path. Before this diff that only happened once per mount (harmless). This diff makes
  `buildProgram` a runtime-repeatable operation (rebuilds on every wallpaper switch via
  `subscribeWallpaperParams`), so every switch now leaks 2 `WebGLShader` objects for the life of the
  context. Fix is a one-liner: `gl.deleteShader(vs); gl.deleteShader(fs)` right after a successful
  `gl.linkProgram`, and delete whichever of `vs`/`fs` did compile on a failed attempt too. General
  lesson: when a diff turns a "build once at mount" GL path into a "rebuild on demand" path, re-check
  every object the build function creates for whether it's ever freed — leaks that were invisible at
  1x/mount become real at Nx/session.
- **Minor**: the new hue slider in [[app/(dashboard)/settings/page.tsx]] locks itself while "follow
  theme" is on using only `opacity-40 pointer-events-none` on the wrapper `div` — the `<input
  type="range">` itself has no `disabled` prop, so a keyboard user (Tab + arrow keys bypasses
  `pointer-events-none`) can still change and persist `wallpaperHue` while the control reads as
  disabled. The sibling `RangeInput` in [[components/settings/preferences-panel.tsx]] does set
  `disabled={disabled}` on the actual input — copy that pattern, not just its CSS classes, for any new
  conditionally-disabled range slider in this file. Same family of bug as the corner-radius-slider
  finding in the first liquid-glass entry above (a slider *looks* disabled but the thing that actually
  gates it doesn't agree) — worth grep'ing for `pointer-events-none` next to `type="range"` whenever
  reviewing a new slider in this codebase.
- Confirmed safe (no repeat of past findings): the rebuild-failure path — `buildProgram` returning
  false mid-session — leaves the old, still-good `prog`/uniforms untouched (it only swaps `prog` after
  a successful link), sets `lost = true`, and calls the same `onUnsupported` -> `setWebglOn(false)`
  path in [[components/layout/dashboard-client.tsx]] that a mount-time failure uses, so the canvas
  actually unmounts and the effect cleanup (listeners, observers, subscriptions) really does run — no
  orphaned listeners left on a detached canvas.
- Environment note, not a diff issue: mid-review, `git status`/`git diff` briefly showed an
  inconsistent state (branch tracking flipped to `origin/main`, one file's diff transiently disappeared
  then reappeared, and the whole working tree ended up auto-committed to `d23a303` by something other
  than me). Content was byte-identical before and after once things settled, so it didn't change any
  finding, but if `git diff`/`git status` looks self-contradictory mid-review on this repo again, re-run
  `git diff HEAD` (not plain `git diff`) and don't trust a single snapshot.
- [[lib/wallpapers.ts]] has no colocated `lib/wallpapers.test.ts` despite exporting real branching logic
  (`getWallpaper()`'s id-lookup-with-fallback) — CLAUDE.md's stated lib/ convention and ~84% of lib/
  files having a colocated test. Cheap gap to close, non-blocking.

## Adaptive Chrome Contrast (branch claude/adaptive-chrome-floor, uncommitted, reviewed 2026-07-24)

**FAIL** — one concrete, empirically-confirmed geometry bug in exactly the "highest-risk" area the
task asked me to verify closely (the sampler in [[components/layout/silk-canvas.tsx]]); everything
else checked out (in-frame readback validity, `floorReady` gating, band-flip math, CSS layering/
specificity, `data-chrome-pill` scoping, conventions, tests, tsc, eslint). `npx vitest run
lib/chrome-floor.test.ts lib/glass-displacement.test.ts lib/app-settings.test.ts` 60/60 exactly as
predicted, `tsc --noEmit` clean, full `npx vitest run` 822 passed/2 skipped (only the pre-existing
margin-route DB-not-provisioned failure), `npx eslint` on every changed file shows only the two
already-known pre-existing issues (confirmed byte-identical via `git stash`, not just a line-shift
assumption).

- **The bug**: `PILL_X_INSET_CSS`/`PILL_W_CSS` in [[components/layout/silk-canvas.tsx]] assume the
  credit-counter/notification-bell pills sit at a fixed CSS-px inset from whichever screen edge is
  opposite the sidebar. They don't — [[components/layout/dashboard-client.tsx]]'s top-strip row lives
  inside a `max-w-7xl mx-auto` centered container, and (a) never actually mirrors position when
  `navPosition="right"` (the row is always left-anchored in that container regardless of which side
  the nav docks to — no conditional flex-direction/justify keyed on navPosition), and (b) even for the
  default `navPosition="left"`, the fixed 84px inset only matches while viewport width is roughly
  ≤1350px; wider than that, `mx-auto` centering pushes the true pill position steadily right. Verified
  with a real Chromium layout (Playwright + the preinstalled swiftshader Chromium — see the environment
  note below), not just static reasoning: for `navPosition="right"` the assumed sample window has
  **zero pixel overlap** with the real pill position at every width tested (1280-2560px); for the
  default left-nav, overlap is gone by ~2560px-wide viewports (an entirely ordinary monitor size). Net
  effect: the pill floor's brightness sample can come from wallpaper unrelated to what's actually
  behind the pills, which defeats the point of the feature rather than just being imprecise — it can
  leave the floor too light exactly where the real pills sit over something bright. The sidebar/rail
  half of the same sampler (`RAIL_INSET_CSS=36`, mirrored via `window.innerWidth - RAIL_INSET_CSS`) has
  no such bug — it's correct, because the sidebar is a real `position:fixed` element pinned to the true
  viewport edge, unlike the centered content column the pills live in.
- **This is a repeat, in spirit, of a mistake this codebase already made once and never actually caught
  by review.** `git show 4c2cffb:MEMORY.md` (recoverable — the plain `git revert` of #106 collaterally
  deleted its own review history from this file, but the blob is still reachable) shows a fully-
  reverted predecessor feature, "Adapt sidebar and top-strip chrome ink to the background luminance
  (#106)" — same two zones (sidebar + these exact two pills), same silk-canvas in-frame-readback
  architecture — that used a *different*, viewport-fraction strategy for the pill/top zone
  (`topSamplePoints(vw, left)` in the old `lib/ink-contrast.ts`: `vw*0.5`/`vw*0.68`, not a fixed px
  inset) alongside a verbatim-identical `36`-px fixed inset for the nav zone (`navSamplePoints`), which
  this diff's `RAIL_INSET_CSS` also uses byte-for-byte. Neither of that old feature's two documented
  review FAILs (reduced-motion sampling before `resize()`; reduced-transparency parity between zones —
  both explicitly re-checked against this diff and confirmed *not* repeated here) was about sample-
  point accuracy, and my own spot-check suggests the old proportional formula wasn't well-calibrated
  either (at vw=1280 it points ~13-19%-of-width past where the pills actually render). So: two
  different features, two different geometric guesses, both wrong, neither ever verified against the
  real `max-w-7xl mx-auto`-centered layout. The robust fix is almost certainly to *measure* the real
  element instead of guessing its position — this codebase already has the pattern for exactly that
  ([[components/ui/glass-panel-registry.ts]]'s register/measure-every-frame flow that
  `SilkCanvas`'s own `measure()` already uses for glass panels) — point any future top-strip/pill
  geometry work at that instead of a hand-derived constant, fixed or proportional.
- Confirmed *not* repeating either of that predecessor's two caught bugs: `floorReady` here (set only
  after `bufW`/`bufH`/the readback buffers are (re)allocated in `resize()`, checked before any readback
  in `sampleChromeFloor`) structurally matches the *fixed* version of "reduced-motion samples an unsized
  300x150 buffer before the first resize," not the original broken one; and the reduced-transparency
  override in [[app/globals.css]] flattens `.nav-glass` and `[data-chrome-pill]` together in one rule,
  not nav-only like the old bug.
- **Confirmed, not new, low-priority**: a `gl.readPixels` call right after `gl.drawArrays` forces a real
  GPU pipeline stall — reproduced the exact "GPU stall due to ReadPixels" driver warning a past review
  already saw on the predecessor ink feature, via the same Playwright+swiftshader technique that
  review's environment note recommended reusing (still holds:
  `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, browser module at
  `/opt/node22/lib/node_modules/playwright/node_modules/playwright-core` since it's not in this repo's
  own node_modules, launch with `--use-gl=swiftshader`). The *first* readPixels of each pair eats the
  whole frame's queued GPU cost (tens of ms under software rendering; structurally real, if far cheaper,
  on actual hardware), not just its own small window's cost. Mirrors an already-shipped, already-
  reviewed design (same ~10Hz wall-clock throttle) and the feature is opt-in/default-off, so not
  blocking — but worth a real-hardware `window.__glassFps` check before wide rollout, same as the task
  asked.
- [[lib/chrome-floor.ts]] itself (pure math, 15 tests) is correct and thorough — hand-verified the
  rounding/gradient-string tests and the smoothstep-based ramp. Only a documentation nit:
  `relativeLuminance` computes Rec.709 luma directly off gamma-encoded 0-255 values (no sRGB
  linearization) — fine for tuning an overlay's opacity, but "relative luminance" oversells it versus
  the stricter WCAG/CIE definition if this function or name is ever reused in an actual accessibility-
  contrast context.
- No dedicated default/round-trip test for the new `chromeFloor` boolean in
  [[lib/glass-displacement.test.ts]] / [[lib/app-settings.test.ts]] (unlike `tintFromTheme`) — but this
  matches a pre-existing gap already present for sibling fields `glassyButtons`/`motionBlur`, so it's
  not a new regression from this diff, just an existing convention gap worth closing someday.
- No planner MEMORY.md entry exists for this task (same as the predecessor ink-feature review noted —
  only the superseded per-phase files under `.claude/agent-memory/reviewer/` exist).

### Resolution (2026-07-24) — geometry FAIL fixed

The pill-geometry bug above is fixed by exactly the approach the review recommended: **measure the
real element instead of guessing its position.** [[components/layout/silk-canvas.tsx]]'s pill sampler
now `document.querySelectorAll("[data-chrome-pill]")`, takes the combined `getBoundingClientRect`
bounding box (the credit counter + notification bell are adjacent in a `flex items-center gap-4` row,
so the box is ~180 CSS px wide — comfortably inside the `PILL_MAX_W=420`/`PILL_MAX_H=80` readback
buffer), and maps it into the WebGL buffer with the same bottom-up flip (`ry = bufH - pb*scale`) the
known-correct panel `measure()` uses. This is correct for any viewport width, for the `max-w-7xl
mx-auto` centering, and for `navPosition="right"` — the three cases the fixed CSS-px insets got wrong.
The deleted constants (`PILL_X_INSET_CSS`/`PILL_W_CSS`/`PILL_H_CSS`/`PILL_Y0_CSS`) are gone; the
per-sample read is clamped to `pillBufW`/`pillBufH` so it can never overflow `pillPx`; an empty/not-
yet-laid-out result (`pr>pl && pb>pt` false) skips the update and keeps the last-good var, which the
`--chrome-floor-pill` flat fallback in [[app/globals.css]] covers. The rail/sidebar half was left
untouched (it was already correct — the sidebar is a real `position:fixed` edge element).
Re-verified: `vitest` 60/60 on the three floor/settings suites, `tsc --noEmit` clean, `eslint` on
every changed file shows only the two pre-existing issues. The three non-blocking notes above
(`relativeLuminance` naming, readPixels GPU stall, missing `chromeFloor` round-trip test) are
unchanged and were deliberately left as-is — each is documented as a pre-existing pattern, not a
regression from this diff.

## Re-review of the pill-geometry fix in silk-canvas.tsx (auto-committed 9e63d3c, reviewed 2026-07-24)

**PASS**, independently confirmed — this is a second, more thorough pass over the same fix already
summarized in the "Resolution (2026-07-24) — geometry FAIL fixed" note directly above (written by
whatever process applied the fix, not by me); I re-derived every claim in it from scratch rather than
trusting it. `tsc --noEmit` clean; `eslint components/layout/silk-canvas.tsx` only the pre-existing
`measureDirty` warning; `vitest run lib/chrome-floor.test.ts lib/glass-displacement.test.ts
lib/app-settings.test.ts` 60/60; full `vitest run` 822 passed/2 skipped, same one pre-existing
DB-not-provisioned failure. No new defects found.

- New technique worth reusing for the next coordinate-mapping fix in
  [[components/layout/silk-canvas.tsx]]: instead of trusting algebra alone, compile the project's real
  Tailwind v4 CSS standalone — `postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync("app/globals.css"))`,
  no dev server or DB needed, v4's content auto-detection just needs the repo on disk — into a scratch
  HTML file that reproduces the exact markup from [[components/layout/dashboard-client.tsx]] /
  [[components/ui/credit-counter.tsx]] / [[components/layout/notification-bell.tsx]], then drive it with
  the same Playwright+swiftshader Chromium the predecessor FAIL review used (paths in that entry, up in
  "Adaptive Chrome Contrast" section). Transcribing the fix's exact `rx/ry/rw/rh` formula into the test
  script and mapping it back to CSS space across 2 dock sides x 9 widths (800-3200px) x 4 dprs (72
  combos) reproduced the real measured pill bbox every time, 0 failures — the same failure matrix the
  original bug was caught with, now clean.
- Confirmed safe but easy to get wrong in a similar future sampler: `sampleChromeFloor` calls
  `root.setProperty("--chrome-floor-nav", ...)` (a DOM write) *before* it reads the pill
  `getBoundingClientRect()`s later in the same call. Write-then-read-layout normally forces a
  synchronous reflow, but doesn't here only because [[app/globals.css]] consumes
  `--chrome-floor-nav`/`-pill` exclusively inside a `background` value (paint-only, never
  layout-affecting) — grep the CSS consumer before assuming a `setProperty`-then-measure sequence is
  free elsewhere in this file.
- Recurring environment pattern, third occurrence (see the two entries under "Animated-wallpaper
  library" and [[.claude/agent-memory/reviewer/environment_concurrent_agent_sessions.md]]): mid-review
  the whole working tree was auto-committed *and pushed* to `origin/claude/adaptive-chrome-floor` as
  `9e63d3c`, apparently by whatever wrote the "Resolution" note above — content confirmed byte-identical
  to what I'd already read beforehand. Same advice as before: re-run `git status`/`git diff HEAD` if
  state looks inconsistent mid-review, don't assume you broke something.

## Extend chrome floor to content glass + page titles (branch claude/adaptive-chrome-floor, uncommitted, reviewed 2026-07-24)

**PASS**, no functional defects. Every priority item empirically verified, not just read: compiled and
linked both the pre-diff and post-diff composed fragment shaders in a real WebGL context (Playwright +
swiftshader Chromium — see the "Adaptive Chrome Contrast" entry above for the exact paths) —
`uContentFloor=0` render is bit-exact identical to the old shader (0/480000 differing bytes), and
`uContentFloor=1` visibly/selectively darkens only glass-covered, locally-bright pixels. Title-sampler
geometry in [[components/layout/silk-canvas.tsx]] (new `[data-page-title]` measure + viewport-intersect
+ bottom-up GL flip) checked against real Tailwind-compiled markup across 2 dock sides x 6 widths x 4
dprs (48 configs) plus 4 scroll states (visible/clipped-at-top/fully-off-screen/back) — all correct,
identical formula to the already-fixed pill sampler. `prefers-reduced-transparency` `text-shadow:none`
confirmed to actually win via CDP media emulation (not just source-order reasoning). `vitest` 63/63 on
the three floor/settings suites (60 baseline + 3 new `buildTextShadow` tests), full suite 825/2 skipped
(same one pre-existing margin-route DB failure), `tsc --noEmit` clean, `eslint` byte-identical to a
`git stash` baseline on every changed file (only the two known pre-existing issues, neither touched here).

- **Real, non-blocking**: this diff reuses the single `chromeFloor` boolean for two new surfaces
  (content-glass shader floor, page-title halo) without updating any copy describing the flag —
  [[lib/chrome-floor.ts]]'s own module header still says the floor is "drawn under the sidebar... and
  the two top-strip pills" / "--chrome-floor-nav / --chrome-floor-pill", no mention of `-title` despite
  this diff adding `buildTextShadow` to that same file; [[lib/glass-displacement.ts]]'s `chromeFloor`
  field JSDoc and [[components/settings/preferences-panel.tsx]]'s user-facing toggle description ("Darkens
  the sidebar and top-strip pill glass...") are equally stale. CLAUDE.md explicitly wants lib files'
  opening comment to explain what the module is for — [[lib/chrome-floor.ts]]'s is now incomplete in a
  file this diff directly edited, not just a stale reference elsewhere. Same pattern as the "stale
  comments" finding in the very first liquid-glass MEMORY entry, now a second occurrence — grep for
  "sidebar and top-strip pill" / the `chromeFloor` JSDoc wherever this flag's surface grows again.
- Confirmed *not* a repeat of the geometry-guessing mistake in the "Adaptive Chrome Contrast" entry
  above: the title sampler measures the real element via `getBoundingClientRect()` (mirrors the
  already-fixed pill sampler) instead of a hand-derived CSS-px constant — first new geometry code on
  this feature since that fix, and it got the lesson right from the start.
- Reusable technique: to backward-compat-prove a JS-string-embedded GLSL shader change, extract the
  `const NAME = \`...\`` blocks with a plain string search (safe here since none of
  `FRAG_UNIFORMS`/`FRAG_BGWRAP`/`FRAG_GLASS`/`FRAG_MAIN` in [[components/layout/silk-canvas.tsx]] nest a
  backtick — check the raw backtick count first), compose old vs. new exactly like `buildFrag()` does,
  and diff rendered pixel buffers with the new uniform forced to its legacy value — an actual bit-exact
  proof beats algebraic reasoning about float-times-zero.
- `page.emulateMedia()`'s typed options don't cover `prefers-reduced-transparency`; open a raw CDP
  session and call `Emulation.setEmulatedMedia({ features: [{ name: "prefers-reduced-transparency",
  value: "reduce" }] })` instead.
- Confirmed scope is complete, not just correct: the only two `<h1>`s outside `app/(dashboard)/**`
  ([[app/(auth)/login/page.tsx]], [[app/(auth)/register/page.tsx]]) are correctly untagged —
  `SilkCanvas`/`GlassRuntimeBridge` only mount from [[components/layout/dashboard-shell.tsx]], so
  `body.chrome-floor` can never apply on auth pages regardless.

## Floor Depth slider on chromeFloor (branch claude/floor-depth-slider, commit 250806e, reviewed 2026-07-26)

**PASS**, no functional defects. All 5 plan items present and correct, verified by direct reading, not
just trusting the diff summary: [[lib/glass-displacement.ts]]'s new `chromeFloorDepth` (default 100,
JSDoc, added to the `PRESETS` `Omit`), [[lib/app-settings.ts]]'s clamp line, the extended assertion in
[[lib/app-settings.test.ts]], [[components/layout/silk-canvas.tsx]]'s `depthScale` (recomputed from a
fresh `getGlassParams()` call every invocation — both `sampleChromeFloor` and the
`subscribeGlassParams(() => applyParams(getGlassParams()))` callback re-read live state, no stale
closure — computed after the `!p.chromeFloor` early-return, and multiplied into all three sampled
alphas *before* `damp()`) and the `uContentFloor` shader-uniform scaling, and the conditionally-rendered
"Floor Depth" `RangeInput` in [[components/settings/preferences-panel.tsx]] wired exactly like its
"Tint Strength" sibling (same debounced save, no `immediate`). Depth=100 is bit-exact backward-compatible
(`100/100` is exact in floating point); depth=0-with-toggle-on is visually indistinguishable from
toggle-off on every surface — confirmed against the shader's own inline comment (`floorBoost==0 =>
mix(col,0.36,0.22)*0.94 exactly (legacy / chromeFloor off)`) and against `buildFloorGradient`/
`buildTextShadow` evaluated at alpha 0. `tsc --noEmit` clean, `eslint` on all 5 changed files shows only
the already-known pre-existing `measureDirty` warning, targeted suites (`chrome-floor`/`glass-displacement`/
`app-settings`) 63/63, full `vitest run` 825 passed/2 skipped (same one pre-existing margin-route
DB-not-provisioned failure). Confirmed a third time: the additive-`GlassSettings`-field precedent from
the color-theme-tint entry above still holds exactly as stated (type + JSDoc + `PRESETS` `Omit` + default
+ one clamp line, no API route change needed, no test-coverage gap this time either).

- **Real, non-blocking, worth remembering if this feature grows another knob**: the
  `--chrome-floor-nav`/`-pill`/`-title` CSS `var()` fallbacks in [[app/globals.css]] (used whenever
  SilkCanvas doesn't mount — reduced-transparency, custom wallpaper image, no-WebGL — or before the first
  sample lands) are fixed literals (`.34`/`.30`/`0.55`+`0.44`) that `chromeFloorDepth` never reaches — it
  only flows through the live JS sampler/uniform path. So on those fallback paths the "depth=0 ≡ toggle
  off" invariant that holds everywhere else (see above) breaks: dragging Floor Depth to 0 (or anywhere)
  has *zero* visible effect there, unlike the `chromeFloor` boolean itself, which the independent
  `body.chrome-floor` class toggle in [[components/settings/glass-runtime-bridge.tsx]] fully respects
  on every path, canvas or no canvas. Narrow and matches the task's own "note, don't necessarily fail"
  framing, but a static-CSS fallback silently stops tracking each new piece of live state unless someone
  deliberately threads it through — check for this explicitly next time a knob is added here.
- Recurring environment artifact again, this time on this exact feature's own files: partway through this
  review the working tree — which `git status` initially showed as 5 uncommitted modified files against
  parent `4af79f2` — had been silently auto-committed (and left the branch 1 commit ahead of
  `origin/main`, unpushed) as `250806e` by something other than me. Content confirmed byte-identical via
  `git diff 4af79f2 250806e` against what I'd already read before the commit appeared; `git show --stat`
  truncated by a `head -20` I piped it through hid one of the five changed files at first glance
  ([[lib/glass-displacement.ts]]) — re-ran without truncation to confirm all 5 files were really there.
  Same advice as the standing entries above: re-run `git status`/`git diff HEAD` (and don't truncate
  `--stat` output) if state looks off, don't trust one snapshot or one piped command.
- No planner MEMORY.md entry exists for this task (same gap noted for the two predecessor chromeFloor
  entries above).

## Wallpaper brightness setting (branch claude/wallpaper-brightness-feature-fcbwvr, commit b1ecb8f, reviewed 2026-07-26)

**PASS**, no functional defects. All 7 "verify specifically" items confirmed by direct reading, not
just trusting the diff summary: the `bg()` GLSL rewrite in [[components/layout/silk-canvas.tsx]]
preserves both the themeAdopt and hueShift branches byte-for-byte and only appends `* uWallBright`
(exact no-op at 1.0); [[components/ui/wallpaper-store.ts]]'s `current` module default includes
`brightness: 100` (no NaN-before-seed risk) and the shader upload clamps to `[0,2]`; `uWallBright` is
declared/looked-up/uploaded (all three) and `applyWallpaperLive` runs both at mount and inside
`subscribeWallpaperParams` unconditionally (post-rebuild included); the schema-to-shader and
schema-to-route data flow has no missing link (grepped every consumer of the sibling
`bgBlurAmount`/`wallpaperHue` fields, all 7 non-schema files updated); the clamp in
[[app/api/settings/wallpaper/route.ts]] mirrors `wallpaperHue`'s `Math.max(0, Math.min(360/200,
Math.round(...)))` pattern exactly; the slider fill (`value/2` over a 0-200 range) is correct; no
hand-written migration file was added (only `prisma/schema.prisma` itself changed). `tsc --noEmit`
clean; full `vitest run` 826 passed/1 pre-existing failure (margin-route, matches documented
baseline exactly); `eslint` diffed against a real pre-diff worktree checkout of the parent commit
(077d72f, not just assumption) — exactly one new lint error, discussed below, everything else
byte-identical pre-existing noise.

- **Should-fix, cheap, recurring pattern**: four "what does the wallpaper store/canvas control"
  enumeration comments across 3 files list `wallpaper, hue, follow-theme, background blur` and never
  got the word "brightness" added: [[components/layout/silk-canvas.tsx]] line 10 (module header) and
  line ~734 (`// ...always refresh the live hue/blur uniforms`, right above the
  `subscribeWallpaperParams` call this diff's own `uWallBright` upload lives inside of);
  [[components/ui/wallpaper-store.ts]] lines 2-4 (module header, misses it twice); and
  [[components/layout/dashboard-client.tsx]] lines 27-29 (the mirroring effect's own comment). Same
  family as the "stale comments" findings in the first liquid-glass entry and the "Extend chrome floor"
  entry above — third time this exact category of miss has shown up, now across 4 call sites in one
  diff. Worth actually fixing next time someone touches any of these three files, and worth grep'ing
  `hue, follow-theme` / `hue/blur uniforms` specifically before adding the next wallpaper-store field.
- **Nit, opinion requested by the task**: the new `brightnessDebounce = useRef<any>(null)` in
  [[app/(dashboard)/settings/page.tsx]] is the one genuinely new lint error this diff adds (confirmed via
  worktree diff, not assumption) — but it's a byte-for-byte mirror of the file's own pre-existing
  `blurDebounce`/`hueDebounce` refs, which already trigger the identical `no-explicit-any` rule and were
  never fixed. Mirroring local convention is fine to land as-is (keeps the file internally consistent,
  doesn't add a new category of debt); typing only the new one would leave 2-old/1-new inconsistency,
  which reads worse than the status quo. If this ever gets cleaned up, do all three refs in the same
  pass, e.g. `useRef<ReturnType<typeof setTimeout> | null>(null)` — that exact idiom already exists
  in-repo, in this same diff even ([[components/layout/ambient-background.tsx]]'s `idleTimer`).
- **Re-learned a lesson that was already recorded but not in the file I'm told to check**: I ran `npx
  prisma format` directly against the live `prisma/schema.prisma` to sanity-check the new field's column
  alignment, and it reformatted dozens of unrelated lines across the `AppSetting`/`Sale`/etc. models (this
  schema has real pre-existing alignment drift, untouched by any single feature). Caught it, restored
  from a backup I'd made first, confirmed byte-clean via `git diff <parent> <this-commit> --
  prisma/schema.prisma`. Turns out `.claude/agent-memory/reviewer/phase5_pr4_garment_options_review.md`
  already hit this exact trap once before ("never run `prisma format` as a blind fix — it's file-wide,
  hand-edit column alignment instead or diff-check after running it") but that lesson never made it into
  this top-level file, so it wasn't visible from the one place I was told to check first. Folding it
  forward here: **never run `npx prisma format` against the working copy during a review without a
  backup — [[prisma/schema.prisma]]'s `User`/`AppSetting` models are not fully aligned to what the
  formatter wants, so it produces a large diff unrelated to whatever you're actually checking.**
- Recurring environment artifact, 5th occurrence (see the entries under "Animated-wallpaper library",
  "Adaptive Chrome Contrast", the pill-geometry re-review, and "Floor Depth slider" above, plus
  [[.claude/agent-memory/reviewer/environment_concurrent_agent_sessions.md]]): mid-review the working
  tree — 9 files uncommitted at the start — was auto-committed and pushed to
  `origin/claude/wallpaper-brightness-feature-fcbwvr` as `b1ecb8f`. Per the concurrent-sessions note,
  this is most likely not a mysterious background process but literally the originating session
  finishing up in the same shared working tree, not something separate from me. Confirmed
  byte-identical to the diff I'd already read via `git diff 077d72f b1ecb8f` (65 insertions/11
  deletions across exactly the 9 listed files) — didn't change any finding.

## Accent gradient fills (branch claude/color-theme-accent-gradients-ifqaom, implemented 2026-07-26, not yet reviewed)

Theme accents now render as a blend of all 5 palette colours (not just the two vivid accents) on
opaque FILL surfaces, via new `--accent-gradient`/`--accent-gradient-h` tokens in
[[app/globals.css]]. Both are composed purely from the same leaf `--color-*` custom properties the
theme `<style>` injection in [[components/layout/dashboard-shell.tsx]] and `applyThemeColors` in
[[app/(dashboard)/settings/page.tsx]] already write, so the gradient auto-follows a theme switch (and
minimal-light's pre-darkened accent) with zero JS changes. `--color-mid`/`--color-ink` (palette
positions 3/4) aren't in the static `:root` — only an injected theme sets them — so the gradient uses
inline fallbacks for those two stops rather than adding new `:root` leaves, specifically to avoid
perturbing the wallpaper follow-theme sampler. Applied through shared `.accent-fill`/`.accent-fill-x`
classes on opaque-fill surfaces only: the primary button, the glow button (`.lg-btn--glow`), the
sidebar/auth-page logo marks, the progress-bar fill, active segmented-control/step-indicator states,
and the notification-bell unseen-count dot. Left deliberately flat (untouched): every single-hue
`--accent`/`--accent-2` use (`text-accent`, borders, focus rings, `color-mix`-based glow box-shadows),
every translucent `bg-accent/NN`/`bg-accent-2/NN` tint, and `.lg-tint-accent`/`-2`. `body.minimal
.accent-fill`/`.accent-fill-x` collapse back to the flat `var(--accent)` (minimal is meant to read as
flat, and a near-white gradient corner would otherwise bleed into the light minimal page), mirrored in
`dashboard-shell.tsx`'s `MINIMAL_GUARDS` SSR pre-hydration flash guard so first paint matches.
`tsc --noEmit` clean, `npm run build` compiled successfully (Turbopack, 99/99 static pages) — both
only after an `npm install` to repair a `node_modules` that came up nearly empty mid-task despite no
install process running at the time (no npm/prisma process found in `ps`; disk space was not the
constraint, 30G free) — matches this file's several other "concurrent/shared working tree" notes
above, just manifesting as a wiped `node_modules` instead of a surprise commit this time.

## Review: Accent gradient fills (branch claude/color-theme-accent-gradients-ifqaom, reviewed 2026-07-26)

**PASS**, 3 non-blocking findings, no regressions. All 3 "cascade/specificity correctness" items the task
called out were verified empirically against the REAL `npm run build` (Turbopack) CSS output, not just
reasoning: `.lg-btn--glow:hover`'s background correctly wins over `.lg-btn:hover`'s; `.accent-fill`/
`.accent-fill-x` (unlayered) correctly beat Tailwind's layered utilities; `body.minimal .accent-fill`
correctly flattens in both minimal-dark and minimal-light. `tsc --noEmit` clean, `npm run build` succeeded
(99/99 static pages, matches the implementation entry above), `npx eslint` on every touched file
byte-identical to `git show HEAD:<path>` baselines (only pre-existing warnings), full `npx vitest run`
827 passed/2 skipped (only the documented pre-existing margin-route DB-not-provisioned failure).

- **Methodology trap, worth repeating**: a standalone `postcss([require("@tailwindcss/postcss")()])`
  compile of [[app/globals.css]] (the technique the pill-geometry re-review entry above recommends)
  produced an apparent real bug — `.lg-btn.lg-btn--glow` rendering fully *transparent* under
  `body.minimal` in real Playwright/swiftshader Chromium, byte-identical on `git show HEAD:app/globals.css`
  (looked 100% pre-existing). Turned out to be a manual-compile-only artifact: the real `npm run build`
  output (`.next/static/chunks/*.css`) renders the same element correctly in the same browser. Didn't
  reproduce even isolating the exact 4 relevant rules verbatim in a sandbox — needs the *whole*
  ~4300-line compiled file, and disappears if either the preflight or the utilities layer is removed, so
  it's some interaction with sheer rule volume/CSS-nesting resolution, not a logic bug in any one rule.
  Lesson: a standalone `@tailwindcss/postcss` compile is fine for confirming static structure (layers,
  specificity, selector text) but always cross-check a *specific worrying computed-style result* against
  the real bundled `.next/static/chunks/*.css` before reporting it as a bug — it can diverge from what
  Turbopack actually ships.
- **New CSS gotcha for this codebase's theme-color plumbing**: a custom property that references *other*
  custom properties (`--accent-gradient: linear-gradient(..., var(--color-navy), ...)` in
  [[app/globals.css]]) resolves those inner `var()`s using the environment of wherever `--accent-gradient`
  itself is *declared* (here, always `:root`), not wherever it's *consumed* through inheritance — confirmed
  by overriding `--color-navy` on a non-root descendant (doesn't follow) vs. on `:root`/
  `document.documentElement` itself (follows correctly). Both real override paths in this codebase — the
  SSR `:root{}` injection in [[components/layout/dashboard-shell.tsx]] and `applyThemeColors`'s
  `document.documentElement.style.setProperty` in [[app/(dashboard)/settings/page.tsx]] — target
  `:root`/`<html>` directly, so this diff is safe. But the *next* feature that reads/writes `--color-*` on
  some narrower scoped element (e.g. a theme-preview swatch) would silently break `--accent-gradient`
  without breaking simple `--accent` uses. Worth a comment near `--accent-gradient`'s definition if that
  ever happens.
- **Real, non-blocking coverage gap**: two more opaque `background: "var(--accent)"` fills, structurally
  identical to the notification-bell dot this diff *did* convert (small solid circular/tag badge + white
  numeral), were missed because they're inline `style={{background:...}}`, not a `bg-accent` className —
  [[components/generation/annotation-canvas.tsx]]:431 (region-number corner tag) and
  [[components/generation/detail-inputs-editor.tsx]]:164 (region-number circle badge, in the *same file*
  this diff already touched for a different element at line 112). Grepping only `bg-accent`/`from-accent`
  classNames misses inline-style opaque fills — worth a second grep (`background:.*var\(--accent`) on any
  future "sweep every fill" task here.
- **Real, non-blocking legibility finding, concrete not hypothetical**: the task pre-cleared Lemon
  Zest/Honey Glaze as pre-existing-not-worse (confirmed true, screenshot-checked — the gradient's dark
  corner actually *improves* contrast there vs. the flat baseline). But palettes where *both* c1 and c2
  are already pale (Pearl Mist `#94A3B8`/`#CBD5E1`, Arctic Frost `#93C5FD`/`#BAE6FD`, both in
  [[app/(dashboard)/settings/page.tsx]]) hit the opposite case: WCAG contrast of white text vs. flat c1 is
  already only ~2.56:1, and the gradient's c4 near-white corner (85-100% of the 135deg diagonal) drops to
  ~1.5:1 — measurably *worse* than today's flat fill at the trailing edge of a longer button label,
  confirmed both by hand-computed contrast ratios and a real screenshot. Narrow (only the last ~15% of
  the diagonal, only bites longer labels) but a genuine exception to "the curated stops are safe."
- `.btn-primary:hover{filter:brightness(1.06)}` (new, [[app/globals.css]]:775) applies unconditionally —
  confirmed via the real build to also fire when `body.glass-btn-glassy` is active, stacking on top of
  that mode's own, more elaborate translucent-background hover change (correctly still wins the
  *background* itself, 0,2,0 beats 0,1,0, [[app/globals.css]]:410-425). Visually harmless (6% brightness
  on an already-translucent surface, doesn't fight it) but unintentional/undocumented — no comment or
  glassy-mode exclusion.
- `git stash` was classifier-blocked again this session; fell back to `git show HEAD:<path>` per
  [[.claude/agent-memory/reviewer/feedback_no_stash_when_told.md]] — that lesson only lives in the
  secondary per-phase index, not in this root file most agents check first (same "lesson wasn't where I
  was told to look" gap the wallpaper-brightness entry above found for `prisma format`). Folding forward:
  **`git stash` can get blocked by the permission classifier even when the task didn't explicitly forbid
  it — keep `git show HEAD:<path>` ready as the no-side-effect fallback for "what did this file look like
  before the diff."**
- No planner-specific MEMORY.md entry exists for this task; the "Accent gradient fills" entry directly
  above, written implementation-side, is the closest equivalent (same gap noted for the three chromeFloor
  entries and the pill-geometry entries above).

**Follow-up fixes applied post-review (same branch, 2026-07-26):**
- Coverage gap (finding 1) resolved — the region-number badges in
  [[components/generation/annotation-canvas.tsx]] and [[components/generation/detail-inputs-editor.tsx]]
  now use the `.accent-fill` class (their inline `background:var(--accent)` removed), so they render the
  gradient and flatten correctly in minimal mode like the other converted fills.
- Legibility (finding 2) mitigated — re-tuned the `--accent-gradient` diagonal stops (primary accent c1
  pulled to the 50% centre, c2 held to 88%, near-white c4 confined to the last ~12% corner) and added a
  subtle `text-shadow: 0 1px 2px rgba(0,0,0,0.3)` on `.accent-fill`, so a centred white label lands on
  saturated colour and the pale-palette (Pearl Mist/Arctic Frost) trailing-edge case is no longer
  measurably worse than the flat baseline. Full white-on-pale legibility for those pastel themes stays a
  pre-existing, out-of-scope condition.
- The unconditional `.btn-primary:hover{filter:brightness(1.06)}` (finding 3) was intentionally left as
  is — harmless per the review. `npx tsc --noEmit` and `npm run build` both clean after these fixes.

## Shipments GET try/catch + repo's first vi.mock route test (branch claude/site-issues-clarification-7jajyn, commit b722672, reviewed 2026-08-04)

**PASS**, bug #13, no defects. All 3 approved-scope items exact: [[app/api/shipments/route.ts]] GET
body wrapped in try/catch with the 401 early-return + `session.user.id` read correctly left *outside*
it (can't be swallowed), catch does `console.error("[api/shipments] GET failed:", e)` then generic
JSON 500 — char-for-char the plan. Diff is pure re-indent + wrapper, zero logic change. PATCH and
`app/(dashboard)/dashboard/shipments/page.tsx` genuinely untouched (git-confirmed; the `try {` at
committed line 195 is PATCH's pre-existing `req.json()` guard, not new). `tsc --noEmit` clean, `eslint`
on both files clean, new test + sibling account-deletion test 6/6.

- **New durable precedent worth pointing future API-route tests at**: [[app/api/shipments/route.test.ts]]
  is this repo's FIRST `vi.mock` test — `git grep vi.mock` returns nothing else. It mocks `@/auth`
  (authed session, to clear the 401 gate) and `@/lib/prisma` (`sale.findMany` rejects) and asserts the
  caught JSON 500 carries an `error` prop. Not a tautology and not testing-the-mock: it imports the real
  `GET`, and without the try/catch `await GET()` would reject so the test fails — and `res.json()`
  succeeding is itself the proof the body is non-empty JSON (the exact "Unexpected end of JSON input"
  regression). This mock-prisma pattern is the antidote to the margin-route "DB-not-provisioned" failure
  class flagged all over this file — prefer it over hitting the real dev.db for route unit tests.
- Auto-commit-mid-review recurred (~6th time, here as `b722672`) on a plain API-route bug fix, not a
  glass/canvas branch — confirming the pattern in [[.claude/agent-memory/reviewer/environment_concurrent_agent_sessions.md]]
  is task-type-agnostic. `git status` went from "1 modified + 1 untracked" to fully clean mid-review; the
  untracked test file was `git add`ed into the same commit; committed content byte-identical to what I'd
  read. Don't mistake the sudden-clean tree for lost work — check `git show HEAD`.
- No planner MEMORY.md entry for this task (only reviewer per-phase files exist — same gap as every prior entry).

## Dropdown menu rendered far down the page — inline `position:fixed` guard (branch claude/site-issues-clarification-7jajyn, bug #1, reviewed 2026-08-04)

**PASS**, no defects. [[components/ui/dropdown.tsx]]'s `Menu` `style` object now sets `position: "fixed"`
(no cast — `tsc --noEmit` clean) with an accurate load-bearing comment; the `fixed` class token is kept;
`measure()`, [[lib/dropdown-nav.ts]] and [[app/globals.css]] are untouched (git diff is a pure 9-line
addition). Live-verified with Playwright on the admin Users-tab Role dropdown: computed `position:fixed`,
menu is a direct `<body>` child anchored at exactly `trigger.bottom + 6px` (0.00px off at rest), left/width
exact. `eslint`: the one error at line 103 (`useEffect(() => setMounted(true), [])`,
`react-hooks/set-state-in-effect`) is byte-identical on `git show HEAD:components/ui/dropdown.tsx` piped
through `eslint --stdin --stdin-filename` — pre-existing, not introduced here.

- **New surface of the recurring "unlayered `.liquid-glass` beats a layered Tailwind utility" cascade bug**
  (documented for `backdrop-filter`/`background`/accent-fill in the liquid-glass and accent-gradient entries
  above) — this time it bit `position`: `.liquid-glass{position:relative}` (unlayered, [[app/globals.css]]:271,
  confirmed at brace-depth 0 — `@layer base` opens at line 9 and closes at 155) silently beat Tailwind's
  `.fixed`, so the portalled menu computed `relative` and its `top`/`left` applied from a normal-flow origin
  far down the page. Reproduced live independently of the dropdown: a bare `<div class="liquid-glass fixed">`
  appended to `<body>` computes `position:relative`. Generalize: `.liquid-glass` also forces
  `overflow:hidden; isolation:isolate; border-radius` — any element that gets `.liquid-glass` *and* a Tailwind
  `fixed`/`absolute`/`overflow-visible`/`rounded-*`/`isolate` utility meant to override one of those will lose
  to the unlayered rule; an inline style is the only reliable override. Grep new `.liquid-glass` usages for a
  conflicting positioning/overflow utility.
- **Live-geometry technique for this codebase**: framer-motion entrance tweens (here `scale:0.98`, `y:-4`)
  skew `getBoundingClientRect()` mid-animation — a first pass read the menu ~2px high and 0.98x wide and
  tripped a tight ±2px tolerance (false negative). Launch Playwright with `reducedMotion: "reduce"` (this
  repo's `useReducedMotion()` honors it, collapsing the entrance to opacity-only, `transform:none`) plus a
  short settle delay before measuring. Complements the swiftshader/postcss techniques in the chrome-floor
  entries above.
- Git state stayed consistent this review (working tree modified + uncommitted throughout — no auto-commit
  artifact this time, unlike the ~6 prior occurrences noted above). No planner MEMORY.md entry for this task
  (same gap as every prior entry — only reviewer notes exist).

## Catalog card heart z-index + density gap/height/glow (branch claude/site-issues-clarification-7jajyn, bugs #2/#3, reviewed 2026-08-04)

**PASS**, no defects, three commits (b190c0d heart, 4e7e21a heights+gap+glow, dcdbaa1 gap test). Every
approved item verified live via Playwright, not just read. `tsc --noEmit` clean; `eslint` on
[[components/catalog/catalog-product-grid.tsx]] shows only the 2 pre-existing `react-hooks/set-state-in-effect`
errors at lines 77/83 (byte-identical on `git show 9400283:...` baseline — executor's claim exact);
[[lib/catalog-density.ts]]/[[lib/catalog-density.test.ts]] eslint-clean; full `vitest run` 2045/2045
(margin-route green here — DB provisioned this session, unlike older entries).

- **THIRD live-confirmed `.liquid-glass`-family cascade escape hatch on this same branch** (after
  [[components/ui/dropdown.tsx]] bug #1 `position`, and now the heart button): the heart `<button>` is a
  direct child of GlassCard's `.liquid-glass`, so unlayered `.liquid-glass > * { position:relative; z-index:3 }`
  ([[app/globals.css]]:350) clobbered its Tailwind `absolute`/`z-20` down to `relative`/`z-3` — identical to
  the sibling image, which then painted over it. Fix is inline `style={{position:"absolute",zIndex:20}}` (the
  only reliable override of an unlayered rule). Live: computed `absolute`/`z-20`, `elementFromPoint` at button
  center returns the Heart SVG subtree (not the image) in BOTH non-compact and compact/Wall density. Pattern is
  now reliable enough to *expect* on any new child-of-`.liquid-glass` that needs positioning/overflow/z utils.
- **Glow-bleed scoping is specificity, not `!important`** (the task's phrasing said `!important` — it's wrong):
  new [[app/globals.css]] `.catalog-density-tile.liquid-glass--glow` (0,2,0) beats bare `.liquid-glass--glow`
  (0,1,0) under Liquid Glass, while `body.minimal .liquid-glass--glow` (0,2,1) still beats the new rule under
  minimal — all three confirmed live by toggling `body.minimal` and reading computed `boxShadow`. Shared
  `--glass-shadow-glow` var untouched; a non-catalog `.liquid-glass--glow` still renders the original
  `60px -10px` glow (other consumers unaffected). GlassCard ([[components/ui/glass-card.tsx]]:119) puts
  `liquid-glass`+`liquid-glass--glow`+the passed `catalog-density-tile` on one element, so the compound
  selector matches in production, not just a synthetic probe.
- **`min-h-[26px]` badge-row value is correct and independently re-derived**: one [[components/ui/badge.tsx]]
  = 22px (text-xs line-height 16 + py-0.5 2+2 + border 1+1); + `pt-1` 4px = 26px; wrapped 2/3 rows = 52/78px
  (matches the code comment). Live: all catalog cards uniformly 374px at 0/1/2 badges — the 22px 0-badge
  shortfall is closed. "Profiled" badge still `variant="success"` (untouched, as required).
- **Verify-first discipline held on bug #3**: claims (b) text-overflow and (c) image-distortion have NO code
  change (git-confirmed `truncate`/`shrink-0`/`object-cover` untouched) — executor correctly left unconfirmed
  symptoms alone. gapClass 16/16/12/8/6px confirmed live-monotonic; the new gap test exercises real data
  (reads `gapClass`, maps px, asserts non-increase + `.toBeDefined` guard against an unmapped class) — not a
  tautology.
- Auto-commit-mid-review recurred (~7th time): the separate in-flight gradient-button ticket (uncommitted
  `app/globals.css`+[[components/layout/dashboard-shell.tsx]] at review start) got committed mid-review as
  `c0399ad` on top of the reviewed commits — confirmed disjoint (touches button/gradient-strength rules, not
  the catalog glow rule / `--glass-shadow-glow` / any reviewed file). Re-ran `git diff HEAD` per the standing
  note; reviewed content intact. No planner MEMORY.md entry (same gap as every prior entry).

## Gradient-Strength for primary + glow buttons (branch claude/site-issues-clarification-7jajyn, commit c0399ad, reviewed 2026-08-04)

**PASS**, tickets #5 + #23 (gradient-opacity part), no defects. All 5 approved-scope items exact and
surgically applied — verified by reading AND live Playwright (reducedMotion reduce, real dev server,
persisted appearance confirmed = **minimal-dark** via `/api/settings/preferences`, gradientStrength 35,
gradientUi true — not assumed): new [[app/globals.css]] `--accent-gradient-strong` is a faithful 5-stop
copy of `--accent-gradient` (navy 0% / mid 16% / blue 50% / purple 88% / ink 100%, fallbacks
#1A1F35/#FFFFFF) with every stop wrapped in `color-mix(... calc(var(--accent-wash)*100%), transparent)`
(raw 1:1, no extra floor/clamp); `.btn-primary.accent-fill` compound rule (base `.accent-fill` line 892
untouched); `.lg-btn--glow`/`:hover` swap only `background:`→`background-color`+`background-image` (opacity/
border/box-shadow/transition/`:active` untouched); `body.gradient-off` + the ONE SSR guard string
([[components/layout/dashboard-shell.tsx]]:74) both extended with `.lg-btn--glow`. git diff = exactly 2
files (33+/4-); `--accent-gradient`, `--accent-gradient-wash`, `.accent-wash-fill`, secondary/glass/liquid,
[[components/settings/preferences-panel.tsx]], [[components/ui/button.tsx]], [[lib/app-settings.ts]] all
untouched. `npm run build` 140/140 pages exit 0 (the CSS gate — no stylelint), `tsc --noEmit` clean,
`eslint` on dashboard-shell byte-identical pre/post, full `vitest run` 2045/2045 (margin-route green,
DB provisioned this session).

- **Reusable pattern worth naming for the next "gradient must never fully disappear" consumer**: opaque
  `background-color: var(--accent)` FLOOR + strength-scaled `background-image` gradient over it. Live-proved
  the exact invariant on real buttons: computed `backgroundColor` is a CONSTANT opaque `rgb(79,142,247)` at
  --accent-wash 0/0.5/1 while the `background-image` color-mix alpha scales 0→0.5→1 (strength 0 = fully
  transparent image, floor shows = solid-accent button, never washed out; strength 100 ≡ old full gradient).
  Contrast with the pre-existing `--accent-gradient-wash` (secondary/glass/liquid): that paints
  background-image ONLY over each host's own translucent face (measured: secondary keeps its `bg-accent-2/20`
  oklab face, NOT forced to the accent floor) — use the wash for "tint over existing face", the floor for
  "opaque fill that dims toward solid, not transparent". Same `calc(var(--accent-wash)*100%)` idiom either way.
- **Confirmed the Glassy-Buttons specificity ladder is preserved**: on a clean `.btn-primary.accent-fill`
  under `body.glass-btn-glassy`, computed `background-color` is transparent and `background-image` is the
  glassy 2-stop gradient — `body.glass-btn-glassy .btn-primary` (0,2,1) still beats the new
  `.btn-primary.accent-fill` (0,2,0), and the shorthand `background:` correctly resets the floor so no opaque
  accent leaks under the frosted glass. This fix's longhand `background-color` does NOT survive a
  higher-specificity `background:` shorthand — good to know the shorthand-vs-longhand cascade lands right here.
- **Pre-existing guard/live DRIFT this commit correctly did NOT touch (but is the same family it DID fix)**:
  there is no live `body.minimal .accent-fill` flatten rule anymore (grep-confirmed; and the primary renders
  the gradient in real minimal-dark) — [[app/globals.css]]:815-817 says minimal now DEFERS to gradient-off so
  "gradients work in minimalistic modes." But the `MINIMAL_GUARDS` SSR strings ([[components/layout/dashboard-shell.tsx]]:29/33)
  AND the comment at [[components/settings/glass-runtime-bridge.tsx]]:44-47 both still assert "minimal flattens
  .accent-fill." Net: the primary button flashes solid (SSR guard) → gradient (live) on load in minimal mode.
  Pre-existing, out of scope (task explicitly said don't touch the minimal guards), NOT worsened here (at
  strength 35 the live gradient is subtler than the old full one). Same class of guard-vs-live drift as the
  gap THIS commit closed — `.lg-btn--glow` was missing from `body.gradient-off` (and its SSR guard) despite
  the rule's own comment claiming full coverage. Whenever a live flatten rule is removed/added, grep both the
  `MINIMAL_GUARDS`/gradient-off SSR strings in dashboard-shell AND the runtime-bridge class-toggle comments —
  this repo has repeatedly let SSR-flash duplicates and comments drift from the live CSS (see the "stale
  comments" findings across the liquid-glass/chrome-floor/wallpaper entries above).
- Live env note: on /revenue the header (glow "Add Sale" + wash-fill buttons) intermittently didn't render
  and `body` read as non-minimal for one run; /catalog rendered fully with both real glow buttons and the
  correct `minimal minimal-dark` class. Don't trust a single page's body-class/element-presence snapshot for
  "current appearance" — read `/api/settings/preferences` (authoritative) and cross-check a second page.
  Closest planner-side note is the implementation "Accent gradient fills" entry above; no planner MEMORY entry
  for this task (same gap as every prior entry).

## Click-to-expand + UploadZone letterbox border (branch claude/site-issues-clarification-7jajyn, ticket #6, commits 27b320e/6e6c83e, reviewed 2026-08-04)

**PASS**, no defects. Exactly the 11 in-scope files; [[app/(dashboard)/community/page.tsx]] (real `<video>`,
not photos), the nav-tab [[app/(dashboard)/dashboard/listings/page.tsx]] (thumb already inside a whole-row
`<button onClick={toggle}>` — nesting would be invalid HTML), and history/swap/backgrounds + `image-carousel.test.ts`
all genuinely untouched. `tsc --noEmit` clean; `eslint` on all 11 files byte-identical rule-set to the
`27b320e~1` baseline (every "diff" was pure line-number shift from added lines — no new problem); vitest
`image-carousel.test.ts` 11/11 and full suite 2045/2045 (margin-route green, DB provisioned). git HEAD=6e6c83e,
clean tree, no auto-commit artifact this review.
- **The labelUrl mix-up the task flagged is NOT present**: [[app/(dashboard)/dashboard/shipments/page.tsx]]'s
  expandable thumb reads `s.images` via `parseImages` (product photo) and its `ResultViewer url={thumb}` uses
  that same field; `s.labelUrl` stays a separate untouched `<a href>` download link. Sales reads
  `s.listing?.product?.images`, Revenue's `g.itemImage` = `firstImage(s.listing?.images)` ([[app/api/sync/orders/route.ts]]:153) —
  all product photos. Each dense-row diff only *wrapped* the pre-existing thumbnail `<img>`/SmartImage in a button
  pointing at the same source, so "what image shows" never changed — the low-risk way to add expand to a dense row.
- **New durable trap for [[components/ui/image-carousel.tsx]]**: its active crossfade frame sets an *inline*
  `style={{zIndex: i===displayIndex ? 1 : 0}}` with `pointerEvents:auto`, so it paints above and eats clicks on any
  sibling overlay with default `z-index:auto`. The new `expandable` button needs `z-10` to beat it; the
  PRE-EXISTING prev/next arrows and dots (lines ~150-199) have NO z-class and share this latent swallow bug in
  some configs — correctly left unfixed here (flag-don't-fix), byte-for-byte unchanged, noted only in a code
  comment. This is a *different* root cause from the branch's `.liquid-glass > *` unlayered-cascade family (bug
  #1/#2/#3 entries above) — inline crossfade z-index, not an unlayered rule — but same reflex: any future overlay
  added to ImageCarousel must carry an explicit `z-` above the frame's inline `zIndex:1`.
- **Reusable nesting pattern, verified live**: [[components/ui/result-viewer.tsx]] nested inside [[components/ui/modal.tsx]]
  (which listens `document`+bubble for Escape and locks `body.overflow`). Fix = window **capture-phase** listener +
  `e.stopImmediatePropagation()` on Escape (capture fires before the parent's bubble handler, so one Escape closes
  only the viewer) + save/restore the *previous* `body.style.overflow` instead of hardcoding `""` (so closing the
  nested viewer keeps the Modal's own scroll lock). Playwright-confirmed the exact sequence: modal open→expand→one
  Escape leaves `role=dialog` present & `overflow:hidden`, second Escape drops both. Copy this for any overlay that
  may open on top of a Modal. (Note: ResultViewer still doesn't trap Tab, so Tab over a modal-nested viewer reaches
  the modal panel behind it — pre-existing, out of scope, not a regression.)
- Executor correctly carried the branch's `.liquid-glass` cascade lesson forward *prophylactically*: the compact
  catalog tile ([[components/catalog/catalog-product-grid.tsx]]) and listings-grid ([[app/(dashboard)/listings/page.tsx]])
  expand buttons ship plain Tailwind `absolute z-20`/`z-10` with a comment reasoning "grandchild of .liquid-glass
  (the `.relative` div is the direct child), so no inline-style workaround needed" — the inverse of the heart
  button's inline-style guard, and correct (the `>` child combinator doesn't reach a grandchild). Live-confirmed
  `stopPropagation` on the inventory-row and compact-tile buttons: clicking the thumb opens the viewer without
  triggering the row's own edit/detail modal.
- Minor, non-blocking: the grid-level `viewer` state comment in [[components/catalog/catalog-product-grid.tsx]]
  claims it's shared by "compact tile's button AND the regular carousel's `expandable` prop" — but the regular
  carousel uses ImageCarousel's OWN internal ResultViewer (`images[displayIndex]`), so the grid-level viewer only
  ever serves compact tiles. Cosmetic doc drift, not a bug.
- Live-test coverage gap (not a defect): all seeded catalog products are single-image, so arrow/dot nav never
  renders — couldn't click-test it. Integrity rests on the byte-identical code + 11/11 helper unit tests + the new
  button being independent state (`viewerOpen` only). The executor DID seed a 400x900 non-square "ZZZ Border Fix
  Test Product" (an SVG data-URL, reachable via /listings & /catalog), which corroborates the border fix's
  live-verify-first requirement; independently reconfirmed the wrapper computes `bg-white/[0.04]` (oklab) and the
  letterbox gap reads as flat neutral fill, not glass bleed. No planner MEMORY entry for this task (same gap as every prior entry).

## Gradient sweep + Gradient Tint + icon/glow/nav fixes (branch claude/site-issues-clarification-7jajyn, commits 5b7ae7d/386941c, tickets #7/#8a/#8b/#9/#10/#23-remainder, reviewed 2026-08-05)

**PASS**, no defects across all 6 tickets. Verified by reading AND live Playwright (swiftshader Chromium, admin
login, per the chrome-floor entries above; persisted appearance = minimal-dark, restored after). `tsc --noEmit`
clean, `npm run build` exit 0 (the CSS gate), full `vitest run` 2045/2045, `eslint` on the sample byte-identical
to the `7128ff7` baseline ([[app/(dashboard)/settings/page.tsx]]'s 4 no-explicit-any errors + [[app/(dashboard)/swap/page.tsx]]'s
img warnings are pre-existing — the debounce-`any` refs already noted in the wallpaper-brightness entry above).
Tree stayed clean at 386941c throughout — no auto-commit artifact this review (unlike the ~7 priors).

- **New durable CSS gotcha, and it was this cluster's highest-risk item**: `background-image` is list-valued, so a
  *more specific* rule that sets it REPLACES the entire layer list, never appends — any `.liquid-glass`-scoped overlay
  rule ([[app/globals.css]]'s new `body.glass-tint-gradient.glass-flat .liquid-glass`) must restate the base rule's
  sheen/haze layers VERBATIM or it silently drops them. Executor got it right: layers 1-3 byte-identical to base
  `.liquid-glass` (confirmed reading AND live — computed `backgroundImage` has 3 `gradient(` on glass-flat, 4 with the
  tint class, identical heads). Precedent in-repo: `body.chrome-floor .nav-glass` restates-then-appends the same way.
  Verify this rule class live by counting `gradient(` in the computed value with/without the toggling body class.
- **Reusable technique — inset shadow for a glow nested in `overflow:hidden`**: `glow-pulse-inset` in [[app/globals.css]]
  fixes #23 ([[app/(dashboard)/swap/page.tsx]] upload zone); a `.liquid-glass p-6` ancestor's load-bearing
  `overflow:hidden` clipped the old outward `glow-pulse` on 3 sides. An `inset` box-shadow paints inside the element's
  own box -> can't be clipped by an ancestor, inherently even on 4 edges (same shape as pre-existing
  `.catalog-density-tile.liquid-glass--glow`). Chromium's `getComputedStyle().boxShadow` puts `inset` at the END of the
  string (`rgb(...) 0px 0px 12px 0px inset`) — test `/inset/`, not `/^inset/` (my first probe false-negatived).
- **Specificity tie-break, "modify don't delete"**: `body.minimal .lg-btn--glow` (#10) and sibling `body.minimal .lg-btn`
  are BOTH (0,2,1) `!important`; the `--glow` rule only wins on later source order. Deleting it (vs. splitting `background:`
  into `background-color`+`background-image` in place) would drop glow buttons to the dim 14%-accent `.lg-btn` face. Glow
  buttons carry both classes (`glow: "lg-btn lg-btn--glow"`, [[components/ui/button.tsx]]) so the tie is real; live-confirmed
  glow==primary computed gradient over an opaque accent floor in both minimal-dark and minimal-light. Whenever "flatten X in
  minimal" is a BEM-modifier rule tying a base rule on specificity, edit it, never delete.
- **#9 negative-result independently reconfirmed**: `stopColor="var(--accent)"` as a JSX prop on an `<stop>` in
  [[components/ui/liquid-glass-filter.tsx]] (zero diff) DOES resolve — live `getComputedStyle(stop).stopColor` = real
  `rgb(79,142,247)`/`rgb(155,110,243)`, and an on-page raster of a `.icon-gradient` icon is 324 fully-coloured px
  (blue->purple), not black. Trap that bit me: cloning the icon SVG into a detached blob-URL canvas rasterises BLACK (the
  external `#icon-grad` def + `:root` `--accent` don't travel with the clone) — sample the REAL on-page element screenshot,
  never a serialized clone, to prove an SVG-gradient stroke renders. `.icon-gradient` count reads 16 not 17 on /settings in
  minimal-dark — the 17th is in the appearance==="glass"-gated Liquid Glass card, hidden in minimal; reconciles under glass.
- WebGL glassType one/two get no Gradient-Tint CSS effect by design (rule needs `.glass-flat`; shader owns their tint) —
  documented in the rule's own comment; the toggle still shows on tintStrength>0 regardless of glassType (a benign
  appears-but-no-op-on-default-glassType-two case, explicitly pre-cleared as an intentional scope boundary, not a gap).
- No planner MEMORY.md entry (same gap as every prior entry on this branch).

## "Use AI" button + object-contain thumbnails on Add-to-Inventory (branch claude/site-issues-clarification-7jajyn, ticket #20, commit 0ca2213, reviewed 2026-08-05)

**FAIL** — backend plumbing is clean, but 3 of the ticket's UI-behavior clauses are inverted or absent, one a direct
violation of an explicit "do NOT" instruction. `tsc --noEmit` clean; `eslint` on all 6 files adds zero new problems
([[components/ui/modal.tsx]]'s `set-state-in-effect` at the `setMounted` effect, and [[app/(dashboard)/dashboard/inv/page.tsx]]'s
`InventoryTab`-unused + `<img>` warnings, are byte-identical on the `0ca2213~1` baseline via `git show …|eslint --stdin`);
the 2 new test files pass 7/7; `git diff 0ca2213 HEAD` on the 6 files is empty (no follow-up fix — the 2 later commits +
uncommitted tree are unrelated bulk-queue/swaps-inspect work).

- **Solid, well-tested plumbing is exactly what makes the UI miss easy to wave through — don't.** [[lib/inventory-ai-identify.ts]]
  (zod schema, injectable `InventoryIdentifyRunner` so the unit test never touches the network, `claude-sonnet-4-6` matching
  [[lib/reverse-search.ts]], returns low-confidence nulls on an inconclusive read), [[app/api/inventory/ai-identify/route.ts]]
  (401/400/502 gates), and the merge (`data.X ?? f.X` at inv/page.tsx:153-155 — non-null overwrites, null keeps hand-typed,
  correct) are all right, and both new tests use the branch's established `vi.mock` pattern. But `components/` + page `.tsx`
  are untested here by convention (first MEMORY entry), so green lib/route tests prove the *contract*, not the *ticket*.
  Durable: for any UI ticket on this repo, read the `.tsx` against every UI clause — passing lib/route tests cover none of it.
- **Explicit-instruction inversion (highest severity):** ticket said place "Use AI" next to the "Add item" submit button, NOT
  next to the modal title, and noted the executor was told this explicitly. The commit does the opposite — adds a new
  `titleAction` header slot to [[components/ui/modal.tsx]] (doc: "rendered in the header, immediately right of the title") and
  puts the button there (inv/page.tsx:428-438), leaving the real submit row untouched at inv/page.tsx:503-506
  (`flex justify-end gap-2 pt-1` … `<Button onClick={addItem}>Add item</Button>`). The commit message itself says "titleAction
  slot next to the title" — a conscious choice against the instruction, no justification, no planner entry documenting a descope.
- **Two more clauses missing/diverged:** (a) hover-highlight ("hovering it highlights the Item Name/Brand/Category fields it
  fills") is absent in every form — no `onMouseEnter`/state/ring on the 3 Inputs (inv/page.tsx:441/443/444), and no pure-CSS
  `peer`/`group` path is even possible since the button is in the header and the inputs in the body. (b) No-photo behavior
  diverges from the confirmed requirement: button is `disabled={photos.length===0}` with `if(!photo)return` in `runAiIdentify`,
  the route 400s without an image, and the lib has no text-only path — so "fall back to inferring from typed text alone (not
  disabled, not an error toast)" is unimplemented. Note the executor's own "disabled with no photo" self-report was truthful to
  the code yet still describes a scope miss: a truthful self-report is not evidence the requirement was met.
- **Verified-accurate reusable bits worth keeping:** `titleAction?: React.ReactNode` IS genuinely additive/backward-compatible
  — optional, only inv passes it; spot-checked [[components/revenue/add-sale-modal.tsx]] (`<Modal … />`, no titleAction) renders
  `{titleAction}`=undefined as nothing. And the route's "no credit charge" is real (only the comment mentions "credit"; zero
  `recordSpend`/`deductCredits`), and its cited precedent holds — neither [[app/api/swaps/inspect/route.ts]] nor
  `app/api/swaps/describe-region/route.ts` charges credits, unlike the generation routes `app/api/swaps/route.ts`/`bulk`. Cite
  those two inspect/describe-region routes as the credit-free vision-utility precedent for any future inspection endpoint.
- No auto-commit artifact this review (tree stayed at HEAD=973fd9c); the uncommitted [[app/(dashboard)/swap/page.tsx]] /
  [[app/api/swaps/inspect/route.ts]] + new bulk-queue files belong to a separate in-flight ticket, not 0ca2213 — don't conflate.
  No planner MEMORY entry (same gap as every prior entry on this branch).

**CORRECTION (orchestrator, 2026-08-05): the "Explicit-instruction inversion" and no-photo findings above are FALSE POSITIVES —
the reviewer was briefed with wrong requirements, not a defect in 0ca2213.** The primary source (the product owner's literal
brief text) reads: `Change "Add to inventory" to "Add To Inventory" … Add an "Use AI" button next to "Add To Inventory" that
when someone hovers over it, it highlights "Item name" … Brand, and Category.` "Add To Inventory" is the modal *title* (per
ticket #18's own research into the same string) — the brief itself places the button next to the title, exactly what
[[app/(dashboard)/dashboard/inv/page.tsx]] + [[components/ui/modal.tsx]]'s `titleAction` slot ship. The claim fed to the
reviewer ("next to Add Item, NOT the title — told explicitly") traced to a stale mid-session default I sent while
AskUserQuestion was failing (session msg ~453), which my own LATER "all 23 items confirmed" summary (msg ~620) corrected to
"next to the modal title" — I re-briefed the reviewer from the stale one without cross-checking the primary source. Same root
cause for the no-photo finding: msg ~620's "disabled when no photo" is what actually shipped and is correct; msg ~453's
"infer from typed text alone" was the superseded draft. **Lesson: when two of the orchestrator's own summaries about a
confirmed requirement disagree, the later "final/compact" one wins, and either way check the primary brief text before
briefing a reviewer with an "explicitly told" claim — that phrase should never be asserted without re-verifying it.** The
hover-highlight finding (#2) is UNAFFECTED by this correction and stays a real, confirmed gap — it traces directly to the
same primary-source sentence ("hovering it highlights Item Name/Brand/Category") independent of the 453-vs-620 discrepancy,
and was genuinely not implemented. Follow-up fix scoped to just the hover-highlight piece.

## Bulk-queue position-tag reliability + left/right pair vocabulary (branch claude/site-issues-clarification-7jajyn, ticket #15 / Phase 4, commit 5b847c4, reviewed 2026-08-05)

**PASS**, no defects. All ticket scope present and correct, verified by reading AND running the toolchain: [[lib/image-meta.ts]] adds `left_item`/`right_item` to IMAGE_TAGS + IMAGE_TAG_LABELS purely additively (all 8 prior tags/labels byte-unchanged; a dedicated test asserts length==10 and no rename); [[lib/bulk-inspect.ts]]'s new `coarsePosition()` + enriched `buildSummary()` (print_placement, special_features, `regions=[label:bucket]` digest) and the reworked CLUSTER_PROMPT (tag every index, default "front" for an unambiguous single view, left_item/right_item guidance) are coherent and don't contradict the surrounding prompt. `tsc --noEmit` clean, `eslint` on all 4 files clean, targeted vitest 45/45, full `vitest run` 2084/2084 (margin-route green — DB provisioned this session). 5b847c4 is an ancestor of HEAD (973fd9c, a separate Sold-Quickest ticket) and no later commit re-touched these 4 files, so the working-tree test run reflects the reviewed state; [[app/(dashboard)/swap/page.tsx]] confirmed untouched (`--stat` = exactly the 4 lib files).

- **First review on this branch outside the CSS/glass subsystem** — the branch's dominant `.liquid-glass` unlayered-cascade escape-hatch family (bugs #1/#2/#3/#6 above) and the Playwright/postcss live-CSS techniques don't apply to framework-free lib/ pure-helper + LLM-prompt code; here tsc + eslint + colocated vitest are the entire verification surface.
- **Additive-tag safety pattern, reuse for the next IMAGE_TAGS entry**: adding to [[lib/image-meta.ts]]'s IMAGE_TAGS is tsc-forced-complete because IMAGE_TAG_LABELS is `Record<ImageTag,string>` (missing label = compile error) and every consumer is generic over the array — [[lib/products.ts]]'s `z.enum(IMAGE_TAGS)`, [[app/(dashboard)/swap/page.tsx]]'s includes+label lookup, [[app/(dashboard)/listings/new/page.tsx]]'s `IMAGE_TAGS.map(...IMAGE_TAG_LABELS[t])`. A clean `tsc --noEmit` alone proves no consumer needs a manual edit (no exhaustive switch/second ImageTag Record exists). Same shape as the "additive GlassSettings field" precedent above.
- **Durable answer for testing any Claude-call lib here**: `ANTHROPIC_API_KEY=""` (empty) in `.env`, so live model behavior is genuinely untestable in-sandbox (matches the executor's disclosed limitation — not a work-around miss). [[lib/bulk-inspect.test.ts]] uses the injectable-deps `stubDeps` idiom to exercise buildSummary enrichment AND left_item/right_item plumbing end-to-end with zero network and no `vi.mock`/nock — the correct network-free pattern per CLAUDE.md. Only the model's actual tag choices under the new prompt stay unverifiable; honestly-disclosed gap, not a defect.
- **Minor, non-blocking**: [[lib/bulk-inspect.ts]]'s `coarsePosition` vocabulary is only `center` + 4 quadrants, so a region dead-centered on one axis but off the other (cx=0.5,cy=0.9) reports `lower-right`, biasing exactly-0.5 toward right/lower — harmless (coarse soft-signal to the LLM; center box `[0.4,0.6]^2` catches the truly-central case). Axis convention is correct: bbox y is top-edge per DetailRegionSchema, so cy<0.5 => "upper".
- No planner MEMORY.md entry (no `.claude/agent-memory/planner/` dir at all — same gap as every prior entry on this branch). Git tree stayed consistent — no auto-commit artifact this review (HEAD was already past the reviewed commit at start).

## Sold Quickest fix — populate listedAt across sale paths (branch claude/site-issues-clarification-7jajyn, ticket #21, commit 973fd9c, reviewed 2026-08-05)

**PASS**, no defects. Pure data-plumbing fix (not a sort-logic change), and [[lib/sold-sort.ts]] +
[[lib/sold-sort.test.ts]] are confirmed byte-identical to parent (`git diff 973fd9c~1 973fd9c --` empty,
absent from `--stat`). `tsc --noEmit` clean, `eslint` exit 0 on all 10 touched files, targeted vitest 40/40,
full `vitest run` 2084/2084 (margin-route green this session). All 5 paths verified: manual (empty-default
`listedDate` in [[components/revenue/add-sale-modal.tsx]] -> `ManualSaleSchema` -> `createManualSale`), CSV,
eBay mock, Depop (untouched), Mark Sold.

- **Load-bearing pre-existing plumbing this whole fix relies on** (verify before ever calling this feature
  broken): the comparator `daysToSale` in [[lib/sold-sort.ts]] reads a field named `listingCreatedAt`, NOT
  `listedAt` — but that field is mapped `s.listing?.listedAt ?? s.listing?.createdAt ?? null` in BOTH
  [[app/api/sync/orders/route.ts]]:161 (revenue page's source) and [[app/(dashboard)/dashboard/sales/page.tsx]]:84.
  So populating `Listing.listedAt` genuinely reaches the sort (listedAt-preferred, createdAt fallback). The
  field NAME is misleading but pre-existing; the select in sync/orders route already fetched `listedAt` too.
  This is why a fix that touches zero sort code still works.
- **Live-verified over the executor's seeded dev.db fixtures** (8 sales, 5 with real `listedAt` across
  manual/sync/csv) by replaying the exact route mapping through the real `sortSales`: order came out
  0/15/25/27/28/45 days then 2 unknowns last — monotonic, unknowns-last. Reusable technique: `npx tsx` a
  scratch script that `createClient({url:"file:./dev.db"})` (@libsql/client) + imports `@/lib/sold-sort` and
  runs the real comparator over the real rows — must live at repo root (not scratchpad) so `@/` alias +
  node_modules resolve. The two `sync` rows read 15/28 days, matching [[lib/ebay-orders.ts]]'s mock
  (now-20d->now-5d, now-30d->now-2d) exactly — mock entries are correctly listed-before-sold.
- **Mark Sold** ([[app/api/sales/sell/route.ts]]:100-118) ALWAYS `prisma.listing.create`s a fresh Listing
  (never updates an existing one — no collision branch), so `listedAt: product.createdAt` is handled in the
  only path; `product` is the owner-scoped `findFirst` with no `select` (full record -> `createdAt` in scope,
  non-null per schema line 485). Minor cosmetic: the comment calls createdAt "strictly better than null" —
  true in the common case, but for a sale backdated before the product's createdAt it yields Infinity just
  like null would (equal there, never worse).
- **Inherent coverage edge, not a regression, out of the 5 in-scope paths**: the REAL eBay Fulfillment API
  path (`mapEbayOrder` in [[lib/ebay-orders.ts]]:92-114) still can't set `listedAt` — that API exposes only
  order `creationDate` (the sale date), never the listing's original list date — so real-API eBay orders fall
  back to `createdAt`. Only the mock represents eBay in the ticket; this is an API limitation the diff
  couldn't fix, and `mapEbayOrder` never set listedAt before either.
- CSV path's Zod->tool-schema derivation is automatic as claimed: [[lib/tracker-import.ts]]'s `importToolSchema()`
  is `z.toJSONSchema(ImportResultSchema)` (which wraps `ImportedRowSchema`), so adding `listedAt` to the Zod
  schema flows into Claude's `record_import` input_schema with no separate JSON-schema edit. The new
  tracker-import test is non-tautological — Zod strips unknown keys, so it would've read `undefined` (fail)
  under the old schema. AI-extraction itself is untestable here (placeholder ANTHROPIC_API_KEY) — the
  mocked-runner + direct-`ingestMixedOrders` approach is the right substitute, matching the diagnosis note.
- No recurring past mistake repeated: the comments this diff ADDS are all accurate (no new stale/enumeration-
  comment drift of the kind flagged across the liquid-glass/chrome-floor/wallpaper entries above). Working
  tree had unrelated swaps/bulk-queue edits uncommitted throughout (concurrent-session pattern, HEAD stayed
  973fd9c) — none overlap the 10 reviewed files. No planner MEMORY entry (same gap as every prior entry on this branch).

## Retail-tag link + inspect-route instrumentation + bulk-queue group preservation (branch claude/site-issues-clarification-7jajyn, tickets #17 / #12-backend / #16, commit 950d615, reviewed 2026-08-05)

**PASS**, no blocking defects; one scope-wording discrepancy flagged for confirmation + two minor non-blocking notes. `tsc --noEmit` clean, `eslint` 0-errors on all 5 files (the 1 new `<img>` warning at [[app/(dashboard)/swap/page.tsx]]:645 mirrors the file's 6 pre-existing img warnings — file has never used next/image; `MAX_BULK_INSPECT_IMAGES` unused warning is pre-existing at baseline line 42, confirmed via `git show 950d615~1:… | eslint --stdin`), new tests 19/19, full `vitest run` 2084/2084 (margin-route green this session). Verified by reading + hand-tracing + toolchain; did NOT run Playwright — the three pure functions are exhaustively unit-tested and I hand-traced them, the dirty tree of unrelated concurrent files would contaminate a live dev-server run, and inspect-bulk needs a mocked response anyway (same placeholder-key live limitation as tickets #15/#20/#21).

- **[[lib/bulk-queue.ts]]'s three pure functions are correct** — hand-traced `updateBulkGroupsOnRemove` (filter-then-`shift` ordering; primary reassigned to `Math.min(...shiftedIndices)` when the primary is the removed image — safe only because the empty-group `continue` guarantees `indices` non-empty; tag re-keying drop/shift/keep) and `mergeScopedInspection` (remaps indices/primaryIndex AND tag keys relative→absolute via `scopedAbsoluteIndices[rel]`) against the task's exact [0,1]+[2,3,4]+add-5,6 example. Wiring in [[app/(dashboard)/swap/page.tsx]] is right: `runBulkInspect` (301) passes `targetIndices`(absolute)=`ungroupedIndices(...)` as `scopedAbsoluteIndices` and sends `targetIndices.map(i=>bulkQueue[i])` so API relative-j ≡ targetIndices[j]; `removeBulkItem` (257) re-indexes groups+queue+bulkDetailRegions consistently; `handleBulkFiles` (242) is the ONLY add-to-queue path, so no site leaves groups stale.
- **Scope-wording discrepancy (flagged, not failed) — recurrence of the #20 imprecise-scope-summary pattern:** the one-line scope said adding an image "auto-triggers inspection for just the new one(s)," but the code does NOT fire inspection on add — new images land in a "Not yet inspected" ungrouped grid and need a manual "Inspect new" click (handleBulkFiles comment: "not automatic"). The task's OWN item-7 live-verify ("add a new image and confirm it shows as **ungrouped**") is only satisfiable by this manual design (auto-fire would show a new group). So "auto" = auto-scopes-to-new, not auto-fires; the observable acceptance criterion matches the code. Same lesson as the #20 CORRECTION above — a one-line scope summary can contradict the same task's own verification step; the verifiable criterion wins. Confirm with product owner only if literal fire-on-add was intended (small additive gap if so).
- **Inspect-route root cause verified, not trusted:** [[lib/composite.ts]]'s `downscaleImageBase64`/`clampAspectForModel` are fully try/catch-wrapped (never throw, return input on failure); `resolveImageToBase64` throws only on the http-fetch branch (re-thrown, caught by route), never on data-URL/raw-base64 uploads — so the image-prep 400 path is essentially unreachable for real uploads and the failure is `inspectGarment`→Anthropic SDK throwing "Could not resolve authentication method" against the 2-char placeholder `ANTHROPIC_API_KEY` (confirmed in .env; SDK call at lib/inspection.ts:353). [[app/api/swaps/inspect/route.ts]]'s new `detail: err.message` leaks no credential (auth-resolution / fetch-URL messages, no key). Instrumentation-only fix (console.error + detail field) is correct — no code defect to fix.
- **Retail-tag link ([[app/(dashboard)/swap/page.tsx]]:559-573) is NOT dead code:** conditional `<a target="_blank" rel="noopener noreferrer"><Badge></a>` when `candidateUrl` exists (rel present — no reverse-tabnabbing), else the pre-diff `<Badge variant="info">` byte-identical. `candidateUrl` is genuinely populated ([[lib/reverse-search.ts]]:21 `candidateUrl: z.string().nullable()` → inspect-bulk route → data.groups.reverseSearch); the client type just gained the field the payload always carried. Minor cosmetic (out of scope): the link badge has no visual affordance it's clickable and a bare `<a>` around a `<span>` Badge could carry a default underline — worth a live glance, not a defect.
- **Minor non-blocking defensive edge:** `mergeScopedInspection` with a group whose EVERY relative index is out of range yields `{indices:[], primaryIndex:undefined}` → `handleBulkGenerate` would choke on `bulkQueue[undefined].base64`; not reachable from the real inspect-bulk backend (emits only in-sublist indices) and the partial-drop case IS tested.
- **Claimed exclusions mostly hold, one imprecise:** [[lib/bulk-inspect.ts]] zero diff; `handleBulkGenerate`/`setBulkPrimary`/`inspectSeqRef`-logic/`maxBulkItems`-cap/credit-icons zero mention in +/- lines; the Detail Inputs modal (swap/page.tsx 1226-1250) untouched — BUT `setEditingBulkDetail(i)` IS newly referenced in the ungrouped grid (a new trigger reusing the existing modal, correct/consistent), so the executor's "didn't touch editingBulkDetail" is imprecise though the substance (modal unmodified) holds.
- Git tree consistent this review (HEAD stayed 950d615, reviewed files match committed state); heavy unrelated uncommitted concurrent work present throughout (dashboard/inv, revenue, side-nav, input, extension/*, prisma, untracked cmd/) — none overlap the 5 reviewed files. No planner MEMORY entry (no planner dir; same gap as every prior entry on this branch).

## CMD nav module + retire Platform Connections from Revenue (branch claude/site-issues-clarification-7jajyn, ticket #22, commit b9d49d9, reviewed 2026-08-05)

**PASS**, no blocking defects; one non-blocking nav-ordering caveat below. Verified by reading AND full
toolchain AND live Playwright (admin + a real non-admin `user`). `tsc --noEmit` clean (this is the proof
the `Record<NavKey,…>` in [[components/layout/side-nav.tsx]] got its matching `cmd` entry — a missing key
would fail to compile); `npx vitest run` 2086/2086; `npm run build` exit 0 with `/cmd` in the route table
and `/revenue` still present (142/142 static pages); `npm run build:extension` exit 0 (its
`noEmitOnError:true` is the proof [[extension/popup.ts]] has zero dangling refs after the button/handler
deletions). `eslint` on all 8 files adds ZERO new problems vs the `b9d49d9~1` baseline (via
`git show …|eslint --stdin`): [[extension/popup.ts]]'s 6 errors (1 triple-slash + 5 no-explicit-any on the
untouched `storageGet`/`sessionGet`/`sendMessage` helpers) are byte-identical, just line-shifted 55-68→43-56
as the sync-interval code was removed; [[extension/dist/popup.js]]'s single triple-slash and
[[app/(dashboard)/revenue/page.tsx]]'s single `<img>` warning likewise shift-only (709→699).

- **Durable lesson for the NEXT new NAV_KEY — "right after Dashboard" holds only for a NULL/unset
  sidebarOrder.** The sidebar renders `settings.sidebarOrder`, seeded by [[components/layout/dashboard-shell.tsx]]:103
  via `normalizeSidebarOrder(user?.sidebarOrder ? JSON.parse(...) : undefined)`. That helper in
  [[lib/ui-settings.ts]]:33 **appends any NAV_KEYS not already in the saved list at the END**. So a user who
  ever dragged their nav (persisting the old 10-key order to the `User.sidebarOrder` String column) gets
  `cmd` appended LAST on next load, NOT after Dashboard; only a NULL/unset order falls back to fresh
  `[...NAV_KEYS]` and honours the placement this diff put in NAV_KEYS/navItems. Non-blocking: (a) inherent
  to the pre-existing append-at-end design that hits every nav addition equally, (b) forcing a fixed
  position would override a user's saved order — against the app's own design, (c) both seed/verify
  accounts have `sidebarOrder=NULL` so it doesn't manifest live. But a future ticket needing a FIXED
  position for existing users too needs a migration/merge — NAV_KEYS order alone won't do it. Grep
  `normalizeSidebarOrder` before promising positional placement for any nav change.
- ReconnectModal-is-required (the plan's own flag) verified concretely: [[app/(dashboard)/cmd/page.tsx]]
  renders `<ReconnectModal open={!!reconnectPlatform} platform={reconnectPlatform} onClose={…}/>` and passes
  `onReconnect={setReconnectPlatform}` to `ConnectionCard` — exact parity with what
  [[app/(dashboard)/revenue/page.tsx]] used to wire (same `open/platform/onClose` shape in
  [[components/revenue/reconnect-modal.tsx]]), so Reconnect/Connect actually open the modal, not no-op. The
  "9 cards" the executor found (vs the plan's assumed 3) is genuine parity — cmd maps `connections` from the
  same `/api/sync/orders` payload with the same grid classes revenue used; not a new count. Live (admin):
  `/cmd` 200, `h1="CMD"` carries `data-page-title` (silk-canvas title sampler still finds it), banner
  "connected", eBay/Depop cards with the depop-expired Reconnect state. `/revenue` live: no "Platform
  connections" section, expired badge `href=/cmd`; `connections` state still drives `expiredCount`
  (page.tsx:311), sales feed/widgets untouched.
- Role gate airtight WITHOUT touching roles: `/cmd` is absent from `ROUTE_RULES` in [[lib/roles.ts]], so
  `requiredRoleFor("/cmd")===null` → `canAccess(anyRole,"/cmd")===true`, and `hiddenNavKeys` only ever hides
  suppliers/fulfillment — [[proxy.ts]]/[[lib/roles.ts]] correctly NOT in this commit's 8-file diff.
  Live-proved by setting a bcryptjs password on the throwaway `cmd-verify-user@backdrop.local` (role=user,
  no admin nav link) and loading `/cmd` → 200, no redirect, CMD in nav. Reusable: reset a verify account's
  password with `bcrypt.hash(pw,12)` + `@libsql/client` UPDATE from a repo-root `.cjs` (repo is
  `type:module`, so Playwright/`require` scripts must be `.cjs`, and DB/bcrypt scripts must live at repo root
  for node_modules resolution — combines the two prior env notes).
- Extension popup.html/popup.ts stay in sync: every removed element
  (`syncNowBtn`/`forceSyncBtn`/`settings`/`syncInterval`) is gone from BOTH files, no dangling
  `getElementById`, `escapeHtml`/`getHiddenSyncTabs`/`hiddenTabs`/`sendMessage` all still used, the
  signed-out "Connect Backdrop account" flow (the connection mechanism that must NOT change) byte-unchanged,
  dashboard button → `/cmd`. [[extension/dist/popup.js]] is a legit rebuild ("CMD"/`/cmd` present;
  `build:extension` re-emits it byte-identical → empty `git diff`). Cosmetic-only: popup.html keeps now-dead
  CSS rules (`.row-actions`/`.settings`/`button.icon`/`button.danger`) — harmless, inline `<style>` unlinted.
- Concurrent-session artifacts again (documented pattern): a sibling session had already built at 02:18 and
  was running `next start -p 3001` (its build held `.next/lock`, failing my first `npm run build` with
  "Another next build process is already running" — retried clean once free), plus it left the
  `cmd-verify-user` account + 2 seeded `SyncConnection` rows (ebay connected/depop expired) and untracked
  `_check_admin_tmp.mjs`. Working tree carries unrelated uncommitted wallpaper/schema edits — none overlap
  the 8 reviewed files; HEAD stayed b9d49d9. My own `npm run build` rewrote the shared `.next` (killed the
  3001 server — used the `next dev` port 3000 for live checks instead). No planner MEMORY entry (no planner
  dir; same gap as every prior entry on this branch).

## Wallpaper polarity metadata + nullable palette field — revamp Phase A of 6 (branch claude/site-issues-clarification-7jajyn, ticket #11, commit f031e1a, reviewed 2026-08-05)

**PASS**, no defects. Data-model-only foundation; zero shader/render change confirmed. Because the shared
working tree DRIFTED mid-review (last bullet), every drift-sensitive check was re-anchored to the immutable
commit via `git show f031e1a:…` and a detached `git worktree` at f031e1a: there `tsc --noEmit` exit 0,
[[lib/wallpapers.test.ts]] 7/7, `eslint lib/wallpapers.ts lib/wallpapers.test.ts` clean. Full `vitest run`
2086/2086 (margin-route green this session). `eslint` on all 8: only [[app/(dashboard)/settings/page.tsx]]
(91-93/461/531) and [[app/api/settings/wallpaper/route.ts]] (the pre-existing `updateData:any`) flag, both
byte-identical to the `f031e1a~1` baseline — settings' lines don't shift (filter→map is net-zero-line),
route's `any` shifts 34→36 (the +2 = new PALETTE_IDS import + GET line).

- **glsl byte-identity proven, not eyeballed**: a full-file `diff <(git show f031e1a~1:lib/wallpapers.ts)
  <(git show f031e1a:lib/wallpapers.ts)` shows ONLY the removed `WallpaperThemeMode` type, the interface
  swap (`themeMode` → `native?`/`selfGraded?`/`sim?`), and three `themeMode:"both"` → `native:` lines —
  ZERO glsl-content lines, so silk/mesh/nebula shader bodies are unchanged to the byte. `native`:
  silk="light", mesh="dark", nebula="dark" (matches plan); none set `sim`/`selfGraded`. `themeMode`/
  `WallpaperThemeMode` gone repo-wide in f031e1a (`git grep` on the commit: none; tsc-clean corroborates).
- **Schema hand-alignment correct — `prisma format` (rightly) NOT run** (standing warning, wallpaper-brightness
  entry above): `wallpaperPalette` (16 chars) + 5 spaces = col-21, matching this sub-block's LOCAL alignment
  (wallpaperShader…themeEnabled) and mirroring `wallpaperShader`'s `String? // …` single-space nullable-comment
  style — NOT the model-wide column the formatter would impose (the `id`/`email` block aligns wider; that
  pre-existing drift is why the formatter must be avoided). Genuinely nullable + db-push applied: dev.db
  `PRAGMA table_info(User)` = `wallpaperPalette TEXT notnull=0 dflt=null`, existing rows NULL.
- **Data path is write-consistent end-to-end**: route imports `PALETTE_IDS` (a real `Set` of 8 ids) from the
  PRE-EXISTING [[lib/wallpaper-palettes.ts]] (commit ecbddea, NOT this diff — easy to mistake for missing).
  Drove the REAL `POST` with mocked `@/auth`+`@/lib/prisma` (repo's `vi.mock` pattern): explicit `null` clears,
  a valid id sets, and unknown-string / number / object are silently ignored → 400 "No changes", NEVER 500;
  garbage alongside a valid field saves only the valid field (6/6). Separately, a fresh-process REAL generated
  Prisma client wrote `wallpaperPalette:"ember"`→read-back→cleared→I restored the original null — schema↔
  generated-client↔dev.db agree for read AND write.
- **Executor's two flags both check out.** (1) Stale-dev-server Prisma-singleton gotcha is REAL/expected, not
  masking a bug: [[lib/prisma.ts]]:40 caches the client on `globalThis` in dev (HMR preserves it), so a server
  started 02:05 (before this commit's `prisma generate`) keeps the pre-`wallpaperPalette` client and a WRITE of
  that field throws client-side validation until restart — a process-lifetime artifact; reads still work (old
  client just doesn't SELECT the unknown column). (2) [[components/layout/silk-canvas.tsx]] is genuinely NOT in
  f031e1a (0-line diff, absent from the file list), so the pre-existing Strict-Mode double-mount WebGL issue is
  correctly out of scope for this data-only phase — did NOT attempt to verify/fix it (belongs to Phase D, which
  rewrites that file).
- **Future-phase MUST-DO (only real gap, non-blocking now)**: [[components/layout/dashboard-client.tsx]]:47-55's
  `setWallpaperParams({…})` seeding effect does NOT mirror `wallpaperPalette`→store `palette`, and its dep array
  omits any palette value; the store default `palette:null` ([[components/ui/wallpaper-store.ts]]) is all that
  feeds it. Fine here (nothing consumes `store.palette` yet — no shader change), but the phase that makes
  SilkCanvas read `palette` must add it to BOTH the seeded object AND the deps or the palette never reaches the
  canvas / won't live-update. The mirror comment at dashboard-client.tsx:43-44 enumerates only "shader, hue,
  follow-theme, background blur, brightness" — stale for "night" AND now "palette" (store header WAS updated,
  the mirror comment wasn't): same enumeration-comment-drift flagged in the wallpaper-brightness/chrome-floor
  entries. Grep `hue, follow-theme` / `blurAmount:` before adding the next wallpaper-store field.
- Closes the coverage gap the d23a303 "Animated-wallpaper library" entry flagged — [[lib/wallpapers.ts]] now HAS
  a colocated [[lib/wallpapers.test.ts]]; the 2 new tests (native XOR selfGraded invariant; silk-light /
  mesh+nebula-dark) are the right guardrails for the later derive/invert logic. Settings-page filter→map is
  behaviour-preserving: all 3 wallpapers were `themeMode:"both"`, so the old filter already passed all 3; the
  `.map` renders the identical 3 (keyed by id, no dupes, no fewer).
- **Mid-review shared-tree drift, ~8th occurrence of the concurrent-session pattern** (see the environment note
  + prior entries): HEAD moved f031e1a→2b55ea8 ("Record the CMD nav module's review outcome" — MEMORY.md-only,
  touches none of the 8 files), AND the tree gained UNCOMMITTED later-phase work — [[lib/wallpapers.ts]] now 7
  wallpapers (adds labyrinth/contour/fluid/rain), [[components/layout/silk-canvas.tsx]] now has `sim:"fluid"`
  Phase-D code, + untracked `components/ui/coin-icon.tsx` and edits to admin/backgrounds/billing/swap/
  dashboard-frame/generation-controls/credit-counter. The long-running dev server compiles the tree, so the LIVE
  settings picker showed 7 wallpapers incl. "Fluid" — DRIFT, NOT an f031e1a defect (committed picker = exactly
  3, proven). Live check (admin → /swap → /settings, switching Nebula→Mesh→Silk) had 0 console + 0 page errors
  but reflects the ADVANCED tree, so it only corroborates general subsystem health; the verdict rests on the
  immutable-commit re-verification. Lesson: on this branch a wallpaper review's `git rev-parse HEAD`/`git status`
  can change under you — pin to `git show <sha>:…` + a detached worktree, and treat any live dev-server render as
  the WORKING TREE's state, not the commit's.
- No planner MEMORY entry for this task (no planner dir; same gap as every prior entry on this branch — 2b55ea8's
  MEMORY addition is the CMD-nav review, unrelated).

## Coin icon for credits + pen icon for Prompt (branch claude/site-issues-clarification-7jajyn, ticket #19, commit 349fbb9, reviewed 2026-08-05)

**FAIL** — one visible cosmetic defect; all structural work correct. The credits->coin swap leaves a
literal space before the closing paren at all 7 IN-PAREN button labels (`<CoinIcon ... /> )`), so the
main CTA renders "Generate (12 [coin] )" with a stranded-looking `)` — confirmed in a real 3x Chromium
render of the live dev server, not just static JSX reasoning. Immutable commit-blob lines:
[[app/(dashboard)/swap/page.tsx]] 724/780/1034/1044, [[app/(dashboard)/backgrounds/page.tsx]]
503/556/672. Fix = delete the one space (`/> )` -> `/>)`). The 3 NO-PAREN label sites
([[app/(dashboard)/billing/page.tsx]]:178, swap Total ~1018, [[components/generation/generation-controls.tsx]]:123)
read cleanly — the defect is specific to labels that wrap a trailing `)`. tsc --noEmit clean; full
vitest 2089/2089 (DB provisioned in this env, so the usual margin-route failure was absent); eslint
byte-identical to the 349fbb9~1 baseline on all 8 files (zero new findings); 0 live console/page errors.

- **Pattern worth keeping**: wrapping a button's full label in one `<span>` correctly kills the
  `inline-flex gap-2` 8px stranded-paren the task feared (the `)` is no longer a separate flex item),
  but does NOT remove a literal text space between the icon and the next glyph — `/> )` still renders
  ~4px + a floating `)`. When an inline icon replaces a word that sat flush against punctuation, verify
  the RENDERED TEXT, not just the flex-item grouping. The clean fix mirrors the no-paren sites: keep the
  `{" "}` before the coin (matches "N credits" spacing) but butt the coin against `)` (matches "credits)").
- [[components/ui/coin-icon.tsx]] is a correct thin pass-through (`<Coins {...props}/>`, no baked
  size/color, named export, lib-style header comment) — the intended single future swap point. 14
  CoinIcon uses = 10 text + 4 icon-swap ([[components/ui/credit-counter.tsx]]:61,
  [[components/dashboard/dashboard-frame.tsx]]:56, billing:220, admin:382), all live-verified as
  `lucide-coins`. Import bookkeeping clean: `Zap` fully dropped from credit-counter/dashboard-frame (it
  was the only lucide icon in each, so the whole import line went), kept where still used (billing:8,
  admin:15). All out-of-scope `Zap` intact live (admin FAL/Claude 2, billing cost card 1;
  [[components/settings/preferences-panel.tsx]]:684 & [[app/(dashboard)/market-intel/page.tsx]]:280
  zero-diff, not in commit). Standalone `credits` sublabels ("credits available/purchased", credit-pack
  label) + prose ("...flat N credits") correctly left as text.
- Shared-tree drift recurs (~9th occurrence, cf. wallpaper/chrome-floor entries): a concurrent session
  rewrote [[app/(dashboard)/swap/page.tsx]] (+50/-42, later-phase work) mid-review, jumping its grep
  line numbers ~+42 between two calls (coin code only shifted, not changed); HEAD also moved
  349fbb9->540c424 (a MEMORY-only "record review outcome" commit). Cite `git show 349fbb9:<path>` blobs,
  never live working-tree grep, on this branch. No planner MEMORY entry (same gap as every prior entry here).

**RESOLVED (orchestrator, 2026-08-05, commit 36e71bc):** applied exactly the fix the review specified
(`/> )` -> `/>)`) at all 7 sites, live-confirmed via a close-up screenshot of the real Generate button
("Generate (12 [coin])", no gap). [[app/(dashboard)/backgrounds/page.tsx]]'s 3 sites are fixed and
committed (36e71bc). [[app/(dashboard)/swap/page.tsx]]'s 4 sites are fixed on disk and independently
verified (tsc/eslint clean, same live-screenshot technique) but NOT YET committed — ticket #12's executor
is concurrently editing that same file, so committing now would either miss #12's in-progress work or
sweep it in half-finished; the paren fix will land in whatever commit covers #12's own changes to this
file instead of its own commit, to avoid mixing an unreviewed diff into history.

## Wallpaper revamp Phase C of 6 — 4 new wallpapers + polarity/inversion shader machinery (branch claude/site-issues-clarification-7jajyn, ticket #11, commit b65ad2c, reviewed 2026-08-05)

**PASS**, no defects. Highest-risk item (transcription) proven byte-exact (scripted, not eyeballed); all 7
composed fragment shaders compiled+linked+rendered in real swiftshader WebGL. tsc exit 0; eslint on the 3
files = only the pre-existing `measureDirty` warning ([[components/layout/silk-canvas.tsx]]:370, untouched
here); [[lib/wallpapers.test.ts]] 10/10; full `vitest run` 2089/2089 (margin-route green this env). Ran
every drift-sensitive check in a detached `git worktree` at b65ad2c (node_modules + app/generated/prisma +
.env symlinked from main) — this time the 3 diff files were byte-identical to the commit in the live tree,
but HEAD had already advanced past b65ad2c with unrelated uncommitted drift (swap/page.tsx, bulk-inspect.*),
so the worktree is still the safe anchor on this branch (cf. the ~9 concurrent-session drift notes above).

- **Transcription byte-exact, scripted + decoded (verified independently of the executor's claim).** Extract
  every backtick-delimited GLSL block by anchor from BOTH the design artifact's `<script>` and `git show
  b65ad2c:lib/wallpapers.ts`, then compare. GOTCHA that makes a naive diff show false mismatches everywhere:
  the artifact is a browser `<script>`, so its em-dashes are literal `—` escapes while the committed TS
  has real `—` bytes — you MUST decode `\uXXXX` on the artifact side first. After decoding, WALLPAPER_GLSL_PRELUDE
  (wallLum/hueRamp/toneTo/wallInvert/themeGradient/themeK/wallTint) + all 7 glsl bodies + the 4 new wallpapers'
  scalar metadata match to the byte. The 3 existing wallpapers' `bgRaw` is untouched: parent-vs-commit diff =
  only 2 removed lines, both the prelude header comment and the `hueShift` line whose trailing backtick moved
  down as helpers were appended (zero silk/mesh/nebula body changes). Same extract-by-anchor trick as the
  "Extend chrome floor" entry, here doubling as the transcription check.
- **The task/commit's "zero behavior change to silk/mesh/nebula" line is a loose paraphrase — do NOT flag the
  change as a regression, it is the documented design.** Only their `bgRaw` GLSL is identical; the SHARED wrapper
  [[components/layout/silk-canvas.tsx]] `FRAG_BGWRAP` intentionally changed: (a) `themeRemap` rewritten onto
  themeGradient/toneTo (fixes the "Silk folds → pink" follow-theme bug), and (b) the new `WALL_NATIVE` flip so
  that for native-**dark** mesh/nebula at the store default `night:false` (uWallNight=0), `flip=abs(0-1)=1`
  applies `wallInvert` → they now render their INVERTED BRIGHT end by default (render-confirmed: mesh mean 120,
  nebula mean 180 at night=0 vs ~24 native-dark at night=1). Artifact line 244 states this outright: "the
  polarity work does change what Mesh and Nebula look like with the dark toggle off... off is now their inverted
  bright end." **Future-phase MUST-DO**: the settings UI / default-`night` wiring ([[components/ui/wallpaper-store.ts]]
  default is `night:false` for every wallpaper) must own this, or existing mesh/nebula users silently flip
  dark→bright; follow-theme output for all 3 existing wallpapers also shifted. `uWallNight` is now a POLARITY
  selector (0=light,1=dark), not the old opt-in night-grade.
- **Reusable WebGL compile+render harness for `buildFrag`** (the single load-bearing check — never trust an "it
  compiled" report): reconstruct `buildFrag` faithfully by textually extracting VERT + the 4 FRAG_* template
  literals (no nested backticks inside — safe) from [[components/layout/silk-canvas.tsx]], substituting `#define
  MAXP ${MAXP}` (=32) and injecting the per-wp `const float WALL_SELF_GRADED/WALL_NATIVE` exactly as buildFrag
  does, then compile+link+draw each in Playwright+swiftshader (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
  `--use-gl=swiftshader --enable-unsafe-swiftshader`, playwright at `/opt/node22/lib/node_modules`). All 7:
  COMPILE/LINK true, empty logs; readback at night 0/1 ±theme ±hue → non-black/non-flat, glErr 0. HARNESS GOTCHA:
  `uWallBright` caps at 0.8 and 0 makes the whole frame black — set it to 0.8, not 0, or you "prove" a false black.
- **`buildProgram` now heeds the d23a303 shader-leak lesson** (see "Animated-wallpaper library" above):
  `gl.deleteShader(vs/fs)` on BOTH the post-link success path and every failure path, `deleteProgram(old)` before
  swap. The `uSim` dummy 1x1 texture is created ONCE at setup and re-bound (not re-created) per rebuild, so a
  wallpaper switch leaks neither shaders nor textures. Non-fluid wp: `uSim=0`, `uSimReady=0`, dummyTex→unit0.
  Fluid: buildProgram deliberately sets nothing (Phase D owns binding the real dye texture) — relies on GL
  default-0, so pre-Phase-D fluid renders its procedural fallback (`uSimReady<0.5`); render-confirmed. Phase D's
  executor owns fluid's unit-0 texture lifecycle and setting `uSimReady=1`.
- Pre-existing, NOT this diff (out of scope, don't attribute): [[components/layout/silk-canvas.tsx]] module header
  (lines 9-11) still enumerates wallpaper-store params as "wallpaper, hue, follow-theme, background blur,
  brightness" — missing `night`/`palette` (Phase A additions); those header lines are untouched here. Same
  enumeration-comment-drift flagged across the wallpaper/chrome-floor entries — fold into the Phase D silk-canvas
  rewrite. No planner MEMORY entry (no planner dir; same gap as the Phase A entry and every prior entry on this branch).

## Merge Detail Inputs into the bulk queue + surface auto-detected regions (branch claude/site-issues-clarification-7jajyn, ticket #12 UI-merge half, commit e60c3cc, reviewed 2026-08-05)

**PASS**, no defects; 2 trivial non-blocking notes. Verified by reading + hand-tracing + full toolchain + live
Playwright. `tsc --noEmit` exit 0 (proves the new `DetailInputsBulkContext` + `BulkGroup.detailRegions` field
typecheck end-to-end); `eslint` on all 4 files 0 errors (one NEW `<img>` warning at
[[components/generation/detail-inputs-modal.tsx]]:87 — the thumbnail-strip img — matching the codebase's
universal data-URL `<img>` convention; [[app/(dashboard)/swap/page.tsx]] unchanged at 8 warnings vs `e60c3cc~1`);
targeted vitest 45/45, full `vitest run` 2091/2091 (margin-route green this env); `npm run build` exit 0. e60c3cc
is HEAD~1 (only later commit 58dc0a0 is a MEMORY doc); the 4 files stayed byte-identical across commit/HEAD/worktree
throughout.

- **The crypto-leak worry (task's highest-risk item) is a non-issue, and the real reason is subtler than
  "detectedToRegions stays server-side":** [[lib/detail-regions.ts]]'s top-level `import { randomUUID } from
  "crypto"` was ALREADY client-reachable pre-diff — client [[components/generation/annotation-canvas.tsx]]
  runtime-imports `pathToBoundingBox`/`isDegenerateBox` from it — and the build tolerates it only because
  detail-regions.ts is side-effect-free, so webpack tree-shakes the unused `detectedToRegions`+crypto out of the
  client. This diff adds exactly one NEW value-importer of `detectedToRegions`: [[lib/bulk-inspect.ts]], imported
  only by server [[app/api/swaps/inspect-bulk/route.ts]]. swap/page.tsx uses `import type { DetailRegion }` (erased)
  and pulls queue helpers from [[lib/bulk-queue.ts]], NOT bulk-inspect — so client crypto exposure is UNCHANGED;
  `npm run build` exit 0 is the proof. Reusable rule: a type-only `DetailRegion` import in client code is free;
  only VALUE imports of `detectedToRegions`/`resolveRegions`/`footprintPad` matter, and all live server-side
  (bulk-inspect, reseller-generation, api/swaps/*).
- **Load-bearing index invariant, verified both directions:** generate-time reads
  `bulkDetailRegions.get(g.primaryIndex)`, so `removeBulkItem`'s region-map re-key (`k<i` stays, `k>i` -> `k-1`,
  `k===i` dropped) MUST use the same shift rule as `updateBulkGroupsOnRemove`'s primaryIndex (`shift(i)=i>removed?
  i-1:i`, or `Math.min(...indices)` when the primary itself is removed) — they do, so seeded/hand-drawn regions
  stay attributed through removals. Seeding maps sublist-relative `primaryIndex` to absolute via
  `targetIndices[g.primaryIndex]`, identical to `mergeScopedInspection`'s `scopedAbsoluteIndices[rel]`; correct for
  the first full pass (targetIndices=identity) and scoped "Inspect new" (targetIndices=ungroupedIndices). Guard
  `prev.has(absIndex)` never clobbers hand-drawn; `!g.detailRegions?.length` never seeds empty (which would flip
  the item to manual-mode-zero-regions at generate).
- **Footprint-aware seeding is a deliberate render-parity choice, not an oversight:** bulk sends seeded regions as
  `detailInputsMode:"manual"` verbatim (resolveRegions manual->userRegions, no re-detection), so the seed must
  apply the SAME `detectedToRegions(insp, insp.footprint)` padding the generation path
  ([[lib/reseller-generation.ts]]:164) would — single padding, no double-pad. (Aside: api routes inspect/prompt
  call detectedToRegions WITHOUT footprint = "med" default — a pre-existing inconsistency, not this diff's concern.)
- **Old modal genuinely retired + live-confirmed:** `editingBulkDetail` state + its `<Modal>` block + the
  `DetailInputsEditor` import are all gone from swap/page.tsx (grep: zero refs); 3 ScanSearch triggers now
  `setBulkDetailIndex`; `key={bulk.activeIndex}` remount present on the bulk editor. Live (Playwright, concurrent
  session's dev server on :3000, single `setInputFiles([a,b])` array call per the task's warning — worked, no hang):
  grouped primary thumb shows "Front"[63-97]+"1"[101-116] badges 4px apart (overlap=false, one flex container);
  ScanSearch opens exactly ONE `[role=dialog]` pre-selected (strip aria-pressed [true,false]), seeded region
  surfaced as "chest badge...badge/auto", footer Done-only (no "Open in New Tab" — bulk omits it, single-session
  keeps it); switching to img2 -> independent state (0 regions, empty prompt), still 1 dialog; removing non-primary
  item2 -> region badge stays on item1.
- **Trivial:** swap/page.tsx:303 comment says "see detectedToRegions in lib/bulk-inspect.ts" but it's DEFINED in
  [[lib/detail-regions.ts]] (bulk-inspect only calls it); the test's own comment ([[lib/bulk-inspect.test.ts]]:265)
  says detail-regions.ts, correctly. Same reference-comment-drift family flagged across the wallpaper/chrome-floor
  entries. `mode` prop on DetailInputsModal is passed-but-never-destructured — PRE-EXISTING (original signature
  didn't use it either), not a regression.
- Sibling backend half of this same ticket is the `950d615` entry above (#12-backend: bulk-queue pure fns +
  inspect-route instrumentation), whose hand-trace of `removeBulkItem`/`mergeScopedInspection` this review reused
  and extended to the new `bulkDetailRegions` seeding. No planner MEMORY entry (no planner dir; same gap as every
  prior entry on this branch). Concurrent-session drift present throughout (silk-canvas/dashboard-client/extension
  uncommitted, :3000 server owned by another session) — none overlap the 4 reviewed files; HEAD stayed 58dc0a0.
## Wallpaper revamp Phase B of 6 — palette field wired to live shader uniforms (branch claude/site-issues-clarification-7jajyn, ticket #11, commit bfc5822, reviewed 2026-08-05)

**PASS**, no defects. (Commit msg says "phase 3/6" but this is the plan's Phase B — palette uniform wiring;
Phase A=f031e1a data model, Phase C=b65ad2c wallpapers/polarity, both PASS above.) Closes the exact
Phase-A-review must-fix gap (the f031e1a entry's "Future-phase MUST-DO", ~line 1020). HEAD==bfc5822; the 2
target files byte-identical to the commit (only unrelated `extension/dist/*` drift). tsc --noEmit exit 0;
full `vitest run` 2091/2091 (margin-route green this env); eslint on both files byte-identical to the
bfc5822~1 baseline (via `git show ~1 | eslint --stdin-filename`) — silk-canvas only the pre-existing
`measureDirty` warning (370→371, +1 from the new import), dashboard-client only the pre-existing
`set-state-in-effect` error at `setWebglOn(false)` (68→69, +1 from the added `palette: wallpaperPalette,`
line — NOT new, see the e9af15c re-review entry). No live dev render needed (Phase C already render-proved
all 7 shaders + the themeRemap/themeGradient path; this phase adds ZERO glsl, only a JS uniform-upload branch).

- **The palette branch structurally CANNOT recompile — verified by reading the guard, not trusting the
  executor's throwaway build-counter.** [[components/layout/silk-canvas.tsx]]'s only two `buildProgram` call
  sites are mount (line 761) and the `subscribeWallpaperParams` callback (814), and 814 is gated by
  `wp.wallpaper !== builtWallpaper` (812) — a palette-only store change never satisfies it. The whole palette
  branch lives inside `applyWallpaperLive` (566-606), which issues only `gl.uniform*`/`drawFrame`. So a palette
  switch is uniform-only by construction; there is no code path from a `palette` change to `buildFrag`.
- **Uniform-order correctness proven THREE ways (this is the swap-but-still-compiles trap the task flagged).**
  The diff maps `[navy,mid,blue,purple,ink]=stops.map(hexToRgb)` → uThemeNavy/Mid/Blue/Purple/Ink, i.e.
  stops[0..4] positionally. (1) Matches [[lib/wallpaper-palettes.ts]]'s documented contract (line 18: "Mapped to
  uThemeNavy/Mid/Blue/Purple/Ink in that order", stops "darkest first"). (2) Matches the ACTUAL shader blend
  order — [[lib/wallpapers.ts]]'s `themeGradient` (66-83) mixes Navy→Mid→Blue→Purple→Ink across k=0→1, and its
  own comment (68-70) explicitly anticipates the palette case ("a preset palette uses all five properly").
  `themeGradient` is the SOLE consumer of the 5 colour uniforms (grep). (3) Live swiftshader render of the
  verbatim `themeGradient` with ember's stops in the diff's exact order → correct dark→light sweep (k=0
  rgb(86,0,0) → k=1 rgb(255,232,169)); glacier distinctly cool (k=0 rgb(0,25,82) → k=1 rgb(181,255,255)); a
  deliberately-REVERSED upload inverts the sweep (light at k=0), proving the harness discriminates a wrong order
  — the diff is the non-reversed/correct case. Harness reused the Phase C swiftshader recipe.
- **Zero behaviour change for `palette:null`, byte-verified.** `getPalette(null)` returns null (short-circuit
  `if(!id)`), so `if(palette)` is false and control falls to the untouched `else if(wp.followTheme)`. A
  `diff bfc5822~1 vs bfc5822` on silk-canvas shows the ONLY changes are the new import + the rewritten comment +
  the prepended `if(palette){…}` branch + `if`→`else if` on follow-theme; the follow-theme and hue/own bodies
  and the trailing blur/bright/night uploads are byte-identical. Precedence is a genuine
  `palette > followTheme > hue/own` cascade, not an incidental win.
- **Mirroring gap from Phase A is fully closed.** [[components/layout/dashboard-client.tsx]] now destructures
  `wallpaperPalette` (30), passes `palette: wallpaperPalette` into `setWallpaperParams` (54), and adds it to the
  effect deps (56) — so a live Settings change reaches the canvas without a reload (effect→store→
  `subscribeWallpaperParams`→`applyWallpaperLive`). Data path is real end-to-end, never `undefined`:
  `String?` in [[prisma/schema.prisma]] → `user?.wallpaperPalette ?? null` in [[components/layout/dashboard-shell.tsx]]:101
  → `string|null` in [[components/state/dashboard-settings-provider.tsx]]:22 → destructure → store (`palette:string|null`).
- Standing enumeration-comment-drift (5th+ occurrence, cf. Phase A/C, wallpaper-brightness, chrome-floor entries):
  this diff DID fix the dashboard-client mirror comment (adds "night, palette"), but [[components/layout/silk-canvas.tsx]]'s
  MODULE header (lines 10-11) still lists only "hue, follow-theme, background blur, brightness" — now doubly stale
  since this diff makes silk-canvas genuinely read `palette`. Non-blocking; fold into the Phase D silk-canvas rewrite.
- No planner MEMORY entry (no planner dir; same gap as every prior entry on this branch). Phase D (fluid-sim) and
  Phase E (minimal-mode mount) depend on this file — the palette→uniform path is confirmed correct and recompile-free.

## Closeup crop mode + merge bulk-generate into the main Generate button (branch claude/site-issues-clarification-7jajyn, ticket #14, commit a0ec83e, reviewed 2026-08-05)

**PASS**, no defects; 4 non-blocking notes. Re-derived every claim independently (did NOT trust the executor self-report or the orchestrator's verification). Ran in a detached worktree pinned to a0ec83e — main HEAD had already advanced to Phase D 210d34c mid-review (~10th concurrent-session drift; pin to a worktree, cf. every prior entry). tsc --noEmit exit 0, eslint no new findings, full `vitest run` 130 files/2113 tests all pass, `npm run build` exit 0, live Playwright 20/20.

- **Two fresh-worktree infra gotchas on THIS repo, neither a diff defect — both cost real time, record for next review here.** (1) `app/generated/prisma` (the CLAUDE.md-documented generated Prisma client location) is gitignored, so a `git worktree add` lacks it and `tsc --noEmit` then throws HUNDREDS of implicit-any TS7006 in every Prisma-touching route (analytics/admin/automation/…). Symlink or copy [[app/generated/prisma]] from the main checkout before trusting tsc. (2) `next build`/`next dev` (Turbopack, Next 16) PANIC "Symlink node_modules is invalid, it points out of the filesystem root" when node_modules is symlinked to the main checkout from a `/tmp` worktree — set `turbopack.root` (next.config.ts) to the lowest common ancestor of the worktree and the real node_modules, i.e. put the worktree UNDER /home/user and set root to `/home/user`. Also: `npm run dev`/`db:setup` run `prisma generate` via predev, which WRITES THROUGH a generated-client symlink into the shared main tree — run `npx next dev` directly and use a real COPY of the client, not a symlink.
- **The orchestrator's self-found garmentMime bug is REAL, the fix COMPLETE, the residual edge precedent-consistent.** [[lib/composite.ts]]'s `cropDetailRegion` always `.png()`-re-encodes (line 575), so a closeup crop is PNG bytes; pre-fix code passed the ORIGINAL upload's `params.garmentMime` (e.g. image/jpeg) to inspect+QC, and [[lib/claude.ts]]'s `prepareImageForClaude` passes `mediaType` THROUGH unchanged for ≤4.6MB images — so [[lib/inspection.ts]]:351→372 and [[lib/qc.ts]]:166-167→194 would declare PNG bytes to Claude vision's `media_type` as jpeg. Fix = `garmentMime = params.closeup ? "image/png" : params.garmentMime` ([[lib/reseller-generation.ts]]:144) at BOTH mime-carrying sites (inspect 148, qc 259-260). Complete: `deps.render` (22) carries NO garment mime; `describe` (swap-pipeline) reads the original image but is unreachable in closeup mode (`resolved=[]`→needsDescribe empty); line 216's `cropDetailRegion(params.garmentBase64,…)` is in the empty detail-crop map. The `if(!imgW||!imgH) return imageBase64` metadata-fallback (composite.ts:558) would relabel original bytes as png — but that is the EXACT risk `detailCrops` already accepts (reseller-generation.ts:220 hardcodes `mimeType:"image/png"` after the same crop) and a sharp-undecodable image fails Claude vision regardless of declared mime. Acceptable. Two new tests assert both directions.
- **Server trust boundary airtight (static + live).** [[app/api/swaps/bulk/route.ts]]'s `parseItem` computes `mode: classifyCloseupCrop(closeupBox)` (76) and NEVER reads `raw.closeupMode` (the field exists only as an interface decl (50) + a comment (72)). Live capture confirms the client DOES send `closeupMode` as a hint and the server ignores it — same trust model as qcMode/scaleMode/perspective on this route.
- **Mutual exclusivity proven LIVE by the captured POST body (task item 3).** Drew BOTH a closeup crop AND a detail region on the SAME queued image, intercepted `POST /api/swaps/bulk`: item0 keys = `itemImageBase64,itemMimeType,backgroundId,shotPerspectiveMode,garmentOptions,closeupBox,closeupMode` — closeup present, `detailInputsMode`/`detailRegions` ABSENT. `bulkItemOverrides` (closeup-wins short-circuit) in [[app/(dashboard)/swap/page.tsx]] is the single source; reseller-generation belts-and-suspenders it (`resolved=[]` when closeup set). The `bulkCloseups` remove-shift re-key (page.tsx:274-281) is byte-identical to the `bulkDetailRegions` re-key beside it — same load-bearing index invariant flagged in the ticket #12 (e60c3cc) entry above, correctly carried forward.
- **Merged Generate button verified both modes LIVE.** Queue non-empty → "Bulk Generate (36 )" + Layers, click fires `/api/swaps/bulk` (NOT single `/api/swaps`); old separate "Bulk generate (" button gone; clear queue → "Generate (12 )" + Wand2, DISABLED without a product image, ENABLED once one loads. Coin label uses the FIXED `…/>)` spacing — no ticket #19 stranded-paren regression in this NEW code. Closeup modal ([[components/generation/closeup-modal.tsx]]): near-edge→warning "Near an edge", interior→info "Lighting only"; `key={activeIndex}` remount + `seeded` prop confirmed leak-free (draw img1 → switch img2 → back → box persisted); per-image "crop" thumbnail indicator works. Same `key={activeIndex}` remount pattern reused from ticket #12's detail-inputs modal.
- **Non-blocking:** (1) `parseCloseupBox` ([[lib/closeup.ts]]) clamps x/y/w/h to [0,1] independently, not x+w≤1 — harmless (the canvas never emits that; `cropDetailRegion` clamps to image bounds). (2) A degenerate closeup box drawn client-side is silently dropped server-side (parseCloseupBox→null→normal flat-lay) — minor UX, not a correctness bug. (3) closeup-modal.tsx's one `<img>` eslint warning matches the codebase's universal data-URL `<img>` convention (identical to ticket #12's detail-inputs-modal). (4) No colocated test for closeup-modal.tsx — consistent with the components/=untested convention; the load-bearing logic lives in the well-tested [[lib/closeup.ts]] (14 tests). No planner MEMORY entry (no planner dir; same gap as every prior entry on this branch).

## Wallpaper revamp Phase D of 6 — cursor-reactive fluid dye sim for the "fluid" wallpaper (branch claude/site-issues-clarification-7jajyn, ticket #11, commit 210d34c, reviewed 2026-08-05)

**PASS**, no defects. New file [[components/layout/fluid-sim.ts]] (semi-Lagrangian solver) + [[components/layout/silk-canvas.tsx]] (+146/-8 wiring). Re-derived every claim independently (did NOT trust the executor self-report or the orchestrator's spot-check). tsc --noEmit exit 0; eslint on both files only the pre-existing `measureDirty` warning (371→404, byte-diffed vs `git show a0ec83e:…|eslint --stdin` — no new findings; fluid-sim.ts is new, 0 issues); full `vitest run` 130 files/2113 tests all pass; `next build` (worktree) exit 0, 142/142 static pages. HEAD drifted 210d34c→d4f39b2 (ticket-14 MEMORY-only commit) mid-review with concurrent uncommitted work in unrelated files — the 2 Phase D files are byte-identical (blob SHA ed51c2f/c9f3c96) across 210d34c/HEAD/worktree, so the verdict is anchored to the immutable commit (cf. every prior concurrent-drift note here).

- **Transcription byte-exact, scripted + decoded (the highest-risk item, re-derived independently).** Extract every backtick GLSL block from BOTH the design artifact's `<script>` (`…/tool-results/artifact-b583764f-1785528947-8840.html`) and the committed fluid-sim.ts, decode `\uXXXX` on the artifact side first (same gotcha as the Phase C entry), then compare: all 11 shader strings (VERT/F_HEAD/F_ADVECT/F_DIVERGENCE/F_PRESSURE/F_GRADIENT/F_CURL/F_VORTICITY/F_SPLAT/F_CLEAR/F_DIFFUSE) + all 13 numeric constants (SIM_RES…PRIME_SPLATS) MATCH to the byte. **F_DIFFUSE is 439 chars on both sides — that IS the executor's load-bearing semicolon fix**: the `vec3 n = (…) * 0.25;` statement terminator; drop it and F_DIFFUSE is 438, fails to compile, `pDiffuse` is null, `createFluidSim` returns null every time (invisible to tsc/eslint — GLSL is just a string). Present and correct.
- **The reference's quad-buffer leak is genuinely fixed, no path bypasses it.** Artifact `cleanup()` never frees the fullscreen-quad buffer; the commit hoists `let quad` above `cleanup` and wraps `dispose: () => { cleanup(); if (quad) gl.deleteBuffer(quad) }`. Traced all 5 early-return-null paths: only the FINAL full return exposes `dispose`, and by then quad is a valid buffer with no early return between its creation and the return, so no path calls dispose without freeing quad; cleanup() correctly leaves quad alone (it'd be null on the pre-quad returns). Stress-proven: 40 create→step→dispose cycles in swiftshader → 0 glErr accumulation, no throw, fresh sim works after.
- **JS palette mapping IS transcribed from the artifact, not independently designed** (the piece the orchestrator couldn't confirm). [[components/layout/silk-canvas.tsx]]'s `fluidPaletteFromStops` (peak-normalize each RGB to 0.72) is byte-identical to the artifact `applyColour`'s preset branch (`stops.map(c=>(c/peak)*0.72)`, peak=max(r,g,b,0.001)); the plain-hue 4-stop ramp (`hsl01((h+342)%360,52,34)`…`(h+18)%360,64,66`) and `FLUID_DEFAULT_PALETTE` match the artifact's `else if(mode==="hue")` and `else`. Only extension beyond the artifact: feeding **followTheme's live theme stops** through the same peak-normalize (the artifact harness has no live-theme-follow, it falls to default there) — a sensible, consistent choice (saturated dye of the theme colours), assessed on merits per the task.
- **The single highest-risk RUNTIME property — GL state-restore after `step()` — is correct, proven in real swiftshader, not just read.** Stepped the sim 40× and ran drawFrame's EXACT restore sequence after each, checking `gl.getError()` after every INDIVIDUAL call: 0 errors across all 40. Then built + drew a DIFFERENT wallpaper (silk) on the SAME context: renders correctly (mean 127, 113 distinct colours), glErr 0 — fluid does NOT corrupt shared GL state for anything downstream. Bare-step probe: after `step()`, viewport is left at DYE_RES 256² and ARRAY_BUFFER is the sim's own quad (genuinely clobbered → the drawFrame restore of viewport/buffer/attrib/program/uSim-texture is load-bearing), but `step()` DOES reset FRAMEBUFFER to null itself (line 480) so drawFrame's `bindFramebuffer(…,null)` is redundant-but-correct/defensive — the header + drawFrame comments listing "framebuffer" as clobbered slightly overstate it (clobbered DURING the passes, ends on null). Non-issue, worth knowing if anyone trims the restore.
- **Swiftshader in THIS sandbox HAS both OES_texture_float AND OES_texture_half_float** (confirms the executor's claim, refutes an earlier phase's speculation) — so createFluidSim returns non-null here (all 9 programs compile+link+run, dye non-black). Graceful degradation still verified by proxying `getExtension` to block both float exts → returns null cleanly, no throw, glErr 0 (the `uSimReady<0.5` procedural `bgRaw` fallback, unchanged from Phase C). Cursor reactivity proven by real pixel readback: 90 steps no-pointer (27% ambient coverage) vs 90 steps WITH synthetic pointer motion → 35.5% of pixels differ meaningfully, isolated against the ambient/auto-splat baseline (not zero).
- **App-level: go straight to a PRODUCTION build for any live wallpaper-canvas check on this branch — dev-mode mount is unreliable and it's NOT a Phase D fault.** Live `next dev` never mounted SilkCanvas for ANY wallpaper incl. nebula (untouched by Phase D): root cause = the admin account was left in `minimal` appearance by concurrent sessions ([[components/layout/dashboard-client.tsx]]'s `if(minimal) return` hard-disables the canvas), and even after switching to Liquid Glass the dev React-Strict-Mode double-mount churns the WebGL context (the pre-existing double-mount issue the Phase A entry parked for this file) → `onUnsupported` → silent AmbientBackground fallback (`.ambient-orbs`, no console error). A worktree `next start` on the prod build (pinned 210d34c, node_modules symlinked, `turbopack:{root:"/home/user"}` per the ticket-14 entry above) rendered fluid perfectly: canvas mounts, `body.glass-webgl` on, `__glassFps` ticking, a real pointer sweep fed to the sim, route transitions (dispose+recreate), and a full live cycle silk→fluid→mesh→fluid→nebula→fluid — ALL zero console/page errors; screenshot shows dye-in-water behind the glass. Diagnosis tip: read the admin's live gates from dev.db via `@libsql/client` (`file:/home/user/backdrop/dev.db`) — `User.wallpaperEnabled/wallpaperUrl/wallpaperShader` + `AppSetting.glassSettings` JSON (`appearance`/`glassType`) — faster than guessing; I mutated appearance/shader for the test and restored them to minimal-dark/nebula.
- **Phase D CLOSES the standing enumeration-comment-drift** the Phase A/B/C + wallpaper-brightness + chrome-floor entries kept flagging "for the Phase D silk-canvas rewrite": the module header now reads "…brightness, night, palette". (Residual, trivial: the `subscribeWallpaperParams` inline comment ~line 921 still says "hue/blur/brightness uniforms", omitting night/palette/followTheme that `applyWallpaperLive` also refreshes.) Conventions otherwise clean: fluid-sim.ts is semicolon-free TS (the 64 trailing `;` are all inside GLSL strings), double quotes, named-exports-only, lib-style header. No test file added — matches the components/=untested precedent (hsl01/hexToRgb/fluidPaletteFromStops all have no colocated test). No planner MEMORY entry (no planner dir; same gap as every prior entry on this branch).

## Sitewide category capitalization + 6 text-casing renames (branch claude/site-issues-clarification-7jajyn, ticket #18, commit f19acbf, reviewed 2026-08-05)

**PASS**, no defects; 2 non-blocking notes. Re-derived every claim independently (did NOT trust the executor self-report or the orchestrator's verification). Ran in a detached worktree pinned to f19acbf (branch drifted f19acbf→f1d3d9b mid-review — the unrelated wallpaper Phase E, ~11th concurrent-drift; all 16 ticket-#18 files byte-identical across both, verdict anchored to the worktree). `tsc --noEmit` exit 0; `eslint` rule-ID multiset byte-identical to parent b1384df per file (all 24 findings pre-existing, the 2 new files clean); full `vitest run` 131 files/2120 tests pass incl. new [[lib/format-category.test.ts]] 7/7; [[lib/catalog-filters.test.ts]]+[[lib/inventory.test.ts]] zero-diff vs parent; `npm run build` exit 0. Live Playwright on a prod build (:3939, admin login).

- **The load-bearing filter-match regression is SAFE, proven live on BOTH filter UIs (the one thing that could silently break).** [[lib/catalog-filters.ts]]/[[lib/inventory.ts]] + tests are zero-diff vs parent; the diff formats only the *label*, key/value stay raw. Selecting the Title-Cased "Vintage Band Tee" option in the catalog [[components/catalog/catalog-filter-bar.tsx]] FacetSelect AND the inventory [[app/(dashboard)/dashboard/inv/page.tsx]] Dropdown keeps the band-tee item and hides the rest → the case-insensitive raw-value matcher still fires. Live-confirmed Title Case at 9/14 Part B sites (catalog card/detail/facet, inv table/filter, market-intel, best-sellers, margin, time-to-sale); apostrophe renders "Levi's Summer Dress", never "Levi'S", everywhere checked. Remaining 5 (sales picker, [[components/dashboard/sell-item-modal.tsx]], listings-wizard Review, new-arrivals x2, fee-comparison result card) verified by code read + green tsc/vitest only — identical one-line `formatCategory()` wraps; the seed DB lacked the subscription/in-stock/wizard state to reach them live.
- **New live-test gotcha for this repo's pickers — record for the next filter/category review.** The custom [[components/ui/dropdown.tsx]] PORTALS its menu to `<body>` as role=listbox/role=option, so a Playwright `getByText` for a category label matches BOTH the table cell and the menu option; a filter-match test MUST scope the option click to `[role="option"]` or it silently clicks the cell, the filter never applies, and you get a false "matcher regression" (my first pass hit exactly this — band-tee "still shows" passed while the others failed to hide, because nothing was ever filtered). The catalog FacetSelect is a details/summary whose trigger reads "All categories", not "Categories".
- [[lib/format-category.ts]] correct incl. the flagged subtleties: the shared `label` in [[app/(dashboard)/analytics/components/time-to-sale-tab.tsx]] feeds BOTH the >18 truncation check AND the slice(0,18) (self-consistent; the fn never changes length), `key={c.category}` stays raw, and interior/ALL-CAPS is preserved ("McQueen boots"->"McQueen Boots") per the approved design. Completeness sweep clean: every un-formatted `.category` is form-input, save-to-DB, a matcher (`listings/[id]`'s feeds `motionTypeForCategory`), or an out-of-scope expense enum — nothing displayed was missed. Conventions clean (semicolon-free, double quotes, named export, lib header). Part A: 5 renames live-confirmed; swap "Bulk Queue (" verified by source (page.tsx:608, behind `{bulkQueue.length>0 &&}` so it doesn't render on an empty queue) and the already-satisfied "Bulk Generate" is capitalized at page.tsx:1128 (the lone lowercase "Bulk generate" is a ticket-#14 *comment*, not a label).
- **Non-blocking coverage nit** (same recurring lesson as the color-theme-tint entry above): [[lib/format-category.test.ts]] pins apostrophe/hyphen/leading-digit/idempotent/empty/double-space but NOT the one behavior the ticket named — interior-caps/ALL-CAPS preservation ("McQueen"/"OEM"-style). Behavior is right and the apostrophe/hyphen cases exercise "don't touch interior chars" indirectly, but a test can look thorough while missing the plan's by-name case.
- Infra reuse: the ticket #14 fresh-worktree gotchas all held (copy [[app/generated/prisma]], symlink node_modules, `turbopack.root:"/home/user"`, `next start` not `npm run dev`); DATABASE_URL is relative `file:./dev.db`, so copy dev.db into the worktree for an isolated live DB — the orchestrator's "ZZZ FormatCat Test —" seed products (categories "vintage band tee"/"levi's summer dress") were already present. No planner MEMORY entry (no planner dir; same gap as every prior entry on this branch).

## Wallpaper revamp Phase E of 6 — auto-derive polarity from Appearance + mount canvas under minimal (branch claude/site-issues-clarification-7jajyn, ticket #11, commit f1d3d9b, reviewed 2026-08-05)

**PASS**, no defects. Re-derived every claim independently (did NOT trust the executor self-report or the orchestrator's verification). 2-file diff ([[components/layout/dashboard-client.tsx]] +21/-18, [[components/layout/silk-canvas.tsx]] 1 line). `tsc --noEmit` exit 0; full `vitest run` 131 files/2120 tests pass (margin-report green, DB provisioned); `npm run build` exit 0. Live Playwright on a PROD build in a detached worktree pinned to f1d3d9b (:3951, admin login, swiftshader). HEAD drifted f1d3d9b→471d478 ("Record the ticket #18 review outcome", MEMORY-only — ~12th concurrent-drift) mid-review; the 2 reviewed files are byte-identical at HEAD (`git diff f1d3d9b 471d478 --` empty), verdict anchored to the pinned worktree.

- **THE CRUX (why the mounted-in-minimal canvas doesn't punch holes in the opaque cards): the diff does NOT touch [[components/settings/glass-runtime-bridge.tsx]], and its PRE-EXISTING `!minimal && (glassType one|two) && getGlassCanvasActive()` guard (line 38) is exactly what keeps `body.glass-webgl` off in minimal even though Phase E now makes `getGlassCanvasActive()` TRUE in minimal.** This is the INVERSE of the first liquid-glass entry's "two pieces compute is-bg-active and disagree without a shared source of truth" mistake — here the shared flag ([[components/ui/glass-canvas-state.ts]]) is SUPPOSED to diverge from the glass-webgl class in minimal, and the untouched `!minimal` guard makes it so. Live-proven: minimal → `canvasCount:1` + `glassWebgl:false` + `glassFlat:false`; glass → `glassWebgl:true`. Whenever a future change makes the canvas mount in a new mode, re-audit this guard AND the `body.minimal .liquid-glass{background:var(--m-surface)!important;backdrop-filter:none}` opacity ([[app/globals.css]]:788/805) — both must stay true or the wallpaper bleeds through the cards. Card pixel sampled EXACTLY `[22,25,31]`=`--m-surface`, backdrop-filter none → opaque.
- **Strongest dep-array-correctness proof, reusable technique**: the store-seeding effect's dep array swaps `wallpaperNight`→`effectiveNight` (a plain per-render-derived bool, `appr==="minimal-dark"?true:appr==="minimal-light"?false:wallpaperNight`). To prove the effect still re-runs when the DERIVED value changes via `appr` alone (appr is no longer a listed dep), HOLD `wallpaperNight=TRUE` constant and flip ONLY appearance minimal-light↔minimal-dark: render flipped 180↔20. If the dep were wrong the polarity would've stuck. Live open-bg luminance: minimal-dark **20** / minimal-light **180** / glass(night=0) **175** (≈minimal-light, both derive night=false→light — the derivation-consistency check), back to minimal-dark **20** with byte-identical rgbs.
- **Manual "Dark Wallpaper" toggle (`wallpaperNight`) is genuinely glass-only, no leak either direction**: glass night=false→174 / night=true→20 (works in glass); with night=TRUE held, minimal-light stays **180** (toggle-dark ignored) and with night=false, minimal-dark stays **20** (toggle-light ignored).
- **`glassType` ⊥ `appearance` (load-bearing for the bail removal)**: [[lib/glass-displacement.ts]] `DEFAULT_GLASS_SETTINGS` sets `glassType:"two"` AND `appearance:"minimal-dark"` independently, so the `webglOn` effect's `!!glassType` gate stays truthy in minimal — removing the `if(minimal){setWebglOn(false);return}` bail correctly lets the canvas mount. Dropping `minimal` from that effect's deps is right BECAUSE webglOn no longer depends on appearance (canvas mounts in both; `subscribeGlassParams(()=>applyParams())` re-reads `p.appearance` for `drawPanels` on a live flip without remount).
- **Reduced-transparency + uploaded-image both correct**: CDP `Emulation.setEmulatedMedia prefers-reduced-transparency:reduce` → `canvasCount:0` in BOTH glass and minimal, returns to 1 when cleared (the now-unconditional check at the effect's line 84 owns this, previously the minimal bail did). Uploaded image under minimal → `uploadedImg:true, canvasCount:0` (mutually exclusive), filter ends in `saturate(0.55) brightness(0.42) contrast(1.12)` = the effectiveNight-driven night grade via `withNight(...,effectiveNight)`.
- **Flat-bg control is the cleanest "is the canvas actually painting" proof on this repo**: set `wallpaperEnabled=false` → `canvasCount:0`, every open pixel EXACTLY `[13,15,19]`=`--bg`, lumSpread 0; canvas-on samples were nebula purples (`77,25,138`, spread 31). Screenshot-clip + `sharp(buf).stats()` at points verified open via `elementFromPoint(x,y).closest(".liquid-glass,.nav-glass,nav")===null` is the robust sampler — the admin's `navPosition:"top"` + full-viewport cards mean naive centre points ALL land on opaque cards (reproduced the executor's own wrong-point trap; scan a grid excluding cards/text/interactive instead).
- **No new comment-drift** (the standing recurring pattern across the wallpaper/chrome-floor entries): the diff's added comments are accurate and the dashboard-client mirror comment already enumerates "night, palette". Phase E does not repeat it. Out of scope / not worsened: glass-default (`night:false`) still renders native-dark nebula/mesh at their inverted BRIGHT end (the Phase C shader-design consequence) — Phase E actually gives minimal-dark users the dark end, an improvement, and owns the Phase C "default-night wiring must own polarity" MUST-DO for the two minimal modes.
- Infra held identically to the ticket #14/#18 entries (independently, before reading #18's note): [[app/generated/prisma]] symlinked, node_modules symlinked, `turbopack.root:"/home/user"` in the worktree next.config (build accommodation, never committed), `next start` not `npm run dev`. DATABASE_URL is relative `file:./dev.db`, so I tested against a COPY of dev.db and left the user's REAL [[dev.db]] byte-identical (admin minimal-dark/nebula/wallpaperEnabled=1/wallpaperNight=0 before==after; I never pointed a server at it). WebGL pixels need `--use-gl=swiftshader --enable-unsafe-swiftshader` on top of the task's launch flags. No planner MEMORY entry (no planner dir; same gap as every prior entry on this branch). Planner-side sibling: the Phase A/B/C/D wallpaper entries above.

## Wallpaper revamp Phase F of 6 — Own/Hue/Theme/Palette picker + glass-only Dark toggle + first-paint race fix (branch claude/site-issues-clarification-7jajyn, ticket #11 FINAL, commit b98a7f5, reviewed 2026-08-05)

**PASS**, one non-blocking finding (strict mutual-exclusivity, below) + one minor cast smell. This is the 6th/final phase of ticket #11 and the LAST item of the whole 23-item brief — every ticket on this branch is now reviewed. Re-derived every claim independently (did NOT trust the orchestrator's self-reported fix reasoning). 2-file diff ([[app/(dashboard)/settings/page.tsx]] +192/-61, [[components/settings/preferences-panel.tsx]] 11 lines). `tsc --noEmit` exit 0; full `vitest run` 131 files/2120 tests pass (no new test file — components/=untested convention); `next build` exit 0 (worktree, pinned). `eslint` on settings/page: parent 36014bc had 4 errors+1 warn, this commit 3 errors+1 warn — the removed `react/no-unescaped-entities` (parent 461:88) is GENUINELY gone because the old apostrophe copy ("theme's colours") was replaced by apostrophe-free text, NOT suppressed (no disable comment; verified via `git show 36014bc:… | eslint --stdin`). preferences-panel eslint-clean both sides. The 3 residual errors are the pre-existing `no-explicit-any` debounce refs (94-96), unrelated to this diff.

- **Race-fix diagnosis is REAL and correctly fixed — re-derived from the code, then live-proven.** [[components/ui/glass-refraction-store.ts]]'s `current` is a module singleton seeded to `DEFAULT_GLASS_SETTINGS` (`appearance:"minimal-dark"`), seeded to the user's real value only by [[components/settings/glass-settings-bridge.tsx]]'s `useLayoutEffect` (commit phase). A `useState(getGlassParams().appearance)` initializer runs in the RENDER phase — always before that layout effect — so it reads the stale default and only "unsticks" when a later `setGlassParams`/`notifyGlassParams` fires the subscription. [[components/layout/dashboard-client.tsx]]:37 dodges this by seeding `useState(appearance)` from an SSR PROP ([[components/layout/dashboard-shell.tsx]]:123 resolves `glass.appearance` from the DB); SettingsPage had no such prop. The fix routes `appearance` through a render prop `appearanceExtras?.(settings.glass.appearance)` ([[components/settings/preferences-panel.tsx]]:231) invoked ONLY past that component's own `loading` gate (line 173), where `settings.glass.appearance` is always the real persisted value (`parseGlassSettings` in [[lib/app-settings.ts]]:152 always returns a complete object). Only fallback path is a preferences-fetch FAILURE → DEFAULT (minimal-dark) — graceful, not the race. SettingsPage no longer imports `getGlassParams`/`subscribeGlassParams` at all (only `notifyGlassParams`, still used at page.tsx:140).
- **The definitive repro is appearance=`glass` ONLY — the store default being `minimal-dark` means minimal-light does NOT distinguish buggy-from-fixed** (both the stale default and the real value render the NOTE). The admin's persisted appearance was `minimal-dark`, i.e. coincidentally == the default — exactly the "looks correct by chance" case the task warned of. Live (prod build, port 3990): 3 fresh full-page `page.goto` loads each, keyed off the "Animated Wallpaper" heading as the fetch-resolved marker → glass=TOGGLE×3 (would be NOTE if buggy), minimal-dark=NOTE×3, minimal-light=NOTE×3. Live-update (no reload): clicking the Appearance segmented control glass→MinDark→glass→MinLight swapped TOGGLE↔NOTE every time — the render-prop propagates live changes through ordinary re-renders (`setAppearance`→`saveGlass`→`save`→`setSettings`), so the fix doesn't trade first-load correctness for a broken live path.
- **NON-BLOCKING FINDING (the one real concern) — strict "only one of hue>0/followTheme/palette set" is NOT held; it's mutual-exclusivity-by-PRECEDENCE, not by zeroing.** `handleColorMode`'s Theme patch is `{followTheme:true, palette:null}` and Palette is `{palette:id, followTheme:false}` — NEITHER resets `wallpaperHue` (matches the plan's prescribed patches verbatim, and [[app/api/settings/wallpaper/route.ts]] only writes keys present in the body). Live-proven: Own→Hue→Theme→Palette→Own persisted `#set` = 0,1,**2**,**2**,0 (a leftover `hue=275` rides along under Theme and Palette). HARMLESS because the `palette > followTheme > hue` order masks it in BOTH the shader ([[components/layout/silk-canvas.tsx]] `applyWallpaperLive`, Phase B) AND the seeding initializer (page.tsx:108 checks palette, then followTheme, then hue) — live-confirmed: persisting theme+hue99 re-seeds "Theme", palette+hue88 re-seeds "Palette". It's also coupled to the intentional "resume last manual hue" in the Hue branch (`wallpaperHue>0 ? keep : baseHue`), so zeroing hue on theme/palette to satisfy the literal invariant would break resume-last-hue. Verdict stays PASS (zero behavioural/visual defect, matches approved plan); flag for the orchestrator only if the literal single-field data invariant is actually wanted.
- **Phase F functionality all correct, live.** Each segment's POST body EXACTLY matches the plan (own `{hue:0,ft:false,pal:null}`, hue `{hue:275,ft:false,pal:null}`, theme `{ft:true,pal:null}`, palette `{pal:"ember",ft:false}`); sub-controls show/hide exactly (Own/Theme → nothing, Hue → the hue slider only, Palette → the [[components/ui/dropdown.tsx]] `Dropdown` only); persistence confirmed via GET; reload re-seeds `colorMode` correctly for all 4 modes. Hue-jump: from Own (hue=0) into Hue the slider jumps to the CURRENT wallpaper's `baseHue` — admin shader=nebula → **275** (matches [[lib/wallpapers.ts]]), slider value and POST both 275. Palette dropdown ember→Glacier via the UI recolored the LIVE canvas (canvasCount=1, `body.glass-webgl`=true; sampled open-wallpaper warmth r-b shifted +2→-5, i.e. cooler/bluer, over 2160 samples) and survived reload (trigger "Glacier") — the settings control genuinely drives Phase B's proven palette→uniform path end-to-end.
- **Minor smell**: `updateDash(patch as never)` in the new `handleColorMode`/`handleWallpaperPalette` is heavier than needed — each patch is a structurally-valid `Partial<DashboardSettings>` and would typecheck without the cast; it just mirrors the file's pre-existing `saveWallpaperFlag(patch as never)`. `as never` silences any future field-name/type typo. Consistent local convention, tsc-clean, not new debt — but if these are ever cleaned up, type them `Partial<DashboardSettings>` and do all three in one pass.
- **Infra reuse + one new gotcha.** Reused the #14/#18/#E worktree recipe exactly (detached worktree under /home/user pinned to b98a7f5, node_modules + [[app/generated/prisma]] symlinked, `turbopack.root:"/home/user"` never-committed, `next start` on a prod build, tested a dev.db COPY — real [[dev.db]] left byte-identical: admin nebula/hue0/ft0/palnull/enabled1/night0/minimal-dark before==after). NEW: prod-build `/settings` loads are ~7-10s EACH (heavy page + shader warmup), so a Playwright script doing >~10 full `page.goto` navigations blows the 2min Bash cap — split into ≤~8-load scripts, and DROP `--use-gl=swiftshader` for DOM/network-only checks (it adds per-load shader-compile overhead; the canvas isn't needed to read the segmented control / toggle-vs-note DOM). `getByRole("button",{name,exact}).click()` scoped to the `[role=group]` is reliable; a `page.locator(sel,{hasText:/^X$/})` variant hung to the 30s actionability timeout (×N = the 2min cap). Concurrent main-tree dev servers (ports incl. 3000) ran throughout — used an isolated port 3990 and confirmed 3000 still up after cleanup. No planner MEMORY entry (no planner dir; same gap as every prior entry on this branch); planner-side sibling is the Phase A/B/C/D/E wallpaper entries above.
