# Self-Improving Builder — Build Plan

A phased plan to evolve the orchestrator from "compiles + passes tests" into a
builder that produces **work you'd ship without reviewing**, and that **gets
better every time it runs**. Written against the real codebase
(`src/swarm/fanout.ts`, `src/verify/gates.ts`, `src/verify/frame-timing.ts`,
`src/models.ts`, `src/store/client.ts`, `src/orchestrator.ts`).

The marketplace UI is the **proof-of-work** that rides on top: each phase is
validated by making the marketplace visibly better, not by abstract capability.

---

## The thesis: three disciplines, one flywheel

One-shotting like a real builder is not one trick. It's three disciplines that
compound:

- **Content engineering** — what reaches the model's context: the spec, the
  library source, reference images, exemplars, a design-token sheet, and an
  explicit priority signal. *Highest ROI per hour. Curation, not volume.*
- **Harness engineering** — the scaffolding that measures and routes: gates,
  decomposition, verification loops, model routing. *Necessary; backfires when
  it starves the model or grades the wrong thing.*
- **Memory engineering** — what persists and compounds across builds: a
  design-system, validated components, failure postmortems. *Highest ceiling;
  the only one that is a moat. Worthless — negative — without a promotion gate.*

```
   CONTENT ──► strong first attempt (spec + refs + memory in a TIGHT context)
      ▲                                   │
      │                                   ▼
   MEMORY ◄── validated wins        HARNESS ──► vision/frame/gate critique measures
   deposited                                     the gap vs the REAL goal → targeted bounce
      ▲                                               │
      └──────────── promotion gate ◄──────────────────┘
              (only evidence-backed results persist)
```

Run that loop across many builds and the marginal build gets cheaper and better.
That compounding substrate — not a smarter model each time — is the goal.

---

## What we already have (don't rebuild)

The pipeline already implements most of what "Unlazy"-style skills market as
novel, and the verification is **stronger** (real Chromium measurement + real
test execution vs. brittle string-matching):

- **Harness runs the checks, agent never self-certifies** — `composeDone` is
  harness-authored from the real verification result.
- **Blind, plan-scoped agents** — the fan-out specialists get goal+plan, not the
  conversation. (Now handed **inline**, after the concurrent-Serena race fix.)
- **Verify-before-accept** — Stage D fix-bounce loop; deliverable + fidelity gates.
- **Model routing** — `models.ts` (haiku explorer, sonnet specialists, opus judge).
- **Honest escalation** — ESCALATE path, `blocked` slice, `MAX_BOUNCES`.

## What is genuinely missing (this plan)

1. **A feedback loop that grades the real objective** (looks/behavior), not just
   compile + frames. → *Vision-critique gate.*
2. **Grounding beyond prose** — reference images, exemplar shaders, tokens. →
   *Grounding pack.*
3. **Per-task, plan-derived gates with machine-captured evidence** (not a fixed
   global checklist hardcoded in TS). → *Gates ledger.*
4. **Decomposition matched to task size** (today: fixed 2-way fan-out; a
   marketplace frontend is one over-loaded agent). → *Recursive tree.*
5. **Memory that compounds across builds, gated on evidence.** → *Memory spine.*

---

## Guardrails (learned the hard way)

- **Parallelism requires isolation.** Naive fan-out caused the Serena store race
  that produced the fake-glass build. Any parallel file-writers must use git
  worktree isolation + explicit file ownership in the plan. Never parallelize
  shared mutable state again.
- **Don't dogfing the skeleton.** The workflow just failed to use a library
  correctly. Hand-build the load-bearing spine (critique gate, memory promotion).
  Only let the workflow build *feature-level* things once the spine is reliable.
- **Evidence or it didn't happen.** A green mark without harness-captured
  evidence is a red flag, not progress — and it's the exact signal that gates
  promotion into memory.

---

## Phases

Each phase is independently shippable and is validated by the marketplace.

### Phase 0 — Vision-critique gate + grounding pack  *(hand-build; the fast win)*

