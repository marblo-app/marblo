"use client";

// 어드민 "프로젝트 감사" 탭 — 읽기 전용 관찰 뷰.
//
// 앱(Electron)의 ProjectAuditPanel 계열이 주던 프로젝트 운영 관찰가능성을 웹으로
// 옮긴 화면이다. 구성 결도 그쪽을 따른다:
//   문제우선 배너 → 요약 카드 → 워크로드 스트립 → 미션→티켓 그룹 → 활동 타임라인
//   → 머지/PR 클러스터
//
// ★데이터는 전부 `getAdminProjectAudit` 콜러블 하나에서 온다. 이 화면은 Firestore
//   를 직접 읽지 않는다 — 웹 클라에 tasks/agents/audit_logs read 를 열면 룰 표면이
//   늘고, 룰 분기와 쿼리 제약이 어긋나는 순간 쿼리 전체가 permission-denied 로
//   죽는다(#406/#428). 서버가 Admin SDK 로 읽어 조립한 뷰만 받는다.
//
// ★Phase1 = read only. 재배정·메시지·상태변경 같은 쓰기 액션은 여기 없다(Phase2).

import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable, getFunctions } from "firebase/functions";
import app from "@/lib/firebase";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  AlertTriangle,
  FolderGit2,
  Users,
  Target,
  GitMerge,
  Activity,
  Ticket,
  ExternalLink,
  Info,
  Clock,
  Bot,
} from "lucide-react";
import ExecutionLedgerSection, {
  type ExecutionLedgerRow,
  type ExecutionLedgerCoverage,
} from "./ExecutionLedgerSection";

// ── 콜러블 응답 타입 (v3/functions/src/projectAudit.ts 미러) ─────────────────

type AttentionKind =
  | "taskFailed"
  | "taskBlocked"
  | "failedActions"
  | "orphanedClaim"
  | "stalled";

type Attention = {
  kinds: AttentionKind[];
  severity: "critical" | "warning";
  idleMs: number | null;
};

type AuditProjectRef = {
  id: string;
  name: string | null;
  ownerId: string | null;
  memberCount: number;
  updatedAt: string | null;
};

type AuditTicket = {
  id: string;
  title: string | null;
  status: string | null;
  role: string | null;
  priority: number | null;
  missionId: string | null;
  prUrl: string | null;
  claimedBy: string | null;
  archived: boolean;
  deleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  activityCount: number;
  failedActions: number;
  attention: Attention | null;
};

type AuditWorkloadRow = {
  agentId: string;
  name: string | null;
  model: string | null;
  role: string | null;
  status: string | null;
  currentTaskId: string | null;
  openTasks: number;
  doneTasks: number;
  totalCost: number;
};

type AuditMissionRow = {
  id: string;
  goal: string | null;
  status: string | null;
  taskCount: number;
  doneCount: number;
  statusCounts: Record<string, number>;
  updatedAt: string | null;
};

type AuditTimelineRow = {
  id: string;
  kind: "activity" | "ledger" | "merge";
  at: string | null;
  taskId: string | null;
  taskTitle: string | null;
  actor: string | null;
  label: string;
  text: string | null;
  success: boolean | null;
};

type AuditMergeRow = {
  id: string;
  taskId: string | null;
  repoRoot: string | null;
  branch: string | null;
  prNumber: number | null;
  mergedAt: string | null;
  filesChanged: number | null;
  linesAdded: number | null;
  linesDeleted: number | null;
};

type AuditSummary = {
  tasksTotal: number;
  tasksOpen: number;
  tasksDone: number;
  tasksByStatus: Record<string, number>;
  agentsTotal: number;
  agentsWorking: number;
  missionsTotal: number;
  missionsActive: number;
  mergesTotal: number;
  prCount: number;
  attentionCount: number;
  criticalCount: number;
};

type ProjectAuditResult = {
  projects: AuditProjectRef[];
  projectId: string | null;
  generatedAt: string;
  summary: AuditSummary;
  attention: AuditTicket[];
  workload: AuditWorkloadRow[];
  missions: AuditMissionRow[];
  tickets: AuditTicket[];
  timeline: AuditTimelineRow[];
  merges: AuditMergeRow[];
  // ★Mission→Ticket→Agent→Model→Cost→Result 를 한 줄로 이은 실행 기록.
  //   서버가 못 내려주는 배포 시점(구 함수)에는 undefined 로 온다 — 그때는
  //   섹션을 그리지 않는다. 빈 배열로 접으면 "실행 0건" 이라는 거짓말이 된다.
  executionLedger?: ExecutionLedgerRow[];
  executionCoverage?: ExecutionLedgerCoverage;
  notes: string[];
};

