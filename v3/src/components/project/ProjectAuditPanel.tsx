import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "../../types/user";
import type { TaskStatus } from "../../types/task";
import { useTranslation } from "../../lib/i18n";
import {
  PROJECT_AUDIT_EVENT_TYPES,
  PROJECT_AUDIT_SINCE_VERSION,
} from "../../lib/projectAudit";
import {
  AUDIT_BOARD_SECTION_ID,
  agentTypeFilterValue,
  auditAgentClaimKeys,
  auditEmptyKind,
  auditMissionOptions,
  auditSourceNotices,
  auditTypeLabelKey,
  auditWorkloadTiles,
  buildAuditAdminView,
  groupAuditRowsByTicket,
  isAuditLoading,
  isFullyDenied,
  isLowSignalAuditRow,
  resolveTaskLabel,
  type AuditActorKindFilter,
  type AuditSourceNotice,
} from "../../lib/projectAuditView";
import { useProjectAuditLog } from "../../hooks/useProjectAuditLog";
import { useAgentStore } from "../../stores/agentStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { ProjectAuditAttention } from "./ProjectAuditAttention";
import { ProjectAuditMissionSectionView } from "./ProjectAuditMissionSection";
import { ProjectAuditTicketDetail } from "./ProjectAuditTicketDetail";
import { ProjectAuditWorkloadStrip } from "./ProjectAuditWorkloadStrip";

/**
 * 감사 로그 — 프로젝트 탭의 세 번째 블록. **관리자/오퍼레이터 뷰.**
 *
 * ★이 화면은 세 질문에만 답한다(그 순서대로 배치돼 있다):
 *   1. 지금 손이 필요한 게 있나  → 맨 위 주의 필요 배너(필터 무시).
 *   2. 누가 무엇을 지고 있나      → 구성원 워크로드 스트립(= 구성원 필터).
 *   3. 이 티켓/미션은 어디까지 갔나 → 미션 → 티켓 카드 → (펼치면) 이벤트 타임라인.
 *
 * 예전에는 같은 데이터를 최신순 한 줄씩 쏟아냈고(firehose), 한 티켓이
 * created→claimed→dispatched→status→submitted 로 4~5줄씩 흩어져 위 셋 중
 * 어느 것도 답이 안 나왔다(사장님 도그푸딩 피드백). 데이터·캡처·권한은 하나도
 * 안 바뀌었다 — **접는 방식만** 바뀌었고, 티켓 카드를 펼치면 옛 타임라인이
 * 원문 그대로 다시 보인다.
 *
 * ★소스는 **둘**이다:
 *   - `projectAuditLog` — 렌더러발 **사람** 행위
 *   - `audit_logs` 원장 — MCP 툴 호출 = **오케(에이전트)** 행위
 * 한쪽만 읽던 시절엔 정상 운영 중에도 화면이 거의 비어 있었다. 보드 이동의
 * 대다수가 에이전트발이라 사람 쪽 컬렉션엔 잡히지 않기 때문인데, owner 는 그
 * 빈 화면을 기능 고장으로 읽는다.
 *
 * ★병합도 이 재설계도 **읽기 전용**이다. 새 write 도 새 룰도 만들지 않는다. 특히
 * 원장의 read 등급(`canReadLedgerDoc()` = 프로젝트 멤버 전원)은 절대 조이지
 * 않는다 — 우측 ActivityStreamPanel 이 같은 컬렉션을 구독하므로 조이는 순간
 * 일반 멤버의 액티비티 스트림이 통째로 죽는다(#406/#428). 배너의 "보드에서
 * 재배정"이 여기서 직접 재배정하지 않고 보드로 보내는 이유도 같다 — 쓰기는
 * 자기 초크포인트를 지나야 한다.
 *
 * 권한은 두 겹이다:
 *   1) 호출부(ProjectTab)가 canViewAuditLog(owner/admin)로 1차 게이트.
 *   2) 그래도 여기서 permission-denied 를 처리한다 — 룰이 최종 권한이고,
 *      역할 캐시가 낡았거나(막 강등됨) 룰이 더 좁을 수 있다. 소스마다 등급이
 *      달라서 **한쪽만 거부되는 것이 정상 상태**이고, 그때는 살아남은 소스를
 *      보여주되 무엇이 빠졌는지 말한다.
 */

