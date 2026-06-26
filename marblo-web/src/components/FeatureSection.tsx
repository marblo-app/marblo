'use client';

import { useTranslations } from 'next-intl';
import { Check, Layout, GitBranch, Terminal, Cpu } from 'lucide-react';

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
  visual: 'kanban' | 'flow' | 'terminal' | 'orchestration';
}

const features: Feature[] = [
  {
    key: 'kanban',
    deepKey: 'deep.kanban',
    icon: Layout,
    color: {
      text: 'text-indigo-400',
      bg: 'bg-indigo-500/10',
      shadow: 'shadow-indigo-500/10',
      accent: 'bg-indigo-500',
      border: 'border-indigo-500/20',
    },
    visual: 'kanban',
  },
  {
    key: 'flow',
    deepKey: 'deep.flow',
    icon: GitBranch,
    color: {
      text: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      shadow: 'shadow-cyan-500/10',
      accent: 'bg-cyan-500',
      border: 'border-cyan-500/20',
    },
    visual: 'flow',
  },
  {
    key: 'terminal',
    deepKey: 'deep.terminal',
    icon: Terminal,
    color: {
      text: 'text-violet-400',
      bg: 'bg-violet-500/10',
      shadow: 'shadow-violet-500/10',
      accent: 'bg-violet-500',
      border: 'border-violet-500/20',
    },
    visual: 'terminal',
  },
  {
    key: 'orchestration',
    deepKey: 'deep.orchestration',
    icon: Cpu,
    color: {
      text: 'text-amber-400',
      bg: 'bg-amber-500/10',
      shadow: 'shadow-amber-500/10',
      accent: 'bg-amber-500',
      border: 'border-amber-500/20',
    },
    visual: 'orchestration',
  },
];

/* ---------- visual mockups ---------- */

function KanbanMockup({ color }: { color: Feature['color'] }) {
  const cols = [
    { label: 'TODO', cards: [{ w: 'w-full', c: 'bg-zinc-700' }, { w: 'w-3/4', c: 'bg-zinc-700' }] },
    { label: 'IN_PROGRESS', cards: [{ w: 'w-full', c: `${color.accent}/60` }] },
    { label: 'REVIEW', cards: [{ w: 'w-full', c: 'bg-zinc-700' }] },
    { label: 'DONE', cards: [{ w: 'w-full', c: 'bg-zinc-700' }, { w: 'w-2/3', c: 'bg-zinc-700' }, { w: 'w-full', c: 'bg-zinc-700' }] },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 h-full">
      {cols.map((col) => (
        <div key={col.label} className="flex flex-col gap-2">
          <span className="text-[10px] font-mono text-zinc-500 tracking-wider">{col.label}</span>
          {col.cards.map((card, i) => (
            <div key={i} className={`${card.c} rounded-lg h-8 ${card.w}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FlowMockup({ color }: { color: Feature['color'] }) {
  const nodes = ['Analyze', 'Tasks', 'Spawn', 'Review'];
  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center justify-center sm:justify-between gap-x-2 gap-y-3 h-full px-2">
      {nodes.map((node, i) => (
        <div key={node} className="flex items-center gap-2">
          <div className={`flex items-center justify-center rounded-xl px-3 py-2 text-xs font-medium border ${i === 0 || i === 3 ? `${color.bg} ${color.text} ${color.border}` : 'bg-zinc-800 text-zinc-300 border-zinc-700'}`}>
            {node}
          </div>
          {i < nodes.length - 1 && (
            <svg width="24" height="12" viewBox="0 0 24 12" className="shrink-0">
              <line x1="0" y1="6" x2="18" y2="6" stroke="currentColor" className="text-zinc-600" strokeWidth="1.5" />
              <polygon points="18,2 24,6 18,10" fill="currentColor" className="text-zinc-600" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

function TerminalMockup({ color }: { color: Feature['color'] }) {
  return (
    <div className="font-mono text-xs leading-6 h-full flex flex-col justify-center">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-3 w-3 rounded-full bg-red-500/70" />
        <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <span className="h-3 w-3 rounded-full bg-green-500/70" />
      </div>
      <p className="text-zinc-500">$&nbsp;
        <span className={color.text}>/tf-spawn</span>
        <span className="text-zinc-400"> --role frontend --model claude</span>
      </p>
      <p className="text-zinc-500 mt-1">✓ Agent <span className="text-emerald-400">frontend-01</span> spawned</p>
      <p className="text-zinc-500">✓ Workspace <span className="text-emerald-400">initialized</span></p>
      <p className={`mt-1 ${color.text}`}>▸ Generating LoginForm.tsx ...</p>
      <p className="text-zinc-600 mt-1">  tokens: 1,247 &nbsp;|&nbsp; latency: 320ms</p>
    </div>
  );
}

function OrchestrationMockup({ color }: { color: Feature['color'] }) {
  const models = [
    { label: 'Claude', x: 'left-0 top-0' },
    { label: 'GPT', x: 'right-0 top-0' },
    { label: 'Gemini', x: 'left-1/2 -translate-x-1/2 bottom-0' },
  ];

  return (
    <div className="relative h-full min-h-[160px] flex items-center justify-center">
      {/* Center orchestrator */}
      <div className={`relative z-10 flex items-center justify-center w-16 h-16 rounded-full ${color.bg} border ${color.border}`}>
        <Cpu className={`w-6 h-6 ${color.text}`} />
      </div>

      {/* Model circles */}
      {models.map((m) => (
        <div key={m.label} className={`absolute ${m.x} flex flex-col items-center gap-1`}>
          <div className="w-12 h-12 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <span className="text-[10px] font-medium text-zinc-400">{m.label}</span>
          </div>
        </div>
      ))}

      {/* Connecting lines (SVG overlay) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
        <line x1="24%" y1="22%" x2="45%" y2="42%" stroke="currentColor" className="text-zinc-700" strokeWidth="1" strokeDasharray="4 3" />
        <line x1="76%" y1="22%" x2="55%" y2="42%" stroke="currentColor" className="text-zinc-700" strokeWidth="1" strokeDasharray="4 3" />
        <line x1="50%" y1="58%" x2="50%" y2="78%" stroke="currentColor" className="text-zinc-700" strokeWidth="1" strokeDasharray="4 3" />
      </svg>
    </div>
  );
}

const visualComponents: Record<Feature['visual'], React.FC<{ color: Feature['color'] }>> = {
  kanban: KanbanMockup,
  flow: FlowMockup,
  terminal: TerminalMockup,
  orchestration: OrchestrationMockup,
};

/* ---------- main component ---------- */

export default function FeatureSection() {
  const t = useTranslations('features');

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
                isEven ? 'lg:flex-row-reverse' : ''
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
                    style={{ fontFamily: 'var(--font-space-grotesk, "Space Grotesk", sans-serif)' }}
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
                      <span className={`mt-1 flex items-center justify-center w-5 h-5 rounded-full ${feature.color.bg} shrink-0`}>
                        <Check className={`w-3 h-3 ${feature.color.text}`} />
                      </span>
                      <span className="text-zinc-300 text-sm leading-relaxed">{t(`${feature.deepKey}.bullet${n}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Visual side */}
              <div className="flex-1 w-full max-w-xl">
                <div
                  className={`bg-zinc-900 border border-zinc-700/50 rounded-2xl p-6 ${feature.color.shadow} shadow-2xl`}
                >
                  <Visual color={feature.color} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
