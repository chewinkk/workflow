// Runner: turns one pipeline role into one headless `claude` call wired to the
// Serena MCP shared store, and CAPTURES every tool the agent invokes.
//
// The captured tool calls are the load-bearing part of Step 2: they are the
// real, observed "sources each agent reads" log the gate is judged on. We do
// not claim what an agent read — we record what it actually called.
//
// Each agent:
//   - system prompt  = plain agents/<role>.md (spec §2/§5)
//   - model          = src/models.ts (spec §8)
//   - store access   = Serena MCP (read_memory/write_memory/list_memories)
//   - directive      = a MINIMAL instruction naming which slices to read/write.
//                      The slice CONTENT is NOT passed here — it flows through
//                      the store. That is the whole point of Step 2.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MCP_CONFIG = join(REPO_ROOT, "mcp", "serena.config.json");

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  denied: boolean; // tool_result came back is_error (e.g. permission denied)
}

export interface AgentResult {
  role: string;
  model: string;
  output: string;
  ms: number;
  toolCalls: ToolCall[];
}

function promptPathFor(role: string): string {
  return join(REPO_ROOT, "agents", `${role}.md`);
}

// Serena memory tools are always allowed (the store). Repo-read tools are
// allowed per-role so we can observe whether a role CHOOSES to re-explore.
const STORE_TOOLS = [
  "mcp__serena__read_memory",
  "mcp__serena__write_memory",
  "mcp__serena__list_memories",
];

export interface RunOpts {
  // Extra tools this role is permitted (e.g. Read/Glob/Grep for the Explorer,
  // and — deliberately — for the Executor, so the gate can prove it declines).
  extraTools?: string[];
  // Override the system prompt. Used by the swarm specialists whose "who" comes
  // from stacked agency-agents roster personalities rather than agents/<role>.md.
  systemPrompt?: string;
  // Working directory for the agent process. Defaults to the repo root. Set to
  // the workspace for file-writing specialists so stray RELATIVE writes (helper
  // scripts, etc.) land in the gitignored workspace instead of polluting the repo.
  cwd?: string;
  // Tools to hard-block (--disallowedTools). Use to stop specialists from
  // self-verifying via Bash or spawning subagents via Task — those are the
  // harness's job and cause slowness + stray files.
  disallowedTools?: string[];
}

export function runAgent(
  role: string,
  model: string,
  directive: string,
  opts: RunOpts = {}
): Promise<AgentResult> {
  const systemPrompt = opts.systemPrompt ?? readFileSync(promptPathFor(role), "utf8");
  const allowed = [...STORE_TOOLS, ...(opts.extraTools ?? [])].join(",");
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      directive,
      "--model",
      model,
      "--system-prompt",
      systemPrompt,
      "--mcp-config",
      MCP_CONFIG,
      "--allowedTools",
      allowed,
      "--output-format",
      "stream-json",
      "--verbose",
    ];
    if (opts.disallowedTools?.length) {
      args.push("--disallowedTools", opts.disallowedTools.join(","));
    }

    // Pin the Serena store to the orchestrator's OWN store dir for every agent,
    // regardless of the agent's file-write cwd. bin/serena-mcp.sh resolves the
    // project as ${SERENA_PROJECT:-$PWD}; without this, an agent spawned with
    // cwd=WORKSPACE_DIR (the fan-out specialists, the apply/perf Executor) would
    // make Serena resolve the store to <workspace>/.serena — a dead directory,
    // NOT the volume-backed store the other agents and this process use. Setting
    // SERENA_PROJECT to process.cwd() (the same base store/client.ts uses for
    // MEM_DIR) decouples store location from cwd: cwd still contains stray file
    // writes; SERENA_PROJECT owns where memories go. (This was the frontend/
    // backend store split.)
    const child = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SERENA_PROJECT: process.cwd() },
      cwd: opts.cwd ?? REPO_ROOT,
    });

    let stderr = "";
    let buf = "";
    const toolCalls: ToolCall[] = [];
    const byId = new Map<string, ToolCall>();
    const textChunks: string[] = [];
    let finalResult: string | null = null;

    function handleEvent(evt: any): void {
      if (!evt || typeof evt !== "object") return;
      if (evt.type === "assistant" && evt.message?.content) {
        for (const block of evt.message.content) {
          if (block.type === "tool_use") {
            const tc: ToolCall = { name: block.name, input: block.input ?? {}, denied: false };
            toolCalls.push(tc);
            if (block.id) byId.set(block.id, tc);
          } else if (block.type === "text" && typeof block.text === "string") {
            textChunks.push(block.text);
          }
        }
      } else if (evt.type === "user" && evt.message?.content) {
        // tool_result blocks report whether the call errored (e.g. denied).
        for (const block of evt.message.content) {
          if (block.type === "tool_result" && block.is_error && block.tool_use_id) {
            const tc = byId.get(block.tool_use_id);
            if (tc) tc.denied = true;
          }
        }
      } else if (evt.type === "result" && typeof evt.result === "string") {
        finalResult = evt.result;
      }
    }

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          /* ignore non-JSON noise */
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`agent "${role}" (model ${model}) exited ${code}\n${stderr.trim()}`)
        );
        return;
      }
      resolve({
        role,
        model,
        output: (finalResult ?? textChunks.join("")).trim(),
        ms: Date.now() - started,
        toolCalls,
      });
    });
  });
}