type CallableError = { code?: string; message?: string };

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────────

const ATTENTION_LABEL: Record<AttentionKind, string> = {
  taskFailed: "실패",
  taskBlocked: "차단",
  failedActions: "실패한 호출",
  orphanedClaim: "고아 클레임",
  stalled: "정체",
};

// 상태 배지 색. 여기 없는 값은 회색으로 떨어진다 — 없는 상태를 발명하지 않는다.
const STATUS_STYLE: Record<string, string> = {
  TODO: "bg-zinc-800 text-zinc-300",
  CLAIMED: "bg-sky-950/60 text-sky-300",
  IN_PROGRESS: "bg-indigo-950/60 text-indigo-300",
  REVIEW: "bg-violet-950/60 text-violet-300",
  BLOCKED: "bg-amber-950/60 text-amber-300",
  FAILED: "bg-red-950/60 text-red-300",
  DONE: "bg-emerald-950/60 text-emerald-300",
};

function statusClass(status: string | null): string {
  return (status && STATUS_STYLE[status]) || "bg-zinc-800 text-zinc-400";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 경과 시간을 사람이 읽는 단위로. 정체 근거(idleMs)를 그대로 밝히는 용도. */
function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}시간`;
  const days = Math.floor(hours / 24);
  return `${days}일 ${hours % 24}시간`;
}

function mapError(err: CallableError): string {
  if (err?.code === "functions/permission-denied") {
    return "어드민 권한이 없습니다 (ADMIN_UID 미설정 또는 계정 불일치).";
  }
  if (err?.code === "functions/failed-precondition") {
    return "서버에 ADMIN_UID 가 설정되어 있지 않습니다.";
  }
  if (err?.code === "functions/not-found") {
    return "getAdminProjectAudit 함수가 아직 배포되지 않았습니다.";
  }
  return err?.message || "알 수 없는 오류가 발생했습니다.";
}

// ── 소형 표시 컴포넌트 ───────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "alert";
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === "alert"
          ? "border-red-900/50 bg-red-950/20"
          : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <div className="flex items-center gap-2 text-zinc-400 mb-1.5">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div
        className={`text-2xl font-bold ${
          tone === "alert" ? "text-red-300" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${statusClass(
        status
      )}`}
    >
      {status ?? "(미기록)"}
    </span>
  );
}

function AttentionBadges({ attention }: { attention: Attention }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {attention.kinds.map((kind) => (
        <span
          key={kind}
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
            attention.severity === "critical"
              ? "bg-red-950/60 text-red-300"
              : "bg-amber-950/60 text-amber-300"
          }`}
        >
          {ATTENTION_LABEL[kind]}
          {kind === "stalled" && attention.idleMs != null
            ? ` ${formatDuration(attention.idleMs)}`
            : ""}
        </span>
      ))}
    </span>
  );
}

// ── 본체 ─────────────────────────────────────────────────────────────────────

