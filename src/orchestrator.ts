// Top-level orchestrator loop (spec §2).
//
// Step 4 scope: adds the SWARM (§6/§2). After the Planner, the single Executor
// role fans out into Frontend + Backend specialists running in PARALLEL and
// BLIND (each reads only goal+plan, never the other's slice), then a Reconciler
// integrates and flags the seams between them. Still NO council (Step 5).
//
// This run demonstrates the swarm gate (Reconciler catches an integration seam).
// The Step 3 verification loop remains in the codebase (src/verify/) and is
// re-composed with the swarm in a later integration pass; it is not exercised in
// this focused Step 4 demonstration.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { load } from "js-yaml";
import { explore } from "./pipeline/explorer.js";
import { plan } from "./pipeline/planner.js";
import type { AgentResult, ToolCall } from "./runner.js";
import { SLICES, type Slice } from "./store/schema.js";
import { writeSlice, readSlice, resetJobSlices } from "./store/client.js";
import { WORKSPACE_DIR, WORKSPACE_SRC, WORKSPACE_TSCONFIG } from "./verify/gates.js";
import { runFanout, runBackend } from "./swarm/fanout.js";
import { reconcile } from "./swarm/reconciler.js";
import { join } from "node:path";

interface Job {
  goal: string;
  constraints?: string[];
  acceptance?: string[];
  council?: boolean;
}

export interface RunOptions {
  seedBreak?: boolean;
  forceDivergence?: boolean; // skip the natural attempt; inject the seam directly
}

// The deliberate divergence used only as a fallback if the blind specialists
// happen to agree — a real, specific contract mismatch for the Reconciler to catch.
const BACKEND_DIVERGENCE =
  "- Use the field name `username` (NOT `email`) in request bodies.\n" +
  "- Return the session as a bearer token in the JSON response body (NOT an httpOnly cookie).\n" +
  "- Mount endpoints under `/auth/*` (e.g. POST /auth/register, POST /auth/signin).\n" +
  "- On bad credentials return HTTP 422 (NOT 401).";

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
  // Fresh workspace each run so the specialists build from scratch.
  rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  mkdirSync(WORKSPACE_SRC, { recursive: true });
  writeFileSync(join(WORKSPACE_DIR, "tsconfig.json"), WORKSPACE_TSCONFIG, "utf8");
}

// Pull the AUTH PAYLOAD CONTRACT block out of a specialist's slice for display.
function extractContract(slice: string | null): string {
  if (!slice) return "(no slice)";
  const m = slice.match(/=== AUTH PAYLOAD CONTRACT ===([\s\S]*?)=== END CONTRACT ===/);
  return m ? m[1].trim() : "(no contract block found)";
}

