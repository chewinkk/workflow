// Verification gates + build config (spec §9 / §7).
//
// The workspace is where the Executor writes REAL files. The build/test config
// is provisioned by the harness (not the Executor) so the *build system* is a
// stable given and only the Executor's source is under test — that keeps the
// verification loop about the code, not about tsconfig flags.

import { join } from "node:path";
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";

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
  code: "A" | "B" | "C" | "D";
  detail: string;
}

function readIf(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function checkDeliverables(): DeliverableMiss[] {
  const misses: DeliverableMiss[] = [];
  const html = readIf(CLIENT_HTML);
  const mainSrc = readIf(CLIENT_ENTRY);
  const perfPath = join(CLIENT_DIR, "perf.ts");
  const perfSrc = readIf(perfPath);
  const serverDir = join(WORKSPACE_SRC, "server");

  // A — the app must be self-contained: index.html references a real ./main.js
  // (the harness emits it from main.ts). No script tag ⇒ an inert page that never
  // fires signup/login in a real browser.
  if (!/<script\b[^>]*\bsrc\s*=\s*["']\.?\/?main\.js["']/i.test(html)) {
    misses.push({
      code: "A",
      detail:
        `${CLIENT_HTML} has no <script type="module" src="./main.js"> — the form is inert in a ` +
        `real browser (signup/login never fires). Add the module script tag referencing ./main.js.`,
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
        `signup/login/session round-trip, wrong-password rejection, JsonFileUserStore durability, and classifyFrames.`,
    });
  }

  // D — the Council ruled file-backed persistence the DEFAULT; an in-memory-only
  // backend does not satisfy the plan.
  const hasJsonStore =
    existsSync(serverDir) &&
    walkWorkspaceTs().some((f) => f.startsWith(serverDir + "/") && /JsonFileUserStore/.test(readIf(f)));
  if (!hasJsonStore) {
    misses.push({
      code: "D",
      detail:
        `No JsonFileUserStore found under workspace/src/server. The Council ruled a file-backed ` +
        `JsonFileUserStore the DEFAULT (persist to JSON, reload on startup) with a durability test — ` +
        `not an in-memory store.`,
    });
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
