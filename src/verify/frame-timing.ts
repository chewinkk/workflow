// Frame-timing harness (spec §7 acceptance; Council ruling). This is the gate
// that makes "NOT laggy" a real, measured criterion instead of a promise:
//
//   1. esbuild-bundle the client entry (workspace/src/client/main.ts).
//   2. Serve the glass UI (workspace/src/client/index.html + the bundle + assets)
//      over a throwaway localhost http server.
//   3. Launch the Chromium that ships in this environment (/opt/pw-browsers) via
//      Playwright, install a requestAnimationFrame sampler + a longtask observer.
//   4. Drive several seconds of REAL scripted interaction on the liquid-glass UI
//      (hover the card, scroll, type any inputs, click filter/pagination/toggle/
//      submit controls) so the animation and any interaction jank actually happen.
//   5. Read the frame deltas back and compute two numbers the Council mandated:
//        worstFrameMs      = the single worst inter-frame delta
//        droppedRatio      = fraction of frames that missed the 60fps budget
//      Pass IFF worstFrameMs < WORST_FRAME_MAX_MS and droppedRatio < DROPPED_RATIO_MAX.
//
// What it measures is MAIN-THREAD frame cadence under interaction — i.e. jank
// caused by layout thrash, synchronous work in handlers, or expensive paints
// blocking rAF. That is exactly the "not laggy" the acceptance criterion is about.
//
// A MISSING or un-renderable client is a HARD FAIL, not a skip: the whole point
// of this gate is that "not laggy" cannot be dodged by simply not building the UI.

import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import {
  CLIENT_DIR,
  CLIENT_HTML,
  CLIENT_ENTRY,
  WORST_FRAME_MAX_MS,
  DROPPED_RATIO_MAX,
  DROPPED_FRAME_MS,
  FRAME_WARMUP_DROP,
  WEBGL_INTERACTION_SLACK_MS,
  WEBGL_DROPPED_DELTA_MAX,
  WEBGL_IDLE_CEILING_MS,
  clientUsesWebGL,
} from "./gates.js";

// Chromium launch flags. --enable-unsafe-swiftshader + angle/swiftshader make WebGL
// actually run in the GPU-less headless box (newer Chromium otherwise disables WebGL
// there, which would blank the wallpaper canvases). Shared with the vision gate so
// its screenshots show the real rendered WebGL, not an empty canvas.
export const CHROMIUM_ARGS = [
  "--ignore-gpu-blocklist",
  "--enable-gpu",
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
];

export interface FrameTimingResult {
  pass: boolean;
  ran: boolean; // false => the harness could not even measure (treated as a failure)
  mode: "strict" | "webgl-relative";
  worstFrameMs: number; // interaction worst (the reported headline number)
  idleWorstMs: number; // steady-state baseline worst (webgl-relative mode)
  droppedRatio: number; // interaction dropped ratio
  frames: number;
  longTasks: number;
  detail: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};

// Where the image bakes Chromium (Dockerfile: PLAYWRIGHT_BROWSERS_PATH).
export const DEFAULT_BROWSERS_PATH = "/opt/pw-browsers";

