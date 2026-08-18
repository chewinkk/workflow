// Swarm fan-out (spec §2/§6). The single Executor role fans out into parallel
// specialists. In Step 4 that is Frontend + Backend, run in PARALLEL and BLIND:
// each reads only `goal`+`plan` from the store, builds its half to disk, and
// declares its own assumed auth payload contract into its own slice. Neither
// reads the other's slice — that blindness is what makes the Reconciler's job
// real (it catches seams no single reviewer, seeing one side, could).
//
// "Who" = agency-agents roster personalities (vendored under agents/roster/,
// verified to exist in Phase 1). "How" = skills would stack here (taste,
// impeccable, ponytail) — NOT yet installed; personality only for now (flagged).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";
import { WORKSPACE_DIR, WORKSPACE_SRC } from "../verify/gates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROSTER = join(__dirname, "..", "..", "agents", "roster");

// Specialists write files only — they must NOT shell out to build/verify (that
// is the harness's job) or spawn subagents. Blocking these keeps them fast and
// contained.
const NO_SHELL = ["Bash", "Task", "KillShell", "BashOutput"];
const DONT_VERIFY =
  " Do NOT run any shell/build/test commands and do NOT spawn subagents — just " +
  "write the source files and your contract memory; the harness verifies the build.";

// The fixed shape both specialists must fill in, so the Reconciler can diff them.
export const CONTRACT_FORMAT = [
  "=== AUTH PAYLOAD CONTRACT ===",
  "signup_endpoint: <METHOD> <path>",
  "login_endpoint: <METHOD> <path>",
  "logout_endpoint: <METHOD> <path>",
  "request_fields: <exact JSON body your client sends / your server expects>",
  "success_response: <status code> <exact JSON shape>",
  "error_response: <status code> <exact JSON shape>",
  "session_mechanism: <httpOnly cookie | bearer token in body | ...>",
  "=== END CONTRACT ===",
].join("\n");

// Compose a specialist system prompt from stacked roster personalities.
function persona(files: string[]): string {
  return files.map((f) => readFileSync(join(ROSTER, `${f}.md`), "utf8")).join("\n\n---\n\n");
}

export interface Divergence {
  // When set, the Backend is told to use these (deliberate seam fallback).
  backendOverride?: string;
}

function frontend(): Promise<AgentResult> {
  const directive =
    "You are the FRONTEND specialist in a blind fan-out. Read the memory named `goal` " +
    "and the memory named `plan`. Do NOT read the `backend` memory — you are working " +
    "blind to the backend team.\n" +
    `Build the login + signup CLIENT as a REAL, BROWSER-RENDERABLE liquid-glass UI under ` +
    `${WORKSPACE_SRC}/client/. A downstream frame-timing harness will load this UI in Chromium ` +
    "and DRIVE it under interaction, measuring real frame timing (worst frame must be <22ms and " +
    "<5% of frames may miss the 60fps budget), so it must actually render and animate. Produce:\n" +
    `  - ${WORKSPACE_SRC}/client/index.html — the login/signup markup and the glass CSS (frosted / ` +
    "backdrop-filter treatment). It MUST include `<script type=\"module\" src=\"./main.js\"></script>` " +
    "before </body>. The build emits main.js from your main.ts; a page with NO script tag is an inert, " +
    "non-working app (signup/login never fires) and will be REJECTED. Reference ./main.js, never ./main.ts.\n" +
    `  - ${WORKSPACE_SRC}/client/main.ts — the interaction logic and the code that CALLS the auth ` +
    "backend over HTTP (pure TypeScript, explicit `.ts` import extensions, no native deps, browser-" +
    "targetable — no node:* imports in the client). Do not touch tsconfig.json.\n" +
    `  - ${WORKSPACE_SRC}/client/perf.ts — REQUIRED (Council Step 6 mandate). Export ` +
    "`classifyFrames(deltas: number[])` that classifies inter-frame deltas against the 60fps budget " +
    "(e.g. counts frames that missed a refresh and the worst frame). In main.ts, wire a `?perfcheck=1` " +
    "URL mode that samples frames, runs classifyFrames, and exposes the result on window (e.g. " +
    "window.__perfResult). This probe is a mandated deliverable and is checked for existence.\n" +
    `  - ${WORKSPACE_SRC}/client/*.test.ts — REQUIRED. At least one node:test file covering ` +
    "classifyFrames (feed known-janky and known-smooth delta arrays, assert the classification). " +
    "Zero test files is a hard failure.\n" +
    "Give the harness stable hooks: put data-testid=\"card\" on the glass card, data-testid=\"email\" and " +
    "data-testid=\"password\" on those inputs, data-testid=\"submit\" on the primary button, and " +
    "data-testid=\"toggle-mode\" on the login<->signup switch. Keep the animation smooth — animate " +
    "transform/opacity, avoid layout-triggering properties in the animation path.\n" +
    "Because you cannot see the backend, YOU decide the exact HTTP auth contract your client " +
    "will call. Then call write_memory to store the memory named `frontend` containing a short " +
    "implementation summary followed by this exact block, filled in:\n\n" +
    CONTRACT_FORMAT +
    "\n\nDo not write any other memory." +
    DONT_VERIFY;
  return runAgent("frontend", modelFor("frontend"), directive, {
    systemPrompt: persona(["engineering-frontend-developer", "design-ui-designer"]),
    extraTools: ["Write", "Edit", "MultiEdit", "Read", "Glob", "Grep"],
    disallowedTools: NO_SHELL,
    cwd: WORKSPACE_DIR, // contain stray relative writes to the gitignored workspace
  });
}