export default function ProjectAuditPanel() {
  const [data, setData] = useState<ProjectAuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const load = useCallback(async (targetProjectId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable<
        { projectId?: string; timelineLimit?: number },
        ProjectAuditResult
      >(getFunctions(app, "us-central1"), "getAdminProjectAudit");
      const res = await fn(
        targetProjectId ? { projectId: targetProjectId } : {}
      );
      setData(res.data);
      // 서버가 기본 선택한 프로젝트를 셀렉터에 반영한다.
      setProjectId(res.data.projectId);
    } catch (err: unknown) {
      setError(mapError(err as CallableError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  const handleProjectChange = useCallback(
    (next: string) => {
      setProjectId(next);
      load(next);
    },
    [load]
  );

  // 미션 → 티켓 그룹. 미션에 안 붙는 티켓은 버리지 않고 별도 묶음으로 남긴다 —
  // 감사에서 조용한 누락이 가장 나쁜 실패다.
  const ticketGroups = useMemo(() => {
    if (!data) return [];
    const byMission = new Map<string, AuditTicket[]>();
    const loose: AuditTicket[] = [];
    for (const t of data.tickets) {
      if (t.deleted) continue;
      if (t.missionId) {
        const list = byMission.get(t.missionId) ?? [];
        list.push(t);
        byMission.set(t.missionId, list);
      } else {
        loose.push(t);
      }
    }
    const groups: Array<{
      key: string;
      title: string;
      subtitle: string | null;
      tickets: AuditTicket[];
    }> = [];
    for (const m of data.missions) {
      const tickets = byMission.get(m.id) ?? [];
      if (tickets.length === 0) continue;
      groups.push({
        key: m.id,
        title: m.goal ?? `미션 ${m.id.slice(0, 8)}`,
        subtitle: `${m.status ?? "상태 미기록"} · ${m.doneCount}/${
          m.taskCount
        } 완료`,
        tickets,
      });
      byMission.delete(m.id);
    }
    // 미션 문서를 못 읽었지만 티켓이 그 미션을 가리키는 경우도 남긴다.
    for (const [missionId, tickets] of byMission) {
      groups.push({
        key: missionId,
        title: `미션 ${missionId.slice(0, 8)}`,
        subtitle: "미션 문서를 읽지 못했다",
        tickets,
      });
    }
    if (loose.length > 0) {
      groups.push({
        key: "__board__",
        title: "보드 · 퀵레인",
        subtitle: "미션에 속하지 않은 티켓",
        tickets: loose,
      });
    }
    return groups;
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-red-400">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { summary } = data;

  return (
    <div className="space-y-6">
      {/* 헤더 + 프로젝트 셀렉터 */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-semibold">프로젝트 감사</h2>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={projectId ?? ""}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={loading || data.projects.length === 0}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            >
              {data.projects.length === 0 && (
                <option value="">프로젝트 없음</option>
              )}
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.id}
                </option>
              ))}
            </select>
            <button
              onClick={() => load(projectId)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-200 disabled:opacity-50"
              aria-label="새로고침"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          읽기 전용 관찰 뷰입니다. 데이터는 서버(어드민 권한)가 Firestore 를
          직접 읽어 조립하며, 이 페이지에서 티켓 재배정·메시지 전송·상태 변경은
          하지 않습니다. 마지막 갱신 {formatDateTime(data.generatedAt)}.
        </p>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-xs text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {/* ★문제 우선 배너 — 사람 손이 필요한 티켓을 맨 위에 */}
      {data.attention.length > 0 && (
        <section
          className={`rounded-2xl border p-6 ${
            summary.criticalCount > 0
              ? "border-red-900/50 bg-red-950/20"
              : "border-amber-900/50 bg-amber-950/20"
          }`}
        >
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle
              className={`h-5 w-5 ${
                summary.criticalCount > 0 ? "text-red-400" : "text-amber-400"
              }`}
            />
            <h3 className="text-base font-semibold">
              주의 필요 {data.attention.length}건
              {summary.criticalCount > 0 && (
                <span className="ml-2 text-sm font-normal text-red-300">
                  (즉시 {summary.criticalCount}건)
                </span>
              )}
            </h3>
          </div>
          <ul className="space-y-2">
            {data.attention.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/60 px-3 py-2 text-sm"
              >
                <StatusBadge status={t.status} />
                <span className="min-w-0 flex-1 truncate text-zinc-200">
                  {t.title ?? t.id}
                </span>
                {t.claimedBy && (
                  <span className="text-xs text-zinc-500">
                    선점 {t.claimedBy}
                  </span>
                )}
                {t.attention && <AttentionBadges attention={t.attention} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 요약 카드 */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Ticket}
          label="티켓"
          value={summary.tasksTotal}
          sub={`진행 ${summary.tasksOpen} · 완료 ${summary.tasksDone}`}
        />
        <StatCard
          icon={Users}
          label="에이전트"
          value={summary.agentsTotal}
          sub={`작업 중 ${summary.agentsWorking}`}
        />
        <StatCard
          icon={Target}
          label="미션"
          value={summary.missionsTotal}
          sub={`진행 ${summary.missionsActive}`}
        />
        <StatCard
          icon={GitMerge}
          label="머지"
          value={summary.mergesTotal}
          sub={`PR 링크 ${summary.prCount}`}
        />
      </section>

      {/* ★불변 실행 원장 — 이 화면의 머리기사.
          응답에 축이 없으면(구버전 함수) 아예 그리지 않는다. 빈 표를 그리면
          "실행 0건" 으로 읽혀서 미배선이 실측 0 으로 위장된다. */}
      {data.executionLedger && data.executionCoverage && (
        <ExecutionLedgerSection
          rows={data.executionLedger}
          coverage={data.executionCoverage}
        />
      )}

      {/* 상태 분포 */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-3 text-base font-semibold">티켓 상태 분포</h3>
        {Object.keys(summary.tasksByStatus).length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            티켓이 없습니다.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.tasksByStatus)
              .filter(([, n]) => n > 0)
              .map(([status, n]) => (
                <span
                  key={status}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${statusClass(
                    status
                  )}`}
                >
                  {status}
                  <span className="font-semibold">{n}</span>
                </span>
              ))}
          </div>
        )}
      </section>

      {/* 워크로드 스트립 */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Bot className="h-5 w-5 text-indigo-400" />
          <h3 className="text-base font-semibold">에이전트 워크로드</h3>
        </div>
        {data.workload.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            이 프로젝트에 등록된 에이전트가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="py-2 pr-4 font-medium">에이전트</th>
                  <th className="py-2 pr-4 font-medium">모델</th>
                  <th className="py-2 pr-4 font-medium">역할</th>
                  <th className="py-2 pr-4 font-medium">상태</th>
                  <th className="py-2 pr-4 font-medium">진행</th>
                  <th className="py-2 pr-4 font-medium">완료</th>
                  <th className="py-2 font-medium text-right">비용</th>
                </tr>
              </thead>
              <tbody>
                {data.workload.map((w) => (
                  <tr
                    key={w.agentId}
                    className="border-b border-zinc-800/60 last:border-0"
                  >
                    <td className="py-2.5 pr-4 text-zinc-200">
                      {w.name ?? w.agentId}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-400">
                      {w.model ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-400">
                      {w.role ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${
                          w.status === "working"
                            ? "bg-indigo-950/60 text-indigo-300"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {w.status ?? "—"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-300">{w.openTasks}</td>
                    <td className="py-2.5 pr-4 text-zinc-300">{w.doneTasks}</td>
                    <td className="py-2.5 text-right text-zinc-400">
                      {w.totalCost > 0 ? `$${w.totalCost.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 미션 요약 카드 */}
      {data.missions.length > 0 && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-400" />
            <h3 className="text-base font-semibold">미션</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {data.missions.map((m) => (
              <div
                key={m.id}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 text-sm font-medium text-zinc-200">
                    {m.goal ?? `미션 ${m.id.slice(0, 8)}`}
                  </p>
                  <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                    {m.status ?? "—"}
                  </span>
                </div>
                <div className="mb-2 text-xs text-zinc-500">
                  {m.doneCount}/{m.taskCount} 완료 ·{" "}
                  {formatDateTime(m.updatedAt)}
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(m.statusCounts).map(([status, n]) => (
                    <span
                      key={status}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${statusClass(
                        status
                      )}`}
                    >
                      {status} {n}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 미션 → 티켓 그룹 */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Ticket className="h-5 w-5 text-indigo-400" />
          <h3 className="text-base font-semibold">티켓</h3>
        </div>
        {ticketGroups.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            티켓이 없습니다.
          </p>
        ) : (
          <div className="space-y-5">
            {ticketGroups.map((group) => (
              <div key={group.key}>
                <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-zinc-800 pb-1.5">
                  <h4 className="text-sm font-semibold text-zinc-200">
                    {group.title}
                  </h4>
                  {group.subtitle && (
                    <span className="text-xs text-zinc-500">
                      {group.subtitle}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-zinc-500">
                    {group.tickets.length}건
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {group.tickets.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950/50 px-3 py-2 text-sm"
                    >
                      <StatusBadge status={t.status} />
                      <span className="min-w-0 flex-1 truncate text-zinc-200">
                        {t.title ?? t.id}
                      </span>
                      {t.archived && (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
                          보관
                        </span>
                      )}
                      {t.claimedBy && (
                        <span className="text-xs text-zinc-500">
                          {t.claimedBy}
                        </span>
                      )}
                      {t.activityCount > 0 && (
                        <span className="text-xs text-zinc-600">
                          활동 {t.activityCount}
                        </span>
                      )}
                      {t.attention && (
                        <AttentionBadges attention={t.attention} />
                      )}
                      {/* 링크 클러스터 — 값이 없으면 아예 숨긴다(죽은 링크 금지). */}
                      {t.prUrl && (
                        <a
                          href={t.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-indigo-400 transition hover:text-indigo-300"
                        >
                          PR
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 활동 타임라인 */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5 text-indigo-400" />
          <h3 className="text-base font-semibold">활동 타임라인</h3>
          <span className="ml-auto text-xs text-zinc-500">
            {data.timeline.length}건
          </span>
        </div>
        {data.timeline.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            기록된 활동이 없습니다.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {data.timeline.map((row) => (
              <li
                key={row.id}
                className="flex gap-3 rounded-lg bg-zinc-950/50 px-3 py-2 text-sm"
              >
                <span className="w-24 shrink-0 whitespace-nowrap text-xs text-zinc-500">
                  {formatDateTime(row.at)}
                </span>
                <span
                  className={`w-16 shrink-0 text-xs font-medium ${
                    row.kind === "merge"
                      ? "text-emerald-400"
                      : row.kind === "ledger"
                      ? "text-sky-400"
                      : "text-zinc-400"
                  }`}
                >
                  {row.kind === "merge"
                    ? "머지"
                    : row.kind === "ledger"
                    ? "원장"
                    : "활동"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-zinc-200">{row.label}</span>
                    {row.success === false && (
                      <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-xs text-red-300">
                        실패
                      </span>
                    )}
                    {row.taskTitle && (
                      <span className="truncate text-xs text-zinc-500">
                        {row.taskTitle}
                      </span>
                    )}
                    {row.actor && (
                      <span className="text-xs text-zinc-600">{row.actor}</span>
                    )}
                  </div>
                  {row.text && (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-400">
                      {row.text}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 머지 / PR 클러스터 */}
      {data.merges.length > 0 && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center gap-2">
            <GitMerge className="h-5 w-5 text-indigo-400" />
            <h3 className="text-base font-semibold">머지 내역</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="py-2 pr-4 font-medium">머지 시각</th>
                  <th className="py-2 pr-4 font-medium">저장소</th>
                  <th className="py-2 pr-4 font-medium">브랜치</th>
                  <th className="py-2 pr-4 font-medium">PR</th>
                  <th className="py-2 font-medium text-right">변경</th>
                </tr>
              </thead>
              <tbody>
                {data.merges.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-zinc-800/60 last:border-0"
                  >
                    <td className="whitespace-nowrap py-2.5 pr-4 text-zinc-400">
                      {formatDateTime(m.mergedAt)}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-300">
                      {m.repoRoot ?? "—"}
                    </td>
                    <td className="break-all py-2.5 pr-4 text-zinc-400">
                      {m.branch ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4">
                      {m.prNumber && m.repoRoot ? (
                        <a
                          href={`https://github.com/${m.repoRoot}/pull/${m.prNumber}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-400 transition hover:text-indigo-300"
                        >
                          #{m.prNumber}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-right text-zinc-400">
                      {m.filesChanged != null ? (
                        <>
                          {m.filesChanged}개 파일
                          {m.linesAdded != null && (
                            <span className="ml-1.5 text-emerald-400">
                              +{m.linesAdded}
                            </span>
                          )}
                          {m.linesDeleted != null && (
                            <span className="ml-1 text-red-400">
                              −{m.linesDeleted}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ★해석 주의 — 표본의 한계를 화면이 직접 밝힌다 */}
      {data.notes.length > 0 && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-2 flex items-center gap-2 text-zinc-400">
            <Info className="h-4 w-4" />
            <h3 className="text-sm font-semibold">해석 주의</h3>
          </div>
          <ul className="space-y-1.5">
            {data.notes.map((note, i) => (
              <li
                key={i}
                className="flex gap-2 text-xs leading-relaxed text-zinc-500"
              >
                <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
