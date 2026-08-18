// build-test-fix loop (spec §7). The Reviewer/verifier ACTUALLY RUNS the code:
//
//   1. Build. If it fails -> bounce the real stderr to the Executor.
//   2. Run tests. If they fail -> bounce the real stderr to the Executor.
//   3. After MAX_BOUNCES failed fixes -> ESCALATE and stop. This loop serves the
//      `execute` path, which consumes a RATIFIED plan, so it never re-plans (that
//      would rewrite the Council-approved plan in reaction to a code/infra error).
//
// Every command is really executed; every error is the real stderr; every fix
// is a real Executor edit to files on disk; the re-run is a real re-execution.
// Nothing here reasons about whether code "would" pass.

import { spawn } from "node:child_process";
import { fixOnDisk } from "../pipeline/executor.js";
import {
  buildCmd,
  testCmd,
  MAX_BOUNCES,
  workspaceTestFiles,
  checkDeliverables,
  deliverableErrorText,
  type Cmd,
} from "./gates.js";
import { frameTimingGate, frameTimingErrorText, type FrameTimingResult } from "./frame-timing.js";

const REPO_ROOT = process.cwd();

export interface CmdRun {
  label: string;
  command: string;
  exitCode: number;
  stderr: string;
  stdout: string;
  ok: boolean;
}

export interface VerifyStep {
  attempt: number;
  run: CmdRun;
  action: string; // what the loop did in response
}

export interface VerifyResult {
  status: "PASS" | "ESCALATED";
  attempts: number;
  trace: VerifyStep[];
}

function runCmd(c: Cmd): Promise<CmdRun> {
  return new Promise((resolve) => {
    const child = spawn(c.cmd, c.args, { cwd: REPO_ROOT, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      const exitCode = code ?? -1;
      resolve({
        label: c.label,
        command: `${c.cmd} ${c.args.join(" ")}`,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        ok: exitCode === 0,
      });
    });
  });
}

// node --test prints failures to stdout, tsc to stderr — surface whichever has content.
function errorText(run: CmdRun): string {
  return (run.stderr || run.stdout || `exit ${run.exitCode}`).slice(0, 4000);
}

// A synthetic CmdRun for tiers that are not a spawned command (preflight), so
// they fit the same trace shape.
function pseudoRun(command: string, detail: string): CmdRun {
  return { label: command, command, exitCode: 1, stdout: detail, stderr: detail, ok: false };
}

// Represent a frame-timing gate result as a CmdRun so it fits the same trace shape.
function timingCmdRun(t: FrameTimingResult): CmdRun {
  return {
    label: "frame-timing (chromium)",
    command: "playwright frame-timing harness",
    exitCode: t.pass ? 0 : 1,
    stdout: t.detail,
    stderr: t.pass ? "" : t.detail,
    ok: t.pass,
  };
}

function log(msg: string): void {
  console.log(msg);
}

