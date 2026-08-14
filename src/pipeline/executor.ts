// Executor stage (spec §1). Reads `plan` from the store and writes `done`.
// Model: Sonnet 5 (§8).
//
// THIS STAGE IS THE STEP 2 GATE. The Executor is deliberately GRANTED repo-read
// tools (Read/Glob/Grep) so that declining to use them is a real, observed
// result — not something made structurally impossible. The wiring is correct
// iff the Executor pulls everything it needs from the `plan` memory and does
// NOT read the `explored` memory nor re-open repo files.

import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";

export function execute(): Promise<AgentResult> {
  const directive =
    "You are the Executor. " +
    "1) Read the memory named `plan`. That plan is self-contained. " +
    "2) Produce a concrete change-summary describing exactly what you would " +
    "implement for each plan step (files, contents, why). This step of the " +
    "orchestrator build is a text-artifact stage — do NOT actually create/edit " +
    "files or run shell commands (real file-writing + running is Step 3). " +
    "Do NOT read the `explored` memory and do NOT re-survey the repository — " +
    "everything you need is in `plan`; re-deriving it wastes tokens. " +
    "3) Call write_memory to store your change-summary in the memory named `done`.";
  return runAgent("executor", modelFor("executor"), directive, {
    // Granted on purpose — the gate proves they go UNUSED.
    extraTools: ["Read", "Glob", "Grep"],
  });
}
