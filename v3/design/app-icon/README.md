# Marblo App Icon — Redesign Concepts (v3.4)

Design-exploration stage for the Marblo desktop app icon. **Nothing here is
wired into the build yet** — `electron-builder.yml` still points at the current
`v3/resources/icon.{icns,png}`. Once a concept is chosen, run `build-icons.sh`
and copy the output over `v3/resources/` in a separate PR.

Open [`preview.html`](./preview.html) to compare all concepts side-by-side at
128 / 32 / 16 px.

## Brand continuity

All concepts reuse the current icon's identity so the update reads as a
refinement, not a rebrand:

- **Gradient** `#5A1DE7 → #7D2EB2` (electric indigo → magenta-purple), vertical
  — sampled from the existing `resources/icon.png`.
- **macOS squircle** silhouette (superellipse, `n=5`), full-bleed like today.
- White foreground, soft top sheen for the Big Sur convex look.

Product identity driving the marks: **a control plane for AI-native teams —
watching multiple agents work at once.**

## The three concepts

| #     | Name               | Concept                                                                              | Reads as                                                                        |
| ----- | ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **A** | **Agent Mesh**     | A central orchestrator hub wired to six agent nodes, three lit "active"              | Multi-agent orchestration / network — most literal to the "control plane" pitch |
| **B** | **Orbital Marble** | A glossy marble (the _Marblo_ pun) with agent dots orbiting it                       | Brand-clever name play + orchestration motif; warmest/most distinctive          |
| **C** | **Command Prompt** | A bold prompt chevron + cursor, with two ghost chevrons for parallel command streams | Developer-tool / terminal identity; sharpest at tiny sizes                      |

Legibility notes (from the 32 px render check): **C** and **B** stay crispest
when small; **A** is recognizable but its six nodes get slightly busy at 16 px.

## A2 hub revisions (chosen direction)

**A (Agent Mesh)** was picked as the base. These two revisions keep A's exact
mesh (6 nodes / 3 active, same links, same squircle + gradient) and only fuse
the central orchestrator hub with a brand glyph so it carries Marblo identity
instead of a plain dot:

| #        | Hub                       | Rationale                                                                                                                           |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **A2·M** | Marblo **"M"** glyph      | Brand gradient `#5A1DE7 → #7D2EB2` "M" on a white disc; peaks sit under the upper links so the wiring reads as springing from the M |
| **A2·▊** | Terminal **block cursor** | Character-cell white block on a soft halo — dev-tool / terminal identity at the hub                                                 |

Both render cleanly at 512 px with a distinct, on-brand center; at 16/32 px they
degrade like any 6-node mesh (the hub still reads as the central marker).

## A3 terminal-cursor revisions (current direction)

Feedback on **A2·▊**: the lone block didn't clearly read as a _terminal_ cursor,
and the purple wasn't mandatory. **A3** keeps A's exact mesh but rebuilds the hub
as a full CLI caret — a rounded **terminal-window panel** holding a **prompt
chevron `>`** and a **bold block cursor `▊`**, i.e. `> ▊`. It ships in four
palettes so the color can be chosen separately from the form:

| #               | Palette                              | Reads as                                        |
| --------------- | ------------------------------------ | ----------------------------------------------- |
| **A3·▊ purple** | brand `#5A1DE7 → #7D2EB2`, white fg  | on-brand baseline, kept for comparison          |
| **A3·▊ teal**   | `#16C7B5 → #0C6E7A`, white fg        | teal/cyan — closest to a dev-tool / terminal    |
| **A3·▊ ink**    | `#0B0F17 → #1B2233` + neon `#3DF5A0` | dark terminal theme — strongest "terminal" read |
| **A3·▊ warm**   | `#FBBF24 → #F97316`, white fg        | warm amber/orange contrast option               |

The prompt is the hero; the 6-way agent wiring is preserved. `>` + block reads
as a terminal at 128 px+; **ink** is the most unmistakably terminal at a glance.

