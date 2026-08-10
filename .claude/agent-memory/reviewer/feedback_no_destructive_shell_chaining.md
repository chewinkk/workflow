---
name: no-destructive-shell-chaining
description: Never write a single bash command that mixes a destructive op (rm) with an unrelated check, even as a "just in case" no-op
metadata:
  type: feedback
---

Do not write shell commands like `rm -f <path> 2>/dev/null; echo "not removing, just checking"; ls -la <path>`
where the intent (checking existence) contradicts an earlier destructive command (rm) in the same chain.
The rm executes regardless of the trailing comment/echo — semicolon-chained commands don't "cancel" each
other. This actually deleted an untracked, unrelated 19MB file (`fixes.pages`) in the Backdrop repo root
during a review pass on 2026-07-19 that had nothing to do with the diff being reviewed.

**Why:** as a reviewer I must never edit/delete files outside the scope of confirming a defect — reviewing
should be read-only except for a minimal, clearly-flagged fix. A careless one-liner briefly destroyed
user data (recovered only because it was accidentally caught by an earlier unrelated `git stash -u` /
`git stash pop` I'd run minutes before, whose dangling stash commit was still in `.git` and hadn't been
GC'd — `git fsck` found it, `git show <blob>:<path>` restored it). That recovery path is NOT reliable —
it depended on a lucky prior stash and no intervening `git gc`.

**How to apply:** Never run `rm`/destructive commands on files that aren't the explicit subject of an
approved fix. To check if a file exists, use `ls`/`test -e` alone — never combine with `rm` in the same
command "for safety" or as leftover scaffolding from a different draft of the command. If a destructive
command IS warranted (rare, e.g. user explicitly asks to delete a stray file), run it as its own isolated,
clearly-labeled command, never bundled with other checks.
