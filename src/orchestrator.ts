// Top-level orchestrator loop (spec §2).
//
// Step 3 scope: adds VERIFICATION (§7). The Executor now writes REAL files to
// the workspace; the verifier actually RUNS them (build + test) and closes a
// build-test-fix loop — a real failure bounces the real stderr back to the
// Executor, which edits the files; re-run; escalate to the Planner after N.
// Still NO swarm or council (Steps 4-5).
//
// Carried forward from Step 2: the store-mediated handoff and the tool-trace
// logging that proves the Executor pulls `plan` from the store.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { load } from "js-yaml";
import { explore } from "./pipeline/explorer.js";
import { plan } from "./pipeline/planner.js";
import { buildToDisk } from "./pipeline/executor.js";
import { review } from "./pipeline/reviewer.js";
import type { AgentResult, ToolCall } from "./runner.js";
import { SLICES, type Slice } from "./store/schema.js";
import { writeSlice, readSlice, resetJobSlices } from "./store/client.js";
import { buildTestFix } from "./verify/build-test-fix.js";
import { seedBreak } from "./verify/seed-break.js";
import { WORKSPACE_DIR, WORKSPACE_SRC, WORKSPACE_TSCONFIG, walkWorkspaceTs } from "./verify/gates.js";
import { join, relative } from "node:path";

interface Job {
  goal: string;
  constraints?: string[];
  acceptance?: string[];
  council?: boolean;
}

export interface RunOptions {
  seedBreak?: boolean;
}

function loadJob(path: string): Job {
  const job = load(readFileSync(path, "utf8")) as Job;
  if (!job || typeof job.goal !== "string") throw new Error(`job file ${path} has no "goal"`);
  return job;
}

function goalText(job: Job): string {
  const lines: string[] = [`GOAL: ${job.goal.trim()}`];
  if (job.constraints?.length) {
    lines.push("", "CONSTRAINTS:");
    for (const c of job.constraints) lines.push(`  - ${c}`);
  }
  if (job.acceptance?.length) {
    lines.push("", "ACCEPTANCE CRITERIA:");
    for (const a of job.acceptance) lines.push(`  - ${a}`);
  }
  return lines.join("\n");
}

function banner(msg: string): void {
  console.log(`\n${"─".repeat(74)}\n${msg}\n${"─".repeat(74)}`);
}

// ---- tool-call interpretation (the observable "sources read") --------------

const SLICE_SET = new Set<string>(SLICES);

// Serena memory tools = the shared store. Everything else Serena exposes
// (read_file, find_file, list_dir, get_symbols_overview, search_for_pattern,
// find_symbol, execute_shell_command, …) is CODE/REPO interaction — the exact
// re-derivation the store is meant to eliminate. So is Read/Glob/Grep.
const MEMORY_TOOLS = new Set([
  "mcp__serena__read_memory",
  "mcp__serena__write_memory",
  "mcp__serena__list_memories",
  "mcp__serena__delete_memory",
  "mcp__serena__edit_memory",
  "mcp__serena__rename_memory",
]);
const NATIVE_REPO_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);

function isDerivedRepoRead(tc: ToolCall): boolean {
  if (NATIVE_REPO_TOOLS.has(tc.name)) return true;
  // Any Serena tool that is NOT a memory tool touches code/the repo.
  if (tc.name.startsWith("mcp__serena__") && !MEMORY_TOOLS.has(tc.name)) return true;
  return false;
}

// Which store slice(s), if any, a tool call references (scans input values).
function slicesReferenced(tc: ToolCall): string[] {
  const hits = new Set<string>();
  for (const v of Object.values(tc.input)) {
    if (typeof v === "string") {
      const bare = v.replace(/\.md$/, "");
      if (SLICE_SET.has(bare)) hits.add(bare);
    }
  }
  return [...hits];
}

function argHint(tc: ToolCall): string {
  const v =
    (tc.input.memory_name as string) ??
    (tc.input.memory_file_name as string) ??
    (tc.input.file_path as string) ??
    (tc.input.relative_path as string) ??
    (tc.input.pattern as string) ??
    (tc.input.name_path as string) ??
    "";
  return v ? `(${v})` : "";
}

interface Sources {
  storeReads: string[]; // slices read via read_memory (successful)
  storeWrites: string[]; // slices written via write_memory (successful)
  repoReads: string[]; // successful code/repo reads (native OR serena)
  repoReadAttempts: string[]; // code/repo reads that were denied
}

function summarizeSources(r: AgentResult): Sources {
  const storeReads: string[] = [];
  const storeWrites: string[] = [];
  const repoReads: string[] = [];
  const repoReadAttempts: string[] = [];
  for (const tc of r.toolCalls) {
    if (tc.name === "mcp__serena__read_memory" && !tc.denied) {
      for (const s of slicesReferenced(tc)) storeReads.push(s);
    } else if (tc.name === "mcp__serena__write_memory" && !tc.denied) {
      for (const s of slicesReferenced(tc)) storeWrites.push(s);
    } else if (isDerivedRepoRead(tc)) {
      const label = `${tc.name}${argHint(tc)}`;
      (tc.denied ? repoReadAttempts : repoReads).push(label);
    }
  }
  return { storeReads, storeWrites, repoReads, repoReadAttempts };
}

// Full, unabridged trace — nothing hidden. ✓ = succeeded, ✗ = denied.
function traceLine(tc: ToolCall): string {
  return `${tc.denied ? "✗" : "✓"} ${tc.name}${argHint(tc)}`;
}

