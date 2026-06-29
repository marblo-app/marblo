import { type DragEvent } from "react";
import type { NodeType } from "../../types/flow";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";

interface PaletteItem {
  type: NodeType;
  label: string;
  icon: string;
  color: string;
  descKey: MessageKey;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: "input",
    label: "Input",
    icon: "📥",
    color: "border-green-500/50 hover:bg-green-900/20",
    descKey: "flows.palette.input",
  },
  {
    type: "llm",
    label: "LLM",
    icon: "🧠",
    color: "border-purple-500/50 hover:bg-purple-900/20",
    descKey: "flows.palette.llm",
  },
  {
    type: "agent",
    label: "Agent",
    icon: "🤖",
    color: "border-blue-500/50 hover:bg-blue-900/20",
    descKey: "flows.palette.agent",
  },
  {
    type: "code",
    label: "Code",
    icon: "💻",
    color: "border-emerald-500/50 hover:bg-emerald-900/20",
    descKey: "flows.palette.code",
  },
  {
    type: "api",
    label: "API",
    icon: "🌐",
    color: "border-orange-500/50 hover:bg-orange-900/20",
    descKey: "flows.palette.api",
  },
  {
    type: "integration",
    label: "Integration",
    icon: "🔗",
    color: "border-rose-500/50 hover:bg-rose-900/20",
    descKey: "flows.palette.integration",
  },
  {
    type: "human",
    label: "Human",
    icon: "👤",
    color: "border-yellow-500/50 hover:bg-yellow-900/20",
    descKey: "flows.palette.human",
  },
  {
    type: "branch",
    label: "Branch",
    icon: "🔀",
    color: "border-cyan-500/50 hover:bg-cyan-900/20",
    descKey: "flows.palette.branch",
  },
  {
    type: "output",
    label: "Output",
    icon: "📤",
    color: "border-pink-500/50 hover:bg-pink-900/20",
    descKey: "flows.palette.output",
  },
];

function onDragStart(event: DragEvent, nodeType: NodeType) {
  event.dataTransfer.setData("application/reactflow", nodeType);
  event.dataTransfer.effectAllowed = "move";
}

export function NodePalette() {
  const { t } = useTranslation();
  return (
    <div className="p-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Nodes
      </h3>
      <div className="space-y-1.5">
        {PALETTE_ITEMS.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-md border ${item.color} bg-gray-800/50 cursor-grab active:cursor-grabbing transition-colors`}
          >
            <span className="text-base flex-shrink-0">{item.icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-200">{item.label}</p>
              <p className="text-[11px] text-gray-500 truncate">
                {t(item.descKey)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
