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
    `Build the login + signup CLIENT (the liquid-glass UI and the code that CALLS the auth ` +
    `backend over HTTP) as real files under ${WORKSPACE_SRC}/client/ (pure TypeScript, ` +
    "explicit `.ts` import extensions, no native deps, do not touch tsconfig.json).\n" +
    "Because you cannot see the backend, YOU decide the exact HTTP auth contract your client " +
    "will call. Then call write_memory to store the memory named `frontend` containing a short " +
    "implementation summary followed by this exact block, filled in:\n\n" +
    CONTRACT_FORMAT +
    "\n\nDo not write any other memory.";
  return runAgent("frontend", modelFor("frontend"), directive, {
    systemPrompt: persona(["engineering-frontend-developer", "design-ui-designer"]),
    extraTools: ["Write", "Edit", "MultiEdit", "Read", "Glob", "Grep"],
    cwd: WORKSPACE_DIR, // contain stray relative writes to the gitignored workspace
  });
}

export function runBackend(div?: Divergence): Promise<AgentResult> {
  const base =
    "You are the BACKEND specialist in a blind fan-out. Read the memory named `goal` " +
    "and the memory named `plan`. Do NOT read the `frontend` memory — you are working " +
    "blind to the frontend team.\n" +
    `Build the auth BACKEND (signup, login, logout, session) as real files under ` +
    `${WORKSPACE_SRC}/server/ (pure TypeScript with node:crypto + an in-memory store, ` +
    "explicit `.ts` import extensions, no native deps, do not touch tsconfig.json).\n" +
    "Because you cannot see the frontend, YOU decide the exact HTTP auth contract your server " +
    "exposes. Then call write_memory to store the memory named `backend` containing a short " +
    "implementation summary followed by this exact block, filled in:\n\n" +
    CONTRACT_FORMAT +
    "\n\nDo not write any other memory.";
  const directive = div?.backendOverride
    ? base +
      "\n\nIMPORTANT contract requirements you MUST follow for this build:\n" +
      div.backendOverride
    : base;
  return runAgent("backend", modelFor("backend"), directive, {
    systemPrompt: persona(["engineering-backend-architect"]),
    extraTools: ["Write", "Edit", "MultiEdit", "Read", "Glob", "Grep"],
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
