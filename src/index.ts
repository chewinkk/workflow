#!/usr/bin/env -S npx tsx
// CLI entrypoint (spec §2). Usage:
//   orchestrate build <job.yaml>
// or during development:
//   npm run orchestrate -- build jobs/liquid-glass-auth.yaml

import { run } from "./orchestrator.js";

async function main(): Promise<void> {
  const [cmd, jobPath] = process.argv.slice(2);

  if (cmd !== "build" || !jobPath) {
    console.error("usage: orchestrate build <job.yaml>");
    process.exit(2);
  }

  try {
    await run(jobPath);
  } catch (err) {
    console.error(`\n❌ orchestrator error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
