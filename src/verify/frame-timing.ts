// Frame-timing harness (spec §7 acceptance; Council ruling). This is the gate
// that makes "NOT laggy" a real, measured criterion instead of a promise:
//
//   1. esbuild-bundle the client entry (workspace/src/client/main.ts).
//   2. Serve the glass UI (workspace/src/client/index.html + the bundle + assets)
//      over a throwaway localhost http server.
//   3. Launch the Chromium that ships in this environment (/opt/pw-browsers) via
//      Playwright, install a requestAnimationFrame sampler + a longtask observer.
//   4. Drive ~4–5s of REAL scripted interaction on the liquid-glass UI (hover the
//      card, focus/type the inputs, submit, toggle login<->signup) so the animation
//      and any interaction jank actually happen.
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
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import {
  CLIENT_DIR,
  CLIENT_HTML,
  CLIENT_ENTRY,
  WORST_FRAME_MAX_MS,
  DROPPED_RATIO_MAX,
  DROPPED_FRAME_MS,
  FRAME_WARMUP_DROP,
} from "./gates.js";

export interface FrameTimingResult {
  pass: boolean;
  ran: boolean; // false => the harness could not even measure (treated as a failure)
  worstFrameMs: number;
  droppedRatio: number;
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

// Resolve the real Chromium binary the environment pre-installed under
// PLAYWRIGHT_BROWSERS_PATH so we never trigger a browser download.
function chromeExecutable(): string | undefined {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
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

// index.html with our bundle injected before </body>. We own the script tag so
// the frontend specialist just writes markup + styles and its logic in main.ts.
function pageHtml(rawHtml: string): string {
  const tag = `<script type="module" src="/__frame_bundle.js"></script>`;
  if (rawHtml.includes("</body>")) return rawHtml.replace("</body>", `${tag}\n</body>`);
  return rawHtml + `\n${tag}\n`;
}

function serve(html: string, bundle: string): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = (req.url ?? "/").split("?")[0];
      if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "content-type": MIME[".html"] });
        res.end(html);
        return;
      }
      if (url === "/__frame_bundle.js") {
        res.writeHead(200, { "content-type": MIME[".js"] });
        res.end(bundle);
        return;
      }
      // Any other asset (css, images) is served straight from the client dir.
      const assetPath = join(CLIENT_DIR, url.replace(/^\/+/, ""));
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

  // Two full passes so transitions run repeatedly under the sampler.
  for (let i = 0; i < 2; i++) {
    await hover('[data-testid="card"], form, main, body');
    await page.waitForTimeout(300);
    await type('[data-testid="email"], input[type="email"], input[name="email"]', `user${i}@example.com`);
    await page.waitForTimeout(250);
    await type('[data-testid="password"], input[type="password"], input[name="password"]', "hunter2-correct");
    await page.waitForTimeout(250);
    await click('[data-testid="submit"], button[type="submit"], button');
    await page.waitForTimeout(500);
    await click('[data-testid="toggle-mode"], a, button');
    await page.waitForTimeout(500);
  }
}

export async function frameTimingGate(): Promise<FrameTimingResult> {
  const fail = (detail: string): FrameTimingResult => ({
    pass: false, ran: false, worstFrameMs: Infinity, droppedRatio: 1, frames: 0, longTasks: 0, detail,
  });

  // HARD FAIL if there is no renderable UI — "not laggy" is not dodgeable.
  if (!existsSync(CLIENT_HTML)) return fail(`no client UI to measure: ${CLIENT_HTML} does not exist`);
  if (!existsSync(CLIENT_ENTRY)) return fail(`no client entry to bundle: ${CLIENT_ENTRY} does not exist`);

  let bundle: string;
  try {
    bundle = await bundleClient();
  } catch (e) {
    return fail(`client failed to bundle for the browser: ${(e as Error).message}`);
  }

  const { server, url } = await serve(pageHtml(readFileSync(CLIENT_HTML, "utf8")), bundle);

  let browser: any;
  try {
    // playwright-core: no browser-download postinstall — we launch the Chromium the
    // environment already provisioned under PLAYWRIGHT_BROWSERS_PATH via executablePath.
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors: string[] = [];
    page.on("pageerror", (err: Error) => consoleErrors.push(err.message));

    await page.goto(url, { waitUntil: "load", timeout: 15000 });
    await page.evaluate(SAMPLER);
    await page.waitForTimeout(400); // let idle cadence settle before we interact
    await driveInteraction(page);
    await page.waitForTimeout(300);

    const ft = await page.evaluate("window.__ft");
    const deltasRaw: number[] = (ft?.deltas ?? []) as number[];
    const longTasks: number = (ft?.longTasks ?? 0) as number;

    // Drop warm-up frames (first paint / compositor spin-up are not interaction jank).
    const deltas = deltasRaw.slice(FRAME_WARMUP_DROP);
    if (deltas.length < 30) {
      return {
        pass: false, ran: false, worstFrameMs: Infinity, droppedRatio: 1,
        frames: deltas.length, longTasks,
        detail: `too few frames sampled (${deltas.length}) — the UI never animated under interaction` +
          (consoleErrors.length ? `; page errors: ${consoleErrors.join(" | ")}` : ""),
      };
    }

    const worstFrameMs = Math.max(...deltas);
    const dropped = deltas.filter((d) => d > DROPPED_FRAME_MS).length;
    const droppedRatio = dropped / deltas.length;
    const pass = worstFrameMs < WORST_FRAME_MAX_MS && droppedRatio < DROPPED_RATIO_MAX;

    return {
      pass,
      ran: true,
      worstFrameMs,
      droppedRatio,
      frames: deltas.length,
      longTasks,
      detail:
        `sampled ${deltas.length} frames; worst=${worstFrameMs.toFixed(1)}ms ` +
        `(budget <${WORST_FRAME_MAX_MS}ms), dropped=${(droppedRatio * 100).toFixed(1)}% ` +
        `(budget <${(DROPPED_RATIO_MAX * 100).toFixed(0)}%), longTasks=${longTasks}` +
        (consoleErrors.length ? `; page errors: ${consoleErrors.join(" | ")}` : ""),
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
