// Verification gates + build config (spec §9 / §7).
//
// The workspace is where the Executor writes REAL files. The build/test config
// is provisioned by the harness (not the Executor) so the *build system* is a
// stable given and only the Executor's source is under test — that keeps the
// verification loop about the code, not about tsconfig flags.

import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";

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
