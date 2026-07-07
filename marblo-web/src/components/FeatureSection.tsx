"use client";

import { useTranslations } from "next-intl";
import {
  Check,
  Layout,
  GitCompare,
  Terminal,
  ArrowLeftRight,
  Cpu,
} from "lucide-react";

/* ---------- data ---------- */

interface Feature {
  key: string;
  deepKey: string;
  icon: typeof Layout;
  color: {
    text: string;
    bg: string;
    shadow: string;
    accent: string;
    border: string;
  };
  visual: "kanban" | "diff" | "terminal" | "agentnav" | "orchestration";
}

const features: Feature[] = [
  {
    key: "kanban",
    deepKey: "deep.kanban",
    icon: Layout,
    color: {
      text: "text-indigo-400",
      bg: "bg-indigo-500/10",
      shadow: "shadow-indigo-500/10",
      accent: "bg-indigo-500",
      border: "border-indigo-500/20",
    },
    visual: "kanban",
  },
  {
    key: "ticketdiff",
    deepKey: "deep.ticketdiff",
    icon: GitCompare,
    color: {
      text: "text-emerald-400",
      bg: "bg-emerald-500/10",
      shadow: "shadow-emerald-500/10",
      accent: "bg-emerald-500",
      border: "border-emerald-500/20",
    },
    visual: "diff",
  },
  {
    key: "terminal",
    deepKey: "deep.terminal",
    icon: Terminal,
    color: {
      text: "text-violet-400",
      bg: "bg-violet-500/10",
      shadow: "shadow-violet-500/10",
      accent: "bg-violet-500",
      border: "border-violet-500/20",
    },
    visual: "terminal",
  },
  {
    key: "agentnav",
    deepKey: "deep.agentnav",
    icon: ArrowLeftRight,
    color: {
      text: "text-cyan-400",
      bg: "bg-cyan-500/10",
      shadow: "shadow-cyan-500/10",
      accent: "bg-cyan-500",
      border: "border-cyan-500/20",
    },
    visual: "agentnav",
  },
  {
    key: "orchestration",
    deepKey: "deep.orchestration",
    icon: Cpu,
    color: {
      text: "text-amber-400",
      bg: "bg-amber-500/10",
      shadow: "shadow-amber-500/10",
      accent: "bg-amber-500",
      border: "border-amber-500/20",
    },
    visual: "orchestration",
  },
];

/* ---------- visual mockups ---------- */

function KanbanCard({
  title,
  active = false,
  color,
}: {
  title: string;
  active?: boolean;
  color: Feature["color"];
}) {
  return (
    <div
      className={`rounded-lg border p-2 ${
        active
          ? `${color.bg} ${color.border}`
          : "bg-zinc-800/70 border-zinc-700/60"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            active ? color.accent : "bg-zinc-500"
          }`}
        />
        <span className="text-[10px] font-medium text-zinc-300 truncate">
          {title}
        </span>
      </div>
      <div className="mt-1.5 h-1 w-3/4 rounded-full bg-zinc-700" />
    </div>
  );
}

