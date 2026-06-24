import { useState } from "react";
import type { ModelType } from "../../types/agent";
import { useTranslation } from "../../lib/i18n";

const HARNESSES: {
  value: ModelType;
  label: string;
  icon: string;
  command: string;
  color: string;
}[] = [
  {
    value: "claude",
    label: "Claude Code",
    icon: "🟣",
    command: "claude",
    color: "#a855f7",
  },
  {
    value: "gpt",
    label: "Codex CLI",
    icon: "🟢",
    command: "codex",
    color: "#10a37f",
  },
  {
    value: "antigravity",
    label: "Antigravity (agy)",
    icon: "🟠",
    command: "agy",
    color: "#f97316",
  },
];

export interface LaneLaunchInput {
  title: string;
  model: ModelType;
  command: string;
}

export function LaneCreateModal({
  onCancel,
  onLaunch,
}: {
  onCancel: () => void;
  onLaunch: (input: LaneLaunchInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [model, setModel] = useState<ModelType>("claude");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    const harness = HARNESSES.find((h) => h.value === model) ?? HARNESSES[0];
    setBusy(true);
    try {
      await onLaunch({ title: title.trim(), model, command: harness.command });
      onCancel();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] rounded-lg border border-gray-700 bg-gray-800 p-5 shadow-xl">
        <h3 className="mb-3 text-sm font-semibold text-gray-100">
          {t("lanes.create.title")}
        </h3>
        <label className="mb-1 block text-xs font-medium text-gray-400">
          {t("lanes.create.whatLabel")}
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={t("lanes.create.placeholder")}
          className="mb-4 w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
        <label className="mb-2 block text-xs font-medium text-gray-400">
          {t("lanes.create.agentLabel")}
        </label>
        <div className="mb-5 space-y-1.5">
          {HARNESSES.map((h) => (
            <button
              key={h.value}
              type="button"
              onClick={() => setModel(h.value)}
              className={`flex w-full items-center gap-3 rounded px-3 py-2 text-sm transition-colors ${
                model === h.value
                  ? "border border-gray-500 bg-gray-600 text-gray-100"
                  : "border border-gray-700 bg-gray-750 text-gray-400 hover:bg-gray-700"
              }`}
              style={
                model === h.value
                  ? { borderLeftColor: h.color, borderLeftWidth: 3 }
                  : undefined
              }
            >
              <span className="text-lg">{h.icon}</span>
              <span className="flex-1 text-left">{h.label}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
          >
            {t("lanes.create.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || busy}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? t("lanes.create.starting") : t("lanes.create.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
