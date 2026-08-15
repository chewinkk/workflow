// The LLM Council (spec §6). A deliberation subroutine that pressure-tests the
// `plan` from four fixed angles in parallel — each critic with FRESH context and
// BLIND to the others, all pointed at the same plan — then a Judge runs last with
// all four verdicts and RULES (it does not average), writing the revised plan back.
//
// This is a specific instance of the swarm pattern (parallel fan-out → single
// synthesizer): the Reconciler integrates CODE, the Council adjudicates DECISIONS.
// Kept separate on purpose.
//
// Carrying the Step 4 lesson: narrow-job agents get Bash/Task hard-blocked at the
// tool level. Critics only read the store and emit prose; the Judge only reads and
// writes the store. A disallowed tool is a guarantee; a prompt instruction is not.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAgent, type AgentResult } from "../runner.js";
import { modelFor } from "../models.js";
import { readSlice } from "../store/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROLES = join(__dirname, "roles");

export const CRITICS = ["contrarian", "first-principles", "expansionist", "outsider"] as const;
export type CriticName = (typeof CRITICS)[number];

function rolePrompt(name: string): string {
  return readFileSync(join(ROLES, `${name}.md`), "utf8");
}

// Critics: read the store, emit prose. No writing, no shell, no subagents, no files.
const CRITIC_BLOCK = [
  "Bash", "Task", "KillShell", "BashOutput",
  "Read", "Glob", "Grep", "Write", "Edit", "MultiEdit",
  "mcp__serena__write_memory",
];
// Judge: reads + writes the store only. No shell, no subagents, no files.
const JUDGE_BLOCK = ["Bash", "Task", "KillShell", "BashOutput", "Read", "Glob", "Grep", "Write", "Edit", "MultiEdit"];

function runCritic(name: CriticName): Promise<AgentResult> {
  const directive =
    `You are the ${name} member of the Council. ` +
    "Call read_memory on `goal` and on `plan`. Then deliver your verdict as text, " +
    "following your mandate. Use ONLY read_memory — do not write any memory, do not " +
    "run shell commands, do not read files, do not spawn subagents.";
  return runAgent(name, modelFor("council-critic"), directive, {
    systemPrompt: rolePrompt(name),
    disallowedTools: CRITIC_BLOCK,
  });
}

function runJudge(verdicts: { role: string; text: string }[]): Promise<AgentResult> {
  const bundle = verdicts
    .map((v) => `### ${v.role.toUpperCase()} verdict\n${v.text}`)
    .join("\n\n");
  const directive =
    "The four critics have ruled, in parallel and blind to each other. " +
    "First call read_memory on `goal` and on `plan`. Here are the four verdicts:\n\n" +
    bundle +
    "\n\nNow RULE, per your mandate — do NOT hedge or average. Then do exactly the two " +
    "writes your mandate specifies: write_memory `council` (your ruling) and write_memory " +
    "`plan` (the full revised plan). Use ONLY read_memory and write_memory.";
  return runAgent("judge", modelFor("council-judge"), directive, {
    systemPrompt: rolePrompt("judge"),
    disallowedTools: JUDGE_BLOCK,
  });
}

export interface CouncilResult {
  critics: { role: CriticName; result: AgentResult }[];
  judge: AgentResult;
  planBefore: string;
  planAfter: string;
}

export async function runCouncil(): Promise<CouncilResult> {
  const planBefore = readSlice("plan") ?? "";
  // Four critics fire in parallel, each blind (separate processes reading only goal+plan).
  const results = await Promise.all(CRITICS.map((c) => runCritic(c)));
  const critics = CRITICS.map((c, i) => ({ role: c, result: results[i] }));
  // Judge runs last with all four verdicts.
  const judge = await runJudge(critics.map((c) => ({ role: c.role, text: c.result.output })));
  const planAfter = readSlice("plan") ?? "";
  return { critics, judge, planBefore, planAfter };
}
