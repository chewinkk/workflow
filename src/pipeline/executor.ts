// Executor stage (spec §1 pipeline). Receives the Planner's plan as its handoff
// input and reports what it would change/build. In Step 1 there is no store and
// no verification loop yet (those are Steps 2 and 3), so the Executor emits a
// concrete change-summary artifact that is handed to the Reviewer.

import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";

export function execute(planFromPlanner: string): Promise<AgentResult> {
  const input =
    `You have been handed the following plan by the Planner. ` +
    `Act on it and report what you changed.\n\n` +
    `=== PLAN ===\n${planFromPlanner}\n=== END PLAN ===\n\n` +
    `Produce your change-summary now.`;
  return runAgent("executor", modelFor("executor"), input);
}
