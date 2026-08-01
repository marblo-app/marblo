import { useEffect, useState } from "react";
import type { InvitationRole } from "../../types/invitation";
import type { User } from "../../types/user";
import { getPresenceStatus } from "../../types/user";
import type { MergeHistoryEntry } from "../../types/mergeHistory";
import { useAgentStore } from "../../stores/agentStore";
import { useTaskStore } from "../../stores/taskStore";
import { subscribeToMergeHistory } from "../../services/mergeHistoryService";
import { t, useTranslation } from "../../lib/i18n";
import {
  computeMemberWorkload,
  workloadTotals,
  type MemberWorkloadRow,
} from "../../lib/memberWorkload";

/**
 * 구성원별 작업량 — 프로젝트 탭의 아래 절반.
 *
 * ★ 이 패널은 아무것도 새로 기록하지 않는다. agents / tasks / merge_history 는
 * 앱이 이미 쓰고 있는 컬렉션이고, 여기서는 읽어서 사람 축으로 접기만 한다.
 * 집계 규칙 전부는 lib/memberWorkload.ts(순수 함수, 유닛테스트)에 있고 이
 * 컴포넌트는 구독 배선과 표시만 맡는다.
 *
 * 호출부(ProjectTab)가 owner/admin 게이트를 이미 통과시킨 뒤에만 렌더한다 —
 * 권한 판정을 두 군데 두지 않기 위해 이 컴포넌트는 게이트를 다시 하지 않는다.
 */

interface MemberWorkloadPanelProps {
  projectId: string;
  members: User[];
  memberRoles: Record<string, InvitationRole>;
}

