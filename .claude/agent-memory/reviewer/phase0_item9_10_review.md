---
name: phase0-item9-10-review
description: Review outcome for Backdrop Phase 0 items 9 (sale-price display) & 10 (select-toggle hover overlap fix)
metadata:
  type: project
---

Reviewed 2026-07-19: items 9 & 10 (sale price on listing card via `salePrice: l.sales[0]?.salePrice ?? null`
in app/api/listings/route.ts, and the `group`/`group-hover:opacity` toggle-visibility fix in
app/(dashboard)/listings/page.tsx) both matched their described diffs exactly. Verified the Prisma
`Listing.sales: Sale[]` relation and `Sale.salePrice: Float` actually exist in prisma/schema.prisma
before trusting the `include` compiled — `npx tsc --noEmit` confirmed clean. `npx vitest run lib/utils.test.ts`
green. Verdict: PASS, no defects, no edits made.

**Why this is worth keeping:** reinforces [[phase0_quickwins_review]]'s per-item verification pattern —
specifically, for any Prisma `include`/`select` change, grep the schema for the referenced relation/field
by name before trusting tsc alone (tsc catches it too, but confirming schema-side first localizes failures
faster). Also: when a diff touches only one file's price-display logic, explicitly diff-grep for the
placeholder string (here "—") across the whole file to confirm no *other* instance was touched by mistake —
cheap check, catches accidental scope creep.
