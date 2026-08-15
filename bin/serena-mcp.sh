#!/usr/bin/env bash
# Launch the Serena MCP server that backs the orchestrator's shared store.
#
# Requirement (Step 6): runs must NOT depend on `uvx` fetching serena-agent from
# PyPI at runtime. In the Railway image Serena is BAKED at build time (pinned)
# and lands on PATH as `serena`, so this wrapper uses it directly — no network.
# Locally (dev), it falls back to a PINNED uvx so behavior matches without a
# separate install and without version drift.
#
# The project path is resolved from $PWD (the orchestrator spawns each agent with
# cwd = repo root, which Serena inherits), so this works at /home/user/workflow
# locally and at /app in the image with no hardcoded path.
set -euo pipefail

SERENA_VERSION="1.7.0"
PROJECT="${SERENA_PROJECT:-$PWD}"

if command -v serena >/dev/null 2>&1; then
  exec serena start-mcp-server --project "$PROJECT" "$@"
fi

# Dev fallback only (pinned — never floats to a newer release).
exec uvx --from "serena-agent==${SERENA_VERSION}" serena start-mcp-server --project "$PROJECT" "$@"
