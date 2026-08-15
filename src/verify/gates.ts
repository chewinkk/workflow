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
