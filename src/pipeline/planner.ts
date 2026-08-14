// Planner stage (spec §1). Reads `goal` + `explored` from the store, writes an
// explicit `plan`. Model: Opus 4.8 (§8). No repo tools: the Planner plans from
// what the Explorer already captured in `explored` — it must not re-survey.

import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";

export function plan(): Promise<AgentResult> {
  const directive =
    "You are the Planner. " +
    "1) Read the memory named `goal` and the memory named `explored`. " +
    "2) Produce an explicit, self-contained plan the Executor can act on WITHOUT " +
    "re-reading `explored` or re-surveying the repo — fold whatever the Executor needs " +
    "from `explored` directly into the plan. " +
    "3) Call write_memory to store it in the memory named `plan`. Do not write any other memory.";
  return runAgent("planner", modelFor("planner"), directive);
}
