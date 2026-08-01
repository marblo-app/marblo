import { useMemo, useState, type ReactNode } from "react";
import type { User } from "../../types/user";
import type { ProjectAuditEventType } from "../../types/projectAudit";
import { useTranslation } from "../../lib/i18n";
import { PROJECT_AUDIT_EVENT_TYPES } from "../../lib/projectAudit";
import {
  auditMetadataSummary,
  auditTypeLabelKey,
  resolveActorLabel,
} from "../../lib/projectAuditView";
import { useProjectAuditLog } from "../../hooks/useProjectAuditLog";

/**
 * 감사 로그 — 프로젝트 탭의 세 번째 블록.
 *
 * 위의 작업량 패널은 **결과**(에이전트·티켓·머지가 지금 어떤 상태인가)를 보고,
 * 이 패널은 **행위**(누가 언제 무엇을 했나)를 본다. 나란히 두면 구성원별로
 * "얼마나 지고 있나 + 실제로 무엇을 했나"가 한 화면에서 맞물린다.
 *
 * ★데이터 출처는 services/projectAuditService 의 조회 API 뿐이다. audit_logs
 * 원장(= MCP 툴 호출 = AI 에이전트 행위)은 여기서 읽지 않는다 — 접근등급이
 * 다르고(멤버 전원 read), 이 패널이 답하는 질문은 **사람** 행위다.
 *
 * 권한은 두 겹이다:
 *   1) 호출부(ProjectTab)가 canViewAuditLog(owner/admin)로 1차 게이트.
 *   2) 그래도 여기서 permission-denied 를 처리한다 — 룰이 최종 권한이고,
 *      역할 캐시가 낡았거나(막 강등됨) 룰이 더 좁을 수 있다. UI 판정만 믿고
 *      throw 를 방치하면 감사 섹션 하나가 프로젝트 탭 전체를 날린다.
 */

interface ProjectAuditPanelProps {
  projectId: string;
  /** 이름 메꿈용. 기록 시점 actorName 이 비어 있을 때만 쓴다. */
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

  const { state, actors, reload } = useProjectAuditLog(
    projectId,
    actorUid === ALL ? undefined : actorUid,
    type === ALL ? undefined : (type as ProjectAuditEventType),
  );

  const nameByUid = useMemo(
    () =>
      Object.fromEntries(
        members.map((m) => [m.id, m.displayName || m.email || m.id]),
      ),
    [members],
  );

  // 권한 없음 — 섹션을 통째로 숨기지 않고 "왜 비어 있는지"를 말한다. 조용히
  // 사라지면 owner 가 "감사 기능이 없어졌나?" 로 읽는다.
  if (state.status === "denied") {
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

        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          aria-label={t("project.audit.filterType")}
        >
          <option value={ALL}>{t("project.audit.filterTypeAll")}</option>
          {PROJECT_AUDIT_EVENT_TYPES.map((eventType) => (
            <option key={eventType} value={eventType}>
              {t(auditTypeLabelKey(eventType))}
            </option>
          ))}
        </select>

        {state.status === "ready" && state.events.length > 0 && (
          <span className="text-xs text-gray-600">
            {t("project.audit.count", { count: state.events.length })}
          </span>
        )}
      </div>

      {state.status === "loading" && (
        <div className="flex items-center justify-center py-10">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
        </div>
      )}

      {state.status === "error" && (
        <div className="rounded border border-red-900/60 bg-red-950/30 px-4 py-3">
          <p className="text-sm text-red-300">{t("project.audit.error")}</p>
          {/* 원문 메시지를 숨기지 않는다 — 인덱스 누락 같은 실제 원인이 여기
              말고는 드러날 데가 없다. */}
          <p className="mt-1 break-words text-xs text-red-400/70">
            {state.message}
          </p>
          <button
            type="button"
            onClick={reload}
            className="mt-2 rounded border border-red-800 px-2 py-1 text-xs text-red-200 transition-colors hover:bg-red-900/40"
          >
            {t("project.audit.retry")}
          </button>
        </div>
      )}

      {state.status === "ready" &&
        (state.events.length === 0 ? (
          <div className="rounded border border-dashed border-gray-700 bg-gray-900/50 px-4 py-8 text-center">
            <p className="text-sm text-gray-400">
              {t("project.audit.emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t("project.audit.emptyDesc")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-800">
            {state.events.map((event) => {
              const detail = auditMetadataSummary(event.type, event.metadata);
              return (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2"
                >
                  <span className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400">
                    {t(auditTypeLabelKey(event.type))}
                  </span>
                  <span className="text-sm text-gray-200">
                    {resolveActorLabel(event, nameByUid)}
                  </span>
                  {detail && (
                    <span className="truncate text-xs text-gray-500">
                      {detail}
                    </span>
                  )}
                  {event.taskId && (
                    <span className="font-mono text-[10px] text-gray-600">
                      #{event.taskId.slice(0, 8)}
                    </span>
                  )}
                  <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-gray-500">
                    {formatAuditTime(event.createdAt, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
        ))}
    </Shell>
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
function formatAuditTime(value: Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
