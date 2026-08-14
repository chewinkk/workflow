// Top-level orchestrator loop (spec §2 src/orchestrator.ts). Owns the run.
//
// Step 1 scope: the bare pipeline Planner -> Executor -> Reviewer, one model
// each, NO shared store, NO swarm, NO council, NO verification loop. The whole
// point of Step 1 is to prove the plumbing: an agent finishes, hands off, and
// the next one picks up. So this file logs each handoff explicitly.

import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { plan } from "./pipeline/planner.js";
import { execute } from "./pipeline/executor.js";
import { review } from "./pipeline/reviewer.js";
import type { AgentResult } from "./runner.js";

interface Job {
  goal: string;
  constraints?: string[];
  acceptance?: string[];
  council?: boolean;
}

function loadJob(path: string): Job {
  const raw = readFileSync(path, "utf8");
  const job = load(raw) as Job;
  if (!job || typeof job.goal !== "string") {
    throw new Error(`job file ${path} has no "goal"`);
  }
  return job;
}

// Flatten the job into the goal+constraints+acceptance string every agent sees.
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
  console.log(`\n${"─".repeat(72)}\n${msg}\n${"─".repeat(72)}`);
}

function handoffLog(from: AgentResult, to: string): void {
  const preview = from.output.replace(/\s+/g, " ").slice(0, 160);
  console.log(
    `\n  ✅ ${from.role} finished  (model=${from.model}, ${from.output.length} chars, ${from.ms} ms)` +
      `\n  🤝 handing off → ${to}` +
      `\n     preview: ${preview}${from.output.length > 160 ? "…" : ""}`
  );
}

export async function run(jobPath: string): Promise<void> {
  const job = loadJob(jobPath);
  const goal = goalText(job);

  banner(`ORCHESTRATOR — Step 1 bare loop\njob: ${jobPath}`);
  console.log(goal);
  if (job.council) {
    console.log(
      `\n  (note) job requests council:true — the Council is Step 5; not wired yet, ignored for Step 1.`
    );
  }

  // --- Stage 1: Planner ---------------------------------------------------
  banner("STAGE 1/3 · PLANNER");
  console.log("  ▶ Planner picking up the goal…");
  const planned = await plan(goal);
  handoffLog(planned, "Executor");

  // --- Stage 2: Executor (picks up the plan) ------------------------------
  banner("STAGE 2/3 · EXECUTOR");
  console.log("  ▶ Executor picking up the plan from the Planner…");
  const executed = await execute(planned.output);
  handoffLog(executed, "Reviewer");

  // --- Stage 3: Reviewer (picks up the executor's work) -------------------
  banner("STAGE 3/3 · REVIEWER");
  console.log("  ▶ Reviewer picking up the Executor's change-summary…");
  const reviewed = await review(goal, executed.output);
  console.log(
    `\n  ✅ Reviewer finished  (model=${reviewed.model}, ${reviewed.output.length} chars, ${reviewed.ms} ms)`
  );

  // --- Gate report --------------------------------------------------------
  banner("STEP 1 GATE — did the baton pass end to end?");
  const passed =
    planned.output.length > 0 &&
    executed.output.length > 0 &&
    reviewed.output.length > 0;
  console.log(
    `  Planner → Executor handoff:  ${planned.output.length > 0 ? "PASS" : "FAIL"}\n` +
      `  Executor → Reviewer handoff: ${executed.output.length > 0 ? "PASS" : "FAIL"}\n` +
      `  Reviewer produced verdict:   ${reviewed.output.length > 0 ? "PASS" : "FAIL"}\n`
  );
  console.log(
    passed
      ? "  ✅ STEP 1 GATE PASSED — each agent finished, handed off, and the next picked up."
      : "  ❌ STEP 1 GATE FAILED — a handoff produced no output."
  );

  banner("REVIEWER VERDICT (full)");
  console.log(reviewed.output);

  if (!passed) process.exitCode = 1;
}
