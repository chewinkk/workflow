// Verification gates + build config (spec §9 / §7).
//
// The workspace is where the Executor writes REAL files. The build/test config
// is provisioned by the harness (not the Executor) so the *build system* is a
// stable given and only the Executor's source is under test — that keeps the
// verification loop about the code, not about tsconfig flags.

import { join } from "node:path";
import {
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
} from "node:fs";
import { readSlice } from "../store/client.js";

export const WORKSPACE_DIR = join(process.cwd(), "workspace");
export const WORKSPACE_SRC = join(WORKSPACE_DIR, "src");

// The frontend specialist builds a real, browser-renderable liquid-glass UI here.
// The frame-timing harness (verify/frame-timing.ts) bundles CLIENT_ENTRY, serves
// CLIENT_HTML, and drives it under Chromium. These paths are the CONTRACT between
// the frontend specialist and the harness — keep them in sync with the directive
// in swarm/fanout.ts.
export const CLIENT_DIR = join(WORKSPACE_SRC, "client");
export const CLIENT_HTML = join(CLIENT_DIR, "index.html");
export const CLIENT_ENTRY = join(CLIENT_DIR, "main.ts");
// Vendored libraries live in the REPO under vendor/ (committed, so present in the
// deployed image). The harness copies them into the client build tree so the
// frontend specialist can `import ... from "./lib/<name>"` and the esbuild bundle
// + tsc can resolve them. This is how a plan "vendors a library": the file is a
// harness-provisioned given, not something a specialist must author or fetch.
export const VENDOR_DIR = join(process.cwd(), "vendor");
export const CLIENT_LIB_DIR = join(CLIENT_DIR, "lib");
// Files copied from vendor/ into client/lib/ when present. Extend as more libs
// are vendored. (.js is the runtime module; .d.ts gives tsc its types.)
const VENDORED_LIB_FILES = ["liquidgl.js", "liquidgl.d.ts"];

// Frame-timing budget (spec §7 acceptance: "No jank: animation holds frame budget
// under interaction"; Council ruling: worst frame < 22ms, dropped-frame ratio < 5%).
// A frame is "dropped" when its inter-frame delta exceeds the 60fps budget.
export const FRAME_BUDGET_MS = 1000 / 60; // 16.67ms — the 60fps main-thread budget
export const WORST_FRAME_MAX_MS = 22; // Council: worst single frame must be under this
export const DROPPED_RATIO_MAX = 0.05; // Council: <5% of frames may miss the 60fps budget
// A frame is "dropped" when it misses a FULL refresh interval (Chrome's own
// definition of a dropped/janky frame), not merely when it exceeds the 16.67ms
// budget by jitter. The harness holds a steady 60fps pump, so a delta this large
// means the main thread was actually blocked, i.e. real jank.
export const DROPPED_FRAME_MS = FRAME_BUDGET_MS * 1.5; // ~25ms = missed a refresh
// Warm-up frames (first paint / compositor spin-up) are not interaction jank.
export const FRAME_WARMUP_DROP = 10;

// WebGL-aware frame budget. A headless browser with no GPU software-renders WebGL
// (SwiftShader), so a real-WebGL app blocks the main thread on EVERY frame —
// regardless of code quality. The strict 22ms/5% budget is physically unreachable
// there and would fail every honest WebGL build (observed: 100% dropped, worst
// ~150ms, longTasks ≈ frame count — the software-raster signature, not a code bug).
// For WebGL apps we switch to a RELATIVE budget: measure an idle baseline (the
// unavoidable steady wallpaper cost) and require that INTERACTION (scroll / filter /
// pagination) does not add materially more main-thread jank on top of it. That
// isolates the app's OWN cost (which it can fix) from the environment's raster cost
// (which it cannot). A genuinely janky app — one that re-snapshots everything on
// each interaction — spikes interaction cost far above idle and still fails.
export const WEBGL_INTERACTION_SLACK_MS = 60; // interaction worst may exceed idle worst by at most this
export const WEBGL_DROPPED_DELTA_MAX = 0.25; // interaction dropped-ratio may exceed idle by at most this
export const WEBGL_IDLE_CEILING_MS = 600; // even the steady baseline must be under this (else pathological)