export function runBackend(div?: Divergence): Promise<AgentResult> {
  const base =
    "You are the BACKEND specialist in a blind fan-out. Read the memory named `goal` " +
    "and the memory named `plan`. Do NOT read the `frontend` memory — you are working " +
    "blind to the frontend team.\n" +
    `Build the auth BACKEND (signup, login, logout, session) as real files under ` +
    `${WORKSPACE_SRC}/server/ (pure TypeScript with node:crypto, explicit \`.ts\` import extensions, ` +
    "no native deps, do not touch tsconfig.json).\n" +
    "Persistence is NOT in-memory. The Council ruled a file-backed `JsonFileUserStore` the DEFAULT: " +
    "define a class `JsonFileUserStore` that persists users/sessions to a JSON file and reloads them on " +
    "construction, and use it as the default store (an in-memory-only store will be REJECTED). Keep the " +
    "JSON path configurable so tests can point it at a temp file.\n" +
    `  - ${WORKSPACE_SRC}/server/*.test.ts — REQUIRED (zero test files is a hard failure). Cover with ` +
    "node:test: a signup→login→session round-trip, a wrong-password rejection, and JsonFileUserStore " +
    "DURABILITY — write a user, construct a FRESH JsonFileUserStore from the same file, assert the user " +
    "survives.\n" +
    "Because you cannot see the frontend, YOU decide the exact HTTP auth contract your server " +
    "exposes. Then call write_memory to store the memory named `backend` containing a short " +
    "implementation summary followed by this exact block, filled in:\n\n" +
    CONTRACT_FORMAT +
    "\n\nDo not write any other memory.";
  const directive =
    (div?.backendOverride
      ? base +
        "\n\nIMPORTANT contract requirements you MUST follow for this build:\n" +
        div.backendOverride
      : base) + DONT_VERIFY;
  return runAgent("backend", modelFor("backend"), directive, {
    systemPrompt: persona(["engineering-backend-architect"]),
    extraTools: ["Write", "Edit", "MultiEdit", "Read", "Glob", "Grep"],
    disallowedTools: NO_SHELL,
    cwd: WORKSPACE_DIR, // contain stray relative writes to the gitignored workspace
  });
}

export interface FanoutResult {
  frontend: AgentResult;
  backend: AgentResult;
}

// Run both specialists concurrently. They are separate headless processes that
// only read goal+plan, so they are structurally blind to each other.
export async function runFanout(div?: Divergence): Promise<FanoutResult> {
  const [fe, be] = await Promise.all([frontend(), runBackend(div)]);
  return { frontend: fe, backend: be };
}
