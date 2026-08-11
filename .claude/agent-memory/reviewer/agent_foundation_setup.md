---
name: agent-foundation-setup
description: First review of the .claude/agents + hooks + CLAUDE.md foundation commit — reviewed and passed 2026-07-16
metadata:
  type: project
---

Reviewed the initial explorer/planner/executor/reviewer agent-foundation setup (four
files in [[.claude/agents]], [[.claude/hooks/block-dangerous.sh]], [[.claude/settings.json]],
filled-in [[CLAUDE.md]], [[MEMORY-INDEX.md]]) on 2026-07-16. Passed — every plan step done,
paths resolve, hook is executable and functionally blocks `rm -rf /` / `git push --force` /
`DROP TABLE|DATABASE` while passing benign commands, CLAUDE.md claims verified against actual
package.json/prisma schema.

**Why noted:** first pass over this repo's memory scaffolding, worth recording the layout so
future reviews don't re-derive it.

**How to apply:** `.claude/agent-memory/{planner,reviewer}/` are the memory dirs; only
planner.md and reviewer.md carry `memory: project` frontmatter (explorer/executor don't).
`.claude/settings.local.json` is a separate, pre-existing *tracked* file (from the
2026-06-24 baseline commit) holding ad-hoc `permissions.allow` entries — it's unrelated to
new hook/agent work and easy to mistake for an untracked stray file at a glance; check
`git log -- <path>` before flagging it. MEMORY-INDEX.md links to planner/reviewer MEMORY.md
files that don't exist until an agent first writes one — that's expected, not a broken link.
