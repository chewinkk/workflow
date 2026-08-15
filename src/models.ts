// Model assignment per role (spec §8). One file, so it's trivial to re-tune
// when a new model ships. These strings are passed straight to `claude --model`.
//
// Step 1 uses only the three loop roles. The rest are listed here (commented)
// so the single-source-of-truth intent from §8 is visible, and get uncommented
// as later steps hire them.

export type Role =
  | "explorer"
  | "planner"
  | "executor"
  | "reviewer"
  | "frontend"
  | "backend"
  | "reconciler"
  | "council-critic"
  | "council-judge";
  // Later steps (kept here as the §8 map, wired when their step lands):
  // | "security"      // Opus 4.8
  // | "runtime"       // Sonnet 5
  // | "a11y"          // Sonnet 5
  // | "reconciler"    // Sonnet 5 -> Opus 4.8 on escalation
  // | "council-critic"// Sonnet 5
  // | "council-judge" // Opus 4.8
  // | "orchestrator"  // Opus 4.8

// Concrete model ids handed to the `claude` CLI.
export const MODELS: Record<Role, string> = {
  // §8: Explorer -> Haiku (cheap, reads the graph).
  explorer: "claude-haiku-4-5-20251001",
  // §8: Planner -> Opus 4.8 (or Fable 5 for the hardest plans).
  planner: "claude-opus-4-8",
  // §8: Executor / most specialists -> Sonnet 5.
  executor: "claude-sonnet-5",
  // §8: Reviewer / Security / Orchestrator -> Opus 4.8.
  reviewer: "claude-opus-4-8",
  // §8: Executor / most specialists -> Sonnet 5.
  frontend: "claude-sonnet-5",
  backend: "claude-sonnet-5",
  // §8: Reconciler -> Sonnet 5, escalating to Opus 4.8 when the cheap pass smells something.
  reconciler: "claude-sonnet-5",
  // §8: Council critics -> Sonnet 5 (each has a narrow lens); Council Judge -> Opus 4.8.
  "council-critic": "claude-sonnet-5",
  "council-judge": "claude-opus-4-8",
};

export function modelFor(role: Role): string {
  return MODELS[role];
}
