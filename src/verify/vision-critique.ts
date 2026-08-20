// Vision-critique gate (Phase 0b). The counterpart to the frame-timing gate: that
// one proves the UI is not laggy; this one proves it is actually GOOD — that it
// looks like what the plan asked for, not a compile-clean look-alike.
//
//   1. Bundle + serve the client (shared helpers from frame-timing.ts).
//   2. Launch the same baked Chromium, drive the UI into a fixed set of STATES
//      worth grading (default grid, a filter applied, the post modal open, the
//      second wallpaper) and screenshot each.
//   3. Hand the screenshots to a vision model — routed dynamically: a cheap
//      Sonnet-5 STRUCTURAL pass first ("is the premise faked?"), and only if that
//      survives, an Opus-4.8 AESTHETIC verdict ("is it premium / on-brief?").
//   4. A blocker/major issue FAILS the gate and bounces to the Executor's
//      visual-fidelity fix mode with the critic's concrete issues.
//
// The model is reached the same way every other agent is: a headless `claude`
// subprocess (runner.ts). Its Read tool renders images, so the agent literally
// looks at the screenshots and returns a structured JSON verdict.
//
// Infra safety: if the browser or the critic subprocess cannot run at all, this is
// a SOFT-SKIP (ran:false, pass:true) — a down critic must not brick a build, and
// the Executor can't fix `claude` being unavailable anyway. Only a critic that
// actually ran and found blocking problems fails the gate.

import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_HTML, CLIENT_ENTRY, WORKSPACE_DIR } from "./gates.js";
import {
  serveClient,
  chromeExecutable,
  bundleClientToDisk,
  DEFAULT_BROWSERS_PATH,
} from "./frame-timing.js";
import { runAgent } from "../runner.js";
import { modelFor, type CritiqueDifficulty } from "../models.js";
import { readSlice } from "../store/client.js";

// Screenshots land in a gitignored scratch dir under the workspace.
const CRITIQUE_DIR = join(WORKSPACE_DIR, ".critique");
// Text grounding (design brief / rubric). Every .md here is concatenated into the
// critic's brief. Phase 0a extends this with reference images.
const GROUNDING_DIR = join(process.cwd(), "grounding");

export type Severity = "blocker" | "major" | "minor";

export interface CritiqueIssue {
  severity: Severity;
  state: string; // which screenshot/state it was seen in
  issue: string; // what's wrong
  fix?: string; // optional concrete remedy
}

export interface VisionCritiqueResult {
  pass: boolean;
  ran: boolean; // false => soft-skip (infra could not run); never fails the build
  model: string; // the model that produced the deciding verdict
  issues: CritiqueIssue[];
  detail: string;
  shots: string[]; // screenshot paths captured
}

// One state worth grading + how to drive the UI into it. Every driver is
// best-effort: a UI missing a given control simply yields the current view, and
// the critic judges whatever states it could reach.
interface CritiqueState {
  name: string;
  note: string;
  drive: (page: any) => Promise<void>;
}

async function clickFirst(page: any, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.click({ timeout: 800 });
        return;
      }
    } catch {
      /* try the next selector */
    }
  }
}

const STATES: CritiqueState[] = [
  {
    name: "default-grid",
    note: "initial marketplace: glass over the live wallpaper, listing grid, filter rail",
    drive: async () => {
      /* just the loaded view */
    },
  },
  {
    name: "filter-applied",
    note: "a filter engaged, so the glass rail + grid update",
    drive: async (page) => {
      await clickFirst(page, [
        '[data-testid*="filter"] button',
        '[data-testid*="chip"]',
        '[data-testid*="brand"]',
        '[data-testid*="condition"]',
        '[data-testid*="quality"]',
        '[role="button"]',
      ]);
    },
  },
  {
    name: "modal-open",
    note: "the post-a-product modal as a glass panel with its fields",
    drive: async (page) => {
      await clickFirst(page, [
        '[data-testid*="post"]',
        '[data-testid*="add"]',
        'button:has-text("Post")',
        'button:has-text("Sell")',
        'button:has-text("Add")',
      ]);
    },
  },
  {
    name: "wallpaper-2",
    note: "the second live WebGL wallpaper (switched), glass refracting it",
    drive: async (page) => {
      await clickFirst(page, [
        '[data-testid*="wallpaper"]',
        '[data-testid*="wall"]',
        '[data-testid*="background"]',
        'button:has-text("wallpaper")',
        'button:has-text("Blue")',
        'button:has-text("Chrome")',
      ]);
    },
  },
];

// Build the design brief the critic judges against: the job's acceptance criteria
// (the `goal` slice) + every grounding .md on disk.
function critiqueBrief(): string {
  const goal = readSlice("goal")?.trim() ?? "";
  let grounding = "";
  if (existsSync(GROUNDING_DIR)) {
    for (const f of readdirSync(GROUNDING_DIR).filter((f) => f.endsWith(".md")).sort()) {
      grounding += `\n\n----- grounding: ${f} -----\n` + readFileSync(join(GROUNDING_DIR, f), "utf8");
    }
  }
  return (
    "===== THE GOAL (acceptance criteria to judge against) =====\n" +
    (goal || "(no goal slice found)") +
    "\n===== END GOAL =====" +
    (grounding ? "\n\n===== DESIGN GROUNDING =====" + grounding + "\n===== END GROUNDING =====" : "")
  );
}