// Recursively list every .ts file under workspace/src (absolute paths). The
// Executor may organize code into subdirectories, so all workspace discovery
// (file count, test discovery, fault injection) must recurse — tsc's
// include:["**/*.ts"] does, and these helpers must agree with it.
export function walkWorkspaceTs(): string[] {
  const out: string[] = [];
  const rec = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.name.endsWith(".ts")) out.push(p);
    }
  };
  if (existsSync(WORKSPACE_SRC)) rec(WORKSPACE_SRC);
  return out.sort();
}

export function workspaceTestFiles(): string[] {
  return walkWorkspaceTs().filter((f) => f.endsWith(".test.ts"));
}

export function workspaceSourceFiles(): string[] {
  return walkWorkspaceTs().filter((f) => !f.endsWith(".test.ts"));
}

// A build config verified to work in this environment (repo-rooted so
// node_modules/@types resolve upward). tsc as the "build"; node --test as tests.
export const WORKSPACE_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      types: ["node"],
    },
    include: ["**/*.ts"],
  },
  null,
  2
);

// Path of the build config the tsc gate compiles against.
export const WORKSPACE_TSCONFIG_PATH = join(WORKSPACE_DIR, "tsconfig.json");

// Provision the workspace scaffolding the harness ASSUMES exists: the source
// tree (so specialists spawned with cwd=WORKSPACE_DIR don't ENOENT, and so tsc's
// include glob has a root) and the build config itself. This is gitignored
// runtime state — a freshly rebuilt box has none of it — so the harness, which
// owns the build config, must create it rather than assume it. Idempotent and
// cheap; safe to call at the top of every build. The tsconfig is always rewritten
// so it can never drift from WORKSPACE_TSCONFIG above (the single source of truth
// that TS5058 "path does not exist" came from never being written).
export function ensureWorkspaceScaffold(): void {
  mkdirSync(WORKSPACE_SRC, { recursive: true });
  writeFileSync(WORKSPACE_TSCONFIG_PATH, WORKSPACE_TSCONFIG + "\n", "utf8");
  provisionVendoredLibs();
}

// Copy any vendored libraries from the repo's vendor/ into the client build tree
// (client/lib/). Idempotent and always-overwrite so the client's `./lib/<name>`
// import resolves to the real, current library. Silently no-ops if vendor/ or a
// given file is absent (not every job vendors a library).
export function provisionVendoredLibs(): void {
  if (!existsSync(VENDOR_DIR)) return;
  let copiedAny = false;
  for (const f of VENDORED_LIB_FILES) {
    const from = join(VENDOR_DIR, f);
    if (!existsSync(from)) continue;
    if (!copiedAny) mkdirSync(CLIENT_LIB_DIR, { recursive: true });
    cpSync(from, join(CLIENT_LIB_DIR, f));
    copiedAny = true;
  }
}

