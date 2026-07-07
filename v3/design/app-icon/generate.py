#!/usr/bin/env python3
"""Generate Marblo app-icon concept SVGs (1024x1024) + comparison preview.

All three concepts share the same macOS-style squircle silhouette and the
brand gradient sampled from the current icon (#5A1DE7 -> #7D2EB2) so they read
as one family. Run:  python3 generate.py

Design-only. Nothing here is wired into electron-builder.yml yet — see
README.md for the SVG -> PNG/icns/ico conversion procedure once a concept is
chosen.
"""
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# --- Brand ---------------------------------------------------------------
TOP = "#5A1DE7"   # electric indigo (icon top, sampled)
BOT = "#7D2EB2"   # magenta-purple (icon bottom, sampled)


def squircle_path(size=1024.0, n=5.0, steps=192):
    """Apple-style superellipse (squircle) filling the full artboard."""
    c = size / 2.0
    r = size / 2.0
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = c + r * math.copysign(abs(ct) ** (2.0 / n), ct)
        y = c + r * math.copysign(abs(st) ** (2.0 / n), st)
        pts.append((x, y))
    d = "M %.2f %.2f " % pts[0]
    d += " ".join("L %.2f %.2f" % (x, y) for x, y in pts[1:])
    return d + " Z"


SQ = squircle_path()


def base_defs(idx, top=TOP, bot=BOT):
    """Shared background gradient + top sheen + soft glow filter.

    ``top``/``bot`` override the vertical background gradient so the same
    silhouette can ship in alternate palettes (teal, ink, warm)."""
    return f"""
    <linearGradient id="bg{idx}" x1="0" y1="0" x2="0" y2="1024"
                    gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="{top}"/>
      <stop offset="1" stop-color="{bot}"/>
    </linearGradient>
    <radialGradient id="sheen{idx}" cx="512" cy="300" r="720"
                    gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="clip{idx}"><path d="{SQ}"/></clipPath>
    <filter id="glow{idx}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="14" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>"""


def frame(idx, foreground, top=TOP, bot=BOT):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"
     width="1024" height="1024" role="img">
  <defs>{base_defs(idx, top, bot)}</defs>
  <path d="{SQ}" fill="url(#bg{idx})"/>
  <path d="{SQ}" fill="url(#sheen{idx})"/>
  <g clip-path="url(#clip{idx})">
{foreground}
  </g>
