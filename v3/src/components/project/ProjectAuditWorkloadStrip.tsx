import { useTranslation } from "../../lib/i18n";
import type { AuditWorkloadTile } from "../../lib/projectAuditView";

/**
 * 구성원 워크로드 스트립 — "누가 무엇을 지고 있나"를 한 줄로.
 *
 * ★위쪽 `MemberWorkloadPanel` 과 **다른 축**이다. 저쪽은 결과(에이전트·티켓·머지
 * 현황), 이쪽은 **행위 수**(이 감사 창에서 그 사람에게 귀속된 기록). 같은 숫자를
 * 두 곳이 다르게 말하는 것처럼 보이지 않도록 부제에 근거를 밝힌다.
 *
 * ★이게 구성원 필터의 자리다. 예전엔 같은 일을 하는 `<select>` 가 따로 있었는데,
 * 드롭다운은 열기 전까지 "누가 몇 건인지"를 못 보여준다 — 운영자가 알고 싶은
 * 것의 절반이 선택지 안에 숨어 있었다. 타일로 펼치면 필터이자 동시에 분포다.
 *
 * 선택 상태는 두 종류다:
 *   - uid 타일  — 서버사이드 필터(actorUid). 창 절단이 없다.
 *   - 미귀속 타일 — uid 가 없어 서버에 걸 수 없다. **불러온 창 안에서만** 거르고,
 *     그 사실을 tooltip 으로 밝힌다(조용한 절단 금지).
 *
 * 숫자 옆의 `*` 는 그 수가 프로젝트 전체 집계가 아니라 **불러온 창 기준**이라는
 * 표시다(`countScope`). 두 범위를 같은 모양으로 찍으면 화면이 서버 집계인 척한다.
 */
export function ProjectAuditWorkloadStrip({
  tiles,
  selectedUid,
  unattributedOnly,
  onSelectUid,
  onSelectUnattributed,
  onClear,
}: {
  tiles: AuditWorkloadTile[];
  /** 현재 걸린 구성원 필터(uid). 없으면 null. */
  selectedUid: string | null;
  unattributedOnly: boolean;
  onSelectUid: (uid: string) => void;
  onSelectUnattributed: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  if (tiles.length === 0) return null;

  const allSelected = !selectedUid && !unattributedOnly;

  return (
    <div data-testid="audit-workload" className="mb-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-medium text-gray-300">
          {t("project.audit.admin.workloadTitle")}
        </span>
        <span className="text-[11px] text-gray-600">
          {t("project.audit.admin.workloadNote")}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onClear}
          aria-pressed={allSelected}
          className={`rounded border px-2 py-1 text-[11px] transition-colors ${
            allSelected
              ? "border-blue-500/60 bg-blue-500/10 text-blue-200"
              : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600"
          }`}
        >
          {t("project.audit.admin.workloadAll")}
        </button>

        {tiles.map((tile) => {
          const isUnattributed = tile.actorUid === null;
          const selected = isUnattributed
            ? unattributedOnly
            : selectedUid === tile.actorUid;
          return (
            <button
              key={tile.actorUid ?? "__unattributed__"}
              type="button"
              aria-pressed={selected}
              onClick={() =>
                isUnattributed
                  ? onSelectUnattributed()
                  : onSelectUid(tile.actorUid!)
              }
              title={
                isUnattributed
                  ? t("project.audit.admin.workloadUnattributedTip")
                  : (tile.actorUid ?? undefined)
              }
              className={`flex flex-col items-start rounded border px-2 py-1 text-left transition-colors ${
                selected
                  ? "border-blue-500/60 bg-blue-500/10"
                  : "border-gray-700 bg-gray-900 hover:border-gray-600"
              } ${isUnattributed ? "border-dashed" : ""}`}
            >
              <span className="flex items-center gap-1 text-[11px] text-gray-200">
                {isUnattributed
                  ? t("project.audit.admin.workloadUnattributed")
                  : (tile.label ?? tile.actorUid?.slice(0, 8))}
                {tile.attentionCount > 0 && (
                  <span className="rounded bg-red-900/50 px-1 text-[10px] text-red-300">
                    ⚠ {tile.attentionCount}
                  </span>
                )}
              </span>
              <span
                className="text-[10px] tabular-nums text-gray-500"
                title={
                  tile.countScope === "window"
                    ? t("project.audit.admin.workloadWindowScopeTip")
                    : undefined
                }
              >
                {t("project.audit.admin.workloadTile", {
                  actions: tile.actionCount,
                })}
                {tile.countScope === "window" && "*"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
