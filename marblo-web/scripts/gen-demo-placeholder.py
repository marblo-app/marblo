#!/usr/bin/env python3
"""Generate clean, branded placeholder demo screenshots for marblo-web.

These are TEMPORARY placeholders. They intentionally contain only generic,
fictional demo data (no real ticket titles, no real accounts, no real PR
numbers). A human replaces them with real clean captures per
docs/DEMO-SCREENSHOT-GUIDE.md.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.environ["OUT_DIR"]
W, H = 2560, 1440

# Palette (matches marblo-web zinc/indigo theme)
BG = (9, 9, 11)            # zinc-950
PANEL = (24, 24, 27)       # zinc-900
PANEL2 = (39, 39, 42)      # zinc-800
BORDER = (63, 63, 70)      # zinc-700
TEXT = (228, 228, 231)     # zinc-200
MUTED = (113, 113, 122)    # zinc-500
INDIGO = (129, 140, 248)   # indigo-400
CYAN = (34, 211, 238)
AMBER = (251, 191, 36)
GREEN = (74, 222, 128)


def font(sz, mono=False):
    # AppleSDGothicNeo covers Latin + Korean so demo task titles render.
    path = "/System/Library/Fonts/SFNSMono.ttf" if mono else "/System/Library/Fonts/AppleSDGothicNeo.ttc"
    try:
        return ImageFont.truetype(path, sz)
    except Exception:
        return ImageFont.load_default()


def rr(d, box, radius, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def titlebar(d, title):
    d.rectangle([0, 0, W, 64], fill=PANEL2)
    d.line([0, 64, W, 64], fill=BORDER, width=1)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([32 + i * 34, 24, 32 + i * 34 + 16, 40], fill=c)
    f = font(26)
    tw = d.textlength(title, font=f)
    d.text(((W - tw) / 2, 20), title, font=f, fill=MUTED)


def watermark(img):
    d = ImageDraw.Draw(img, "RGBA")
    f = font(30)
    msg = "PLACEHOLDER — replace with clean app capture (docs/DEMO-SCREENSHOT-GUIDE.md)"
    tw = d.textlength(msg, font=f)
    rr(d, [(W - tw) / 2 - 24, H - 92, (W + tw) / 2 + 24, H - 36], 14,
       fill=(129, 140, 248, 40), outline=(129, 140, 248, 160), width=2)
    d.text(((W - tw) / 2, H - 78), msg, font=f, fill=(199, 205, 255, 255))


def make_hero():
    """Full app: file tree | Board (4 cols) | agent+orchestrator terminals."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    titlebar(d, "Marblo v3")

    top = 88
    # --- Left: file tree ---
    tx0, tx1 = 24, 360
    rr(d, [tx0, top, tx1, H - 24], 14, fill=PANEL, outline=BORDER)
    fh = font(22)
    fm = font(20, mono=True)
    d.text((tx0 + 20, top + 18), "EXPLORER", font=font(18), fill=MUTED)
    tree = ["src/", "  api/", "    auth.ts", "    payments.ts", "  components/",
            "    Board.tsx", "    FileTree.tsx", "  lib/", "    tokens.ts",
            "tests/", "  auth.e2e.ts", "package.json", "README.md"]
    for i, node in enumerate(tree):
        d.text((tx0 + 20, top + 56 + i * 34), node, font=fm,
               fill=TEXT if not node.startswith("  ") else MUTED)

    # --- Center: Board with 4 columns ---
    bx0, bx1 = 384, 1700
    cols = [
        ("TODO", MUTED, [("검색 인덱싱 최적화", ""), ("온보딩 튜토리얼 작성", "")]),
        ("IN PROGRESS", CYAN, [("결제 연동 (Toss 웹훅)", "claude"),
                                ("대시보드 UI 컴포넌트", "codex")]),
        ("REVIEW", INDIGO, [("인증 API 구현 (JWT)", "PR #42")]),
        ("DONE", GREEN, [("파일 트리 리팩터", ""), ("E2E 테스트 스위트", "")]),
    ]
    cw = (bx1 - bx0 - 3 * 16) / 4
    ch = font(20)
    cardf = font(21)
    tagf = font(17)
    for ci, (name, color, cards) in enumerate(cols):
        cx = bx0 + ci * (cw + 16)
        rr(d, [cx, top, cx + cw, H - 24], 14, fill=PANEL, outline=BORDER)
        d.ellipse([cx + 18, top + 22, cx + 30, top + 34], fill=color)
        d.text((cx + 40, top + 18), name, font=ch, fill=color)
        d.text((cx + cw - 44, top + 18), str(len(cards)), font=ch, fill=MUTED)
        cy = top + 62
        for title, tag in cards:
            card_h = 108
            rr(d, [cx + 14, cy, cx + cw - 14, cy + card_h], 10, fill=PANEL2, outline=BORDER)
            # wrap title crudely
            words, line, lines = title.split(" "), "", []
            for w in words:
                if d.textlength((line + " " + w).strip(), font=cardf) > cw - 60:
                    lines.append(line); line = w
                else:
                    line = (line + " " + w).strip()
            lines.append(line)
            for li, ln in enumerate(lines[:2]):
                d.text((cx + 30, cy + 16 + li * 28), ln, font=cardf, fill=TEXT)
            if tag:
                tagcol = {"claude": AMBER, "codex": CYAN, "PR #42": INDIGO}.get(tag, MUTED)
                tw = d.textlength(tag, font=tagf)
                rr(d, [cx + 30, cy + card_h - 34, cx + 30 + tw + 20, cy + card_h - 8], 8,
                   fill=None, outline=tagcol, width=1)
                d.text((cx + 40, cy + card_h - 32), tag, font=tagf, fill=tagcol)
            cy += card_h + 14

    # --- Right: terminals (agent + orchestrator) + activity ---
    rx0, rx1 = 1716, W - 24
    # agent terminal
    ah = 520
    rr(d, [rx0, top, rx1, top + ah], 14, fill=(12, 12, 14), outline=BORDER)
    d.text((rx0 + 20, top + 16), "● claude — auth API", font=font(19), fill=AMBER)
    agent_log = [
        "$ implement JWT refresh rotation",
        "Reading src/api/auth.ts …",
        "Added refresh-token endpoint",
        "Writing tests/auth.e2e.ts …",
        "✓ 12 passing  (2.4s)",
        "Committing: feat(auth): refresh rotation",
        "→ submit_for_review",
    ]
    mf = font(19, mono=True)
    for i, ln in enumerate(agent_log):
        d.text((rx0 + 20, top + 56 + i * 34), ln, font=mf,
               fill=GREEN if ln.startswith("✓") else TEXT)

    # orchestrator terminal
    oy = top + ah + 16
    oh = 380
    rr(d, [rx0, oy, rx1, oy + oh], 14, fill=(12, 12, 14), outline=BORDER)
    d.text((rx0 + 20, oy + 16), "◆ orchestrator", font=font(19), fill=INDIGO)
    orch_log = [
        "Assigned: payments-webhook -> codex",
        "Assigned: auth-api        -> claude",
        "claude finished -> moved to REVIEW",
        "Reviewing PR #42 ...",
    ]
    for i, ln in enumerate(orch_log):
        d.text((rx0 + 20, oy + 56 + i * 34), ln, font=mf, fill=TEXT)

    # activity stream
    ay = oy + oh + 16
    rr(d, [rx0, ay, rx1, H - 24], 14, fill=PANEL, outline=BORDER)
    d.text((rx0 + 20, ay + 14), "ACTIVITY", font=font(18), fill=MUTED)
    acts = ["codex claimed 결제 연동", "claude opened PR #42", "E2E 테스트 스위트 → DONE"]
    for i, ln in enumerate(acts):
        d.ellipse([rx0 + 22, ay + 52 + i * 30 + 4, rx0 + 30, ay + 52 + i * 30 + 12], fill=INDIGO)
        d.text((rx0 + 42, ay + 50 + i * 30), ln, font=font(18), fill=TEXT)

    watermark(img)
    return img


