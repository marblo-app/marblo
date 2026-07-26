import { useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useQuickLaneModelStore } from "../../stores/quickLaneModelStore";
import { QuickLaneModelSelector } from "./QuickLaneModelSelector";
import {
  defaultSelection,
  describeSelection,
  type QuickLaneSelection,
} from "../../lib/quickLaneModel";

export interface LaneLaunchInput {
  title: string;
  /** 선택된 벤더·하네스·구체 모델·effort 전부. 레인 스폰이 쓰는 유일한 모델 축. */
  selection: QuickLaneSelection;
}

/**
 * 퀵레인 생성 모달.
 *
 * ★"시작" 은 **기다리지 않는다**. onLaunch 를 await 해서 성공한 뒤에 닫으면, 티켓
 * 생성 → 에이전트 doc 생성 → 워크트리 준비 → PTY 스폰 이 다 끝날 때까지(수 초)
 * 모달이 화면을 잡고 있고, 그동안 사용자는 두 번째 레인을 시작할 수 없다. 병렬이
 * 핵심인 탭에서 생성 자체가 직렬화되는 셈이다. 그래서 모달은 즉시 닫고, 진행은
 * 목록의 낙관적 카드(pending)가 대신 보여준다 — 실패해도 그 카드에 사유가 남는다.
 */
export function LaneCreateModal({
  onCancel,
  onLaunch,
}: {
  onCancel: () => void;
  onLaunch: (input: LaneLaunchInput) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [selection, setSelection] = useState<QuickLaneSelection | null>(null);
  const groups = useQuickLaneModelStore((s) => s.groups);
  const status = useQuickLaneModelStore((s) => s.status);

  // 카탈로그가 도착하면 첫 기본 선택을 세운다(쓸 수 있는 첫 벤더의 최상위 모델).
  // 이미 사용자가 고른 뒤라면 건드리지 않는다.
  useEffect(() => {
    if (status !== "ready" || selection) return;
    setSelection(defaultSelection(groups));
  }, [status, groups, selection]);

  const canStart = Boolean(title.trim() && selection);

  const submit = () => {
    if (!title.trim() || !selection) return;
    onLaunch({ title: title.trim(), selection });
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[85vh] w-[460px] overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 p-5 shadow-xl">
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

        <QuickLaneModelSelector selection={selection} onChange={setSelection} />

        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-[11px] text-gray-500">
            {selection ? describeSelection(selection) : ""}
          </span>
          <div className="flex flex-shrink-0 gap-2">
            <button
              onClick={onCancel}
              className="rounded px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
            >
              {t("lanes.create.cancel")}
            </button>
            <button
              onClick={submit}
              disabled={!canStart}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {t("lanes.create.start")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
