// Thin runner: turns one pipeline role into one headless `claude` call.
//
// This is the only place that knows *how* an agent is executed. Step 1 runs
// each agent as a headless `claude -p` invocation:
//   - its system prompt is the plain agents/<role>.md file (spec §2/§5),
//   - its model comes from src/models.ts (spec §8),
//   - its "handoff input" is passed as the user prompt on stdin.
//
// No API key required: this uses the ambient Claude Code auth + ANTHROPIC_BASE_URL.
// Deliberately obvious and deletable per the governing discipline (§0).

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

export interface AgentResult {
  role: string;
  model: string;
  output: string;
  ms: number;
}

function promptPathFor(role: string): string {
  return join(REPO_ROOT, "agents", `${role}.md`);
}

/**
 * Run one agent headlessly and return its text output.
 * @param role       role name, also the agents/<role>.md filename
 * @param model      model id for `claude --model`
 * @param input      the handoff payload (becomes the user prompt)
 */
export function runAgent(
  role: string,
  model: string,
  input: string
): Promise<AgentResult> {
  const systemPrompt = readFileSync(promptPathFor(role), "utf8");
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--model",
      model,
      "--system-prompt",
      systemPrompt,
      "--output-format",
      "text",
    ];

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `agent "${role}" (model ${model}) exited ${code}\n${stderr.trim()}`
          )
        );
        return;
      }
      resolve({
        role,
        model,
        output: stdout.trim(),
        ms: Date.now() - started,
      });
    });

    // The handoff payload goes in on stdin as the user turn.
    child.stdin.write(input);
    child.stdin.end();
  });
}
