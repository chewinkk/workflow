#!/bin/bash
# Container entrypoint for the Railway dev box (BUILD_PLAN.md §7).
# Only job: get a working clone of backdrop onto the persistent volume, then
# run its dev server on Railway's port. Claude Code itself is NOT started
# here — it's installed in the image; you run it yourself from Railway's
# Console/SSH, in a separate exec session into this same container.
set -e

REPO_DIR="${REPO_DIR:-/data/backdrop}"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "[start] GITHUB_TOKEN is not set — cannot clone the private chewinkk/backdrop repo." >&2
  exit 1
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[start] cloning chewinkk/backdrop into $REPO_DIR"
  git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/chewinkk/backdrop.git" "$REPO_DIR"
else
  echo "[start] $REPO_DIR already has a clone — leaving it as-is (may have uncommitted work from a previous session)"
fi

cd "$REPO_DIR"
npm install

exec npm run dev -- -H 0.0.0.0 -p "$PORT"