## A4 agent-fleet marks (current direction)

Feedback on **A3**: keep the terminal caret and the loved **ink** / **warm**
palettes, but make it read as _agents_. **A4** color-codes the active mesh nodes
to the real fleet — matching the orchestrator demo legend — and colors each
routing link to match, so the mark reads as **one orchestrator (`> ▊`) routing
several different agents at once**. Idle nodes stay dim (waiting agents).

| Fleet node  | Color           |
| ----------- | --------------- |
| Claude      | amber `#FFB020` |
| GPT · Codex | cyan `#29C7F0`  |
| Antigravity | green `#3DE07A` |

Active nodes get a soft colored glow + white lit core ("screen on"); a thin dark
ring delineates them (invisible on ink, separates the amber node on warm).

| #                    | Base                             | Notes                                                        |
| -------------------- | -------------------------------- | ------------------------------------------------------------ |
| **A4 ink · agents**  | ink `#0B0F17 → #1B2233`          | main candidate — neon fleet on dark terminal; 3 agents lit   |
| **A4 warm · agents** | amber `#FBBF24 → #F97316`        | comparison — warm base (amber Claude node is lower-contrast) |
| **A4 ink · 2-agent** | ink, 2 large agents (amber/cyan) | small-size legibility variant — cleanest at 16 px            |

Verified at 512 / 64 / 32 / 16 px: the fleet colors stay distinguishable down to
16 px on ink (the 2-agent variant is the safest tiny-size read).

## Files

- `concept-a.svg`, `concept-b.svg`, `concept-c.svg` — 1024×1024 base vector marks
- `concept-a2-m.svg`, `concept-a2-cursor.svg` — A2 hub revisions on the mesh base
- `concept-a3-cursor-{purple,teal,ink,warm}.svg` — A3 terminal-cursor palettes
- `concept-a4-{ink-agents,warm-agents,ink-2agents}.svg` — A4 agent-fleet marks
- `preview.html` — side-by-side comparison board (multi-size)
- `generate.py` — regenerates the SVGs + preview (edits go here, not the SVGs)
- `build-icons.sh` — converts a chosen SVG → `icon.png` / `icon.icns` / `icon.ico`

## SVG → PNG / icns / ico procedure

```bash
# 1. Tooling (one-time)
brew install librsvg imagemagick   # iconutil ships with Xcode CLT

# 2. Build the full set from the chosen concept
./build-icons.sh concept-b.svg     # → out/icon.{png,icns,ico}

# 3. Adopt (separate PR, not this one)
cp out/icon.png  ../../resources/icon.png
cp out/icon.icns ../../resources/icon.icns
cp out/icon.ico  ../../resources/icon.ico   # optional — see note below
# then rebuild:  cd v3 && npm run dev   (or a signed release build)
```

What the script does:

1. **1024 PNG** — `rsvg-convert` rasterizes the SVG.
2. **`.icns`** — builds a `.iconset` (16→512 @1x/@2x) and runs `iconutil -c icns`.
3. **`.ico`** — packs a **multi-size ico with a 256 px frame** via ImageMagick.

### ⚠ The `.ico` 256 px requirement

electron-builder's `nsis` target rejects any `.ico` whose largest frame is
< 256 px (`ERR_ICON_TOO_SMALL`). The current `resources/icon.ico` is only
16×16, which is exactly why `electron-builder.yml` sets `win.icon: resources/icon.png` — electron-builder derives a correct multi-size ico from a
≥256 PNG at build time. Two valid options after choosing a concept:

- **Keep it simple:** only replace `icon.png` (+ `icon.icns` for mac) and let
  electron-builder keep generating the Windows ico from the PNG. No yml change.
- **Ship an explicit ico:** use `build-icons.sh`'s ≥256 `icon.ico` and switch
  `win.icon` to `resources/icon.ico`. Only do this with ImageMagick installed.