export async function buildTestFix(): Promise<VerifyResult> {
  const trace: VerifyStep[] = [];
  let attempt = 0;

  while (attempt <= MAX_BOUNCES) {
    attempt++;

    // --- Tier 0: DELIVERABLE PREFLIGHT ------------------------------------
    // Structural proof that the plan's mandated artifacts EXIST before we spend
    // a build/browser cycle. A miss bounces to the Executor's deliverable mode
    // (create what's missing) rather than the Planner — the plan is already
    // correct; the specialists under-delivered against it.
    const misses = checkDeliverables();
    if (misses.length > 0) {
      const codes = misses.map((m) => m.code).join(",");
      const run = pseudoRun("deliverable preflight", `missing mandated deliverables: ${codes}`);
      log(`\n  ▶ [attempt ${attempt}] deliverable preflight`);
      log(`    MISSING: ${codes}`);
      if (attempt > MAX_BOUNCES) {
        trace.push({ attempt, run, action: "escalated-no-replan (deliverables still missing)" });
        break;
      }
      log(`    ↳ bouncing missing deliverables to Executor to create…`);
      const fix = await fixOnDisk("deliverable", deliverableErrorText(misses));
      trace.push({ attempt, run, action: `executor-deliverable: ${fix.summary}` });
      continue;
    }

    // --- Tier 1: BUILD ----------------------------------------------------
    const build = await runCmd(buildCmd());
    log(`\n  ▶ [attempt ${attempt}] $ ${build.command}`);
    log(`    exit=${build.exitCode} (${build.ok ? "OK" : "FAIL"})`);
    if (!build.ok) {
      log(`    real stderr:\n${indent(errorText(build))}`);
      if (attempt > MAX_BOUNCES) {
        trace.push({ attempt, run: build, action: "escalated-no-replan (build still failing)" });
        break;
      }
      log(`    ↳ bouncing build error to Executor for a fix…`);
      const fix = await fixOnDisk("build", errorText(build));
      trace.push({ attempt, run: build, action: `executor-fix: ${fix.summary}` });
      continue;
    }

    // --- Tier 2: TEST -----------------------------------------------------
    // Zero tests is a HARD FAIL, never a vacuous pass — the deliverable preflight
    // already requires ≥1 test, so this is defense-in-depth for that guarantee.
    const testFiles = workspaceTestFiles();
    if (testFiles.length === 0) {
      const run = pseudoRun("test (node --test)", "no *.test.ts in workspace/src — node --test would pass vacuously");
      log(`  ▶ [attempt ${attempt}] test discovery: no *.test.ts found (HARD FAIL — not a vacuous pass)`);
      if (attempt > MAX_BOUNCES) {
        trace.push({ attempt, run, action: "escalated-no-replan (no tests)" });
        break;
      }
      log(`    ↳ bouncing missing tests to Executor…`);
      const fix = await fixOnDisk("deliverable", deliverableErrorText(checkDeliverables()));
      trace.push({ attempt, run, action: `executor-deliverable: ${fix.summary}` });
      continue;
    } else {
      const test = await runCmd(testCmd(testFiles));
      log(`  ▶ [attempt ${attempt}] $ ${test.command}`);
      log(`    exit=${test.exitCode} (${test.ok ? "OK" : "FAIL"})`);
      if (!test.ok) {
        log(`    real output:\n${indent(errorText(test))}`);
        if (attempt > MAX_BOUNCES) {
          trace.push({ attempt, run: test, action: "escalated-no-replan (tests still failing)" });
          break;
        }
        log(`    ↳ bouncing test failure to Executor for a fix…`);
        const fix = await fixOnDisk("test", errorText(test));
        trace.push({ attempt, run: test, action: `executor-fix: ${fix.summary}` });
        continue;
      }
      trace.push({ attempt, run: test, action: "build + tests green" });
    }

    // --- Tier 3: FRAME TIMING (the "not laggy" gate) ----------------------
    // Actually renders the liquid-glass UI in Chromium, drives interaction, and
    // measures real frame timing. A breach — or a missing/un-renderable UI — is
    // a failure that bounces to the Executor's perf-fix mode, same as build/test.
    log(`  ▶ [attempt ${attempt}] frame-timing harness (Chromium + rAF sampling under interaction)`);
    const timing = await frameTimingGate();
    const timingRun = timingCmdRun(timing);
    log(`    ${timing.ran ? "measured" : "COULD NOT MEASURE"}: ${timing.detail}`);
    if (!timing.pass) {
      if (attempt > MAX_BOUNCES) {
        trace.push({ attempt, run: timingRun, action: "escalated-no-replan (frame budget still blown)" });
        break;
      }
      log(`    ↳ bouncing frame-timing failure to Executor for a UI-perf fix…`);
      const fix = await fixOnDisk("perf", frameTimingErrorText(timing));
      trace.push({ attempt, run: timingRun, action: `executor-fix: ${fix.summary}` });
      continue;
    }

    // All three tiers green.
    trace.push({ attempt, run: timingRun, action: "build + tests + frame budget green" });
    return { status: "PASS", attempts: attempt, trace };
  }

  // Exhausted bounces. The `execute` path (the only caller of this loop) CONSUMES
  // a ratified plan — it must NOT re-plan. Calling the Planner here rewrites the
  // Council-approved `plan` slice in reaction to a build/infra error, which is
  // exactly how plan.md got mutated ("ESCALATION REVISION #2") on a prior failed
  // run — including drift toward a manual perf-check dodge. So we report ESCALATED
  // and leave the plan UNTOUCHED; remediation is code-side (specialists/directives),
  // never plan-side.
  log(`\n  ⚠ ${MAX_BOUNCES} fix-bounces exhausted — ESCALATED. The plan is a ratified input and is left`);
  log(`     UNTOUCHED (no re-plan). Fix the specialists/directives from the trace above and re-run.`);
  return { status: "ESCALATED", attempts: attempt, trace };
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `      | ${l}`)
    .join("\n");
}
