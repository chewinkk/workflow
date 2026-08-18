// Reconciler (spec §2/§6). The integration pass after every fan-out. It reads
// BOTH specialists' slices — the only agent that sees both sides — and flags the
// seams between them. "Who" = engineering-senior-developer (integration judgment
// is a generalist task; substituted for the spec's non-existent
// specialized-codebase-archaeologist, confirmed in Phase 1).
//
// The Reconciler adjudicates CODE integration; the Council (Step 5) adjudicates
// decisions. Kept separate on purpose.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROSTER = join(__dirname, "..", "..", "agents", "roster");

export function reconcile(): Promise<AgentResult> {
  const systemPrompt = readFileSync(join(ROSTER, "engineering-senior-developer.md"), "utf8");
  const directive =
    "You are the RECONCILER — the integration pass after a blind fan-out. Do EXACTLY these " +
    "three steps and nothing else:\n" +
    "STEP 1: call read_memory on `frontend`.\n" +
    "STEP 2: call read_memory on `backend`.\n" +
    "STEP 3: compare their two `API CONTRACT` blocks field by field (endpoint " +
    "methods/paths, request field names, success/error response shapes and status codes, " +
    "data model field names/types, state/pagination mechanism), then call write_memory to " +
    "store the memory named `reconciled`.\n\n" +
    "The `reconciled` content MUST begin with a single line:\n" +
    "  SEAMS_FOUND: <number>\n" +
    "then, for each seam, a line:\n" +
    "  - <field>: frontend=`<value>` VS backend=`<value>`  -> fix: <the reconciliation>\n" +
    "If and only if the two contracts fully agree, write `SEAMS_FOUND: 0`. Report only real " +
    "mismatches between the two contracts; do not invent seams.\n\n" +
    "Use ONLY the read_memory and write_memory tools. Do NOT run shell commands, do NOT read " +
    "files, do NOT spawn subagents. This is a two-read, one-write task.";
  return runAgent("reconciler", modelFor("reconciler"), directive, {
    systemPrompt,
    disallowedTools: ["Bash", "Task", "KillShell", "BashOutput", "Read", "Glob", "Grep", "Write", "Edit"],
  });
}
