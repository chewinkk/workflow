@AGENTS.md

# Project: Backdrop

## What this is
A Next.js app for clothing resellers: AI-generated product photos and listing
copy, cross-platform listing/sales sync (eBay, Depop via a browser extension),
pricing intelligence, and Stripe billing. Prisma over SQLite (libSQL driver
adapter), Auth.js credentials login.

## Build and run
```
npm install          # postinstall runs prisma generate
npm run dev          # predev runs prisma generate && prisma db push first
npm run build
npm run build:extension   # compiles the browser extension (extension/)
```

Database setup on a fresh checkout: `npm run db:setup` (generate + db push +
seed admin). Default admin: `admin@backdrop.local` / `admin12345`.

## Test and lint
```
npm run test                          # vitest run (all tests)
npx vitest run lib/listings.test.ts   # single test file
npm run lint                          # eslint (whole repo; carries legacy debt — see Verification)
npx tsc --noEmit                      # typecheck, strict mode; must stay clean
```

## Conventions
- Language and version: TypeScript, strict mode, `@/*` path alias to repo root.
- Style: no semicolons, double quotes, named exports (no default exports in
  lib/). Match the comment density of neighboring code — lib files open with a
  short block comment explaining what the module is for.
- File layout: `app/` Next.js App Router (routes, `app/actions/`, `app/api/`);
  `lib/` framework-free domain logic with colocated `*.test.ts`; `components/`
  React components grouped by feature; `extension/` browser extension;
  `prisma/` schema; `scripts/` operational scripts; `test/` cross-cutting tests.
- Tests: colocated next to the module (`lib/foo.ts` + `lib/foo.test.ts`).
  Unit tests must never hit the network; integration tests opt in explicitly.
- Commit format: plain imperative sentence describing the change, no
  conventional-commit prefixes (e.g. "Fix partial Depop syncs, frozen
  placeholder titles/descriptions, and the Sold quickest sort").

## Known gotchas
- This Next.js version has breaking changes vs. training data. Read the
  relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Use `prisma db push` for local iteration, not `prisma migrate deploy` — but
  `db push` is NOT the source of truth on Railway, despite what this file used
  to claim. Railway's deploy (`railway.json`'s `startCommand`) runs
  `scripts/migrate-deploy-safe.ts`, which only applies committed migration
  FILES under `prisma/migrations/`; it never runs `db push` itself. Any
  `schema.prisma` change made locally via `db push` needs a matching migration
  file too, hand-authored to match the existing files' format, or it silently
  never reaches production (this already happened once — a `wallpaperPalette`
  column added via `db push` with no migration file crashed every dashboard
  page in prod, since `app/generated/prisma` expected a column the live table
  didn't have). Before merging a schema change, verify the migration is real
  by applying the full migration history to a FRESH database (not `dev.db`,
  which already has the column from your own local `db push`) and confirming
  it succeeds cleanly:
  ```
  rm -f /tmp/migration-check.db
  DATABASE_URL="file:/tmp/migration-check.db" npx tsx scripts/migrate-deploy-safe.ts
  ```
- The libSQL adapter silently creates an empty `dev.db` on first connect. If
  queries fail with `SQLITE_ERROR: no such table`, the schema was never
  applied — run `npm run db:setup`.
- The Prisma client is generated into `app/generated/prisma`, not
  `node_modules/@prisma/client`.

## Graphify code graph
This project uses Graphify to build a structural graph of the codebase so the
explorer agent can answer structure questions from a prebuilt map instead of
re-reading files. Outputs live in `graphify-out/` (`graph.json`, `graph.html`,
`GRAPH_REPORT.md`). Rebuild after a batch of changes — it takes two commands:

```
graphify . --code-only            # rebuild graph.json (local AST, no API key)
graphify cluster-only .            # regenerate GRAPH_REPORT.md and graph.html
```

`--code-only` skips the doc/image semantic pass, which needs an LLM API key;
the code graph itself needs none. (Install: `pip install graphifyy` — double y —
then `graphify install`.)

## Workflow rule
For any task touching more than 3 files, or any refactor, or anything you are
not fully sure how to approach:

1. Invoke the explorer agent first to map the relevant files.
2. Invoke the planner agent with that output. It writes a plan and STOPS.
3. Read the plan. Approve it or send it back with corrections.
4. Only after approval, invoke the executor agent to make changes.
5. Invoke the reviewer agent before you consider the task done.

Do not jump straight to editing files on anything nontrivial. The plan review
step is where most wasted fix cycles get caught before they happen.

One PR fixes one issue. Never open a PR titled "fix N issues" or "revamp." If
a brief lists 23 issues, that is 23 PRs (or 23 commits on one branch), each
independently reviewable and revertable. A PR that touches a schema file may
change **only** that schema concern. Hard cap: if a single PR exceeds ~15
non-generated files, stop and split it.

If two consecutive commits re-do the same file/surface, stop. Do not attempt a
third — the requirement is unsettled; get it specified before touching code
again. Cap a working session at ~2 hours or ~5 merged PRs, whichever comes
first; past that, start a fresh session. A revert within 24h of a merge is a
signal the change skipped the plan/review step — treat it as a process
failure, not a normal commit.

## Verification

After **every** change, before moving to the next one, run `npx tsc --noEmit`
and `npm run test`, and lint the files you touched (`npx eslint <changed
files>`). Do not batch verification to the end of a multi-part task. The repo
carries known legacy lint debt, so lint only what you changed and leave it
clean — do not run `npm run lint` across the whole tree as a gate. For any
change under `prisma/schema.prisma`, additionally run the fresh-DB migration
check already documented in "Known gotchas" **and** `npx prisma migrate diff
--from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`
— a green `npm run test` does **not** cover schema/migration drift.

## Scope

Every task states its allowed file set before editing. Touch nothing outside
it — not `MEMORY.md`, not a stray file in the repo root, not "while I'm here"
cleanups. `rm` is never allowed on a file that is not the explicit subject of
an approved change. To check existence use `test -e`/`ls` alone, never chained
with `rm`.

## Definition of done

A task is complete only when `ci.yml` is green on its PR. "GitHub says
mergeable" is not done. Never merge a PR whose CI has not passed, and never
treat a squash-merge as proof the tests ran.