function logSources(r: AgentResult, s: Sources): void {
  console.log(
    `\n  ✅ ${r.role} finished  (model=${r.model}, ${r.ms} ms, ${r.toolCalls.length} tool calls)`
  );
  console.log(`     full tool trace: ${r.toolCalls.map(traceLine).join("  ") || "(none)"}`);
  console.log(`     SOURCES READ:`);
  console.log(`       · store slices        : ${s.storeReads.join(", ") || "(none)"}`);
  console.log(`       · code/repo (success) : ${s.repoReads.join(", ") || "(none)"}`);
  if (s.repoReadAttempts.length)
    console.log(`       · code/repo (DENIED)  : ${s.repoReadAttempts.join(", ")}`);
  console.log(`     WROTE store slices      : ${s.storeWrites.join(", ") || "(none)"}`);
}

// Convenience for stages whose sources we only want to display.
function logSources2(r: AgentResult): void {
  logSources(r, summarizeSources(r));
}

function provisionWorkspace(): void {
  // Fresh workspace each run so the Executor builds from scratch.
  rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  mkdirSync(WORKSPACE_SRC, { recursive: true });
  // The build system is a harness-provided given (not the Executor's job).
  writeFileSync(join(WORKSPACE_DIR, "tsconfig.json"), WORKSPACE_TSCONFIG, "utf8");
}

function workspaceFiles(): string[] {
  return walkWorkspaceTs().map((f) => relative(WORKSPACE_SRC, f));
}

export async function run(jobPath: string, opts: RunOptions = {}): Promise<void> {
  const job = loadJob(jobPath);
  const goal = goalText(job);

  banner(`ORCHESTRATOR — Step 3: base loop + shared store + verification\njob: ${jobPath}`);

  resetJobSlices();
  writeSlice("goal", goal);
  provisionWorkspace();
  console.log(`  seeded store slice: goal (${goal.length} chars)`);
  console.log(`  provisioned workspace: ${WORKSPACE_DIR} (+ tsconfig)`);
  console.log(`  seed-break: ${opts.seedBreak ? "ON (a deliberate break will be injected)" : "off"}`);
  if (job.council) console.log(`  (note) council:true is Step 5 — not wired yet, ignored for Step 3.`);

  // --- Stage 1: Explorer --> writes `explored` ----------------------------
  banner("STAGE 1/5 · EXPLORER   (reads goal → writes explored)");
  logSources2(await explore());

  // --- Stage 2: Planner --> writes `plan` ---------------------------------
  banner("STAGE 2/5 · PLANNER    (reads goal + explored → writes plan)");
  logSources2(await plan());

  // --- Stage 3: Executor --> writes REAL files + `done` -------------------
  banner("STAGE 3/5 · EXECUTOR   (reads plan → writes real files to workspace)");
  const executedR = await buildToDisk();
  const executedS = summarizeSources(executedR);
  logSources(executedR, executedS);
  const filesWritten = workspaceFiles();
  console.log(`  files written to workspace/src: ${filesWritten.join(", ") || "(none)"}`);

  // --- Stage 4: VERIFY (build-test-fix, §7) — the Step 3 gate -------------
  banner("STAGE 4/5 · VERIFY     (actually build + test; fix on failure)   ← Step 3 gate");
  if (opts.seedBreak) {
    const seed = seedBreak();
    if (seed) console.log(`  🔩 SEEDED BREAK (deliberate) in ${seed.file}: ${seed.detail}`);
    else console.log(`  (seed-break requested but Executor wrote no source file to break)`);
  }
  const verify = await buildTestFix();

  // --- Stage 5: Reviewer --------------------------------------------------
  banner("STAGE 5/5 · REVIEWER   (reads goal + done → verdict)");
  const reviewedR = await review();
  logSources2(reviewedR);

  // --- Store contents after the run ---------------------------------------
  banner("SHARED STORE after run (Serena memories)");
  for (const s of SLICES) {
    const len = readSlice(s as Slice)?.trim().length ?? 0;
    console.log(`  ${s.padEnd(9)} : ${len > 0 ? `${len} chars` : "(empty)"}`);
  }

  // --- STEP 3 GATE --------------------------------------------------------
  banner("STEP 3 GATE — was a broken build caught and fixed with no human help?");

  const caughtFailure = verify.trace.some((t) => !t.run.ok);
  const appliedFix = verify.trace.some((t) => t.action.startsWith("executor-fix"));
  const wroteRealFiles = filesWritten.length > 0;
  const endedGreen = verify.status === "PASS";
  const readPlan = executedS.storeReads.includes("plan"); // Step-2 continuity
  const noReExplore = !executedS.storeReads.includes("explored");

  const checks: [string, boolean][] = [
    ["Executor wrote real files to disk", wroteRealFiles],
    ["Verifier actually RAN the code and caught a real failure (exit≠0)", caughtFailure],
    ["Failure bounced back and the Executor applied a real fix", appliedFix],
    ["Re-run went GREEN (build + tests pass)", endedGreen],
    ["(carried) Executor read `plan` from store, not re-deriving `explored`", readPlan && noReExplore],
  ];
  for (const [label, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);

  console.log(`\n  verification trace (${verify.attempts} attempt(s), status=${verify.status}):`);
  for (const t of verify.trace)
    console.log(`    · attempt ${t.attempt} [${t.run.label}] exit=${t.run.exitCode} → ${t.action}`);

  const passed = checks.every(([, ok]) => ok);
  console.log(
    "\n" +
      (passed
        ? "  ✅ STEP 3 GATE PASSED — real commands ran, a real build failure was caught from\n" +
          "     real stderr, the Executor fixed the file, and the re-run went green. No human."
        : "  ❌ STEP 3 GATE FAILED — see FAILs above.")
  );

  banner("REVIEWER VERDICT");
  console.log(reviewedR.output || "(no text output)");

  if (!passed) process.exitCode = 1;
}
