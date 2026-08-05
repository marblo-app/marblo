import { useMemo, useState, type ReactNode } from "react";
import type { User } from "../../types/user";
import { useTranslation } from "../../lib/i18n";
import {
  PROJECT_AUDIT_EVENT_TYPES,
  PROJECT_AUDIT_SINCE_VERSION,
} from "../../lib/projectAudit";
import {
  agentTypeFilterValue,
  auditBadgeKind,
  auditEmptyKind,
  auditSourceNotices,
  auditTypeLabelKey,
  foldAuditRows,
  isAuditLoading,
  isFullyDenied,
  resolveActorLabel,
  resolveTaskLabel,
  type AuditRowGroup,
  type AuditRowLabel,
  type AuditSourceNotice,
  type UnifiedAuditRow,
} from "../../lib/projectAuditView";
import { useProjectAuditLog } from "../../hooks/useProjectAuditLog";
import { ProjectAuditTicketDetail } from "./ProjectAuditTicketDetail";

/**
 * 감사 로그 — 프로젝트 탭의 세 번째 블록.
 *
 * 위의 작업량 패널은 **결과**(에이전트·티켓·머지가 지금 어떤 상태인가)를 보고,
 * 이 패널은 **행위**(누가 언제 무엇을 했나)를 본다. 나란히 두면 구성원별로
 * "얼마나 지고 있나 + 실제로 무엇을 했나"가 한 화면에서 맞물린다.
 *
 * ★소스는 **둘**이다(예전엔 하나였고, 그게 이 패널의 가장 큰 갭이었다):
 *   - `projectAuditLog` — 렌더러발 **사람** 행위
 *   - `audit_logs` 원장 — MCP 툴 호출 = **오케(에이전트)** 행위
 * 한쪽만 읽던 시절엔 정상 운영 중에도 화면이 거의 비어 있었다. 보드 이동의
 * 대다수가 에이전트발이라 사람 쪽 컬렉션엔 잡히지 않기 때문인데, owner 는 그
 * 빈 화면을 기능 고장으로 읽는다. 이제 두 소스를 겹쳐 본다.
 *
 * ★병합은 **읽기 전용**이다. 새 write 도 새 룰도 만들지 않는다. 특히 원장의
 * read 등급(`canReadLedgerDoc()` = 프로젝트 멤버 전원)은 절대 조이지 않는다 —
 * 우측 ActivityStreamPanel 이 같은 컬렉션을 구독하므로 조이는 순간 일반 멤버의
 * 액티비티 스트림이 통째로 죽는다(#406/#428). 이 패널은 owner/admin 이 두 등급
 * **모두를 읽을 수 있다**는 사실만 쓴다 — 상위집합을 읽는 방향.
 *
 * 권한은 두 겹이다:
 *   1) 호출부(ProjectTab)가 canViewAuditLog(owner/admin)로 1차 게이트.
 *   2) 그래도 여기서 permission-denied 를 처리한다 — 룰이 최종 권한이고,
 *      역할 캐시가 낡았거나(막 강등됨) 룰이 더 좁을 수 있다. UI 판정만 믿고
 *      throw 를 방치하면 감사 섹션 하나가 프로젝트 탭 전체를 날린다.
 *      소스마다 등급이 달라서 **한쪽만 거부되는 것이 정상 상태**이고, 그때는
 *      살아남은 소스를 보여주되 무엇이 빠졌는지 말한다.
 */

interface ProjectAuditPanelProps {
  projectId: string;
  /** 이름 메꿈용. 사람 행은 기록 시점 actorName 이 빌 때, 오케 행은 항상 쓴다. */
  members: User[];
}

const ALL = "__all__";