def make_orchestration():
    """Orchestration dashboard: central orchestrator fanning to 3 agents."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    titlebar(d, "Marblo v3 — Orchestration")

    cx, cy = W // 2, 360
    # orchestrator node
    rr(d, [cx - 200, cy - 70, cx + 200, cy + 70], 20, fill=PANEL, outline=INDIGO, width=3)
    d.text((cx - 150, cy - 40), "◆ Orchestrator", font=font(34), fill=INDIGO)
    d.text((cx - 150, cy + 6), "assigning 3 tasks …", font=font(22), fill=MUTED)

    agents = [
        ("● Claude", AMBER, "인증 API 구현 (JWT)", "REVIEW · PR #42"),
        ("● GPT / Codex", CYAN, "결제 연동 (Toss 웹훅)", "IN PROGRESS"),
        ("● Antigravity", GREEN, "파일 트리 리팩터", "DONE"),
    ]
    ay = 820
    gap = W // 4
    for i, (name, color, task, status) in enumerate(agents):
        ax = gap * (i + 1)
        d.line([cx, cy + 70, ax, ay - 90], fill=BORDER, width=3)
        rr(d, [ax - 260, ay - 90, ax + 260, ay + 120], 18, fill=PANEL, outline=color, width=2)
        d.text((ax - 230, ay - 66), name, font=font(30), fill=color)
        d.text((ax - 230, ay - 16), task, font=font(24), fill=TEXT)
        rr(d, [ax - 230, ay + 40, ax - 230 + d.textlength(status, font=font(20)) + 28, ay + 78],
           10, fill=None, outline=color, width=1)
        d.text((ax - 216, ay + 44), status, font=font(20), fill=color)

    watermark(img)
    return img


for name, mk in [("product-demo", make_hero), ("orchestration-demo", make_orchestration)]:
    img = mk()
    path = os.path.join(OUT_DIR, f"{name}.webp")
    img.save(path, "WEBP", quality=90, method=6)
    print(f"wrote {path}  ({os.path.getsize(path)//1024} KB, {W}x{H})")