// Parse the Reconciler's machine-readable seam count.
function parseSeamCount(reconciled: string | null): number {
  const m = reconciled?.match(/SEAMS_FOUND:\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : -1;
}

export async function run(jobPath: string, opts: RunOptions = {}): Promise<void> {
  const job = loadJob(jobPath);
  const goal = goalText(job);

  banner(`ORCHESTRATOR — Step 4: base loop + store + swarm (fan-out + Reconciler)\njob: ${jobPath}`);

  resetJobSlices();
  writeSlice("goal", goal);
  provisionWorkspace();
  console.log(`  seeded store slice: goal (${goal.length} chars)`);
  console.log(`  provisioned workspace: ${WORKSPACE_DIR}/{client,server}`);
  if (job.council) console.log(`  (note) council:true is Step 5 — not wired yet, ignored for Step 4.`);

  // --- Stage 1: Explorer --> writes `explored` ----------------------------
  banner("STAGE 1/4 · EXPLORER   (reads goal → writes explored)");
  logSources2(await explore());

  // --- Stage 2: Planner --> writes `plan` ---------------------------------
  banner("STAGE 2/4 · PLANNER    (reads goal + explored → writes plan)");
  logSources2(await plan());

  // --- Stage 3: FAN-OUT — Frontend || Backend, in parallel and BLIND ------
  banner("STAGE 3/4 · FAN-OUT    (Frontend ∥ Backend, parallel + blind)");
  console.log(`  divergence: ${opts.forceDivergence ? "FORCED (deliberate seam injected)" : "natural first"}`);
  let fan = await runFanout(opts.forceDivergence ? { backendOverride: BACKEND_DIVERGENCE } : undefined);
  const feS = summarizeSources(fan.frontend);
  const beS = summarizeSources(fan.backend);
  console.log("\n  [FRONTEND specialist]");
  logSources(fan.frontend, feS);
  console.log("\n  [BACKEND specialist]");
  logSources(fan.backend, beS);

  // --- Stage 4: RECONCILER — the Step 4 gate ------------------------------
  banner("STAGE 4/4 · RECONCILER (reads frontend + backend → flags seams)   ← Step 4 gate");
  let reconciledR = await reconcile();
  logSources2(reconciledR);
  let seamCount = parseSeamCount(readSlice("reconciled"));

  // If the blind specialists happened to AGREE, fall back to a deliberate seam
  // so the gate is exercised against a real disagreement either way.
  let usedFallback = false;
  if (seamCount === 0 && !opts.forceDivergence) {
    usedFallback = true;
    banner("FALLBACK · natural contracts agreed → injecting a deliberate divergence");
    console.log("  re-running the Backend specialist with a conflicting contract, then re-reconciling…");
    fan = { ...fan, backend: await runBackend({ backendOverride: BACKEND_DIVERGENCE }) };
    console.log("\n  [BACKEND specialist — deliberate divergence]");
    logSources(fan.backend, summarizeSources(fan.backend));
    reconciledR = await reconcile();
    console.log("\n  [RECONCILER — re-run]");
    logSources2(reconciledR);
    seamCount = parseSeamCount(readSlice("reconciled"));
  }

  // --- The two contracts, side by side, and the Reconciler's verdict ------
  banner("THE TWO CONTRACTS (built blind) + RECONCILER VERDICT");
  console.log("── FRONTEND contract ──\n" + extractContract(readSlice("frontend")));
  console.log("\n── BACKEND contract ──\n" + extractContract(readSlice("backend")));
  console.log("\n── RECONCILER (`reconciled` slice) ──\n" + (readSlice("reconciled")?.trim() || "(empty)"));

  // --- Store contents after the run ---------------------------------------
  banner("SHARED STORE after run (Serena memories)");
  for (const s of SLICES) {
    const len = readSlice(s as Slice)?.trim().length ?? 0;
    console.log(`  ${s.padEnd(11)} : ${len > 0 ? `${len} chars` : "(empty)"}`);
  }

  // --- STEP 4 GATE --------------------------------------------------------
  banner("STEP 4 GATE — did the Reconciler catch a real integration seam?");

  // Blindness: neither specialist read the other's slice.
  const feBlind = !feS.storeReads.includes("backend");
  const beBlind = !summarizeSources(fan.backend).storeReads.includes("frontend");
  const bothBuilt =
    (readSlice("frontend")?.trim().length ?? 0) > 0 && (readSlice("backend")?.trim().length ?? 0) > 0;
  const reconcilerReadBoth =
    summarizeSources(reconciledR).storeReads.includes("frontend") &&
    summarizeSources(reconciledR).storeReads.includes("backend");
  const caughtSeam = seamCount >= 1;

  const checks: [string, boolean][] = [
    ["Both specialists produced a half + contract", bothBuilt],
    ["Fan-out was BLIND (FE didn't read `backend`, BE didn't read `frontend`)", feBlind && beBlind],
    ["Reconciler read BOTH sides (only agent that sees both)", reconcilerReadBoth],
    [`Reconciler caught ≥1 real seam (found ${seamCount})`, caughtSeam],
  ];
  for (const [label, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(
    `\n  seam source: ${usedFallback ? "DELIBERATE (blind halves agreed; fallback injected)" : "NATURAL (blind halves diverged on their own)"}`
  );

  const passed = checks.every(([, ok]) => ok);
  console.log(
    "\n" +
      (passed
        ? "  ✅ STEP 4 GATE PASSED — two blind specialists, a real payload-contract disagreement,\n" +
          "     and the Reconciler caught it — a seam no single-side reviewer could see."
        : "  ❌ STEP 4 GATE FAILED — see FAILs above.")
  );

  if (!passed) process.exitCode = 1;
}
