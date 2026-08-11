#!/bin/bash
# PreToolUse hook. Reads the proposed tool call from stdin as JSON.
# Exit code 2 blocks the action. Exit code 0 allows it.

input=$(cat)
command=$(echo "$input" | grep -o '"command"[^,}]*' | head -1)

# Block obviously destructive patterns. Extend this list as you find more.
if echo "$command" | grep -qE 'rm -rf /|git push --force|DROP TABLE|DROP DATABASE'; then
  echo "Blocked: this command matches a destructive pattern. Confirm manually if intended." >&2
  exit 2
fi

# Guard `rm` specifically. A careless one-liner — an rm chained to an unrelated
# "just checking" command, or an rm on a repo-relative path — once deleted a 19MB
# untracked file during a review (see
# .claude/agent-memory/reviewer/feedback_no_destructive_shell_chaining.md).
# First decide whether the command actually INVOKES rm: rm at the start of the
# command value, or right after a separator (; & |), a conjunction (&& ||), or a
# wrapper (sudo/xargs/time/env/exec) — not the letters "rm" sitting inside an
# argument such as a commit message. If it does, allow it ONLY when it is not
# chained to another command AND every target lives under /tmp (where the session
# scratchpad and throwaway files like /tmp/migration-check.db live).
is_rm=$(printf '%s' "$command" | grep -oiE '(:[[:space:]]*"|[;&|(]|&&|\|\||(^|[[:space:]])(sudo|xargs|time|env|exec)[[:space:]]+)[[:space:]]*rm[[:space:]]')
if [ -n "$is_rm" ]; then
  # (a) rm chained to another command via ;  &&  ||
  if printf '%s' "$command" | grep -qE ';|&&|\|\|'; then
    echo "Blocked: 'rm' is chained (;, && or ||) to another command. Run rm as its own isolated command. Confirm manually if intended." >&2
    exit 2
  fi
  # (b) rm targeting anything outside /tmp (the throwaway scratchpad area)
  after=$(printf '%s' "${command#*rm}" | tr -d '"')
  for tok in $after; do
    case "$tok" in
      -*) ;;         # flag, ignore
      /tmp/*) ;;     # under /tmp, allowed
      *)
        echo "Blocked: 'rm' target '$tok' is outside /tmp (the scratchpad area). Run rm in isolation on a scratchpad path, or confirm manually if intended." >&2
        exit 2
        ;;
    esac
  done
fi

exit 0
