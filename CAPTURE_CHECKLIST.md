# Showcase capture checklist (post-draft)

Public README assets must use **fictional demo data only**. See `marblo-web/docs/DEMO-SCREENSHOT-GUIDE.md`.

## Already shipped (safe)

| File | Source | Notes |
| --- | --- | --- |
| `assets/icon.png` | v3 app icon 128px | Brand mark |
| `assets/hero.png` | `hero-wider.png` (landing crop) | Marketing hero + clean board mock |
| `assets/board.png` | `marblo-web/public/images/product-demo.png` | Demo SaaS backlog, no real PII |
| `assets/orchestration.png` | `orchestration-demo.webp` → PNG | Parallel fleet diagram |
| `assets/live-decompose.png` | sample demo frame 1 | Mission → tickets |
| `assets/live-complete.png` | sample demo frame 2 | Complete + CTA |

## Removed (do not restore)

| Former file | Why |
| --- | --- |
| previous `hero.png` / `workspace.png` | Real app capture: `John Kim`, `/Users/dongwonkim/...`, internal ticket titles, `gh` device code |

## Still needed (Electron app, staged demo project)

Capture at ~16:9 (2560×1440 preferred). Stage per DEMO-SCREENSHOT-GUIDE (Alex Rivera / Demo Workspace, fictional tickets).

| Shot | Tab | Must show | Suggested path |
| --- | --- | --- | --- |
| A | **Agents** | Live PTY, model badge, stdin follow-up box | `assets/tab-agents.png` (+ optional short GIF) |
| B | **Code** | Diff across a worktree, no real secrets | `assets/tab-code.png` |
| C | **Worktrees** | Ticket ↔ branch list, 2+ parallel trees | `assets/tab-worktrees.png` |
| D | **Usage** | Cost by agent/model/day, demo numbers | `assets/tab-usage.png` |
| E | **Harness** | Skills / MCP table, no real API keys | `assets/tab-harness.png` |
| F | **History** | Ledger of merge/cost events (demo) | `assets/tab-history.png` |
| G | **Missions** | Mission create + decomposed tree | `assets/tab-missions.png` |

Optional GIFs (≤ ~5s, no PII): decompose → claim → IN_PROGRESS; merge confirm.

## Pre-publish scan

```bash
# Fail if real paths / names / tokens appear in image binaries
for f in assets/*; do
  strings "$f" | grep -iE 'John.?Kim|/Users/dongwonkim|FB1B-|sk-|ghp_|AIza' && echo "LEAK $f"
done
```

## Owner actions

1. Review README copy on the PR (language = **English** for public showcase).
2. Approve or request capture A–G.
3. After approval: merge PR into `marblo-app/marblo` (maintainer push).
