"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";

const CLOSE_LABEL: Record<string, string> = {
  ko: "닫기",
  ja: "閉じる",
  en: "Close",
};

// Model accent colors — mirror the agent-tab colors used across the Marblo app.
const INDIGO = "#818cf8";
const CLAUDE = "#d97757";
const GPT = "#10a37f";
const GROK = "#a78bfa";

const TABS = [
  { label: "Orchestrator", color: INDIGO, active: true },
  { label: "Claude", color: CLAUDE },
  { label: "GPT", color: GPT },
  { label: "Grok", color: GROK },
];

const DISPATCH = [
  { color: CLAUDE, model: "Claude", task: "Board UI" },
  { color: GPT, model: "GPT", task: "API · tests" },
  { color: GROK, model: "Grok", task: "Docs sweep" },
];

type Card = { title: string; model?: string; color?: string; prio?: string };
const COLUMNS: { title: string; accent: string; cards: Card[] }[] = [
  {
    title: "To Do",
    accent: "#8b93a7",
    cards: [
      { title: "Payment webhook", prio: "#f59e0b" },
      { title: "Sitemap i18n", prio: "#8b93a7" },
      { title: "Onboarding banner", prio: "#8b93a7" },
    ],
  },
  {
    title: "In Progress",
    accent: "#3b82f6",
    cards: [
      {
        title: "Audit log view",
        model: "Claude",
        color: CLAUDE,
        prio: "#ef4444",
      },
      { title: "Board query fix", model: "GPT", color: GPT, prio: "#f59e0b" },
    ],
  },
  {
    title: "Review",
    accent: "#a855f7",
    cards: [
      { title: "File tree labels", model: "GPT", color: GPT, prio: "#8b93a7" },
      { title: "Mission replay", model: "Grok", color: GROK, prio: "#8b93a7" },
    ],
  },
  {
    title: "Done",
    accent: "#22c55e",
    cards: [
      { title: "Signup rule guard", model: "GPT", color: GPT },
      { title: "Repo connect modal", model: "Claude", color: CLAUDE },
    ],
  },
];

const FONT = "system-ui, -apple-system, sans-serif";
const COL_X = [300, 472, 644, 816];
const COL_W = 158;
const CARD_H = 52;
const CARD_GAP = 12;
const CARDS_TOP = 148;

/**
 * Inline-SVG mockup of the current Marblo workspace UX — orchestrator rail
 * (owner prompt → task decomposition → per-model dispatch), the agent tab bar
 * (Orchestrator / Claude / GPT / Grok), and the live kanban board. Rendered as
 * SVG (not a raster screenshot) so it stays crisp at any size and locale-neutral.
 */
