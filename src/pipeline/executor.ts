// Executor stage (spec §1, now §7). In Step 3 the Executor writes REAL files to
// the workspace and, when the verifier bounces a failure back, edits them to fix
// it. Model: Sonnet 5 (§8).
//
// Two modes:
//   buildToDisk() — read `plan` from the store, materialize it as real files.
//   fixOnDisk()   — given a real build/test error, make the minimal edit to fix.

import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";
import { WORKSPACE_SRC } from "../verify/gates.js";

const FILE_TOOLS = ["Write", "Edit", "MultiEdit", "Read", "Glob", "Grep"];

export function buildToDisk(): Promise<AgentResult> {
  const directive =
    "You are the Executor. Materialize the plan as REAL files on disk.\n" +
    "1) Read the memory named `plan`. It is self-contained — do NOT read `explored` " +
    "or re-survey the repo.\n" +
    `2) Write the implementation as real files under ${WORKSPACE_SRC}/ (use absolute paths). ` +
    "Constraints that keep it buildable in this environment:\n" +
    "   - Pure TypeScript only. NO native/native-addon deps (no argon2, no better-sqlite3, no bcrypt). " +
    "Use Node's built-in `node:crypto` (e.g. scryptSync for hashing, randomBytes + hmac for sessions) " +
    "and an in-memory store. This is the buildable auth-core slice of the job.\n" +
    "   - Every local import must use an explicit `.ts` extension (e.g. `./auth.ts`).\n" +
    "   - Provide at least one unit test file named `*.test.ts` under that dir using `node:test` + " +
    "`node:assert/strict`, covering signup/login/session round-trips including a wrong-password case.\n" +
    "   - Do NOT create or edit any tsconfig.json — the build config is provisioned for you.\n" +
    "3) Call write_memory to store a concise change-summary in the memory named `done` " +
    "(list each file you wrote and why).";
  return runAgent("executor", modelFor("executor"), directive, { extraTools: FILE_TOOLS });
}

export interface FixResult {
  summary: string;
}

// Called by the verifier with the REAL stderr from a failed build/test.
export async function fixOnDisk(phase: "build" | "test", errorText: string): Promise<FixResult> {
  const directive =
    `You are the Executor in fix mode. The ${phase} just FAILED with this real error:\n\n` +
    "```\n" +
    errorText +
    "\n```\n\n" +
    `The code lives under ${WORKSPACE_SRC}/. ` +
    "1) Read the offending file(s) named in the error. " +
    "2) Make the MINIMAL edit that fixes this specific failure — do not rewrite unrelated code, " +
    "do not touch tsconfig.json. " +
    "3) Reply with one line naming the file(s) you edited and what you changed. " +
    "Do not call write_memory; just fix the files.";
  const r = await runAgent("executor", modelFor("executor"), directive, { extraTools: FILE_TOOLS });
  return { summary: r.output.replace(/\s+/g, " ").slice(0, 200) || "(no summary)" };
}