export function MemberWorkloadPanel({
  projectId,
  members,
  memberRoles,
}: MemberWorkloadPanelProps) {
  const { t } = useTranslation();
  const agents = useAgentStore((s) => s.agents);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const tasks = useTaskStore((s) => s.tasks);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const [merges, setMerges] = useState<MergeHistoryEntry[]>([]);

  useEffect(() => {
    if (!projectId) return;
    return subscribeToAgents(projectId);
  }, [projectId, subscribeToAgents]);

  useEffect(() => {
    if (!projectId) return;
    return subscribeToTasks(projectId);
  }, [projectId, subscribeToTasks]);

  useEffect(() => {
    if (!projectId) return;
    // 이 프로젝트로 스코프한 구독 — merge_history 룰이 멤버십으로 조여 있어
    // unscoped 쿼리는 통째로 거부된다(services/mergeHistoryService 주석).
    const unsub = subscribeToMergeHistory((entries) => setMerges(entries), {
      projectId,
    });
    return () => unsub();
  }, [projectId]);

  const summary = computeMemberWorkload({
    members,
    memberRoles,
    agents,
    tasks,
    merges,
  });
  const totals = workloadTotals(summary);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-200">
          {t("project.workload.heading")}
        </h3>
        <span className="text-xs text-gray-500">
          {t("project.workload.sourceNote")}
        </span>
      </div>

      {!summary.hasData ? (
        <div className="rounded border border-dashed border-gray-700 bg-gray-900/50 px-4 py-8 text-center">
          <p className="text-sm text-gray-400">
            {t("project.workload.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {t("project.workload.emptyDesc")}
          </p>
        </div>
      ) : (
        <>
          {/* 합계 스트립 — 표를 읽기 전에 프로젝트 전체 규모가 먼저 보인다. */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <TotalTile
              label={t("project.workload.totalAgents")}
              value={totals.agents}
            />
            <TotalTile
              label={t("project.workload.colInProgress")}
              value={totals.inProgress}
            />
            <TotalTile
              label={t("project.workload.colReview")}
              value={totals.review}
            />
            <TotalTile
              label={t("project.workload.colDone")}
              value={totals.done}
            />
            <TotalTile
              label={t("project.workload.colMerges")}
              value={totals.merges}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-xs text-gray-500">
                  <th className="py-2 pr-3 font-medium">
                    {t("project.workload.colMember")}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("project.workload.colAgents")}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("project.workload.colInProgress")}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("project.workload.colReview")}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("project.workload.colDone")}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("project.workload.colStuck")}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t("project.workload.colMerges")}
                  </th>
                  <th className="py-2 pl-2 text-right font-medium">
                    {t("project.workload.colLastActive")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row) => (
                  <WorkloadRow key={row.userId} row={row} />
                ))}

                {/* 귀속 실패분 — 합계가 맞지 않는 이유를 숨기지 않는다. */}
                {(summary.unattributed.tasks.total > 0 ||
                  summary.unattributed.agentCount > 0 ||
                  summary.unattributed.merges > 0) && (
                  <tr className="border-t border-gray-700 text-gray-500">
                    <td className="py-2 pr-3">
                      <span className="text-xs">
                        {t("project.workload.unattributed")}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {summary.unattributed.agentCount || "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {summary.unattributed.tasks.inProgress || "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {summary.unattributed.tasks.review || "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {summary.unattributed.tasks.done || "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {summary.unattributed.tasks.stuck || "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {summary.unattributed.merges || "—"}
                    </td>
                    <td className="py-2 pl-2 text-right text-xs">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {(summary.unattributed.tasks.total > 0 ||
            summary.unattributed.agentCount > 0 ||
            summary.unattributed.merges > 0) && (
            <p className="mt-2 text-xs text-gray-600">
              {t("project.workload.unattributedHint")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function TotalTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-gray-700 bg-gray-900 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-200">
        {value}
      </p>
    </div>
  );
}

const PRESENCE_DOT: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  offline: "bg-gray-600",
};

function WorkloadRow({ row }: { row: MemberWorkloadRow }) {
  const { t } = useTranslation();
  const presence = getPresenceStatus(row.lastHeartbeatAt);

  return (
    <tr className="border-b border-gray-800 last:border-b-0">
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2.5">
          {row.photoURL ? (
            <img src={row.photoURL} alt="" className="h-7 w-7 rounded-full" />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-700 text-xs font-medium text-gray-300">
              {row.displayName[0]?.toUpperCase() || "?"}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                  PRESENCE_DOT[presence] || PRESENCE_DOT.offline
                }`}
                title={t(`project.presence.${presence}`)}
              />
              <span className="truncate text-sm text-gray-200">
                {row.displayName}
              </span>
              <span className="flex-shrink-0 rounded border border-gray-700 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">
                {row.role}
              </span>
            </div>
            {!row.hasData && (
              <span className="text-xs text-gray-600">
                {t("project.workload.rowEmpty")}
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-2 py-2.5 text-right tabular-nums text-gray-300">
        {row.agentCount > 0 ? (
          <span>
            {row.agentCount}
            {row.activeAgentCount > 0 && (
              <span className="ml-1 text-xs text-green-400">
                ({row.activeAgentCount})
              </span>
            )}
          </span>
        ) : (
          <span className="text-gray-600">—</span>
        )}
      </td>
      <Cell value={row.tasks.inProgress} highlight="text-blue-400" />
      <Cell value={row.tasks.review} highlight="text-purple-400" />
      <Cell value={row.tasks.done} highlight="text-green-400" />
      <Cell value={row.tasks.stuck} highlight="text-red-400" />
      <Cell value={row.merges} highlight="text-gray-200" />
      <td className="py-2.5 pl-2 text-right text-xs text-gray-500">
        {row.lastActivityAt ? formatRelative(row.lastActivityAt) : "—"}
      </td>
    </tr>
  );
}

function Cell({ value, highlight }: { value: number; highlight: string }) {
  return (
    <td
      className={`px-2 py-2.5 text-right tabular-nums ${
        value > 0 ? highlight : "text-gray-600"
      }`}
    >
      {value > 0 ? value : "—"}
    </td>
  );
}

function formatRelative(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return t("project.time.justNow");
  if (diffMin < 60) return t("project.time.minsAgo", { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("project.time.hoursAgo", { count: diffHour });
  return t("project.time.daysAgo", { count: Math.floor(diffHour / 24) });
}
