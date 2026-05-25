import { useState } from "react";
import type { MissionTemplateId } from "../../types/mission";
import { TEMPLATE_META, listTemplates } from "./templates";

interface MissionLaunchDialogProps {
  initialTemplateId?: MissionTemplateId;
  onCancel: () => void;
  onLaunch: (input: {
    goal: string;
    templateId: MissionTemplateId;
  }) => Promise<void>;
}

export function MissionLaunchDialog({
  initialTemplateId,
  onCancel,
  onLaunch,
}: MissionLaunchDialogProps) {
  const [goal, setGoal] = useState("");
  const [templateId, setTemplateId] = useState<MissionTemplateId>(
    initialTemplateId ?? "feature",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLaunch = async () => {
    if (!goal.trim()) {
      setError("미션의 목표를 한 줄로 적어주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onLaunch({ goal: goal.trim(), templateId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  const template = TEMPLATE_META[templateId];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-800 shadow-2xl">
        <div className="border-b border-gray-700 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-100">
            🚀 Launch Mission
          </h3>
          <p className="mt-1 text-xs text-gray-400">
            한 줄 목표와 템플릿을 고르면 orchestrator 가 끝까지 책임지고
            진행합니다.
          </p>
        </div>
        <div className="space-y-5 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">
              목표 (한 줄)
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting) handleLaunch();
              }}
              placeholder='예: "로그인 페이지 만들어줘"'
              className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">
              템플릿
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
              {listTemplates().map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left text-xs transition-colors ${
                    templateId === t.id
                      ? "border-blue-500 bg-blue-500/10 text-blue-100"
                      : "border-gray-700 bg-gray-900/60 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  <span className="text-base">{t.emoji}</span>
                  <span className="font-medium">{t.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {template.description} · {template.steps.length} step
            </p>
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-gray-600 bg-gray-700/30 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700/60 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={submitting || !goal.trim()}
            className="rounded-lg border border-blue-500/50 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-500/30 disabled:opacity-50"
          >
            {submitting ? "시작 중..." : "🚀 Launch Mission"}
          </button>
        </div>
      </div>
    </div>
  );
}
