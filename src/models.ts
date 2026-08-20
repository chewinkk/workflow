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
  | "council-judge"
  | "critique"; // vision-critique gate (dynamic: see modelFor)

// The vision-critique gate routes by how hard the judgment is: a cheap structural
// pass ("is it obviously broken / faked?") vs. the strong aesthetic verdict
// ("does it look premium / on-brief?"). Cheap pass first; strong pass only where
// it earns its cost.
export type CritiqueDifficulty = "structural" | "aesthetic";
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
  // Vision-critique: Opus 4.8 is the default (the aesthetic verdict). The cheap
  // structural pass routes to Sonnet 5 via modelFor's `difficulty` option.
  critique: "claude-opus-4-8",
};

export function modelFor(role: Role, opts?: { difficulty?: CritiqueDifficulty }): string {
  // Dynamic routing for the vision-critique gate: the fast structural pass runs on
  // Sonnet 5; the aesthetic verdict (and anything unspecified) runs on Opus 4.8.
  if (role === "critique") {
    return opts?.difficulty === "structural" ? "claude-sonnet-5" : MODELS.critique;
  }
  return MODELS[role];
}
