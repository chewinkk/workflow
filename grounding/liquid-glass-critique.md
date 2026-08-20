# Design brief — liquid-glass marketplace (critique rubric)

Text-only grounding for the vision-critique gate. The critic judges rendered
screenshots against THIS brief plus the job's acceptance criteria. Reference
images will be added later (Phase 0a); until then this prose is the standard.

## What "real liquid glass" must look like (not a look-alike)

- **Refraction, not translucency.** Glass surfaces must visibly BEND/DISTORT the
  animated wallpaper behind them (the vendored liquidGL library does this). A flat
  semi-transparent panel, or a CSS `backdrop-filter: blur()` with a solid tint and
  no refraction, is a FAIL — that is the fake we are guarding against.
- **Depth cues:** a soft bevel/edge highlight where light catches the rim, a subtle
  inner glow or specular streak, and a shadow grounding the panel above the
  wallpaper. Panels should read as thick glass, not paper.
- **Frost gradient:** slight blur that varies across the surface, not a uniform
  gray wash.
- **Chromatic edge:** a faint color fringe (aberration) at high-contrast edges is a
  strong signal the real refraction shader is running.

## The two wallpapers (must be LIVE WebGL, visibly animating)

- **Black liquid chrome:** dark metallic, ridged flowing waves — like brushed
  liquid metal / oil on chrome. Deep blacks with bright specular highlights riding
  the ridges. Must look 3-D and molten, not a static dark gradient.
- **Blue macOS waves:** flowing translucent blue ribbons/waves, bright and airy,
  in the spirit of a macOS Sonoma-style dynamic wallpaper. Smooth gradients of blue
  with gentle motion, not flat banded color.
- A still, banded, or obviously-CSS gradient standing in for either wallpaper is a
  FAIL (they must be shader-driven and switchable).

## Composition & polish

- Clear hierarchy: top bar, filter rail, listing grid, pagination bar all legible
  and aligned; consistent spacing scale; nothing overlapping or clipped.
- Text on glass stays READABLE (enough contrast / scrim behind text).
- The grid reads as a real marketplace: image, title, brand, price, quality/passing
  badge per card.
- The post-a-product modal is a glass panel with its full field set, not a bare
  browser form.

## Priority (where the build must be EXCELLENT vs. merely correct)

- **Excellent (the point):** glass fidelity (real refraction) and the two live
  WebGL wallpapers. This is what the whole build is about.
- **Table stakes (must be correct, need not dazzle):** filter/pagination controls,
  the modal's field completeness, layout alignment.

## Severity guidance for the critic

- **blocker** — the premise is faked: no visible refraction, a wallpaper that is a
  static/CSS gradient, or the glass/wallpaper simply absent.
- **major** — real but poor: weak/barely-visible glass, unreadable text on glass,
  broken layout, a wallpaper that reads flat.
- **minor** — polish nits (spacing, minor contrast, small alignment) that do not
  undermine the look.

A build with any **blocker** or **major** issue does NOT pass.
