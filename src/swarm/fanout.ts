// Swarm fan-out (spec §2/§6). The single Executor role fans out into parallel
// specialists. In Step 4 that is Frontend + Backend, run in PARALLEL and BLIND:
// each reads only `goal`+`plan` from the store, builds its half to disk, and
// declares its own assumed API contract into its own slice. Neither
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
// Generic across app types: whatever HTTP surface the plan calls for (auth,
// a data API, a static server + JSON endpoints, ...), both sides declare it in
// this same shape so their assumptions can be diffed at the seam.
export const CONTRACT_FORMAT = [
  "=== API CONTRACT ===",
  "endpoints: <one line per endpoint: <METHOD> <path> — <what it does>>",
  "request_fields: <for each endpoint, the exact query params / JSON body the client sends and the server expects>",
  "success_response: <status code> <exact JSON shape (or content-type for static assets)>",
  "error_response: <status code> <exact JSON shape>",
  "data_model: <the shape of the core records exchanged (e.g. a listing, a user) as exact field names + types>",
  "state_mechanism: <how state/session/pagination is carried: httpOnly cookie | bearer token | query cursor | page+pageSize | stateless | ...>",
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
    "You are the FRONTEND specialist in a blind fan-out. Your FIRST TWO actions MUST be tool " +
    "calls: read_memory(name=\"goal\"), then read_memory(name=\"plan\") — the Serena MEMORY STORE, " +
    "not the filesystem. Do NOT use Glob or Read to find goal/plan; only read_memory returns them. " +
    "BUILD EXACTLY WHAT THE PLAN DESCRIBES — the plan is the spec; do not invent a different app. " +
    "You MUST FOLLOW the plan's performance rules exactly (animate only transform/opacity; keep " +
    "backdrop-filter / heavy GPU layers promoted to their own layer with `will-change: transform`; " +
    "never transition backdrop-filter/filter/box-shadow; provide any `@supports` fallback the plan " +
    "names). Do NOT read the `backend` memory — you are working blind to the backend team.\n" +
    `Build the CLIENT as a REAL, BROWSER-RENDERABLE UI under ${WORKSPACE_SRC}/client/, implementing ` +
    "the exact screens, controls, and interactions the plan calls for. A downstream frame-timing " +
    "harness will load this UI in Chromium and DRIVE it under interaction (scrolling, clicking " +
    "buttons/links/chips), measuring real frame timing (worst frame must be <22ms and <5% of frames " +
    "may miss the 60fps budget), so it must actually render and animate. Produce:\n" +
    `  - ${WORKSPACE_SRC}/client/index.html — the markup and CSS for the UI the plan describes. ` +
    "It MUST include `<script type=\"module\" src=\"./main.js\"></script>` " +
    "before </body>. The build emits main.js from your main.ts; a page with NO script tag is an inert, " +
    "non-working app and will be REJECTED. Reference ./main.js, never ./main.ts.\n" +
    `  - ${WORKSPACE_SRC}/client/main.ts — the interaction logic and any code that CALLS the ` +
    "backend over HTTP (pure TypeScript, explicit `.ts` import extensions, no native deps, browser-" +
    "targetable — no node:* imports in the client). Do not touch tsconfig.json.\n" +
    "  - If the plan VENDORS a library (e.g. a file under client/lib/), IMPORT and USE it — read its " +
    "source/typings to wire it correctly. Do NOT reimplement a vendored library from scratch.\n" +
    `  - ${WORKSPACE_SRC}/client/perf.ts — REQUIRED (Council Step 6 mandate). Export ` +
    "`classifyFrames(deltas: number[])` that classifies inter-frame deltas against the 60fps budget " +
    "(e.g. counts frames that missed a refresh and the worst frame). In main.ts, wire a `?perfcheck=1` " +
    "URL mode that samples frames, runs classifyFrames, and exposes the result on window (e.g. " +
    "window.__perfResult). This probe is a mandated deliverable and is checked for existence.\n" +
    `  - ${WORKSPACE_SRC}/client/*.test.ts — REQUIRED. At least one node:test file covering ` +
    "classifyFrames (feed known-janky and known-smooth delta arrays, assert the classification), plus " +
    "any pure client logic the plan calls for (e.g. filter/pagination helpers). " +
    "Zero test files is a hard failure.\n" +
    "Give the harness stable hooks: put a `data-testid` on the main content container and on the " +
    "primary interactive controls the plan describes (e.g. the main card/panel, primary inputs, the " +
    "primary action button, and any pagination / filter / toggle controls) so the harness can drive " +
    "them. Keep the animation smooth — animate transform/opacity, avoid layout-triggering properties " +
    "in the animation path.\n" +
    "Because you cannot see the backend, YOU decide the exact HTTP contract your client " +
    "will call (endpoints, query params, JSON shapes). Then you MUST call " +
    "write_memory(name=\"frontend\", ...) — this is REQUIRED; a run " +
    "where the `frontend` slice is empty FAILS the build. Store a short implementation summary " +
    "(the files you wrote and the UI/perf approach you took) followed by this exact block, " +
    "filled in with YOUR client's actual contract:\n\n" +
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
    "You are the BACKEND specialist in a blind fan-out. Your FIRST TWO actions MUST be tool calls: " +
    "read_memory(name=\"goal\"), then read_memory(name=\"plan\") — the Serena MEMORY STORE, not the " +
    "filesystem (do NOT Glob/Read to find them). BUILD EXACTLY WHAT THE PLAN DESCRIBES — the plan is " +
    "the spec. Do NOT read the `frontend` memory — you are working blind to the frontend team.\n" +
    `Build the BACKEND exactly as the plan calls for, as real files under ` +
    `${WORKSPACE_SRC}/server/ (pure TypeScript, prefer Node built-ins like node:http / node:crypto, ` +
    "explicit `.ts` import extensions, no native deps, do not touch tsconfig.json). Common shapes the " +
    "plan may call for: a static file server that serves the client build, and/or JSON API endpoints " +
    "(e.g. a listings/data endpoint that returns seeded fake data with pagination + filtering). " +
    "Implement whatever the plan specifies — do not assume auth unless the plan asks for it.\n" +
    "If the plan requires SEEDED fake data, generate it deterministically (a fixed seed, no reliance " +
    "on Math.random at request time) so results are stable and paginable.\n" +
    `  - ${WORKSPACE_SRC}/server/*.test.ts — REQUIRED (zero test files is a hard failure). Cover the ` +
    "server's real behavior with node:test — e.g. the endpoints return the expected shapes, and " +
    "pagination + each filter the plan defines actually narrows/pages the data correctly.\n" +
    "Because you cannot see the frontend, YOU decide the exact HTTP contract your server " +
    "exposes (endpoints, query params, JSON shapes). Then you MUST call write_memory(name=\"backend\", " +
    "...) — REQUIRED; an empty `backend` slice FAILS the build. Store a short implementation summary " +
    "followed by this exact block, filled in:\n\n" +
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
