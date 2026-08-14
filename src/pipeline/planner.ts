// Planner stage (spec §1 pipeline). Reads the job goal, produces an explicit
// plan. In Step 1 there is no shared store, so the plan is returned in-memory
// and handed straight to the Executor by the orchestrator.

import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";

export function plan(goalAndConstraints: string): Promise<AgentResult> {
  const input =
    `Here is the job to plan.\n\n${goalAndConstraints}\n\n` +
    `Produce the plan now.`;
  return runAgent("planner", modelFor("planner"), input);
}
