#!/usr/bin/env -S npx tsx
// CLI entrypoint (spec §2). Usage:
//   orchestrate build <job.yaml>
// or during development:
//   npm run orchestrate -- build jobs/liquid-glass-auth.yaml

import { run } from "./orchestrator.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const jobPath = argv.find((a, i) => i > 0 && !a.startsWith("--"));
  const seedBreak = argv.includes("--seed-break");

  if (cmd !== "build" || !jobPath) {
    console.error("usage: orchestrate build <job.yaml> [--seed-break]");
    process.exit(2);
  }

  try {
    await run(jobPath, { seedBreak });
  } catch (err) {
    console.error(`\n❌ orchestrator error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
