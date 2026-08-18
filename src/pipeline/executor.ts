// Executor stage (spec §1, now §7). In Step 3 the Executor writes REAL files to
// the workspace and, when the verifier bounces a failure back, edits them to fix
// it. Model: Sonnet 5 (§8).
//
// Two modes:
//   buildToDisk() — read `plan` from the store, materialize it as real files.
//   fixOnDisk()   — given a real build/test error, make the minimal edit to fix.

import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";
import { WORKSPACE_DIR, WORKSPACE_SRC } from "../verify/gates.js";

const FILE_TOOLS = ["Write", "Edit", "MultiEdit", "Read", "Glob", "Grep"];
// The consolidation/fix Executor edits files + the store; it must NOT shell out
// (build/verify is the harness's job) or spawn subagents — that's a containment leak.
const NO_SHELL = ["Bash", "Task", "KillShell", "BashOutput"];

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

// Called by the verifier with the REAL error from a failed tier:
//   - "build" / "test": the compiler / test-runner output.
//   - "perf": the frame-timing harness's metrics + guidance.
//   - "deliverable": the preflight gate's list of MISSING mandated artifacts
//     (an inert page, a missing perf probe, zero tests, an in-memory store the
//     Council overrode). Here the Executor CREATES what's missing, not just edits.
export async function fixOnDisk(
  phase: "build" | "test" | "perf" | "deliverable",
  errorText: string
): Promise<FixResult> {
  const intro =
    phase === "perf"
      ? "You are the Executor in UI-PERFORMANCE fix mode. The frame-timing gate measured the " +
        "liquid-glass UI running in a real browser under interaction and it is JANKY:\n\n"
      : phase === "deliverable"
      ? "You are the Executor in DELIVERABLE mode. The blind fan-out under-delivered against the " +
        "ratified plan — mandated artifacts are missing and MUST be created:\n\n"
      : `You are the Executor in fix mode. The ${phase} just FAILED with this real error:\n\n`;
  const body =
    phase === "perf"
      ? "1) Read the client UI file(s) under workspace/src/client/ that drive the animation. " +
        "2) Make the MINIMAL change that brings both metrics under budget (animate transform/opacity " +
        "only, drop layout-triggering properties from the animation path, cut synchronous layout reads " +
        "in handlers, shrink backdrop-filter regions). Do not touch tsconfig.json. "
      : phase === "deliverable"
      ? `The code lives under ${WORKSPACE_SRC}/ (client/ and server/). ` +
        "1) Read the existing client/server files so your additions fit the real code (endpoints, " +
        "exports, the auth contract). 2) CREATE each missing item listed above exactly — the script " +
        "tag in index.html referencing ./main.js, client/perf.ts exporting classifyFrames() plus a " +
        "?perfcheck=1 mode in main.ts, real *.test.ts using node:test (auth round-trip, wrong-password, " +
        "session, JsonFileUserStore durability across a simulated restart, classifyFrames), and a " +
        "file-backed JsonFileUserStore in server/ used by default. Keep pure TypeScript with explicit " +
        "`.ts` import extensions; do NOT touch tsconfig.json. For any EMPTY `frontend`/`backend` store " +
        "slice listed above, call write_memory(name=\"frontend\"|\"backend\", ...) with a short summary " +
        "plus the \"=== AUTH PAYLOAD CONTRACT ===\" block derived from the actual client/server code. "
      : `The code lives under ${WORKSPACE_SRC}/. ` +
        "1) Read the offending file(s) named in the error. " +
        "2) Make the MINIMAL edit that fixes this specific failure — do not rewrite unrelated code, " +
        "do not touch tsconfig.json. ";
  const closing =
    phase === "deliverable"
      ? "3) Reply with one line naming what you created and which memory slices you wrote."
      : "3) Reply with one line naming the file(s) you created/edited and what you changed. " +
        "Do not call write_memory; just write the files.";
  const directive = intro + "```\n" + errorText + "\n```\n\n" + body + closing;
  const r = await runAgent("executor", modelFor("executor"), directive, {
    extraTools: FILE_TOOLS,
    disallowedTools: NO_SHELL,
    cwd: WORKSPACE_DIR,
  });
  return { summary: r.output.replace(/\s+/g, " ").slice(0, 200) || "(no summary)" };
}

// Executor CONSOLIDATION pass, used only by the full-build (`execute`) path AFTER
// the blind fan-out + Reconciler. The specialists already wrote client+server to
// disk; this pass does NOT rebuild — it reads the Reconciler's seam list and makes
// the minimal edits to make the two halves agree on ONE auth-payload contract,
// then records what it closed in `done`. (buildToDisk, which builds the whole app
// from `plan`, would clobber the fan-out output, so it is not used here.)
export function applyReconciliation(): Promise<AgentResult> {
  const directive =
    "You are the Executor in CONSOLIDATION mode after a blind fan-out. The Frontend and Backend " +
    "specialists each built their half under workspace/src/{client,server}; the Reconciler compared " +
    "their AUTH PAYLOAD CONTRACT blocks.\n" +
    "1) Call read_memory on `reconciled` (the seam list), then on `frontend` and `backend` for context.\n" +
    "2) For EACH seam in `reconciled`, edit the on-disk files under workspace/src to make the client " +
    "and server agree on a single contract — prefer the reconciliation the Reconciler named. Make " +
    "MINIMAL edits; do NOT rebuild from scratch, do NOT touch tsconfig.json, keep pure TS with explicit " +
    "`.ts` import extensions. If `reconciled` says SEAMS_FOUND: 0, change nothing in the code.\n" +
    "3) Call write_memory to store `done` as a REAL BUILD SUMMARY the Reviewer can verify each " +
    "acceptance criterion against — not just a seam note. Read the actual files first and cover: the " +
    "CLIENT (index.html + glass treatment, main.js script tag, perf.ts/classifyFrames + ?perfcheck=1), " +
    "the SERVER (auth, JsonFileUserStore persistence, session/secret handling), the TESTS that exist, " +
    "the seams you closed, and which files you touched. Be concrete (name files); this slice is the " +
    "Reviewer's evidence.";
  return runAgent("executor", modelFor("executor"), directive, {
    extraTools: FILE_TOOLS,
    disallowedTools: NO_SHELL,
    cwd: WORKSPACE_DIR,
  });
}
