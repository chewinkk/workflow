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

// Escalation target (spec §7.4): the verifier calls this after MAX_BOUNCES failed
// Executor fixes. The Planner revises `plan` in light of the persistent failure
// and records the blockage.
export function replan(persistentError: string): Promise<AgentResult> {
  const directive =
    "You are the Planner, called to ESCALATE. The Executor could not make the build/tests pass " +
    "after repeated fix attempts. The persistent error is:\n\n" +
    "```\n" +
    persistentError +
    "\n```\n\n" +
    "1) Read the memory named `plan`. " +
    "2) Revise it to route around this failure (different approach/deps/structure), and call " +
    "write_memory to store the revised plan back in `plan`. " +
    "3) Call write_memory to record the escalation and its cause in the memory named `blocked`.";
  return runAgent("planner", modelFor("planner"), directive);
}
