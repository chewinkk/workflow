// build-test-fix loop (spec §7). The Reviewer/verifier ACTUALLY RUNS the code:
//
//   1. Build. If it fails -> bounce the real stderr to the Executor.
//   2. Run tests. If they fail -> bounce the real stderr to the Executor.
//   3. Only after MAX_BOUNCES failed fixes -> escalate to the Planner.
//
// Every command is really executed; every error is the real stderr; every fix
// is a real Executor edit to files on disk; the re-run is a real re-execution.
// Nothing here reasons about whether code "would" pass.

import { spawn } from "node:child_process";
import { fixOnDisk } from "../pipeline/executor.js";
import { replan } from "../pipeline/planner.js";
import { buildCmd, testCmd, MAX_BOUNCES, workspaceTestFiles, type Cmd } from "./gates.js";

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

function log(msg: string): void {
  console.log(msg);
}

export async function buildTestFix(): Promise<VerifyResult> {
  const trace: VerifyStep[] = [];
  let attempt = 0;

  while (attempt <= MAX_BOUNCES) {
    attempt++;

    // --- Tier 1: BUILD ----------------------------------------------------
    const build = await runCmd(buildCmd());
    log(`\n  ▶ [attempt ${attempt}] $ ${build.command}`);
    log(`    exit=${build.exitCode} (${build.ok ? "OK" : "FAIL"})`);
    if (!build.ok) {
      log(`    real stderr:\n${indent(errorText(build))}`);
      if (attempt > MAX_BOUNCES) {
        trace.push({ attempt, run: build, action: "escalate-to-planner (build still failing)" });
        break;
      }
      log(`    ↳ bouncing build error to Executor for a fix…`);
      const fix = await fixOnDisk("build", errorText(build));
      trace.push({ attempt, run: build, action: `executor-fix: ${fix.summary}` });
      continue;
    }

    // --- Tier 2: TEST -----------------------------------------------------
    const testFiles = workspaceTestFiles();
    if (testFiles.length === 0) {
      trace.push({ attempt, run: build, action: "build OK; no test files found" });
      log(`    (no *.test.ts in workspace/src — build-only verification)`);
      return { status: "PASS", attempts: attempt, trace };
    }
    const test = await runCmd(testCmd(testFiles));
    log(`  ▶ [attempt ${attempt}] $ ${test.command}`);
    log(`    exit=${test.exitCode} (${test.ok ? "OK" : "FAIL"})`);
    if (!test.ok) {
      log(`    real output:\n${indent(errorText(test))}`);
      if (attempt > MAX_BOUNCES) {
        trace.push({ attempt, run: test, action: "escalate-to-planner (tests still failing)" });
        break;
      }
      log(`    ↳ bouncing test failure to Executor for a fix…`);
      const fix = await fixOnDisk("test", errorText(test));
      trace.push({ attempt, run: test, action: `executor-fix: ${fix.summary}` });
      continue;
    }

    // Both tiers green.
    trace.push({ attempt, run: test, action: "build + tests green" });
    return { status: "PASS", attempts: attempt, trace };
  }

  // Exhausted bounces -> escalate to Planner (spec §7.4).
  log(`\n  ⚠ ${MAX_BOUNCES} fix-bounces exhausted — escalating to the Planner.`);
  const lastErr = trace.length ? errorText(trace[trace.length - 1].run) : "unknown";
  await replan(lastErr);
  return { status: "ESCALATED", attempts: attempt, trace };
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `      | ${l}`)
    .join("\n");
}