interface ProjectAuditPanelProps {
  projectId: string;
  /** 이름 메꿈용. 사람 행은 기록 시점 actorName 이 빌 때, 오케 행은 항상 쓴다. */
  members: User[];
}

const ALL = "__all__";
/** 구성원 필터의 특수값 — uid 가 없는 행만. 서버에 걸 수 없어 창 안에서만 거른다. */
const UNATTRIBUTED = "__unattributed__";

const TASK_STATUS_OPTIONS: TaskStatus[] = [
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "FAILED",
  "DONE",
];

export function ProjectAuditPanel({
  projectId,
  members,
}: ProjectAuditPanelProps) {
  const { t, locale } = useTranslation();

  // 서버사이드 축 — 재조회를 유발한다. "최근 100건 안에 그 사람이 3건뿐" 같은
  // 절단이 없어야 하는 두 필터라 클라이언트로 내리지 않는다.
  const [actorUid, setActorUid] = useState<string>(ALL);
  const [type, setType] = useState<string>(ALL);

  // 클라이언트 축 — 이미 불러온 행을 접는 방식만 바꾼다(재조회 없음).
  const [actorKind, setActorKind] = useState<AuditActorKindFilter>("all");
  const [status, setStatus] = useState<TaskStatus | "all">("all");
  const [mission, setMission] = useState<string>("all");
  const [showLowSignal, setShowLowSignal] = useState(false);

  const actorFilter =
    actorUid === ALL || actorUid === UNATTRIBUTED ? undefined : actorUid;
  const typeFilter = type === ALL ? undefined : type;

  const nameByUid = useMemo(
    () =>
      Object.fromEntries(
        members.map((m) => [m.id, m.displayName || m.email || m.id]),
      ),
    [members],
  );

  const {
    rows,
    sources,
    actors,
    toolNames,
    taskMetaById,
    missionMetaById,
    reload,
  } = useProjectAuditLog(projectId, actorFilter, typeFilter, nameByUid);

  const worktrees = useWorktreeStore((s) => s.worktrees);
  const ensureFreshWorktrees = useWorktreeStore((s) => s.ensureFresh);
  useEffect(() => {
    ensureFreshWorktrees().catch(() => {});
  }, [ensureFreshWorktrees, projectId]);

  // 고아 클레임 판정의 근거. ★`hydrated` 전에는 **null 을 넘긴다** — 빈 목록을
  // "살아 있는 에이전트가 없다"로 읽으면 콜드 부팅 한 프레임 동안 진행 중인
  // 티켓이 전부 고아로 튄다(agentStore.hydrated 주석이 같은 함정을 적어 뒀다).
  const agents = useAgentStore((s) => s.agents);
  const agentsHydrated = useAgentStore((s) => s.hydrated);
  const liveAgentKeys = useMemo(
    () => (agentsHydrated ? auditAgentClaimKeys(agents) : null),
    [agents, agentsHydrated],
  );

  const notices = auditSourceNotices(sources);
  const loading = isAuditLoading(sources);

  // 저신호 기본 숨김 — 텔레그램 발송·메모(add_activity)는 커뮤니케이션
  // 부산물이라 기본으로 접어둔다. 캡처(audit_logs)는 그대로고 표시만 가린다 —
  // 토글을 켜면 즉시 다시 보인다.
  const signalRows = useMemo(
    () =>
      showLowSignal ? rows : rows.filter((row) => !isLowSignalAuditRow(row)),
    [rows, showLowSignal],
  );
  const hiddenLowSignalCount = rows.length - signalRows.length;

  // 미귀속 필터는 서버에 걸 수 없다(uid 가 없는 행을 where 로 못 고른다).
  // 창 안에서만 거르고, 그 사실은 스트립의 tooltip 이 밝힌다.
  const visibleRows = useMemo(
    () =>
      actorUid === UNATTRIBUTED
        ? signalRows.filter((row) => !row.actorUid)
        : signalRows,
    [signalRows, actorUid],
  );

  const view = useMemo(
    () =>
      buildAuditAdminView(visibleRows, {
        taskMetaById,
        missionMetaById,
        liveAgentKeys,
        filters: { actorKind, status, mission },
      }),
    [
      visibleRows,
      taskMetaById,
      missionMetaById,
      liveAgentKeys,
      actorKind,
      status,
      mission,
    ],
  );

  // 워크로드 타일은 **필터 전** 그룹으로 센다 — 필터를 걸면 타일이 그 필터의
  // 결과로 줄어들어서, 다른 사람으로 바꿀 수단이 화면에서 사라진다(구성원
  // 드롭다운이 자기 자신을 가두던 것과 같은 함정, useProjectAuditLog 주석 참조).
  const workloadTiles = useMemo(
    () =>
      auditWorkloadTiles(
        groupAuditRowsByTicket(signalRows, taskMetaById, { liveAgentKeys }),
        actors,
      ),
    [signalRows, taskMetaById, liveAgentKeys, actors],
  );

  const missionOptions = useMemo(
    () => auditMissionOptions(view.sections),
    [view.sections],
  );

  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleTicket = (key: string) =>
    setExpandedTickets((prior) => {
      const next = new Set(prior);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 티켓 클릭 → 그 티켓의 원장 상세. 목록 조회와는 별개의 taskId 스코프 조회라
  // 여기 state 하나로만 열고 닫는다 — 목록의 필터와 무관.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // 배너/카드의 "보드에서 재배정" — 이 패널은 읽기 전용이라 쓰기(재배정)는
  // 보드의 초크포인트로 넘긴다. Layout 이 탭을 바꾸고 BoardTab 이 잡을 소비한다.
  const openOnBoard = (taskId: string) =>
    useNavigationStore.getState().requestJump({ type: "task", id: taskId });

  const filtersActive =
    actorKind !== "all" || status !== "all" || mission !== "all";
  const resetFilters = () => {
    setActorKind("all");
    setStatus("all");
    setMission("all");
  };

  // 두 소스가 **모두** 거부됐을 때만 전체 거부 화면. 한쪽만 거부면 살아남은
  // 쪽을 보여준다 — 조용히 사라지면 owner 가 "감사 기능이 없어졌나?" 로 읽는다.
  if (isFullyDenied(sources)) {
    return (
      <Shell>
        <div className="rounded border border-dashed border-gray-700 bg-gray-900/50 px-4 py-8 text-center">
          <p className="text-sm text-gray-400">{t("project.audit.denied")}</p>
          <p className="mt-1 text-xs text-gray-500">
            {t("project.audit.deniedDesc")}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* ①문제 우선. 로딩 중에는 "문제 없음"을 단정하지 않으려고 통째로 뺀다. */}
      {!loading && (
        <ProjectAuditAttention
          groups={view.attention}
          locale={locale}
          onOpenTicket={setSelectedTaskId}
          onOpenBoard={openOnBoard}
        />
      )}

      {/* ②누가 무엇을 지고 있나 — 동시에 구성원 필터. */}
      {!loading && (
        <ProjectAuditWorkloadStrip
          tiles={workloadTiles}
          selectedUid={actorFilter ?? null}
          unattributedOnly={actorUid === UNATTRIBUTED}
          onSelectUid={(uid) => setActorUid(uid === actorUid ? ALL : uid)}
          onSelectUnattributed={() =>
            setActorUid(actorUid === UNATTRIBUTED ? ALL : UNATTRIBUTED)
          }
          onClear={() => setActorUid(ALL)}
        />
      )}

      {/* ③필터 바 — 축이 서로 다르다. 종류는 **소스를 가르는 서버 필터**,
          나머지 셋은 이미 불러온 것을 접는 클라이언트 필터다. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          aria-label={t("project.audit.filterType")}
        >
          <option value={ALL}>{t("project.audit.filterTypeAll")}</option>
          <optgroup label={t("project.audit.filterTypeHumanGroup")}>
            {PROJECT_AUDIT_EVENT_TYPES.map((eventType) => (
              <option key={eventType} value={eventType}>
                {t(auditTypeLabelKey(eventType))}
              </option>
            ))}
          </optgroup>
          {/* 오케 행위 종류 = 창에 **실제로 등장한** 툴 이름. 전체 툴 목록을
              박아두면 고르는 족족 0건이라 필터가 고장난 것처럼 보인다. */}
          {toolNames.length > 0 && (
            <optgroup label={t("project.audit.filterTypeAgentGroup")}>
              {toolNames.map((toolName) => (
                <option key={toolName} value={agentTypeFilterValue(toolName)}>
                  {toolName}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <select
          value={actorKind}
          onChange={(e) => setActorKind(e.target.value as AuditActorKindFilter)}
          className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          aria-label={t("project.audit.admin.filterActorKind")}
        >
          <option value="all">
            {t("project.audit.admin.filterActorKindAll")}
          </option>
          <option value="human">
            {t("project.audit.admin.filterActorKindHuman")}
          </option>
          <option value="orchestrator">
            {t("project.audit.admin.filterActorKindOrchestrator")}
          </option>
          <option value="agent">
            {t("project.audit.admin.filterActorKindAgent")}
          </option>
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus | "all")}
          className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          aria-label={t("project.audit.admin.filterStatus")}
        >
          <option value="all">
            {t("project.audit.admin.filterStatusAll")}
          </option>
          {TASK_STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <select
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          className="max-w-[14rem] rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          aria-label={t("project.audit.admin.filterMission")}
        >
          <option value="all">
            {t("project.audit.admin.filterMissionAll")}
          </option>
          <option value={AUDIT_BOARD_SECTION_ID}>
            {t("project.audit.admin.boardSection")}
          </option>
          {missionOptions.map((option) => (
            <option key={option.missionId} value={option.missionId}>
              {option.label} ({option.ticketCount})
            </option>
          ))}
        </select>

        {!loading && view.ticketCount > 0 && (
          <span className="text-xs text-gray-600">
            {t("project.audit.admin.missionSummary", {
              tickets: view.ticketCount,
              actions: view.actionCount,
            })}
          </span>
        )}

        {filtersActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200"
          >
            {t("project.audit.admin.filterReset")}
            {view.hiddenByFilterCount > 0 && (
              <span className="ml-1 text-gray-600">
                {t("project.audit.admin.filterHidden", {
                  count: view.hiddenByFilterCount,
                })}
              </span>
            )}
          </button>
        )}

        {/* 저신호(텔레그램 발송·메모) 기본 숨김 토글 — 캡처는 그대로고 표시만
            가린다. 무엇이 숨었는지 항상 말한다(감사에서 조용한 절단은 최악). */}
        <label className="ml-auto flex flex-shrink-0 items-center gap-1 text-[11px] text-gray-500">
          <input
            type="checkbox"
            checked={showLowSignal}
            onChange={(e) => setShowLowSignal(e.target.checked)}
            className="h-3 w-3 rounded border-gray-600 bg-gray-900"
          />
          {t("project.audit.lowSignalToggle")}
          {!showLowSignal && hiddenLowSignalCount > 0 && (
            <span className="text-gray-600">
              {t("project.audit.lowSignalHiddenCount", {
                count: hiddenLowSignalCount,
              })}
            </span>
          )}
        </label>
      </div>

      {/* 부분 실패 안내 — 살아남은 소스는 보여주되 무엇이 빠졌는지 항상 말한다.
          말하지 않으면 반쪽 타임라인을 전부로 읽는다(빈 화면보다 나쁘다). */}
      {notices.length > 0 && (
        <div className="mb-3 space-y-1">
          {notices.map((notice) => (
            <SourceNotice
              key={notice.source}
              notice={notice}
              onRetry={reload}
            />
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-10">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
        </div>
      )}

      {!loading &&
        (rows.length === 0 ? (
          notices.length === 0 && (
            <EmptyState actorUid={actorFilter} type={typeFilter} />
          )
        ) : signalRows.length === 0 ? (
          // 필터 탓 빈 화면과 진짜 0건을 가르는 것과 같은 이유 — 전부 저신호라
          // 숨겨졌을 뿐 기록 자체가 없는 게 아니다. 빈 박스 대신 토글 안내.
          <div className="rounded border border-dashed border-gray-700 bg-gray-900/50 px-4 py-6 text-center">
            <button
              type="button"
              onClick={() => setShowLowSignal(true)}
              className="text-xs text-gray-400 underline decoration-dotted hover:text-gray-300"
            >
              {t("project.audit.lowSignalOnlyEmpty", {
                count: hiddenLowSignalCount,
              })}
            </button>
          </div>
        ) : view.sections.length === 0 ? (
          <div className="rounded border border-dashed border-gray-700 bg-gray-900/50 px-4 py-6 text-center">
            <p className="text-xs text-gray-400">
              {t("project.audit.admin.emptySection")}
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-2 rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:bg-gray-800"
            >
              {t("project.audit.admin.filterReset")}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {view.sections.map((section) => (
              <ProjectAuditMissionSectionView
                key={section.key}
                section={section}
                locale={locale}
                worktrees={worktrees}
                expandedTickets={expandedTickets}
                onToggleTicket={toggleTicket}
                onOpenTicket={setSelectedTaskId}
                onOpenBoard={openOnBoard}
              />
            ))}
          </div>
        ))}

      {selectedTaskId && (
        <ProjectAuditTicketDetail
          projectId={projectId}
          taskId={selectedTaskId}
          taskTitle={resolveTaskLabel(
            selectedTaskId,
            Object.fromEntries(
              Object.values(taskMetaById)
                .filter((meta) => meta.title)
                .map((meta) => [meta.id, meta.title as string]),
            ),
          )}
          nameByUid={nameByUid}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </Shell>
  );
}

/**
 * 소스 하나가 죽었을 때의 안내.
 *
 * 거부와 장애를 **다른 문구**로 가른다 — 한 문장으로 뭉개면 owner 가 권한
 * 문제를 장애로, 장애를 권한 문제로 읽는다. 장애일 때만 원문 메시지를 노출한다
 * (인덱스 누락 같은 실제 원인이 여기 말고는 드러날 데가 없다).
 */
function SourceNotice({
  notice,
  onRetry,
}: {
  notice: AuditSourceNotice;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const denied = notice.state.status === "denied";
  const label = denied
    ? notice.source === "human"
      ? t("project.audit.notice.humanDenied")
      : t("project.audit.notice.agentDenied")
    : notice.source === "human"
      ? t("project.audit.notice.humanError")
      : t("project.audit.notice.agentError");

  return (
    <div
      className={`rounded border px-3 py-2 ${
        denied
          ? "border-gray-700 bg-gray-900/50"
          : "border-red-900/60 bg-red-950/30"
      }`}
    >
      <p className={`text-xs ${denied ? "text-gray-400" : "text-red-300"}`}>
        {label}
      </p>
      {notice.state.status === "error" && (
        <>
          <p className="mt-1 break-words text-[11px] text-red-400/70">
            {notice.state.message}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded border border-red-800 px-2 py-1 text-[11px] text-red-200 transition-colors hover:bg-red-900/40"
          >
            {t("project.audit.retry")}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * 빈 목록 안내.
 *
 * 필터 탓인 빈 화면과 진짜 0건을 가른다 — 필터를 걸어놓고 "{version} 부터
 * 쌓입니다"를 읽으면 전혀 엉뚱한 결론에 도달한다.
 *
 * 두 소스를 함께 읽게 된 뒤로 이 화면은 예전만큼 자주 뜨지 않는다(예전엔
 * 에이전트 행위가 통째로 빠져서 정상 운영 중에도 비어 있었다). 그래도 여전히
 * 여기 안 잡히는 것이 있어서 — 앱 밖에서 한 일, MCP 툴을 거치지 않은 파일
 * 수정 — 무엇이 안 잡히는지는 계속 말해준다.
 */
function EmptyState({ actorUid, type }: { actorUid?: string; type?: string }) {
  const { t } = useTranslation();
  const kind = auditEmptyKind({ actorUid, type });

  return (
    <div className="rounded border border-dashed border-gray-700 bg-gray-900/50 px-4 py-8 text-center">
      {kind === "filtered" ? (
        <>
          <p className="text-sm text-gray-400">
            {t("project.audit.emptyFilteredTitle")}
          </p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-gray-500">
            {t("project.audit.emptyFilteredDesc")}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-400">
            {t("project.audit.emptyTitle")}
          </p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-gray-500">
            {t("project.audit.emptyDesc", {
              version: PROJECT_AUDIT_SINCE_VERSION,
            })}
          </p>
          <p className="mx-auto mt-2 max-w-lg text-xs text-gray-600">
            {t("project.audit.emptyAgentNote")}
          </p>
        </>
      )}
    </div>
  );
}

/** 제목 줄 + 테두리. 어떤 상태(로딩·거부·에러·빈 목록)든 같은 껍데기 안에서
 *  바뀌게 해서, 섹션이 통째로 나타났다 사라지며 레이아웃이 튀지 않게 한다. */
function Shell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-200">
          {t("project.audit.heading")}
        </h3>
        <span className="text-xs text-gray-500">
          {t("project.audit.sourceNote")}
        </span>
      </div>
      {children}
    </div>
  );
}
