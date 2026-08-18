// The shared-store slices (spec §3). Single source of truth all agents
// read/write. Backed by Serena memories: each slice is the memory named
// `<slice>` (persisted by Serena as .serena/memories/<slice>.md).
//
// This file is the ONE place that declares the slice contract: who writes it,
// who reads it. Keep it in sync with the agent prompts under agents/.

export type Slice =
  | "goal"
  | "explored"
  | "plan"
  | "done"
  | "blocked"
  // Step 4 swarm slices: each specialist's half-implementation + payload contract,
  // and the Reconciler's integration verdict.
  | "frontend"
  | "backend"
  | "reconciled"
  // Step 5: the Council's ruling on the plan.
  | "council";

export const SLICES: Slice[] = [
  "goal",
  "explored",
  "plan",
  "done",
  "blocked",
  "frontend",
  "backend",
  "reconciled",
  "council",
];

// §3 access table — used for logging/verification and to keep the wiring honest.
export interface SliceSpec {
  writtenBy: string[];
  readBy: string[];
  contents: string;
}

export const SLICE_SPEC: Record<Slice, SliceSpec> = {
  goal: {
    writtenBy: ["orchestrator"],
    readBy: ["explorer", "planner", "executor", "reviewer"],
    contents: "the job's objective, constraints, acceptance criteria",
  },
  explored: {
    writtenBy: ["explorer"],
    readBy: ["planner"], // NOTE: Executor must NOT re-read this (that's the Step 2 gate).
    contents: "what the codebase contains — structure, entry points, relevant symbols",
  },
  plan: {
    writtenBy: ["planner"],
    readBy: ["executor", "reviewer"],
    contents: "explicit steps: files, signatures, edge cases",
  },
  done: {
    writtenBy: ["executor"],
    readBy: ["reviewer"],
    contents: "what was changed, where, and why",
  },
  blocked: {
    writtenBy: ["explorer", "planner", "executor", "reviewer"],
    readBy: ["orchestrator"],
    contents: "anything stuck, with the reason",
  },
  frontend: {
    writtenBy: ["frontend"],
    readBy: ["reconciler"], // Backend must NOT read this — the two fan out BLIND.
    contents: "frontend half + its assumed API CONTRACT",
  },
  backend: {
    writtenBy: ["backend"],
    readBy: ["reconciler"], // Frontend must NOT read this — the two fan out BLIND.
    contents: "backend half + its assumed API CONTRACT",
  },
  reconciled: {
    writtenBy: ["reconciler"],
    readBy: ["orchestrator", "reviewer"],
    contents: "integration verdict: the seams between frontend and backend, with fixes",
  },
  council: {
    writtenBy: ["council-judge"],
    readBy: ["orchestrator", "planner", "executor"],
    contents: "the Judge's ruling: RULING / ADOPTED / OVERRIDDEN (the plan itself is revised in `plan`)",
  },
};