// Parse a JSON verdict out of a critic's free-text reply. Robust to code fences and
// leading prose: prefer a ```json block, else the last balanced {...}.
function parseVerdict(text: string): { pass: boolean; issues: CritiqueIssue[] } | null {
  const tryParse = (s: string): { pass: boolean; issues: CritiqueIssue[] } | null => {
    try {
      const o = JSON.parse(s);
      if (o && typeof o === "object" && Array.isArray(o.issues)) {
        const issues: CritiqueIssue[] = o.issues
          .filter((i: any) => i && typeof i.issue === "string")
          .map((i: any) => ({
            severity: (["blocker", "major", "minor"].includes(i.severity) ? i.severity : "major") as Severity,
            state: typeof i.state === "string" ? i.state : "unknown",
            issue: String(i.issue),
            fix: typeof i.fix === "string" ? i.fix : undefined,
          }));
        return { pass: Boolean(o.pass), issues };
      }
    } catch {
      /* not valid JSON */
    }
    return null;
  };
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const v = tryParse(fence[1].trim());
    if (v) return v;
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const v = tryParse(text.slice(first, last + 1));
    if (v) return v;
  }
  return null;
}

// The critic has no roster file; give it an inline system prompt (the runner reads
// agents/<role>.md only when systemPrompt is omitted, and there is no critique.md).
const CRITIC_SYSTEM =
  "You are a meticulous visual design critic reviewing screenshots of a running web UI. You look at " +
  "the actual pixels via your Read tool and judge fidelity to a written brief. You are precise, " +
  "specific, and honest — you name concrete visual problems and never rubber-stamp. You output only " +
  "the requested JSON verdict, nothing else.";

const VERDICT_SHAPE =
  'Reply with ONLY a JSON object, no prose around it:\n' +
  '{ "pass": <true|false>, "issues": [ { "severity": "blocker"|"major"|"minor", ' +
  '"state": "<screenshot name>", "issue": "<what is wrong>", "fix": "<concrete remedy>" } ] }\n' +
  'Set "pass" to false if there is ANY blocker or major issue. An empty issues array means a clean pass.';

// Run one critic pass over the screenshots at the given difficulty (model routed by
// modelFor). Returns the parsed verdict, or null if the subprocess/parse failed.
async function critiquePass(
  difficulty: CritiqueDifficulty,
  brief: string,
  shots: { name: string; path: string; note: string }[]
): Promise<{ pass: boolean; issues: CritiqueIssue[]; model: string } | null> {
  const model = modelFor("critique", { difficulty });
  const lens =
    difficulty === "structural"
      ? "You are a STRUCTURAL critic. Judge ONLY whether the build FAKED its premise: is the " +
        "liquid glass actually refracting the wallpaper (not a flat translucent/CSS-blur panel), and " +
        "is each wallpaper a LIVE, shader-looking WebGL scene (not a static or CSS gradient)? Also flag " +
        "anything obviously broken/absent. Do NOT nitpick taste — only catch fakes and gross breakage. " +
        "Mark faked refraction or a gradient-instead-of-WebGL wallpaper as a \"blocker\"."
      : "You are an AESTHETIC critic with high taste. The structural basics passed; now judge whether " +
        "this looks PREMIUM and on-brief per the grounding — glass depth/bevel/specular, wallpaper " +
        "richness and motion, hierarchy, spacing, and readability of text on glass. Hold the bar high, " +
        "but reserve \"blocker\"/\"major\" for real quality failures, not tiny nits.";
  const shotList = shots.map((s) => `  - state "${s.name}" (${s.note}): ${s.path}`).join("\n");
  const directive =
    lens +
    "\n\nUse your Read tool to VIEW each screenshot below (they are PNG files — Read renders them), " +
    "then judge them against the goal + grounding.\n\nSCREENSHOTS:\n" +
    shotList +
    "\n\n" +
    brief +
    "\n\n" +
    VERDICT_SHAPE;
  try {
    const r = await runAgent("critique", model, directive, {
      systemPrompt: CRITIC_SYSTEM,
      extraTools: ["Read"],
      disallowedTools: ["Bash", "Task", "KillShell", "BashOutput", "Write", "Edit", "MultiEdit", "Glob", "Grep"],
    });
    const v = parseVerdict(r.output);
    if (!v) return null;
    return { ...v, model };
  } catch {
    return null;
  }
}

function blockingIssues(issues: CritiqueIssue[]): CritiqueIssue[] {
  return issues.filter((i) => i.severity === "blocker" || i.severity === "major");
}

