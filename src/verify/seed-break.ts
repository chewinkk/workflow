// Deliberate fault injection for the Step 3 gate.
//
// The gate requires a REAL break for the loop to catch. This appends a genuine
// compile error (TS2304 — undefined identifier) to a real source file the
// Executor wrote, and returns exactly what it did so the run log is honest about
// the seed being deliberate. Not used in normal operation — only when the run is
// invoked with --seed-break.

import { appendFileSync } from "node:fs";
import { relative } from "node:path";
import { workspaceSourceFiles } from "./gates.js";

const MARKER = "__SEEDED_BREAK__";

export interface SeededBreak {
  file: string;
  detail: string;
}

export function seedBreak(): SeededBreak | null {
  // First real implementation file (not a test), recursively, deterministically.
  const target = workspaceSourceFiles()[0];
  if (!target) return null;
  const snippet = `\n// ${MARKER} (deliberate, injected by --seed-break)\nexport function ${MARKER}(): number { return seededUndefinedIdentifier; }\n`;
  appendFileSync(target, snippet, "utf8");
  return {
    file: relative(process.cwd(), target),
    detail: "appended a function referencing an undefined identifier (expected TS2304)",
  };
}