**Why first:** it directly fixes the quality gap you can see, reuses the existing
Chromium harness, and is the first load-bearing spine piece. Smallest change that
turns "verifies it works" into "verifies it's good."

**0a. Grounding pack** (`content`)
- A per-job `grounding/` dir referenced by the plan: reference images (the two
  wallpapers, a liquid-glass exemplar), one exemplar fragment shader, a
  design-token sheet (palette, spacing, blur radii, motion curves), and a single
  **priority line** ("glass fidelity is the point; filters/pagination are table
  stakes").
- Threaded into the frontend specialist's inline context (extends the
  `specContext()` we just added).

**0b. Vision-critique gate** (`harness`) — sibling to `frame-timing.ts`
- Split the "serve workspace build" half of `frame-timing.ts` into a reusable
  dev server (esbuild `--watch`, holds `:PORT`).
- New `src/verify/vision-critique.ts`: headless Chromium drives a **fixed script
  of states worth grading** (default grid, one filter applied, modal open,
  wallpaper #2), screenshots each, sends them + the goal + grounding refs to a
  vision model, returns a structured verdict `{ pass, issues[], severity }`.
- Wire into Stage D as a gate that **bounces** with the vision model's specific
  issues, exactly like the frame gate bounces on timing.

**Critique model routing (dynamic — decided).** The gate picks its model per
call, following the `models.ts` router pattern:
- **Structural checks** ("is the glass refracting? is the wallpaper animating? is
  the control present?") → **sonnet-5** — fast, cheap, near-binary.
- **Aesthetic/taste verdict** ("does this look premium / on-brief?") → **opus-4.8**
  — nuanced visual judgment, the real quality bar.
- **Escalation:** a borderline sonnet verdict, or a node flagged high-stakes by
  the grounding priority line / its depth in the tree, escalates to opus-4.8 as a
  tiebreak. Cheap pass first; strong pass only where it earns its cost. Expose the
  policy in `models.ts` (`modelFor("critique", { difficulty })`).

**Proof:** re-run the marketplace; the fake gradient / non-refracting glass now
**fails and bounces** with a concrete critique instead of passing.

**0c. Desktop live-refresh viewer** (`harness`, in scope — not yet built)
- The dev server from 0b is the **single source of truth**. The human viewer is a
  tab on it: a thin client that hot-reloads on the server's SSE "rebuilt" ping
  (esbuild `--watch` triggers it). This is the desktop take on the iOS/Xcode
  preview canvas.
- The agent drives its **own** headless Chromium session against the same URL —
  **share the server, never the browser session** (else the human's scroll/cursor
  pollutes the grade; races on nondeterminism).
- Surface the agent's screenshots + structured verdict into a viewer panel: the
  canvas shows, live, *what the build looks like, what the critic saw, and what it
  bounced* — the preview canvas with the build's reasoning visible.
- Deliverable boundary: define the dev-server + SSE contract here; the viewer
  shell (Electron/Tauri/plain browser window) consumes it. Kept decoupled so the
  viewer can be iterated without touching the harness.

### Phase 1 — Declarative gates ledger  *(hand-build)*

**Generalize `checkDeliverables` from a fixed TS list into a plan-derived ledger.**
- Each `acceptance:` bullet in the job YAML compiles to a gate:
  `{ outcome, command | probe, expected, evidence: "pending" }`.
- Gate *types*: shell-command+match, real test, Chromium measurement (frame),
  structural probe (fidelity: imports liquidGL, real WebGL context), vision verdict.
- The **harness** runs each gate, captures real output into `evidence`, ticks the
  box. A ticked box with `pending` evidence = **unmet** (worse than empty).
- `done`/report is generated from the closed ledger.

**Proof:** the marketplace's 7 acceptance criteria each become an
independently-proven gate with captured evidence, replacing prose review.

### Phase 2 — Recursive tree decomposition + isolation  *(hand-build)*

**Replace the fixed 2-way fan-out with a depth-controlled tree.**
- A decomposer turns the plan into a task tree; leaves are real, focused units
  (e.g. frontend → `{wallpaper-shaders, glass-wiring, filter-state, modal,
  effect-controls}`), each ≥ a real-work threshold, each with its **own tight
  context** (subtask + its gates + grounding) and its **own agent**.
- **Isolation:** file-writing leaves run in git worktrees (`Agent` tool
  `isolation: 'worktree'`); the plan assigns file ownership so no two leaves
  write the same file. Reconciler merges seams (already exists).
- Current 2-way split becomes just "depth-1."

**Proof:** the two wallpaper shaders and the glass wiring each get a dedicated,
deep agent → materially better fidelity than one overloaded frontend agent.

### Phase 3 — Memory spine  *(hand-build; the moat)*

**Persistent, curated knowledge that survives across jobs.**
- A long-term store (separate from per-job slices): a **design-system memory**
  (tokens + components that passed the vision gate) and a **postmortem memory**
  (validated failure→fix lessons, e.g. "liquidGL snapshot init → pre-warm off the
  first frame").
- **Promotion gate:** a result enters long-term memory only if its gate closed
  **with real evidence** (Phase 1 gives this signal). No promotion of unvalidated
  lore — that's negative compounding.
- Retrieval: the decomposer/specialists read relevant memory into their tight
  context (content eng), compacted so it never bloats the window.

**Proof:** build N+1 starts with the tokens and lessons build N validated —
including never re-hitting the first-frame spike.

### Phase 4 — Let the workflow build features  *(workflow-built)*

Once the spine is reliable, dogfood it for feature-level work: marketplace
polish, the desktop live viewer, and future apps — where the workflow is strong
(bounded builds, tight grounding, a real critique loop catching mistakes).

---

## Build ownership

| Piece | Who builds it | Why |
|---|---|---|
| Grounding pack, vision-critique gate | **Hand** | Load-bearing; must be correct |
| Gates ledger | **Hand** | Core integrity mechanism |
| Tree decomposition + isolation | **Hand** | Coordination correctness |
| Memory spine + promotion gate | **Hand** | The moat; poison-sensitive |
| Marketplace UI, live viewer, future apps | **Workflow** | Feature work on a reliable spine |

---

## Sequencing rationale

Phase 0 first because it's the fastest visible win *and* the first spine piece —
it makes every later phase's "is it actually good?" question answerable by the
harness instead of by you. Phases 1→3 are ordered so each unlocks the next
(ledger evidence is the promotion signal memory needs; the tree needs per-leaf
gates to hold leaves honest). Phase 4 is gated on the spine being trustworthy.

## Decisions (locked)

1. **Start with Phase 0.** Rationale: it is the *dependency root*, not merely the
   easiest. The tree (P2) and memory (P3) both need a quality signal that doesn't
   exist yet — building them first scales production without inspection, and P3's
   promotion gate would bank "compiled + smooth" as a win (the exact lie that
   green-lit the fake glass). Phase 0 also makes P2 measurable (A/B depth-1 vs.
   tree, graded), and reuses `frame-timing.ts` infra so it's the cheapest to build.
   QA goes on the line before the line scales.
2. **Critique model: dynamic sonnet-5 / opus-4.8.** sonnet-5 for fast structural
   checks; opus-4.8 for aesthetic/taste verdicts and borderline/high-stakes
   escalation. Routed via `models.ts` (`modelFor("critique", { difficulty })`).
   See Phase 0b.
3. **Live viewer: in scope, not yet built.** Designed as the tab on Phase 0's dev
   server (0c). Build the dev-server + SSE contract here; the viewer shell consumes
   it, kept decoupled.

## Still open

- Cost ceiling per critique run (how many opus-4.8 passes before the gate caps).
- Viewer shell tech (Electron / Tauri / plain browser window) — decide at 0c.
- The "real-work threshold" for a tree leaf (P2) — tune once the gate can measure
  whether finer splits actually raise graded quality.
