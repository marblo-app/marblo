#!/usr/bin/env bash
#
# Regenerate package-lock.json with the FULL cross-platform optional dependency
# tree — including the win32-only electron-builder-squirrel-windows subtree
# (archiver / archiver-utils / compress-commons / crc32-stream / zip-stream / …).
#
# WHY THIS EXISTS
# ---------------
# Running a plain `npm install` on macOS prunes the win32 optional subtree from
# the lockfile (those packages are not needed to *install* on macOS). The pruned
# lock then fails `npm ci` on the Linux CI runner with:
#
#     npm error Missing: archiver-utils@... from lock file
#     npm error Missing: compress-commons@... from lock file   (EUSAGE)
#
# which keeps .github/workflows/build.yml permanently red. The lockfile is meant
# to be a complete, cross-platform tree, so the fix is to regenerate it on Linux
# (or in a Linux container) where npm keeps the win32 subtree.
#
# WHEN TO RUN
# -----------
# After ANY dependency change (adding/removing/bumping a package). Run this
# instead of committing the lockfile that a macOS `npm install` produced.
#
#   npm run relock        # convenience wrapper
#   bash scripts/relock.sh
#
# It only rewrites the lockfile (`--package-lock-only`), runs no install scripts,
# and downloads nothing into node_modules. Requires Docker on non-Linux hosts.
#
set -euo pipefail

cd "$(dirname "$0")/.."

run_relock() {
  npm install --package-lock-only --include=optional --ignore-scripts --no-audit --no-fund
}

if [[ "$(uname -s)" == "Linux" ]]; then
  run_relock
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "relock: Docker is required on $(uname -s) to generate a Linux-correct lockfile." >&2
    echo "        Install Docker, or run 'npm install --package-lock-only --include=optional' on a Linux machine." >&2
    exit 1
  fi
  echo "relock: regenerating package-lock.json inside node:20-slim (Linux)…"
  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "$PWD:/app" -w /app \
    -e HOME=/tmp -e NPM_CONFIG_CACHE=/tmp/.npm \
    node:20-slim \
    sh -c "npm install --package-lock-only --include=optional --ignore-scripts --no-audit --no-fund"
fi

# Sanity check: the win32 subtree must be present, or the lock is still pruned.
if ! grep -q '"node_modules/electron-builder-squirrel-windows"' package-lock.json; then
  echo "relock: FAILED — electron-builder-squirrel-windows still missing from lockfile." >&2
  exit 1
fi
echo "relock: OK — win32 optional subtree present in package-lock.json."
