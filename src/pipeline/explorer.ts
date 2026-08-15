// Explorer stage (spec §1 base loop). Reads `goal` from the store, surveys the
// codebase, and writes `explored`. Model: Haiku (§8). It is allowed repo-read
// tools because exploring is its job.

import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";

export function explore(): Promise<AgentResult> {
  const directive =
    "You are the Explorer. " +
    "1) Read the memory named `goal` to learn the objective. " +
    "2) Survey the current repository to see what already exists relevant to that goal. " +
    "3) Call write_memory to store your findings in the memory named `explored`. " +
    "Your `explored` memory is the ONLY place downstream agents learn what the codebase contains, " +
    "so make it complete. Do not write any other memory.";
  return runAgent("explorer", modelFor("explorer"), directive, {
    extraTools: ["Read", "Glob", "Grep"],
  });
}
