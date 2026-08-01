import { useState } from "react";
import type { ReplayVisibilityLevel } from "../../../types/missionReplay";

export interface ReplayVisibilityPanelProps {
  level?: ReplayVisibilityLevel;
  includeCost?: boolean;
  creditEnabled?: boolean;
  creditHandle?: string;
  includeIncomplete?: boolean;
  onLevelChange?: (level: ReplayVisibilityLevel) => void;
  onIncludeCostChange?: (enabled: boolean) => void;
  onCreditChange?: (value: { enabled: boolean; handle: string }) => void;
  onIncludeIncompleteChange?: (enabled: boolean) => void;
}

const LEVELS: ReadonlyArray<{
  value: ReplayVisibilityLevel;
  label: string;
  description: string;
}> = [
  { value: "L0", label: "비공개", description: "앱 안에만 보관합니다." },
  { value: "L1", label: "과정만", description: "진행·상태·수치와 익명 캐스트만 포함합니다." },
  { value: "L2", label: "일부 (권장)", description: "L1 + 통과한 요약·공개 저장소 PR을 포함합니다." },
  { value: "L3", label: "전체", description: "코드·터미널 발췌가 포함될 수 있습니다." },
];

export function ReplayVisibilityPanel({
  level: controlledLevel = "L2",
  includeCost: controlledCost = false,
  creditEnabled: controlledCredit = false,
  creditHandle: controlledHandle = "",
  includeIncomplete: controlledIncomplete = false,
  onLevelChange,
  onIncludeCostChange,
  onCreditChange,
  onIncludeIncompleteChange,
}: ReplayVisibilityPanelProps) {
  const [level, setLevel] = useState(controlledLevel);
  const [includeCost, setIncludeCost] = useState(controlledCost);
  const [creditEnabled, setCreditEnabled] = useState(controlledCredit);
  const [handle, setHandle] = useState(controlledHandle);
  const [includeIncomplete, setIncludeIncomplete] = useState(controlledIncomplete);
  const [pendingL3, setPendingL3] = useState(false);

  const changeLevel = (next: ReplayVisibilityLevel) => {
    if (next === "L3") {
      setPendingL3(true);
      return;
    }
    setLevel(next);
    onLevelChange?.(next);
  };
  const changeCredit = (enabled: boolean, nextHandle = handle) => {
    setCreditEnabled(enabled);
    onCreditChange?.({ enabled, handle: nextHandle });
  };

  return (
    <section aria-labelledby="replay-visibility-title" className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <div>
        <h3 id="replay-visibility-title" className="text-sm font-semibold text-gray-200">공개 등급</h3>
        <p className="mt-1 text-xs text-gray-500">기본값은 L2이며, 선택한 미션에만 적용됩니다.</p>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Mission Replay 공개 등급</legend>
        {LEVELS.map((item) => (
          <label key={item.value} className="flex cursor-pointer gap-2 rounded-lg border border-gray-800 p-3 hover:border-gray-600">
            <input type="radio" name="replay-visibility" value={item.value} checked={level === item.value} onChange={() => changeLevel(item.value)} />
            <span>
              <span className="block text-xs font-medium text-gray-200">{item.value} · {item.label}</span>
              <span className="mt-1 block text-[11px] text-gray-500">{item.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-2 border-t border-gray-800 pt-3">
        <label className="flex items-start gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={includeCost} onChange={(event) => { setIncludeCost(event.target.checked); onIncludeCostChange?.(event.target.checked); }} />
          <span><span className="font-medium">비용 공개</span><span className="block text-[11px] text-gray-500">독립 opt-in · 기본 OFF</span></span>
        </label>
        <label className="flex items-start gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={creditEnabled} onChange={(event) => changeCredit(event.target.checked)} />
          <span className="min-w-0 flex-1"><span className="font-medium">크레딧 표시</span><span className="block text-[11px] text-gray-500">기본 익명 · 원하는 핸들을 직접 선택</span>
            {creditEnabled && <input aria-label="크레딧 핸들" value={handle} onChange={(event) => { setHandle(event.target.value); onCreditChange?.({ enabled: true, handle: event.target.value }); }} placeholder="@handle" className="mt-2 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200" />}
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={includeIncomplete} onChange={(event) => { setIncludeIncomplete(event.target.checked); onIncludeIncompleteChange?.(event.target.checked); }} />
          <span><span className="font-medium">실패·중단 미션도 후보에 포함</span><span className="block text-[11px] text-gray-500">기본은 완료 미션만</span></span>
        </label>
      </div>

      {pendingL3 && (
        <div role="dialog" aria-modal="true" aria-labelledby="replay-l3-title" className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3">
          <h4 id="replay-l3-title" className="text-xs font-semibold text-amber-200">L3 공개를 확인하세요</h4>
          <p className="mt-1 text-xs text-amber-100/80">코드와 터미널 출력이 포함될 수 있습니다. 회사 프로젝트라면 L2를 권장합니다.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300" onClick={() => setPendingL3(false)}>취소</button>
            <button type="button" className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-gray-950" onClick={() => { setLevel("L3"); setPendingL3(false); onLevelChange?.("L3"); }}>확인</button>
          </div>
        </div>
      )}
    </section>
  );
}
