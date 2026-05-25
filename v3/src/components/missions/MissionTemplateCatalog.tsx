import type { MissionTemplateId } from "../../types/mission";
import { listTemplates } from "./templates";

interface MissionTemplateCatalogProps {
  onSelect: (id: MissionTemplateId) => void;
  highlighted?: MissionTemplateId | null;
}

const WEIGHT_LABEL: Record<"light" | "medium" | "heavy", string> = {
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
};

const WEIGHT_COLOR: Record<"light" | "medium" | "heavy", string> = {
  light: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-blue-300 bg-blue-500/10 border-blue-500/30",
  heavy: "text-purple-300 bg-purple-500/10 border-purple-500/30",
};

export function MissionTemplateCatalog({
  onSelect,
  highlighted,
}: MissionTemplateCatalogProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {listTemplates().map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`flex h-full flex-col gap-2 rounded-xl border p-4 text-left transition-all hover:scale-[1.01] hover:bg-gray-800/60 ${
            highlighted === t.id
              ? "border-blue-500 bg-blue-500/10"
              : "border-gray-700 bg-gray-800/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-2xl leading-none">{t.emoji}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${WEIGHT_COLOR[t.weight]}`}
            >
              {WEIGHT_LABEL[t.weight]}
            </span>
          </div>
          <h3 className="text-base font-semibold text-gray-100">{t.label}</h3>
          <p className="text-xs text-gray-400">{t.description}</p>
          <div className="mt-auto flex flex-wrap gap-1 pt-2">
            {t.steps.slice(0, 6).map((s, i) => (
              <span
                key={i}
                className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[10px] text-gray-300"
              >
                {s.skill ?? `<${s.type}>`}
              </span>
            ))}
            {t.steps.length > 6 && (
              <span className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[10px] text-gray-300">
                +{t.steps.length - 6}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