</svg>
"""


# --- Concept A: Agent Mesh ----------------------------------------------
# A central orchestrator hub wired to six agent nodes. The control plane
# watching agents work in parallel; some nodes lit "active".
def mesh_a(idx, fg="#ffffff"):
    """Shared 6-node / 3-active agent mesh (links + satellites) for the A
    family. Returns (cx, cy, links_svg, sats_svg) so hub variants can drop a
    different center glyph on top of the identical mesh.

    ``fg`` recolors the foreground (links + nodes) — white on the light
    palettes, a neon accent on the dark ``ink`` theme."""
    cx = cy = 512.0
    R = 292.0
    nodes = []
    for k in range(6):
        ang = math.radians(-90 + k * 60)
        nodes.append((cx + R * math.cos(ang), cy + R * math.sin(ang)))
    active = {0, 1, 4}  # lit agents

    links = "\n".join(
        f'    <line x1="{cx}" y1="{cy}" x2="{x:.1f}" y2="{y:.1f}" '
        f'stroke="{fg}" stroke-opacity="0.32" stroke-width="11" '
        f'stroke-linecap="round"/>'
        for (x, y) in nodes
    )
    sats = []
    for i, (x, y) in enumerate(nodes):
        if i in active:
            sats.append(
                f'    <circle cx="{x:.1f}" cy="{y:.1f}" r="60" fill="{fg}" '
                f'fill-opacity="0.22" filter="url(#glow{idx})"/>'
                f'\n    <circle cx="{x:.1f}" cy="{y:.1f}" r="46" fill="{fg}"/>'
            )
        else:
            sats.append(
                f'    <circle cx="{x:.1f}" cy="{y:.1f}" r="42" fill="{fg}" '
                f'fill-opacity="0.72"/>'
            )
    sats = "\n".join(sats)
    return cx, cy, links, sats


def concept_a():
    cx, cy, links, sats = mesh_a("A")
    hub = (
        f'    <circle cx="{cx}" cy="{cy}" r="104" fill="#ffffff" '
        f'fill-opacity="0.16"/>\n'
        f'    <circle cx="{cx}" cy="{cy}" r="86" fill="#ffffff"/>\n'
        f'    <circle cx="{cx}" cy="{cy}" r="30" fill="url(#bgA)"/>'
    )
    return frame("A", f"{links}\n{sats}\n{hub}")


# --- Concept A2-M: Agent Mesh, Marblo "M" hub ---------------------------
# Same mesh, but the orchestrator hub becomes the Marblo "M" glyph rendered
# in the brand gradient on a white disc. The M's two peaks sit under the
# upper links so the wiring reads as springing from the peaks.
def concept_a2_m():
    cx, cy, links, sats = mesh_a("A2M")
    # M drawn as a bold stroked glyph; peaks up, valley on center.
    m_path = "M 450 570 L 450 452 L 512 522 L 574 452 L 574 570"
    hub = (
        f'    <circle cx="{cx}" cy="{cy}" r="122" fill="#ffffff" '
        f'fill-opacity="0.16"/>\n'
        f'    <circle cx="{cx}" cy="{cy}" r="102" fill="#ffffff"/>\n'
        f'    <path d="{m_path}" fill="none" stroke="url(#bgA2M)" '
        f'stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>'
    )
    return frame("A2M", f"{links}\n{sats}\n{hub}")


# --- Concept A2-Cursor: Agent Mesh, terminal block-cursor hub -----------
# Same mesh, but the orchestrator hub becomes a terminal block cursor (the
# filled caret dev-tool identity) floating on a soft halo. Six-way wiring
# emanates from beneath the block.
def concept_a2_cursor():
    cx, cy, links, sats = mesh_a("A2C")
    # Block cursor: character-cell proportions (taller than wide), centered.
    w, h = 96.0, 148.0
    x = cx - w / 2.0
    y = cy - h / 2.0
    hub = (
        f'    <circle cx="{cx}" cy="{cy}" r="122" fill="#ffffff" '
        f'fill-opacity="0.16"/>\n'
        f'    <rect x="{x:.1f}" y="{y:.1f}" width="{w:.0f}" height="{h:.0f}" '
        f'rx="20" fill="#ffffff"/>'
    )
    return frame("A2C", f"{links}\n{sats}\n{hub}")


# --- Concept A3-Cursor: terminal prompt hub (palette-tunable) -----------
# Feedback on A2·▊: the lone block didn't read as a *terminal* cursor, and
# the purple wasn't mandatory. A3 answers both:
#   • Hub = a rounded "terminal window" panel holding a prompt chevron ">"
#     and a bold block cursor "▊" — i.e. `> ▊`, the unmistakable CLI caret.
#   • `top`/`bot`/`fg` are palette knobs so the same mark ships in brand
#     purple, teal/cyan, dark ink + neon, and warm amber for comparison.
# The 6-way agent wiring is preserved; the prompt is the hero.
def terminal_hub(fg):
    """The `> ▊` CLI caret hub: a rounded terminal-window panel holding a
    prompt chevron and a bold block cursor. Shared by A3 and A4 so the
    orchestrator glyph stays identical across revisions."""
    # Terminal window panel (subtle, defines the "shell" the caret lives in).
    wx, wy, ww, wh = 384.0, 420.0, 256.0, 184.0
    # Prompt chevron ">" — solid, left of the caret.
    chevron = (
        f'<polyline points="446,474 500,512 446,550" fill="none" '
        f'stroke="{fg}" stroke-width="22" stroke-linecap="round" '
        f'stroke-linejoin="round"/>'
    )
    # Block cursor "▊" — character-cell proportions, the hero of the mark.
    bx, by, bw, bh = 520.0, 454.0, 60.0, 116.0
    return (
        f'    <rect x="{wx:.0f}" y="{wy:.0f}" width="{ww:.0f}" '
        f'height="{wh:.0f}" rx="34" fill="{fg}" fill-opacity="0.12" '
        f'stroke="{fg}" stroke-opacity="0.28" stroke-width="6"/>\n'
        f'    {chevron}\n'
        f'    <rect x="{bx:.0f}" y="{by:.0f}" width="{bw:.0f}" '
        f'height="{bh:.0f}" rx="12" fill="{fg}"/>'
    )


def concept_a3_cursor(idx, top=TOP, bot=BOT, fg="#ffffff"):
    cx, cy, links, sats = mesh_a(idx, fg)
    hub = terminal_hub(fg)
    return frame(idx, f"{links}\n{sats}\n{hub}", top, bot)


# Palette knobs for the A3 terminal-cursor family. (top, bot, fg)
A3_PALETTES = {
    "purple": (TOP, BOT, "#ffffff"),          # brand — kept for comparison
    "teal": ("#16C7B5", "#0C6E7A", "#ffffff"),   # teal → deep cyan, dev feel
    "ink": ("#0B0F17", "#1B2233", "#3DF5A0"),    # near-black + neon mint accent
    "warm": ("#FBBF24", "#F97316", "#ffffff"),   # amber → orange
}


def concept_a3(palette):
    top, bot, fg = A3_PALETTES[palette]
    idx = "A3" + palette[0].upper()
    return concept_a3_cursor(idx, top=top, bot=bot, fg=fg)


# --- Concept A4-Agents: orchestrator routing a colored agent fleet ------
# Feedback on A3: keep the terminal caret + the loved ink / warm palettes,
# but make it read as *agents*. The active mesh nodes are now color-coded to
# the real fleet (matching the orchestrator demo legend) and their routing
# links carry the same color, so the mark reads as "one orchestrator routing
# several different agents at once". Idle nodes stay dim (waiting agents).
CLAUDE_C = "#FFB020"   # amber / orange   — Claude
CODEX_C = "#29C7F0"    # cyan             — GPT · Codex
AGY_C = "#3DE07A"      # green            — Antigravity

# node index -> fleet color. Indices come from mesh_a's -90°+k*60° layout:
# 0 top, 1 upper-right, 2 lower-right, 3 bottom, 4 lower-left, 5 upper-left.
FLEET_3 = {0: CLAUDE_C, 1: CODEX_C, 4: AGY_C}
FLEET_2 = {1: CLAUDE_C, 4: CODEX_C}   # diagonal, warm vs cool — small-size legibility


def concept_a4_agents(idx, top, bot, hub_fg="#ffffff", dim="#ffffff",
                      dim_op=0.28, agents=None, big=False):
    if agents is None:
        agents = FLEET_3
    cx = cy = 512.0
    R = 292.0
    nodes = [
        (cx + R * math.cos(math.radians(-90 + k * 60)),
         cy + R * math.sin(math.radians(-90 + k * 60)))
        for k in range(6)
    ]
    # Active nodes bigger in the 2-agent "balance" variant for tiny sizes.
    r_glow, r_disc, r_core = (78, 56, 20) if big else (62, 46, 15)

    links = []
    for i, (x, y) in enumerate(nodes):
        if i in agents:
            links.append(
                f'    <line x1="{cx}" y1="{cy}" x2="{x:.1f}" y2="{y:.1f}" '
                f'stroke="{agents[i]}" stroke-opacity="0.60" stroke-width="13" '
                f'stroke-linecap="round"/>'
            )
        else:
            links.append(
                f'    <line x1="{cx}" y1="{cy}" x2="{x:.1f}" y2="{y:.1f}" '
                f'stroke="{dim}" stroke-opacity="{dim_op * 0.7:.2f}" '
                f'stroke-width="10" stroke-linecap="round"/>'
            )
    links = "\n".join(links)

    sats = []
    for i, (x, y) in enumerate(nodes):
        if i in agents:
            c = agents[i]
            # Thin dark ring: invisible on the ink/black bg, but delineates a
            # like-colored node (e.g. amber Claude) against the warm amber bg.
            sats.append(
                f'    <circle cx="{x:.1f}" cy="{y:.1f}" r="{r_glow}" fill="{c}" '
                f'fill-opacity="0.32" filter="url(#glow{idx})"/>\n'
                f'    <circle cx="{x:.1f}" cy="{y:.1f}" r="{r_disc}" fill="{c}" '
                f'stroke="#0A0A0A" stroke-opacity="0.28" stroke-width="5"/>\n'
                f'    <circle cx="{x:.1f}" cy="{y:.1f}" r="{r_core}" '
                f'fill="#ffffff" fill-opacity="0.92"/>'
            )
        else:
            sats.append(
                f'    <circle cx="{x:.1f}" cy="{y:.1f}" r="40" fill="{dim}" '
                f'fill-opacity="{dim_op:.2f}"/>'
            )
    sats = "\n".join(sats)

    hub = terminal_hub(hub_fg)
    return frame(idx, f"{links}\n{sats}\n{hub}", top, bot)


# (top, bot, hub_fg, dim, dim_op, agents, big)
A4_VARIANTS = {
    "ink-agents": ("#0B0F17", "#1B2233", "#ffffff", "#ffffff", 0.30,
                   FLEET_3, False),
    "warm-agents": ("#FBBF24", "#F97316", "#ffffff", "#7A3410", 0.42,
                    FLEET_3, False),
    "ink-2agents": ("#0B0F17", "#1B2233", "#ffffff", "#ffffff", 0.30,
                    FLEET_2, True),
}


def concept_a4(variant):
    top, bot, hub_fg, dim, dim_op, agents, big = A4_VARIANTS[variant]
    idx = "A4" + "".join(w[0].upper() for w in variant.split("-"))
    return concept_a4_agents(idx, top, bot, hub_fg=hub_fg, dim=dim,
                             dim_op=dim_op, agents=agents, big=big)


# --- Concept B: Orbital Marble ------------------------------------------
# A glossy marble (the "Marblo" pun) with agent dots orbiting it — the
# orchestration motif. Light reads from the top-left for a 3D sphere.
def concept_b():
    cx = cy = 512.0

    def ring(theta_deg, rx, ry):
        return (
            f'    <g transform="translate({cx} {cy}) rotate({theta_deg})">'
            f'<ellipse rx="{rx}" ry="{ry}" fill="none" stroke="#ffffff" '
            f'stroke-opacity="0.45" stroke-width="8"/></g>'
        )

    def dot_on(theta_deg, rx, ry, t_deg, r=26):
        th = math.radians(theta_deg)
        t = math.radians(t_deg)
        lx, ly = rx * math.cos(t), ry * math.sin(t)
        x = cx + lx * math.cos(th) - ly * math.sin(th)
        y = cy + lx * math.sin(th) + ly * math.cos(th)
        return (
            f'    <circle cx="{x:.1f}" cy="{y:.1f}" r="{r+14}" fill="#ffffff" '
            f'fill-opacity="0.22" filter="url(#glowB)"/>'
            f'\n    <circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="#ffffff"/>'
        )

    rings = ring(-22, 330, 120) + "\n" + ring(34, 330, 120)
    marble = (
        '    <defs>'
        '<radialGradient id="marble" cx="0.4" cy="0.36" r="0.75">'
        '<stop offset="0" stop-color="#ffffff"/>'
        '<stop offset="0.35" stop-color="#EBDDFF"/>'
        '<stop offset="0.72" stop-color="#B78CFF"/>'
        '<stop offset="1" stop-color="#5E23C6"/>'
        '</radialGradient></defs>\n'
        f'    <circle cx="{cx}" cy="{cy}" r="190" fill="url(#marble)"/>\n'
        '    <ellipse cx="452" cy="440" rx="62" ry="40" fill="#ffffff" '
        'fill-opacity="0.75" transform="rotate(-28 452 440)"/>'
    )
    dots = (
        dot_on(-22, 330, 120, 8) + "\n"
        + dot_on(34, 330, 120, 200) + "\n"
        + dot_on(-22, 330, 120, 210, r=20)
    )
    return frame("B", f"{rings}\n{marble}\n{dots}")


# --- Concept C: Command Prompt ------------------------------------------
# A bold prompt chevron + cursor (developer-tool identity), with two ghost
# chevrons stacked behind to imply parallel agent command streams.
def concept_c():
    def chevron(ox, oy, w, opacity, color="#ffffff"):
        return (
            f'    <polyline points="{395+ox},{352+oy} {600+ox},{512+oy} '
            f'{395+ox},{672+oy}" fill="none" stroke="{color}" '
            f'stroke-opacity="{opacity}" stroke-width="{w}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>'
        )

    ghosts = (
        chevron(-96, -96, 54, 0.16) + "\n" + chevron(-50, -50, 62, 0.30)
    )
    hero = chevron(0, 0, 76, 1.0)
    cursor = (
        '    <rect x="654" y="596" width="150" height="132" rx="24" '
        'fill="#ffffff"/>'
    )
    return frame("C", f"{ghosts}\n{hero}\n{cursor}")


# (filename, label, title, fn). Labels are explicit so the A2 hub revisions
# read as a family rather than a plain A/B/C/D/E sequence.
CONCEPTS = [
    ("concept-a.svg", "A", "Agent Mesh", concept_a),
    ("concept-b.svg", "B", "Orbital Marble", concept_b),
    ("concept-c.svg", "C", "Command Prompt", concept_c),
    ("concept-a2-m.svg", "A2·M", "Agent Mesh — Marblo “M” hub", concept_a2_m),
    ("concept-a2-cursor.svg", "A2·▊", "Agent Mesh — cursor hub", concept_a2_cursor),
    ("concept-a3-cursor-purple.svg", "A3·▊ purple",
        "Terminal prompt hub — brand purple", lambda: concept_a3("purple")),
    ("concept-a3-cursor-teal.svg", "A3·▊ teal",
        "Terminal prompt hub — teal / cyan", lambda: concept_a3("teal")),
    ("concept-a3-cursor-ink.svg", "A3·▊ ink",
        "Terminal prompt hub — ink + neon", lambda: concept_a3("ink")),
    ("concept-a3-cursor-warm.svg", "A3·▊ warm",
        "Terminal prompt hub — warm amber", lambda: concept_a3("warm")),
    ("concept-a4-ink-agents.svg", "A4 ink · agents",
        "Ink + fleet-colored agents (Claude / Codex / Antigravity)",
        lambda: concept_a4("ink-agents")),
    ("concept-a4-warm-agents.svg", "A4 warm · agents",
        "Warm amber + fleet-colored agents", lambda: concept_a4("warm-agents")),
    ("concept-a4-ink-2agents.svg", "A4 ink · 2-agent",
        "Ink, 2 large agents — small-size legibility variant",
        lambda: concept_a4("ink-2agents")),
]


def main():
    cards = []
    for fname, label, title, fn in CONCEPTS:
        svg = fn()
        with open(os.path.join(HERE, fname), "w") as f:
            f.write(svg)
        print("wrote", fname)
        cards.append((fname, label, title, svg))

    # comparison preview
    tiles = "\n".join(
        f'''      <figure class="card">
        <div class="art">{svg}</div>
        <figcaption><b>{label} · {title}</b><br><code>{fname}</code></figcaption>
        <div class="row">
          <div class="chip"><div class="mini">{svg}</div><span>128</span></div>
          <div class="chip"><div class="tiny">{svg}</div><span>32</span></div>
          <div class="chip"><div class="micro">{svg}</div><span>16</span></div>
        </div>
      </figure>'''
        for (fname, label, title, svg) in cards
    )
    html = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Marblo App Icon — 3 Concepts</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    margin: 0; padding: 40px; background: #0e0e12; color: #e8e8ee; }}
  h1 {{ font-size: 22px; margin: 0 0 4px; }}
  p.sub {{ color: #9a9aa8; margin: 0 0 32px; }}
  .grid {{ display: grid; gap: 28px; grid-template-columns: repeat(auto-fit,minmax(300px,1fr)); }}
  .card {{ margin: 0; background: #17171f; border: 1px solid #26262f;
    border-radius: 18px; padding: 22px; }}
  .art svg {{ width: 100%; height: auto; display: block; border-radius: 22px; }}
  figcaption {{ margin: 16px 2px 12px; }}
  figcaption code {{ color: #9a9aa8; font-size: 12px; }}
  .row {{ display: flex; gap: 18px; align-items: flex-end; padding: 12px 2px 2px;
    border-top: 1px solid #26262f; }}
  .chip {{ display: flex; flex-direction: column; align-items: center; gap: 6px; }}
  .chip span {{ font-size: 11px; color: #9a9aa8; }}
  .mini svg {{ width: 128px; height: 128px; border-radius: 28px; }}
  .tiny svg {{ width: 32px; height: 32px; border-radius: 7px; }}
  .micro svg {{ width: 16px; height: 16px; border-radius: 4px; }}
</style></head><body>
  <h1>Marblo — App Icon Redesign (v3.4)</h1>
  <p class="sub">3 base concepts + 2 A2 hub revisions + 4 A3 terminal-cursor
     palettes + 3 A4 agent-fleet marks · 1024×1024 vector · macOS squircle ·
     shown at 128 / 32 / 16 px for legibility check</p>
  <div class="grid">
{tiles}
  </div>
</body></html>"""
    with open(os.path.join(HERE, "preview.html"), "w") as f:
        f.write(html)
    print("wrote preview.html")


if __name__ == "__main__":
    main()