function KanbanMockup({ color }: { color: Feature["color"] }) {
  const cols: {
    label: string;
    count: number;
    cards: { title: string; active?: boolean }[];
  }[] = [
    {
      label: "TODO",
      count: 2,
      cards: [{ title: "Auth API" }, { title: "DB schema" }],
    },
    {
      label: "IN_PROGRESS",
      count: 1,
      cards: [{ title: "LoginForm", active: true }],
    },
    { label: "REVIEW", count: 1, cards: [{ title: "PR #142" }] },
    {
      label: "DONE",
      count: 2,
      cards: [{ title: "Setup CI" }, { title: "Routing" }],
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-2.5 h-full">
      {cols.map((col) => (
        <div key={col.label} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-zinc-500 tracking-wider truncate">
              {col.label}
            </span>
            <span className="text-[9px] font-mono text-zinc-600">
              {col.count}
            </span>
          </div>
          {col.cards.map((card) => (
            <KanbanCard
              key={card.title}
              title={card.title}
              active={card.active}
              color={color}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TicketDiffMockup({ color }: { color: Feature["color"] }) {
  const diff: { sign: string; text: string; add: boolean }[] = [
    { sign: "+", text: "export function LoginForm() {", add: true },
    { sign: "+", text: "  const [email, setEmail] = useState('');", add: true },
    { sign: "-", text: "  return null;", add: false },
    { sign: "+", text: "  return <form>…</form>;", add: true },
  ];
  return (
    <div className="flex flex-col gap-3 h-full justify-center">
      {/* Ticket header with attached agent */}
      <div className={`rounded-lg border ${color.border} ${color.bg} p-2.5`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-zinc-200 truncate">
            #142 · Add login form
          </span>
          <span
            className={`flex items-center gap-1 text-[9px] font-medium shrink-0 ${color.text}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${color.accent}`} />
            frontend-01
          </span>
        </div>
      </div>
      {/* Inline diff */}
      <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/60 p-2.5 font-mono text-[10px] leading-5">
        {diff.map((line, i) => (
          <div
            key={i}
            className={`flex gap-2 ${
              line.add ? "text-emerald-400" : "text-rose-400/80"
            }`}
          >
            <span className="select-none opacity-70">{line.sign}</span>
            <span className="truncate">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentNavMockup({ color }: { color: Feature["color"] }) {
  const agents: { name: string; task: string; active?: boolean }[] = [
    { name: "backend-01", task: "Auth API" },
    { name: "frontend-01", task: "LoginForm", active: true },
    { name: "test-01", task: "Integration tests" },
  ];
  return (
    <div className="flex flex-col gap-2.5 h-full justify-center">
      {agents.map((a) => (
        <div
          key={a.name}
          className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 ${
            a.active
              ? `${color.bg} ${color.border}`
              : "bg-zinc-800/50 border-zinc-700/50"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                a.active ? color.accent : "bg-zinc-500"
              }`}
            />
            <span className="text-[11px] font-medium text-zinc-200 truncate">
              {a.name}
            </span>
            <span className="text-[10px] text-zinc-500 truncate">{a.task}</span>
          </div>
          {a.active && (
            <div className="flex items-center gap-1 shrink-0">
              <kbd
                className={`rounded border px-1 text-[9px] ${color.border} ${color.bg} ${color.text}`}
              >
                ←
              </kbd>
              <kbd
                className={`rounded border px-1 text-[9px] ${color.border} ${color.bg} ${color.text}`}
              >
                →
              </kbd>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TerminalMockup({ color }: { color: Feature["color"] }) {
  return (
    <div className="font-mono text-xs leading-6 h-full flex flex-col justify-center">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-3 w-3 rounded-full bg-red-500/70" />
        <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <span className="h-3 w-3 rounded-full bg-green-500/70" />
      </div>
      <p className="text-zinc-500">
        $&nbsp;
        <span className={color.text}>/tf-spawn</span>
        <span className="text-zinc-400"> --role frontend --model claude</span>
      </p>
      <p className="text-zinc-500 mt-1">
        ✓ Agent <span className="text-emerald-400">frontend-01</span> spawned
      </p>
      <p className="text-zinc-500">
        ✓ Workspace <span className="text-emerald-400">initialized</span>
      </p>
      <p className={`mt-1 ${color.text}`}>▸ Generating LoginForm.tsx ...</p>
      <p className="text-zinc-600 mt-1">
        {" "}
        tokens: 1,247 &nbsp;|&nbsp; latency: 320ms
      </p>
    </div>
  );
}

function OrchestrationMockup({ color }: { color: Feature["color"] }) {
  const models = [
    { label: "Claude", x: "left-0 top-0" },
    { label: "GPT", x: "right-0 top-0" },
    { label: "Antigravity", x: "left-1/2 -translate-x-1/2 bottom-0" },
  ];

  return (
    <div className="relative h-full min-h-[160px] flex items-center justify-center">
      {/* Center orchestrator */}
      <div
        className={`relative z-10 flex items-center justify-center w-16 h-16 rounded-full ${color.bg} border ${color.border}`}
      >
        <Cpu className={`w-6 h-6 ${color.text}`} />
      </div>

      {/* Model circles */}
      {models.map((m) => (
        <div
          key={m.label}
          className={`absolute ${m.x} flex flex-col items-center gap-1`}
        >
          <div className="w-12 h-12 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <span className="text-[10px] font-medium text-zinc-400">
              {m.label}
            </span>
          </div>
        </div>
      ))}

      {/* Connecting lines (SVG overlay) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        preserveAspectRatio="none"
      >
        <line
          x1="24%"
          y1="22%"
          x2="45%"
          y2="42%"
          stroke="currentColor"
          className="text-zinc-700"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        <line
          x1="76%"
          y1="22%"
          x2="55%"
          y2="42%"
          stroke="currentColor"
          className="text-zinc-700"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        <line
          x1="50%"
          y1="58%"
          x2="50%"
          y2="78%"
          stroke="currentColor"
          className="text-zinc-700"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
      </svg>
    </div>
  );
}

const visualComponents: Record<
  Feature["visual"],
  React.FC<{ color: Feature["color"] }>
> = {
  kanban: KanbanMockup,
  diff: TicketDiffMockup,
  terminal: TerminalMockup,
  agentnav: AgentNavMockup,
  orchestration: OrchestrationMockup,
};

/* ---------- main component ---------- */

export default function FeatureSection() {
  const t = useTranslations("features");

  return (
    <section className="py-24 px-4">
      <div className="max-w-7xl mx-auto flex flex-col gap-32">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          const Visual = visualComponents[feature.visual];
          const isEven = index % 2 === 1;

          return (
            <div
              key={feature.key}
              className={`flex flex-col lg:flex-row items-center gap-12 lg:gap-20 ${
                isEven ? "lg:flex-row-reverse" : ""
              }`}
            >
              {/* Text side */}
              <div className="flex-1 max-w-xl">
                {/* Label */}
                <div className="flex items-center gap-2 mb-4">
                  <div className={`p-1.5 rounded-lg ${feature.color.bg}`}>
                    <Icon className={`w-4 h-4 ${feature.color.text}`} />
                  </div>
                  <span
                    className={`tracking-widest uppercase text-sm font-semibold ${feature.color.text}`}
                    style={{
                      fontFamily:
                        'var(--font-space-grotesk, "Space Grotesk", sans-serif)',
                    }}
                  >
                    {t(`${feature.deepKey}.label`)}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-3xl md:text-4xl font-bold text-white mb-4 leading-tight">
                  {t(`${feature.deepKey}.title`)}
                </h3>

                {/* Description */}
                <p className="text-zinc-400 text-lg leading-relaxed mb-8">
                  {t(`${feature.deepKey}.description`)}
                </p>

                {/* Bullets */}
                <ul className="flex flex-col gap-3">
                  {[1, 2, 3].map((n) => (
                    <li key={n} className="flex items-start gap-3">
                      <span
                        className={`mt-1 flex items-center justify-center w-5 h-5 rounded-full ${feature.color.bg} shrink-0`}
                      >
                        <Check className={`w-3 h-3 ${feature.color.text}`} />
                      </span>
                      <span className="text-zinc-300 text-sm leading-relaxed">
                        {t(`${feature.deepKey}.bullet${n}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Visual side */}
              <div className="flex-1 w-full max-w-xl">
                <div
                  className={`flex min-h-[220px] items-center bg-zinc-900 border border-zinc-700/50 rounded-2xl p-6 ${feature.color.shadow} shadow-2xl`}
                >
                  <div className="w-full">
                    <Visual color={feature.color} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
