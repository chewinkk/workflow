// Reviewer stage (spec §1 pipeline). Receives the Executor's change-summary and
// the original goal, and issues a verdict. In Step 1 the Reviewer only *reads*
// and reports (it does NOT run the code yet — that verification loop is Step 3).

import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";

export function review(
  goalAndConstraints: string,
  changeSummaryFromExecutor: string
): Promise<AgentResult> {
  const input =
    `Review the Executor's work against the original goal.\n\n` +
    `=== GOAL ===\n${goalAndConstraints}\n=== END GOAL ===\n\n` +
    `=== EXECUTOR CHANGE-SUMMARY ===\n${changeSummaryFromExecutor}\n` +
    `=== END CHANGE-SUMMARY ===\n\n` +
    `Produce your verdict now.`;
  return runAgent("reviewer", modelFor("reviewer"), input);
}