// Resolve the full-Chromium binary the image baked, so launch() never triggers a
// download and never falls back to /root/.cache/ms-playwright (which is empty on
// the box). Falls back to the baked default path if the env var is somehow unset.
// Exported so sibling browser gates (vision-critique) launch the same binary.
export function chromeExecutable(): string | undefined {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || DEFAULT_BROWSERS_PATH;
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base)) {
    if (d.startsWith("chromium-") && !d.includes("headless")) {
      const p = join(base, d, "chrome-linux", "chrome");
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

// Bundle the client entry into a single browser-loadable ES module (in memory).
async function bundleClient(): Promise<string> {
  // Imported lazily so the harness only pulls esbuild/playwright when it runs.
  const esbuild = await import("esbuild");
  const out = await esbuild.build({
    entryPoints: [CLIENT_ENTRY],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    sourcemap: false,
    logLevel: "silent",
  });
  const file = out.outputFiles?.[0];
  if (!file) throw new Error("esbuild produced no output for the client entry");
  return file.text;
}

// Bundle main.ts and EMIT it to disk as main.js, so index.html's own
// <script type="module" src="./main.js"> resolves — both under a browser gate and
// when the app is served standalone. (main.js is not *.ts, so tsc/node --test
// ignore it.) Shared by the frame-timing and vision-critique gates.
export async function bundleClientToDisk(): Promise<void> {
  const bundle = await bundleClient();
  writeFileSync(join(CLIENT_DIR, "main.js"), bundle, "utf8");
}

// Serve the client dir over a throwaway localhost server. Exported so the
// vision-critique gate serves the same build the frame gate does.
export function serveClient(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = (req.url ?? "/").split("?")[0];
      const rel = url === "/" || url === "/index.html" ? "index.html" : url.replace(/^\/+/, "");
      // Everything is served straight from the client dir — index.html, the
      // esbuild-emitted main.js (referenced by index.html's own <script>), CSS,
      // assets. The app is self-contained: no harness-injected script tag.
      const assetPath = join(CLIENT_DIR, rel);
      if (assetPath.startsWith(CLIENT_DIR) && existsSync(assetPath)) {
        res.writeHead(200, { "content-type": MIME[extname(assetPath)] ?? "application/octet-stream" });
        res.end(readFileSync(assetPath));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

// Installed in the page BEFORE interaction: sample every animation frame + count
// long tasks. Passed to page.evaluate as a string EXPRESSION, so it is written as
// a self-invoking function — Playwright evaluates the expression but does not call
// a bare function for us, so the IIFE must run itself.
const SAMPLER = `(() => {
  window.__ft = { deltas: [], longTasks: 0 };
  // A 1px fixed sentinel mutated every frame keeps the compositor at a steady
  // 60fps and defeats headless Chromium's IDLE rAF throttling (~30fps), which
  // would otherwise register idle frames as false "dropped" frames. The UI's own
  // main-thread work still shows up on top as deltas above the 60fps budget.
  const s = document.createElement('div');
  s.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;opacity:0.01;z-index:-1';
  document.body.appendChild(s);
  let last = performance.now();
  let i = 0;
  const tick = (now) => {
    window.__ft.deltas.push(now - last); last = now;
    s.style.transform = 'translateX(' + (i++ % 2) + 'px)';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    const po = new PerformanceObserver((list) => { window.__ft.longTasks += list.getEntries().length; });
    po.observe({ entryTypes: ['longtask'] });
  } catch (_) { /* longtask unsupported: rAF deltas still carry the signal */ }
})()`;

// Drive real interaction on whatever hooks the frontend exposed. Each helper is
// best-effort: the frontend is asked for data-testid hooks, but we fall back to
// tag selectors so a naming slip degrades to a weaker test, not a crash.
async function driveInteraction(page: any): Promise<void> {
  const click = async (sel: string) => {
    const el = page.locator(sel).first();
    if (await el.count()) { try { await el.click({ timeout: 800 }); } catch { /* ignore */ } }
  };
  const hover = async (sel: string) => {
    const el = page.locator(sel).first();
    if (await el.count()) { try { await el.hover({ timeout: 800 }); } catch { /* ignore */ } }
  };
  const type = async (sel: string, text: string) => {
    const el = page.locator(sel).first();
    if (await el.count()) { try { await el.fill(text, { timeout: 800 }); } catch { /* ignore */ } }
  };
  // Scroll the page (or a scroll container) to exercise scroll-driven animation.
  const scroll = async () => {
    try {
      await page.mouse.wheel(0, 1200);
    } catch { /* ignore */ }
  };
  // Click the Nth matching interactive element (chips, buttons, links, pagination),
  // not just the first, so filters/pagination actually change state under the sampler.
  const clickNth = async (sel: string, n: number) => {
    const loc = page.locator(sel);
    try {
      const count = await loc.count();
      if (count) { try { await loc.nth(n % count).click({ timeout: 800 }); } catch { /* ignore */ } }
    } catch { /* ignore */ }
  };

  // Several passes so transitions/scroll/filter changes run repeatedly under the
  // sampler. Selectors are generic (they cover the auth app AND a filtered,
  // paginated marketplace); each is best-effort, so a UI missing a given control
  // simply skips it rather than failing.
  for (let i = 0; i < 3; i++) {
    await hover('[data-testid="card"], [data-testid], form, main, body');
    await page.waitForTimeout(200);
    await scroll();
    await page.waitForTimeout(250);
    // Text inputs, if any (auth fields, a custom-quantity box, a search box).
    await type('[data-testid="email"], input[type="email"], input[name="email"]', `user${i}@example.com`);
    await type('[data-testid="password"], input[type="password"], input[name="password"]', "hunter2-correct");
    await page.waitForTimeout(150);
    // Interactive controls: filter chips / toggles / buttons / links, cycling the
    // index so different filters and pagination pages get exercised each pass.
    await clickNth(
      'button, a[href], [role="button"], [data-testid*="filter"], [data-testid*="chip"], ' +
        '[data-testid*="page"], [data-testid*="toggle"], [data-testid="submit"]',
      i + 1
    );
    await page.waitForTimeout(400);
    await scroll();
    await page.waitForTimeout(300);
  }
}

// Per-phase frame statistics.
interface PhaseStat {
  worst: number;
  droppedRatio: number;
  n: number;
}
function phaseStat(deltas: number[]): PhaseStat {
  if (deltas.length === 0) return { worst: 0, droppedRatio: 0, n: 0 };
  const worst = Math.max(...deltas);
  const dropped = deltas.filter((d) => d > DROPPED_FRAME_MS).length;
  return { worst, droppedRatio: dropped / deltas.length, n: deltas.length };
}

export async function frameTimingGate(): Promise<FrameTimingResult> {
  const fail = (detail: string): FrameTimingResult => ({
    pass: false, ran: false, mode: "strict", worstFrameMs: Infinity, idleWorstMs: Infinity,
    droppedRatio: 1, frames: 0, longTasks: 0, detail,
  });

  // HARD FAIL if there is no renderable UI — "not laggy" is not dodgeable.
  if (!existsSync(CLIENT_HTML)) return fail(`no client UI to measure: ${CLIENT_HTML} does not exist`);
  if (!existsSync(CLIENT_ENTRY)) return fail(`no client entry to bundle: ${CLIENT_ENTRY} does not exist`);

  // Emit main.js so index.html's own <script src="./main.js"> resolves (shared helper).
  try {
    await bundleClientToDisk();
  } catch (e) {
    return fail(`client failed to bundle for the browser: ${(e as Error).message}`);
  }

  // Ensure Playwright's own resolution also finds the baked browser if our
  // executablePath lookup ever returns undefined (headless-shell fallback).
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = DEFAULT_BROWSERS_PATH;

  const usesWebGL = clientUsesWebGL();
  const { server, url } = await serveClient();

  let browser: any;
  try {
    // playwright-core: no browser-download postinstall — we launch the Chromium the
    // image baked under PLAYWRIGHT_BROWSERS_PATH via executablePath.
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ headless: true, executablePath: chromeExecutable(), args: CHROMIUM_ARGS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors: string[] = [];
    page.on("pageerror", (err: Error) => consoleErrors.push(err.message));

    await page.goto(url, { waitUntil: "load", timeout: 15000 });
    await page.evaluate(SAMPLER);
    await page.waitForTimeout(400); // let first paint / compositor spin-up settle
    // Boundary between warm-up and the IDLE baseline phase.
    const warmMark: number = (await page.evaluate("window.__ft.deltas.length")) as number;
    // IDLE PHASE — steady-state cost with NO interaction (for WebGL, this is the
    // unavoidable software-raster baseline the app cannot fix in a GPU-less box).
    await page.waitForTimeout(1500);
    const idleMark = (await page.evaluate(
      "({ len: window.__ft.deltas.length, lt: window.__ft.longTasks })"
    )) as { len: number; lt: number };
    // INTERACTION PHASE — scroll/filter/pagination; this is where the app's OWN cost shows.
    await driveInteraction(page);
    await page.waitForTimeout(300);

    const ft = await page.evaluate("window.__ft");
    const deltasRaw: number[] = (ft?.deltas ?? []) as number[];
    const longTasksTotal: number = (ft?.longTasks ?? 0) as number;

    const warmup = Math.max(FRAME_WARMUP_DROP, warmMark);
    const idleDeltas = deltasRaw.slice(warmup, idleMark.len);
    const interDeltas = deltasRaw.slice(idleMark.len);
    const idleLongTasks = Math.max(0, idleMark.lt);
    const interLongTasks = Math.max(0, longTasksTotal - idleMark.lt);

    if (interDeltas.length < 20) {
      return {
        pass: false, ran: false, mode: usesWebGL ? "webgl-relative" : "strict",
        worstFrameMs: Infinity, idleWorstMs: Infinity, droppedRatio: 1,
        frames: interDeltas.length, longTasks: longTasksTotal,
        detail: `too few interaction frames sampled (${interDeltas.length}) — the UI never animated under interaction` +
          (consoleErrors.length ? `; page errors: ${consoleErrors.join(" | ")}` : ""),
      };
    }

    const B = phaseStat(idleDeltas); // baseline / idle
    const I = phaseStat(interDeltas); // interaction
    const errs = consoleErrors.length ? `; page errors: ${consoleErrors.join(" | ")}` : "";

    if (usesWebGL) {
      // RELATIVE budget: the app can't fix the software-WebGL baseline, but its
      // interactions must not pile materially more jank on top of it.
      const worstDelta = I.worst - B.worst;
      const droppedDelta = I.droppedRatio - B.droppedRatio;
      const pass =
        B.worst < WEBGL_IDLE_CEILING_MS &&
        worstDelta < WEBGL_INTERACTION_SLACK_MS &&
        droppedDelta < WEBGL_DROPPED_DELTA_MAX;
      return {
        pass, ran: true, mode: "webgl-relative",
        worstFrameMs: I.worst, idleWorstMs: B.worst, droppedRatio: I.droppedRatio,
        frames: I.n + B.n, longTasks: longTasksTotal,
        detail:
          `WebGL-relative (GPU-less box software-renders WebGL, so absolute frames are not the app's fault): ` +
          `idle worst=${B.worst.toFixed(1)}ms → interaction worst=${I.worst.toFixed(1)}ms ` +
          `(Δ=${worstDelta.toFixed(1)}ms, budget <${WEBGL_INTERACTION_SLACK_MS}ms); ` +
          `idle dropped=${(B.droppedRatio * 100).toFixed(0)}% → interaction dropped=${(I.droppedRatio * 100).toFixed(0)}% ` +
          `(Δ=${(droppedDelta * 100).toFixed(0)}pp, budget <${(WEBGL_DROPPED_DELTA_MAX * 100).toFixed(0)}pp); ` +
          `idle-ceiling ${B.worst.toFixed(0)}<${WEBGL_IDLE_CEILING_MS}ms; ` +
          `longTasks idle=${idleLongTasks}/interaction=${interLongTasks}${errs}`,
      };
    }

    // STRICT budget (non-WebGL apps): the whole sampled run must hold 60fps.
    const all = phaseStat(deltasRaw.slice(warmup));
    const pass = all.worst < WORST_FRAME_MAX_MS && all.droppedRatio < DROPPED_RATIO_MAX;
    return {
      pass, ran: true, mode: "strict",
      worstFrameMs: all.worst, idleWorstMs: B.worst, droppedRatio: all.droppedRatio,
      frames: all.n, longTasks: longTasksTotal,
      detail:
        `strict: sampled ${all.n} frames; worst=${all.worst.toFixed(1)}ms ` +
        `(budget <${WORST_FRAME_MAX_MS}ms), dropped=${(all.droppedRatio * 100).toFixed(1)}% ` +
        `(budget <${(DROPPED_RATIO_MAX * 100).toFixed(0)}%), longTasks=${longTasksTotal}${errs}`,
    };
  } catch (e) {
    return fail(`frame-timing harness could not run Chromium: ${(e as Error).message}`);
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    server.close();
  }
}

// Render the metrics as the "error" text bounced to the Executor's perf-fix mode.
export function frameTimingErrorText(r: FrameTimingResult): string {
  // WebGL-relative failure means interaction added jank ON TOP of the steady baseline
  // — the fix is different from "reduce absolute frame cost" (which is unfixable here).
  if (r.mode === "webgl-relative") {
    return (
      "Frame-timing gate FAILED (WebGL-relative) — INTERACTION adds jank on top of the steady\n" +
      "wallpaper baseline. The GPU-less test box software-renders WebGL, so the absolute frame\n" +
      "cost is the environment's, NOT yours — do NOT try to hit a 22ms absolute budget. The\n" +
      "failure is that scrolling / filtering / paginating makes it MUCH worse than idle:\n" +
      `  ${r.detail}\n\n` +
      "The UI code is under workspace/src/client/. Fix the INTERACTION cost specifically:\n" +
      "  - REDUCE THE NUMBER OF GLASS SURFACES. This is the biggest lever: do NOT give every listing\n" +
      "    card its own liquidGL surface. Put the grid on ONE glass panel and render the cards as flat\n" +
      "    DOM on top of it. Reserve live refraction for the chrome (top bar, filter rail, modal). N\n" +
      "    glass surfaces re-compositing over a software-rendered WebGL wallpaper is the worst case.\n" +
      "  - Do NOT rebuild the grid or re-run liquidGL snapshots on every filter/pagination change —\n" +
      "    update only what changed; use registerDynamic()/syncWith() so the glass tracks moving\n" +
      "    content without a full re-snapshot.\n" +
      "  - Debounce filter/search/pagination handlers; never do synchronous layout reads in them.\n" +
      "  - Animate only transform/opacity; keep the WebGL wallpapers at a fixed rAF cost independent\n" +
      "    of interaction (they should cost the same idle and under interaction).\n" +
      "Bring the interaction delta under budget. Do not touch tsconfig.json."
    );
  }
  return (
    "Frame-timing gate FAILED — the liquid-glass UI is laggy under interaction.\n" +
    `  worst frame        = ${Number.isFinite(r.worstFrameMs) ? r.worstFrameMs.toFixed(1) + "ms" : "n/a"} ` +
    `(budget < ${WORST_FRAME_MAX_MS}ms)\n` +
    `  dropped-frame ratio= ${(r.droppedRatio * 100).toFixed(1)}% (budget < ${(DROPPED_RATIO_MAX * 100).toFixed(0)}%)\n` +
    `  detail             = ${r.detail}\n\n` +
    "The UI code is under workspace/src/client/. Reduce MAIN-THREAD jank: animate only\n" +
    "transform/opacity (never width/height/top/left or box-shadow in the animation path),\n" +
    "avoid synchronous layout reads inside event handlers, keep backdrop-filter regions\n" +
    "small, debounce/throttle expensive work, and move any heavy work off the frame path.\n" +
    "Make the minimal change that brings BOTH metrics under budget. Do not touch tsconfig."
  );
}