function WorkspaceMockup() {
  return (
    <svg
      viewBox="0 0 1000 600"
      role="img"
      aria-hidden="true"
      className="block h-auto w-full"
    >
      {/* window shell */}
      <rect
        x="1"
        y="1"
        width="998"
        height="598"
        rx="14"
        fill="#0a0c12"
        stroke="#232838"
      />

      {/* title bar */}
      <circle cx="26" cy="24" r="5.5" fill="#ff5f57" />
      <circle cx="46" cy="24" r="5.5" fill="#febc2e" />
      <circle cx="66" cy="24" r="5.5" fill="#28c840" />
      <text
        x="500"
        y="28"
        textAnchor="middle"
        fontSize="12.5"
        fill="#8b93a7"
        fontFamily={FONT}
      >
        Marblo · Workspace
      </text>
      <line x1="1" y1="48" x2="999" y2="48" stroke="#232838" />

      {/* ── left: orchestrator rail ── */}
      <rect x="1" y="48" width="286" height="551" fill="#0d1018" />
      <line x1="287" y1="48" x2="287" y2="599" stroke="#232838" />

      <circle cx="28" cy="78" r="10" fill="#6366f1" opacity="0.18" />
      <circle cx="28" cy="78" r="3.6" fill={INDIGO} />
      <text
        x="46"
        y="82"
        fontSize="13"
        fontWeight="600"
        fill="#e4e7ee"
        fontFamily={FONT}
      >
        Orchestrator
      </text>
      <circle cx="258" cy="78" r="3.6" fill="#22c55e" />
      <text x="266" y="82" fontSize="10" fill="#22c55e" fontFamily={FONT}>
        live
      </text>

      {/* owner prompt bubble */}
      <rect x="16" y="102" width="256" height="34" rx="9" fill="#1a1f2e" />
      <text x="30" y="123" fontSize="11" fill="#c7ccd8" fontFamily={FONT}>
        &ldquo;Ship the audit view&rdquo;
      </text>

      {/* plan line */}
      <text x="18" y="160" fontSize="10.5" fill="#8b93a7" fontFamily={FONT}>
        Decomposed into 4 tasks · routing…
      </text>

      {/* dispatch rows */}
      {DISPATCH.map((d, i) => {
        const y = 176 + i * 30;
        return (
          <g key={d.model}>
            <rect x="16" y={y} width="256" height="24" rx="7" fill="#12151f" />
            {/* dispatch arrow — SVG shape, not a glyph, so it renders on any font */}
            <path
              d={`M26 ${y + 8} L32 ${y + 12} L26 ${y + 16} Z`}
              fill="#6b7488"
            />
            <circle cx="46" cy={y + 12} r="3.4" fill={d.color} />
            <text
              x="56"
              y={y + 16}
              fontSize="11"
              fontWeight="600"
              fill="#dfe3ec"
              fontFamily={FONT}
            >
              {d.model}
            </text>
            <text
              x="262"
              y={y + 16}
              textAnchor="end"
              fontSize="10"
              fill="#8b93a7"
              fontFamily={FONT}
            >
              {d.task}
            </text>
          </g>
        );
      })}

      {/* self-healing / merge status */}
      <path
        d="M18 300 l3 3 l6 -7"
        fill="none"
        stroke="#22c55e"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="34" y="303" fontSize="10.5" fill="#22c55e" fontFamily={FONT}>
        Watchdog · all agents healthy
      </text>
      <text x="18" y="322" fontSize="10.5" fill="#8b93a7" fontFamily={FONT}>
        Merge gate · 2 ready for review
      </text>

      {/* input bar */}
      <rect
        x="16"
        y="556"
        width="256"
        height="30"
        rx="8"
        fill="#12151f"
        stroke="#232838"
      />
      <text x="30" y="575" fontSize="10.5" fill="#5b6478" fontFamily={FONT}>
        Message the orchestrator…
      </text>

      {/* ── right: agent tab strip ── */}
      {TABS.map((tab, i) => {
        const x = 300 + i * 118;
        return (
          <g key={tab.label}>
            <circle cx={x + 4} cy="72" r="3.6" fill={tab.color} />
            <text
              x={x + 14}
              y="76"
              fontSize="11.5"
              fontWeight={tab.active ? 600 : 400}
              fill={tab.active ? "#e4e7ee" : "#8b93a7"}
              fontFamily={FONT}
            >
              {tab.label}
            </text>
            {tab.active && (
              <rect
                x={x - 2}
                y="90"
                width="94"
                height="2.5"
                rx="1.25"
                fill="#6366f1"
              />
            )}
          </g>
        );
      })}
      <line x1="287" y1="93" x2="999" y2="93" stroke="#232838" />

      {/* ── right: kanban board ── */}
      {COLUMNS.map((col, ci) => {
        const x = COL_X[ci];
        return (
          <g key={col.title}>
            {/* column header */}
            <circle cx={x + 4} cy="120" r="3.4" fill={col.accent} />
            <text
              x={x + 14}
              y="124"
              fontSize="11.5"
              fontWeight="600"
              fill="#c7ccd8"
              fontFamily={FONT}
            >
              {col.title}
            </text>
            <rect
              x={x + COL_W - 22}
              y="112"
              width="22"
              height="16"
              rx="8"
              fill="#1a1f2e"
            />
            <text
              x={x + COL_W - 11}
              y="124"
              textAnchor="middle"
              fontSize="9.5"
              fill="#8b93a7"
              fontFamily={FONT}
            >
              {col.cards.length}
            </text>

            {/* cards */}
            {col.cards.map((card, idx) => {
              const cy = CARDS_TOP + idx * (CARD_H + CARD_GAP);
              return (
                <g key={card.title}>
                  <rect
                    x={x}
                    y={cy}
                    width={COL_W}
                    height={CARD_H}
                    rx="9"
                    fill="#12151d"
                    stroke="#232838"
                  />
                  {card.prio && (
                    <circle
                      cx={x + COL_W - 14}
                      cy={cy + 15}
                      r="3.4"
                      fill={card.prio}
                    />
                  )}
                  <text
                    x={x + 13}
                    y={cy + 20}
                    fontSize="11"
                    fill="#d7dbe4"
                    fontFamily={FONT}
                  >
                    {card.title}
                  </text>
                  {card.model ? (
                    <>
                      <circle
                        cx={x + 16}
                        cy={cy + 37}
                        r="3.2"
                        fill={card.color}
                      />
                      <text
                        x={x + 25}
                        y={cy + 40}
                        fontSize="9.5"
                        fill="#9aa2b4"
                        fontFamily={FONT}
                      >
                        {card.model}
                      </text>
                    </>
                  ) : (
                    <text
                      x={x + 13}
                      y={cy + 40}
                      fontSize="9.5"
                      fill="#5b6478"
                      fontFamily={FONT}
                    >
                      unassigned
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Hero surface: a click-to-enlarge mockup of the Marblo workspace. Mirrors the
 * former HeroScreenshot interaction (keyboard-operable opener + focus-managed
 * lightbox) but renders the new-UX inline SVG instead of a raster screenshot.
 */
export default function HeroWorkspaceMockup() {
  const t = useTranslations("hero");
  const locale = useLocale();
  const closeLabel = CLOSE_LABEL[locale] ?? CLOSE_LABEL.en;
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const opener = openerRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={t("clickToEnlarge")}
        className="group mx-auto mt-16 block w-full max-w-5xl cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        style={{ perspective: "1200px" }}
        onClick={() => setIsOpen(true)}
      >
        <div
          className="overflow-hidden rounded-xl border border-zinc-800 shadow-2xl shadow-indigo-500/10 transition-transform duration-300 group-hover:scale-[1.01]"
          style={{
            transform: "rotateX(2deg)",
            transformOrigin: "bottom center",
          }}
        >
          <WorkspaceMockup />
        </div>
        <p className="mt-3 text-center text-xs text-zinc-600">
          {t("clickToEnlarge")}
        </p>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Marblo workspace"
          className="fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative w-full max-w-[95vw] md:max-w-5xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <WorkspaceMockup />
            </div>
            <button
              ref={closeRef}
              type="button"
              aria-label={closeLabel}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-zinc-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              onClick={() => setIsOpen(false)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