// Remove the previous build's source tree so a new full build never inherits stale
// files (e.g. a prior job's client/server/tests that would break tsc or run as
// dead tests). The harness re-scaffolds (tsconfig + vendored libs) immediately
// after. The vendored libs are re-provisioned from the repo, so wiping them here
// is safe. Only the gitignored workspace/src is touched — never the repo sources.
export function resetWorkspaceSrc(): void {
  rmSync(WORKSPACE_SRC, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Deliverable preflight gate (execute path). The specialists build against a
// plan whose hard requirements the Council already ratified; a prompt asking
// for them is not a guarantee, so this deterministic structural check runs
// BEFORE the browser stage and bounces any MISSING mandated deliverable to the
// Executor to remediate. It does NOT judge quality (that's tsc, node --test,
// and the frame-timing harness) — it only proves the mandated artifacts exist,
// so nothing can pass by simply not being built (e.g. a vacuous zero-test run,
// an inert script-less page, or an in-memory store the Council overrode).
export interface DeliverableMiss {
  code: string;
  detail: string;
}

function readIf(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// The frontend specialist's OWN client source (all client/*.ts except tests and
// except the vendored library itself under client/lib/). This is what the fidelity
// checks inspect: we want to know whether the specialist's code uses the mandated
// technology, not whether the vendored library file happens to contain it.
function clientSourceText(): string {
  return walkWorkspaceTs()
    .filter((f) => f.startsWith(CLIENT_DIR) && !f.startsWith(CLIENT_LIB_DIR) && !f.endsWith(".test.ts"))
    .map((f) => readIf(f))
    .join("\n");
}

// True when the client creates a real WebGL context — the signal the frame-timing
// gate uses to pick the relative (vs. strict) budget. Same probe as fidelity gate G.
export function clientUsesWebGL(): boolean {
  return /getContext\s*\(\s*["'`](?:webgl2?|experimental-webgl)["'`]/.test(clientSourceText());
}

export function checkDeliverables(): DeliverableMiss[] {
  const misses: DeliverableMiss[] = [];
  const html = readIf(CLIENT_HTML);
  const mainSrc = readIf(CLIENT_ENTRY);
  const perfPath = join(CLIENT_DIR, "perf.ts");
  const perfSrc = readIf(perfPath);

  // A — the app must be self-contained: index.html references a real ./main.js
  // (the harness emits it from main.ts). No script tag ⇒ an inert page whose
  // interactions never fire in a real browser.
  if (!/<script\b[^>]*\bsrc\s*=\s*["']\.?\/?main\.js["']/i.test(html)) {
    misses.push({
      code: "A",
      detail:
        `${CLIENT_HTML} has no <script type="module" src="./main.js"> — the page is inert in a ` +
        `real browser (its interactions never fire). Add the module script tag referencing ./main.js.`,
    });
  }

  // B — the Council's Step 6 perf probe must exist as a deliverable (the harness's
  // own sampler remains the authoritative judge; this is the required artifact).
  if (!/\bclassifyFrames\b/.test(perfSrc)) {
    misses.push({
      code: "B",
      detail:
        `workspace/src/client/perf.ts must exist and export classifyFrames() (Council Step 6 mandate). ` +
        `It is missing or does not define classifyFrames.`,
    });
  }
  if (!/perfcheck/i.test(mainSrc)) {
    misses.push({
      code: "B",
      detail:
        `main.ts must wire a ?perfcheck=1 URL mode that runs classifyFrames() and exposes its result ` +
        `(Council Step 6 mandate). No perfcheck handling found.`,
    });
  }

  // C — at least one real test must exist, or `node --test` passes vacuously.
  if (workspaceTestFiles().length === 0) {
    misses.push({
      code: "C",
      detail:
        `No *.test.ts anywhere in workspace/src — node --test would pass vacuously. Add tests covering: ` +
        `classifyFrames, plus the core behavior the plan defines (e.g. the server's endpoints/pagination/` +
        `filters, or the client's filter/pagination helpers).`,
    });
  }

  // D/E — each specialist MUST declare its API CONTRACT into its store slice (via
  // write_memory). An empty slice means the specialist never engaged the store —
  // the frontend has done exactly this (globbed for the plan, never read it, never
  // wrote its contract), which breaks the reconciler and the reviewer.
  if (!(readSlice("frontend") ?? "").trim()) {
    misses.push({
      code: "D",
      detail:
        `The \`frontend\` store slice is EMPTY — the frontend specialist never wrote its contract ` +
        `(write_memory name="frontend"). Read the client code under workspace/src/client and write ` +
        `memory \`frontend\`: a short summary + the "=== API CONTRACT ===" block for the ` +
        `endpoints/fields/responses/state the client actually uses.`,
    });
  }
  if (!(readSlice("backend") ?? "").trim()) {
    misses.push({
      code: "E",
      detail:
        `The \`backend\` store slice is EMPTY — write memory \`backend\` with a short summary + the ` +
        `"=== API CONTRACT ===" block for the server's actual endpoints/fields/responses/state.`,
    });
  }

  // --- Fidelity checks: the plan mandated REAL technology, not a look-alike -----
  // tsc + node --test + the frame gate all pass on a build that COMPILES and stays
  // smooth while completely ignoring the plan's premise — faking glass with CSS,
  // painting a gradient instead of a real WebGL wallpaper, reimplementing (or not
  // using) a vendored library. These structural checks fail such a build so the
  // harness can never green-light one that faked what the plan is actually about.
  const planText = readSlice("plan") ?? "";
  const clientSrc = clientSourceText();

  // F — if the plan VENDORS a library (harness provisioned it into client/lib/), the
  // client MUST import it. Reading the file then hand-rolling the effect is the exact
  // failure we saw: the vendored library sat unused while the UI faked it in CSS.
  const vendoredLibs = existsSync(CLIENT_LIB_DIR)
    ? readdirSync(CLIENT_LIB_DIR).filter((f) => f.endsWith(".js"))
    : [];
  if (vendoredLibs.length && clientSrc) {
    const importsAVendoredLib = vendoredLibs.some((f) => {
      const base = f.replace(/\.js$/, "");
      // matches:  from "./lib/liquidgl.js"  |  import("./lib/liquidgl")  |  "../lib/liquidgl.js"
      return new RegExp(`["'\\\`][^"'\\\`]*\\blib/${base}(?:\\.js)?["'\\\`]`).test(clientSrc);
    });
    if (!importsAVendoredLib) {
      misses.push({
        code: "F",
        detail:
          `A library is VENDORED at workspace/src/client/lib/ (${vendoredLibs.join(", ")}) but the ` +
          `client code never IMPORTS it. The plan requires using the vendored library, not faking its ` +
          `effect. In main.ts (or a module it imports), \`import\` the vendored file (e.g. ` +
          `import liquidGL from "./lib/${vendoredLibs[0].replace(/\.js$/, ".js")}") and drive the real ` +
          `UI through it — do NOT reimplement the effect in CSS/hand-rolled code.`,
      });
    }
  }

  // G — if the plan calls for a WebGL wallpaper/background, the client MUST create a
  // real WebGL context. A CSS gradient or 2D-canvas "wallpaper" compiles and animates
  // but is not what the plan asked for.
  if (/\bwebgl\b/i.test(planText) && clientSrc) {
    const createsWebGL = /getContext\s*\(\s*["'`](?:webgl2?|experimental-webgl)["'`]/.test(clientSrc);
    if (!createsWebGL) {
      misses.push({
        code: "G",
        detail:
          `The plan calls for a live WebGL wallpaper/background, but the client never creates a WebGL ` +
          `context (no getContext("webgl"/"webgl2")). A CSS gradient or 2D canvas is NOT a WebGL ` +
          `wallpaper. Create a real WebGL context on a <canvas> and animate it with a shader, as the ` +
          `plan describes (e.g. the black liquid-chrome and blue macOS-waves wallpapers).`,
      });
    }
  }

  return misses;
}

export function deliverableErrorText(misses: DeliverableMiss[]): string {
  return (
    "Mandated deliverables from the ratified plan are MISSING. These are hard Council requirements, " +
    "NOT optional — create them exactly:\n\n" +
    misses.map((m) => `  [${m.code}] ${m.detail}`).join("\n\n") +
    "\n\nWrite the missing files/edits under workspace/src (client/ and server/). Keep pure TypeScript " +
    "with explicit .ts import extensions; do NOT touch tsconfig.json."
  );
}

export interface Cmd {
  label: string;
  cmd: string;
  args: string[];
}

// Build tier: real TypeScript compile of the workspace.
export function buildCmd(): Cmd {
  return { label: "build (tsc)", cmd: "npx", args: ["tsc", "-p", "workspace/tsconfig.json"] };
}

// Test tier: real execution of the workspace's unit tests.
export function testCmd(testFiles: string[]): Cmd {
  return {
    label: "test (node --test)",
    cmd: "node",
    args: ["--import", "tsx", "--test", ...testFiles],
  };
}

// How many Executor fix-bounces before escalating to the Planner (spec §7.4).
export const MAX_BOUNCES = 3;
