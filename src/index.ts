#!/usr/bin/env -S npx tsx
// CLI entrypoint (spec §2). Usage:
//   orchestrate build   <job.yaml>   # plan the job: explore → plan → council (writes `plan`)
//   orchestrate execute <job.yaml>   # BUILD an existing plan: fanout → reconcile → verify
// or during development:
//   npm run orchestrate -- build   jobs/liquid-glass-auth.yaml
//   npm run orchestrate -- execute jobs/liquid-glass-auth.yaml
//
// `execute` consumes the `plan` slice already in the store (it does NOT re-plan);
// run it in the working directory whose .serena/memories holds that plan.

import { run, execute } from "./orchestrator.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const jobPath = argv.find((a, i) => i > 0 && !a.startsWith("--"));
  const seedBreak = argv.includes("--seed-break");
  const forceDivergence = argv.includes("--diverge");

  if ((cmd !== "build" && cmd !== "execute") || !jobPath) {
    console.error(
      "usage:\n" +
        "  orchestrate build   <job.yaml> [--seed-break] [--diverge]   (plan the job)\n" +
        "  orchestrate execute <job.yaml>                              (build an existing plan)"
    );
    process.exit(2);
  }

  try {
    if (cmd === "execute") {
      await execute(jobPath, { seedBreak, forceDivergence });
    } else {
      await run(jobPath, { seedBreak, forceDivergence });
    }
  } catch (err) {
    console.error(`\n❌ orchestrator error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
