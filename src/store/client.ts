// Thin store client (spec §2 src/store/client.ts) — the orchestrator's handle
// on the Serena-backed shared store.
//
// The store is the active Serena project's memory set. Serena persists each
// memory as a file under `<project>/.serena/memories/<name>.md`. Agents reach
// these through the Serena MCP server's read_memory/write_memory tools; the
// orchestrator reaches the SAME files through this client. One store, two
// front doors — that's the single source of truth from §3.
//
// The client is deliberately thin and file-backed (fast, no per-call process
// spawn). It is the orchestrator's job here to: seed `goal` before the run,
// and read slices back for checkpointing + the Step 2 gate report. The agents
// themselves do their reads/writes via Serena MCP (that's what the gate
// instruments).

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Slice } from "./schema.js";

const MEM_DIR = join(process.cwd(), ".serena", "memories");

function memPath(slice: Slice): string {
  return join(MEM_DIR, `${slice}.md`);
}

export function ensureStore(): void {
  mkdirSync(MEM_DIR, { recursive: true });
}

export function writeSlice(slice: Slice, content: string): void {
  ensureStore();
  writeFileSync(memPath(slice), content, "utf8");
}

export function readSlice(slice: Slice): string | null {
  const p = memPath(slice);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

export function hasSlice(slice: Slice): boolean {
  return existsSync(memPath(slice));
}

export function listSlices(): string[] {
  if (!existsSync(MEM_DIR)) return [];
  return readdirSync(MEM_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

// Clear the per-job runtime slices so each run starts from a clean store.
// (goal is re-seeded by the orchestrator; the rest are produced by the run.)
export function resetJobSlices(): void {
  ensureStore();
  for (const s of ["goal", "explored", "plan", "done", "blocked"] as Slice[]) {
    const p = memPath(s);
    if (existsSync(p)) writeFileSync(p, "", "utf8");
  }
}
