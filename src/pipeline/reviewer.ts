// Reviewer stage (spec §1). Reads `goal` + `done` from the store and issues a
// verdict. Model: Opus 4.8 (§8). Still Step 1/2 semantics: it reads and reports
// only — it does NOT run the code (that verification loop is Step 3).

import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";

export function review(): Promise<AgentResult> {
  const directive =
    "You are the Reviewer. " +
    "1) Read the memory named `goal` and the memory named `done`. " +
    "2) Judge whether the Executor's work satisfies the goal and acceptance criteria. " +
    "3) State your verdict (PASS / BOUNCE-BACK / ESCALATE) in your text output. " +
    "In this step you only read and report — do NOT run the code (that is Step 3).";
  return runAgent("reviewer", modelFor("reviewer"), directive);
}
