// The shared-store slices (spec §3). Single source of truth all agents
// read/write. Backed by Serena memories: each slice is the memory named
// `<slice>` (persisted by Serena as .serena/memories/<slice>.md).
//
// This file is the ONE place that declares the slice contract: who writes it,
// who reads it. Keep it in sync with the agent prompts under agents/.

export type Slice = "goal" | "explored" | "plan" | "done" | "blocked";

export const SLICES: Slice[] = ["goal", "explored", "plan", "done", "blocked"];

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
};