export function ProjectAuditPanel({
  projectId,
  members,
}: ProjectAuditPanelProps) {
  const { t, locale } = useTranslation();
  const [actorUid, setActorUid] = useState<string>(ALL);
  const [type, setType] = useState<string>(ALL);

  const actorFilter = actorUid === ALL ? undefined : actorUid;
  const typeFilter = type === ALL ? undefined : type;

  const nameByUid = useMemo(
    () =>
      Object.fromEntries(
        members.map((m) => [m.id, m.displayName || m.email || m.id]),
      ),
    [members],
  );

  const { rows, sources, actors, toolNames, taskTitleById, reload } =
    useProjectAuditLog(projectId, actorFilter, typeFilter, nameByUid);

  const notices = auditSourceNotices(sources);
  const loading = isAuditLoading(sources);

  // 노이즈 접기 — 같은 티켓에 연속으로 쌓인 add_activity 를 한 그룹으로 접는다.
  // 순수함수라 렌더 중에 접어도 안전(재조회 없음).
  const displayRows = useMemo(() => foldAuditRows(rows), [rows]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleGroup = (key: string) =>
    setExpandedGroups((prior) => {
      const next = new Set(prior);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 티켓 클릭 → 그 티켓의 원장 상세(티켓 U6ITRR38Z3c4MGLyg2PU). 목록 조회와는
  // 별개의 taskId 스코프 조회라 여기 state 하나로만 열고 닫는다 — 목록의
  // 필터·페이지네이션과 무관.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

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
      {/* 필터 — 구성원별 조회가 이 패널의 핵심 용례라 맨 위에 둔다. 서버사이드
          필터라서 "최근 100건 안에 그 사람이 3건뿐" 같은 절단이 없다. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={actorUid}
          onChange={(e) => setActorUid(e.target.value)}
          className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          aria-label={t("project.audit.filterActor")}
        >
          <option value={ALL}>{t("project.audit.filterActorAll")}</option>
          {actors.map((a) => (
            <option key={a.actorUid} value={a.actorUid}>
              {resolveActorLabel(a, nameByUid)} ({a.count})
            </option>
          ))}
        </select>

        {/* 종류 필터는 **소스를 가른다**: 사람 종류를 고르면 원장을 조회하지
            않고, 툴 이름을 고르면 사람 쪽을 조회하지 않는다. 두 축의 값이 한
            <select> 에 섞이므로 오케 쪽은 `tool:` 접두사로 못 박는다. */}
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

        {!loading && rows.length > 0 && (
          <span className="text-xs text-gray-600">
            {t("project.audit.count", { count: rows.length })}
          </span>
        )}
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
        ) : (
          <ul className="divide-y divide-gray-800">
            {displayRows.map((displayRow) =>
              displayRow.kind === "group" ? (
                <AuditGroupRow
                  key={displayRow.key}
                  group={displayRow}
                  expanded={expandedGroups.has(displayRow.key)}
                  onToggle={() => toggleGroup(displayRow.key)}
                  locale={locale}
                  taskTitleById={taskTitleById}
                  onOpenTicket={setSelectedTaskId}
                />
              ) : (
                <AuditRow
                  key={displayRow.row.key}
                  row={displayRow.row}
                  locale={locale}
                  taskTitleById={taskTitleById}
                  onOpenTicket={setSelectedTaskId}
                />
              ),
            )}
          </ul>
        ))}

      {selectedTaskId && (
        <ProjectAuditTicketDetail
          projectId={projectId}
          taskId={selectedTaskId}
          taskTitle={resolveTaskLabel(selectedTaskId, taskTitleById)}
          nameByUid={nameByUid}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </Shell>
  );
}

/**
 * 뱃지 하나 — 사람 / 오케(에이전트, 모델 있음) / 오케(컨트롤플레인, 모델 없음).
 *
 * ★세 갈래로 가르는 이유: 지금 오케가 사장님 uid 로 행동해 사람 행과 오케 행이
 * 이름만으로는 안 갈린다("John Kim" 이 둘 다에 뜬다). `actorKind`+`model` 로
 * 시각 구분을 강제한다. 모델이 없는 오케 행은 "모델 미상"(오류처럼 읽힘)이
 * 아니라 "오케 조작"(정상 분류 — 스폰된 에이전트 없이 오케 자신이 MCP 툴을
 * 직접 호출한 행위)으로 구분한다.
 */
export function AuditBadge({
  row,
}: {
  row: Pick<UnifiedAuditRow, "actorKind" | "model">;
}) {
  const { t } = useTranslation();
  const kind = auditBadgeKind(row);

  if (kind === "human") {
    return (
      <span className="flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400">
        {t("project.audit.actor.human")}
      </span>
    );
  }
  if (kind === "agentModel") {
    return (
      <span
        className="flex-shrink-0 rounded border border-purple-800/70 bg-purple-950/40 px-1.5 py-0.5 text-[10px] text-purple-300"
        title={t("project.audit.actor.agentHint")}
      >
        {`🤖 ${row.model}`}
      </span>
    );
  }
  return (
    <span
      className="flex-shrink-0 rounded border border-blue-800/70 bg-blue-950/40 px-1.5 py-0.5 text-[10px] text-blue-300"
      title={t("project.audit.actor.orchestratorHint")}
    >
      {`🎛️ ${t("project.audit.actor.orchestrator")}`}
    </span>
  );
}

/**
 * 티켓 칸 — 제목이 있으면 제목, 없으면(물리 삭제) 해시. 원문 id 는 hover 로.
 *
 * `onOpenTicket` 이 있으면 버튼이 된다 — 그 티켓의 원장 상세(티켓
 * U6ITRR38Z3c4MGLyg2PU)를 연다. 물리 삭제된 티켓도 원장엔 남아 있으므로 클릭은
 * 항상 유효하다(해시로 표시될 뿐, 조회 자체는 taskId 로만 걸린다).
 */
function AuditTaskLabel({
  taskId,
  taskTitleById,
  onOpenTicket,
}: {
  taskId: string;
  taskTitleById: Record<string, string>;
  onOpenTicket?: (taskId: string) => void;
}) {
  const label = resolveTaskLabel(taskId, taskTitleById);
  if (!onOpenTicket) {
    return (
      <span
        className="max-w-[220px] truncate text-xs text-gray-500"
        title={`#${taskId}`}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpenTicket(taskId)}
      className="max-w-[220px] truncate text-xs text-gray-500 underline decoration-dotted underline-offset-2 hover:text-gray-300"
      title={`#${taskId}`}
    >
      {label}
    </button>
  );
}

/**
 * 행 하나.
 *
 * ★사람/오케 뱃지를 맨 앞에 둔다. 두 소스를 겹쳐 놓고 구분을 안 주면 "김대표가
 * 티켓 40개를 옮겼다"처럼 읽히는데, 실제로는 김대표가 **발주한 에이전트**가
 * 옮긴 것이다. 감사에서 그 둘을 뭉개면 기록 자체가 오해의 근거가 된다.
 */
function AuditRow({
  row,
  locale,
  taskTitleById,
  onOpenTicket,
}: {
  row: UnifiedAuditRow;
  locale: string;
  taskTitleById: Record<string, string>;
  onOpenTicket?: (taskId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
      <AuditBadge row={row} />

      <span
        className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400"
        title={row.label.kind === "tool" ? row.label.toolName : undefined}
      >
        <RowLabel label={row.label} />
      </span>

      <span className="text-sm text-gray-200">
        {row.actorLabel ?? t("project.audit.actor.unknown")}
      </span>

      {row.detail && (
        <span className="truncate text-xs text-gray-500">{row.detail}</span>
      )}

      {row.failed && (
        <span className="rounded border border-red-900/60 px-1 text-[10px] text-red-400">
          {t("project.audit.failed")}
        </span>
      )}

      {row.taskId && (
        <AuditTaskLabel
          taskId={row.taskId}
          taskTitleById={taskTitleById}
          onOpenTicket={onOpenTicket}
        />
      )}

      <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-gray-500">
        {formatAuditTime(row.createdAt, locale)}
      </span>
    </li>
  );
}

/**
 * 사람 행위·아는 툴은 번역한 라벨을, 모르는 툴은 코드 값 그대로 찍는다
 * (모노스페이스). 아는 툴의 원문 toolName 은 감춘 게 아니라 감싸는 배지의
 * `title` 로 옮겨졌다(hover 로 대조 가능) — AuditRow 참조.
 */
export function RowLabel({ label }: { label: AuditRowLabel }) {
  const { t } = useTranslation();
  if (label.kind === "i18n" || label.kind === "tool")
    return <>{t(label.key)}</>;
  return <span className="font-mono">{label.text}</span>;
}

/**
 * 접힌 add_activity 그룹 — 요약 줄 하나 + 펼치면 원본 행 전부.
 *
 * ★캡처는 그대로다. 그룹은 이미 만들어진 `UnifiedAuditRow[]` 를 감싸기만
 * 할 뿐 값을 합치거나 지우지 않는다 — 펼치면 원문 그대로 다시 보인다.
 *
 * 집계 정보(모델·발주자)를 요약 줄에 올리지 않는다 — 연속 조건은 같은
 * 티켓·같은 툴만 강제할 뿐 같은 에이전트/발주자까지는 강제하지 않아서,
 * 대표 하나를 뽑아 보여주면 "이 사람이/이 모델이 다 했다"는 오귀속이 될 수
 * 있다. 정확한 귀속은 펼쳤을 때 행 단위로만 보여준다.
 */
function AuditGroupRow({
  group,
  expanded,
  onToggle,
  locale,
  taskTitleById,
  onOpenTicket,
}: {
  group: AuditRowGroup;
  expanded: boolean;
  onToggle: () => void;
  locale: string;
  taskTitleById: Record<string, string>;
  onOpenTicket?: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const latest = group.rows[0];

  return (
    <li className="py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-left"
      >
        <span className="flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400">
          {t("project.audit.group.badge")}
        </span>

        {/* onOpenTicket 을 안 넘긴다 — 이 라벨은 이미 <button onClick={onToggle}>
            안에 있어서, 클릭형으로 바꾸면 버튼 중첩(무효 HTML)이 된다. 펼치면
            아래 개별 행의 라벨이 클릭 가능하다. */}
        <AuditTaskLabel taskId={group.taskId} taskTitleById={taskTitleById} />

        <span className="text-xs text-gray-500">
          {t("project.audit.group.count", { count: group.rows.length })}
        </span>

        <span className="flex-shrink-0 text-[11px] text-blue-400 underline">
          {expanded
            ? t("project.audit.group.collapse")
            : t("project.audit.group.expand")}
        </span>

        <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-gray-500">
          {formatAuditTime(latest.createdAt, locale)}
        </span>
      </button>

      {expanded && (
        <ul className="mt-1 ml-4 divide-y divide-gray-800 border-l border-gray-800 pl-3">
          {group.rows.map((row) => (
            <AuditRow
              key={row.key}
              row={row}
              locale={locale}
              taskTitleById={taskTitleById}
              onOpenTicket={onOpenTicket}
            />
          ))}
        </ul>
      )}
    </li>
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

/**
 * 감사 시각은 **절대 시각**으로 찍는다. 작업량 표의 "3분 전"과 달리 감사는
 * 나중에 "그때 정확히 언제였나"를 되짚는 용도라, 상대 시각은 기록을 다시 읽는
 * 순간 쓸모가 없어진다.
 *
 * createdAt 이 Date 가 아닌 경우(변환 실패)에도 터지지 않게 방어한다.
 */
export function formatAuditTime(value: Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
