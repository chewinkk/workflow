// Top-level orchestrator loop (spec §2).
//
// Step 2 scope: the base loop Explorer -> Planner -> Executor -> Reviewer, now
// mediated by the Serena shared store (§3). Stages no longer pass raw text
// hand-to-hand; each reads its input slice(s) from the store and writes its
// output slice. Still NO verification loop, swarm, or council (Steps 3-6).
//
// The Step 2 GATE: the Executor must pull `plan` from the store and must NOT
// re-read `explored` or re-open the repo. We prove it by logging every source
// each agent actually reads (captured from real tool calls in runner.ts).

import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { explore } from "./pipeline/explorer.js";
import { plan } from "./pipeline/planner.js";
import { execute } from "./pipeline/executor.js";
import { review } from "./pipeline/reviewer.js";
import type { AgentResult, ToolCall } from "./runner.js";
import { SLICES, type Slice } from "./store/schema.js";
import { writeSlice, readSlice, resetJobSlices } from "./store/client.js";

interface Job {
  goal: string;
  constraints?: string[];
  acceptance?: string[];
  council?: boolean;
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

export async function run(jobPath: string): Promise<void> {
  const job = loadJob(jobPath);
  const goal = goalText(job);

  banner(`ORCHESTRATOR — Step 2: base loop + Serena shared store\njob: ${jobPath}`);

  // Fresh store for this run; seed the `goal` slice (orchestrator owns it, §3).
  resetJobSlices();
  writeSlice("goal", goal);
  console.log(`  seeded store slice: goal (${goal.length} chars)`);
  console.log(`  store slices declared (§3): ${SLICES.join(", ")}`);
  if (job.council) {
    console.log(`  (note) council:true is Step 5 — not wired yet, ignored for Step 2.`);
  }

  // --- Stage 1: Explorer --> writes `explored` ----------------------------
  banner("STAGE 1/4 · EXPLORER   (reads goal → writes explored)");
  const exploredR = await explore();
  const exploredS = summarizeSources(exploredR);
  logSources(exploredR, exploredS);

  // --- Stage 2: Planner --> writes `plan` ---------------------------------
  banner("STAGE 2/4 · PLANNER    (reads goal + explored → writes plan)");
  const plannedR = await plan();
  const plannedS = summarizeSources(plannedR);
  logSources(plannedR, plannedS);

  // --- Stage 3: Executor --> writes `done`  [THE GATE] --------------------
  banner("STAGE 3/4 · EXECUTOR   (reads plan → writes done)   ← Step 2 gate");
  const executedR = await execute();
  const executedS = summarizeSources(executedR);
  logSources(executedR, executedS);

  // --- Stage 4: Reviewer --------------------------------------------------
  banner("STAGE 4/4 · REVIEWER   (reads goal + done → verdict)");
  const reviewedR = await review();
  const reviewedS = summarizeSources(reviewedR);
  logSources(reviewedR, reviewedS);

  // --- Store contents after the run (checkpointed slices) -----------------
  banner("SHARED STORE after run (Serena memories)");
  for (const s of SLICES) {
    const v = readSlice(s as Slice);
    const len = v ? v.trim().length : 0;
    console.log(`  ${s.padEnd(9)} : ${len > 0 ? `${len} chars` : "(empty)"}`);
  }

  // --- STEP 2 GATE --------------------------------------------------------
  banner("STEP 2 GATE — did the Executor pull `plan` from the store, not re-derive it?");

  const readPlan = executedS.storeReads.includes("plan");
  const reReadExplored = executedS.storeReads.includes("explored");
  const reOpenedRepo = executedS.repoReads.length > 0; // successful code/repo reads (native + serena)
  const planWasStored = (readSlice("plan")?.trim().length ?? 0) > 0;
  const doneWasStored = (readSlice("done")?.trim().length ?? 0) > 0;

  const checks: [string, boolean][] = [
    ["Planner wrote `plan` to the store", planWasStored],
    ["Executor READ `plan` from the store", readPlan],
    ["Executor did NOT re-read `explored`", !reReadExplored],
    ["Executor did NOT re-open repo/code (native or Serena)", !reOpenedRepo],
    ["Executor wrote `done` to the store (handoff via store)", doneWasStored],
  ];

  for (const [label, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  }
  if (reReadExplored) console.log(`        ↳ Executor read explored — WIRING WRONG.`);
  if (reOpenedRepo)
    console.log(`        ↳ Executor re-opened repo/code: ${executedS.repoReads.join(", ")} — WIRING WRONG.`);
  if (executedS.repoReadAttempts.length)
    console.log(
      `        (note) Executor ATTEMPTED but was denied: ${executedS.repoReadAttempts.join(", ")} — ` +
        `no successful re-derivation, gate unaffected.`
    );

  const passed = checks.every(([, ok]) => ok);
  console.log(
    "\n" +
      (passed
        ? "  ✅ STEP 2 GATE PASSED — handoff is store-mediated; the Executor pulled `plan`\n" +
          "     from Serena and re-derived nothing already captured upstream."
        : "  ❌ STEP 2 GATE FAILED — see FAILs above; fix the store wiring before Step 3.")
  );

  banner("REVIEWER VERDICT");
  console.log(reviewedR.output || "(no text output)");

  if (!passed) process.exitCode = 1;
}
