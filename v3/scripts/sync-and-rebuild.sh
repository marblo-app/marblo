#!/usr/bin/env bash
#
# sync-and-rebuild.sh — one-shot "pull merged work into the running marblo".
#
# WHY THIS EXISTS
# ---------------
# `gh pr merge` only advances origin/main. The local checkout that the running
# Electron app builds from does NOT move — so after a merge the app keeps running
# stale code. In one session this drift reached 21 commits behind: every merged
# change was silently absent from the running app until someone noticed.
#
# This script collapses the whole catch-up into a single command:
#
#     pull  →  (npm ci only if the lockfile moved)  →  build:mcp  →  renderer
#
# It is SAFE BY DEFAULT: it never throws away local work. If you have uncommitted
# changes it stops and tells you to handle them yourself — no auto-stash, no
# reset --hard, no clean.
#
# USAGE
# -----
#   bash v3/scripts/sync-and-rebuild.sh            # dev mode (default): renderer hot-reloads via Vite HMR
#   bash v3/scripts/sync-and-rebuild.sh --build    # production path: run the full renderer build (npm run build)
#   npm --prefix v3 run sync                       # same as the dev-mode form, via package.json
#
# Renderer mode can also be set with the env var:  SYNC_RENDERER=build bash v3/scripts/sync-and-rebuild.sh
#
# It can be invoked from ANY directory — it locates the v3 build target relative
# to its own path, so the v3 build is always what gets rebuilt.
#
set -euo pipefail

# --- locate paths -----------------------------------------------------------
# V3_DIR = the v3/ folder (this script lives in v3/scripts/). REPO_ROOT = git toplevel.
V3_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$V3_DIR" rev-parse --show-toplevel)"

# --- renderer mode ----------------------------------------------------------
RENDERER_MODE="${SYNC_RENDERER:-dev}"
for arg in "$@"; do
  case "$arg" in
    --build|-b) RENDERER_MODE="build" ;;
    --dev|-d)   RENDERER_MODE="dev" ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "⚠️  unknown argument: $arg (use --build, --dev, or --help)" >&2; exit 2 ;;
  esac
done

echo "🔄 sync-and-rebuild"
echo "   repo:     $REPO_ROOT"
echo "   v3 build: $V3_DIR"
echo "   renderer: $RENDERER_MODE"
echo

# --- 1. refuse to run on a dirty tree (never destroy local work) ------------
echo "▶ [1/5] checking working tree…"
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  echo "❌ uncommitted changes detected — aborting to protect your work." >&2
  echo "   This script does NOT auto-stash / reset / clean. Handle it yourself:" >&2
  echo "     • commit:  git add -p && git commit" >&2
  echo "     • shelve:  git stash push -m 'wip before sync'   (restore: git stash pop)" >&2
  echo "   Then re-run this script." >&2
  git -C "$REPO_ROOT" status --short >&2
  exit 1
fi
echo "  ✓ clean"

# --- 2. fast-forward pull (current branch only, no merge commits) -----------
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "▶ [2/5] pulling origin/$BRANCH (fast-forward only)…"
if [[ "$BRANCH" != "main" ]]; then
  echo "  ⚠️  on branch '$BRANCH' (not main) — pulling its upstream. Merged work usually lands on main."
fi

# Record lockfile fingerprint before the pull so we know if deps changed.
LOCK="$V3_DIR/package-lock.json"
lock_hash() { [[ -f "$LOCK" ]] && git -C "$REPO_ROOT" hash-object "$LOCK" || echo "absent"; }
LOCK_BEFORE="$(lock_hash)"

BEFORE_REV="$(git -C "$REPO_ROOT" rev-parse HEAD)"
git -C "$REPO_ROOT" pull --ff-only origin "$BRANCH"
AFTER_REV="$(git -C "$REPO_ROOT" rev-parse HEAD)"

if [[ "$BEFORE_REV" == "$AFTER_REV" ]]; then
  echo "  ✓ already up to date ($AFTER_REV)"
else
  echo "  ✓ $BEFORE_REV → $AFTER_REV"
  git -C "$REPO_ROOT" --no-pager log --oneline "$BEFORE_REV..$AFTER_REV" | sed 's/^/      /'
fi

# --- 3. npm ci only when the lockfile actually changed ----------------------
echo "▶ [3/5] dependencies…"
LOCK_AFTER="$(lock_hash)"
if [[ "$LOCK_BEFORE" != "$LOCK_AFTER" ]]; then
  echo "  • package-lock.json changed → running npm ci"
  ( cd "$V3_DIR" && npm ci )
  echo "  ✓ deps reinstalled"
else
  echo "  ✓ lockfile unchanged → skipping npm ci"
fi

# --- 4. rebuild the MCP server (always — cheap, and stale dist-mcp bites) ----
echo "▶ [4/5] building MCP server (npm run build:mcp)…"
( cd "$V3_DIR" && npm run build:mcp )
echo "  ✓ dist-mcp rebuilt"

# --- 5. renderer ------------------------------------------------------------
echo "▶ [5/5] renderer ($RENDERER_MODE)…"
if [[ "$RENDERER_MODE" == "build" ]]; then
  echo "  • running full build (electron tsc + vite build)…"
  ( cd "$V3_DIR" && npm run build )
  echo "  ✓ renderer + electron-main compiled (dist/, dist-electron/)"
else
  echo "  ✓ dev mode: the running 'npm run dev' Vite server hot-reloads renderer (React/UI) changes automatically — no rebuild needed."
fi

echo
echo "✅ sync-and-rebuild complete."
echo
echo "⚠️  RESTART REQUIRED for changes outside the renderer:"
echo "    • electron-main (electron/ → dist-electron) and the MCP server (dist-mcp)"
echo "      do NOT hot-reload. Quit and relaunch the app (or restart 'npm run dev')"
echo "      so the new main process + freshly spawned MCP servers are picked up."
echo
echo "🔍 Verify the update actually landed in the running app:"
echo "    • File tree / open files in the app should reflect the new commits."
echo "    • In an agent terminal:   get_task <agent-id>   → confirms latest task projection."
echo "    • Reap stale worktrees:   npm --prefix \"$V3_DIR\" run worktree:reap"
echo "    • Move finished tickets TODO → DONE on the board once reflected."
echo "    • Sanity-check HEAD:      git -C \"$REPO_ROOT\" log --oneline -3"