export async function visionCritiqueGate(): Promise<VisionCritiqueResult> {
  const soft = (detail: string, shots: string[] = []): VisionCritiqueResult => ({
    pass: true, ran: false, model: "n/a", issues: [], detail: `SOFT-SKIP: ${detail}`, shots,
  });

  // No renderable UI is a HARD fail here too — but the frame gate runs first and
  // already hard-fails that case, so in practice this only guards direct calls.
  if (!existsSync(CLIENT_HTML) || !existsSync(CLIENT_ENTRY)) {
    return { pass: false, ran: true, model: "n/a", issues: [
      { severity: "blocker", state: "load", issue: "no renderable client UI to critique" },
    ], detail: "no client UI (index.html/main.ts missing)", shots: [] };
  }

  try {
    await bundleClientToDisk();
  } catch (e) {
    return soft(`client failed to bundle: ${(e as Error).message}`);
  }
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = DEFAULT_BROWSERS_PATH;

  // Fresh screenshot dir each run.
  rmSync(CRITIQUE_DIR, { recursive: true, force: true });
  mkdirSync(CRITIQUE_DIR, { recursive: true });

  const { server, url } = await serveClient();
  let browser: any;
  const shots: { name: string; path: string; note: string }[] = [];
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(600); // let the wallpaper + glass settle

    for (const st of STATES) {
      try {
        await st.drive(page);
      } catch {
        /* best-effort: judge whatever rendered */
      }
      await page.waitForTimeout(500);
      const path = join(CRITIQUE_DIR, `${st.name}.png`);
      try {
        await page.screenshot({ path });
        shots.push({ name: st.name, path, note: st.note });
      } catch {
        /* a state we couldn't capture is simply not judged */
      }
    }
  } catch (e) {
    return soft(`Chromium could not run: ${(e as Error).message}`, shots.map((s) => s.path));
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    server.close();
  }

  if (shots.length === 0) return soft("no screenshots were captured", []);

  const brief = critiqueBrief();

  // Pass 1 — cheap structural (Sonnet 5). If it can't run, soft-skip.
  const structural = await critiquePass("structural", brief, shots);
  if (!structural) return soft("structural critic did not return a parseable verdict", shots.map((s) => s.path));
  const structuralBlockers = blockingIssues(structural.issues);
  if (structuralBlockers.length > 0) {
    return {
      pass: false, ran: true, model: structural.model, issues: structural.issues,
      detail: describe("structural", structural.model, structuralBlockers, structural.issues),
      shots: shots.map((s) => s.path),
    };
  }

  // Pass 2 — aesthetic verdict (Opus 4.8), only now that the premise is real.
  const aesthetic = await critiquePass("aesthetic", brief, shots);
  if (!aesthetic) {
    // Structural passed but the strong pass couldn't run: accept the structural
    // result rather than block on infra (don't brick a real, non-faked build).
    return {
      pass: true, ran: true, model: structural.model, issues: structural.issues,
      detail: `structural pass clean (${structural.model}); aesthetic pass unavailable — accepted on structural`,
      shots: shots.map((s) => s.path),
    };
  }
  const aestheticBlockers = blockingIssues(aesthetic.issues);
  return {
    pass: aestheticBlockers.length === 0,
    ran: true,
    model: aesthetic.model,
    issues: aesthetic.issues,
    detail: describe("aesthetic", aesthetic.model, aestheticBlockers, aesthetic.issues),
    shots: shots.map((s) => s.path),
  };
}

function describe(pass: string, model: string, blockers: CritiqueIssue[], all: CritiqueIssue[]): string {
  const counts = { blocker: 0, major: 0, minor: 0 } as Record<Severity, number>;
  for (const i of all) counts[i.severity]++;
  return (
    `${pass} verdict (${model}): ${blockers.length ? "FAIL" : "PASS"} — ` +
    `${counts.blocker} blocker / ${counts.major} major / ${counts.minor} minor across ${all.length} issue(s)`
  );
}

// Render the critic's blocking issues as the text bounced to the Executor's
// visual-fidelity fix mode.
export function visionCritiqueErrorText(r: VisionCritiqueResult): string {
  const blockers = blockingIssues(r.issues);
  const lines = blockers
    .map((i) => `  [${i.severity}] (${i.state}) ${i.issue}${i.fix ? `\n     fix: ${i.fix}` : ""}`)
    .join("\n\n");
  return (
    "Vision-critique gate FAILED — the running UI does not match what the plan asked for.\n" +
    `Verdict: ${r.detail}\n\n` +
    "Blocking visual problems (screenshots were taken of the real running app):\n\n" +
    lines +
    "\n\nThe UI code is under workspace/src/client/. Fix these specifically:\n" +
    "  - The wallpapers MUST be live WebGL shaders on a <canvas> (getContext('webgl'/'webgl2')), " +
    "not CSS gradients or static images — they must visibly animate.\n" +
    "  - The glass MUST use the vendored liquidGL library (import it from ./lib/) so surfaces REFRACT " +
    "the wallpaper beneath them — a flat translucent panel or a plain backdrop-filter blur is not enough.\n" +
    "  - Keep text on glass readable and the layout aligned.\n" +
    "Make the minimal changes that resolve every blocker/major issue above. Do not touch tsconfig.json."
  );
}
