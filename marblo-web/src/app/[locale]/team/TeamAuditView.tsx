/**
 * 감사 탭 — 프레젠테이션 층. 설계 §12.
 *
 * ★사용량 탭과 **같은 규율**이다: firebase·next-intl 훅 무의존, 입력은 정규화된
 *   봉투 + 문구 사전뿐 → 테스트가 렌더된 HTML 바이트를 검사할 수 있다.
 *
 * 이 탭이 지키는 네 줄(§12 화면규칙):
 *   1. `disabled` → 목록을 **아예 안 그린다.** 사유 문장만. ★"프로젝트가 없다" 고
 *      쓰지 않는다 — 서버가 존재 여부를 일부러 말하지 않는다.
 *   2. `empty` → 빈 상태 + 사유. **0 이 아니다.**
 *   3. `partial` → 목록은 그리되 "전부가 아니다" 배너. 빈 칸은 0 이 아니라 '모름'.
 *   4. `basis` 배지 항상.
 *
 * ★그리고 금액 칸을 만들지 않는다(§12.4). 서버가 금액을 안 주는 이유가 게이트
 *   우회 방지인데, 화면이 다른 데서 끌어와 채우면 같은 우회가 성립한다.
 */

import {
  AlertTriangle,
  Ban,
  Bot,
  Database,
  EyeOff,
  GitMerge,
  Info,
  Ticket,
  Workflow,
} from "lucide-react";
import { fill, type TeamCopy, type TeamCopyKey } from "./teamCopy";
import {
  derivedCounts,
  formatCount,
  formatEventTime,
  isAuditEmpty,
  isAuditPartial,
  memberChipLabel,
  resolveAuditReason,
  resolveCodedLine,
  type TeamAuditEnvelope,
  type TeamAuditEvent,
  type AgentLabel,
  type CodedLine,
  type TeamAuditCriteria,
  type TeamAuditEventKind,
  type TeamAuditReasonCode,
  type TeamAuditTicket,
} from "./teamAuditContract";

export type AuditViewProps = {
  env: TeamAuditEnvelope;
  copy: TeamCopy;
  locale: string;
  /** 다음 페이지를 요청할 수 있으면 콜백. 없으면 피드 끝이다. */
  onLoadMore?: (() => void) | null;
  loadingMore?: boolean;
};

type Text = (
  key: TeamCopyKey,
  values?: Record<string, string | number>
) => string;

function textOf(copy: TeamCopy): Text {
  return (key, values) =>
    values ? fill(copy.text[key], values) : copy.text[key];
}

const KIND_KEY: Readonly<Record<TeamAuditEventKind, TeamCopyKey>> = {
  task_create: "audit.kind.task_create",
  task_transition: "audit.kind.task_transition",
  merge: "audit.kind.merge",
  agent_spawn: "audit.kind.agent_spawn",
  flow_change: "audit.kind.flow_change",
};

const KIND_ICON: Readonly<Record<TeamAuditEventKind, typeof Ticket>> = {
  task_create: Ticket,
  task_transition: Ticket,
  merge: GitMerge,
  agent_spawn: Bot,
  flow_change: Workflow,
};

// ── 공통 소품 ───────────────────────────────────────────────────────────────

/** ★목록에도 기준 라벨이 붙는다 — "라벨 없는 숫자 금지" 는 표에도 적용된다. */
export function AuditBasisBadge({
  copy,
  basis,
}: {
  copy: TeamCopy;
  basis: string;
}) {
  const t = textOf(copy);
  const known = basis !== "";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${
        known
          ? "border-zinc-700 bg-zinc-900 text-zinc-400"
          : "border-amber-800/60 bg-amber-950/30 text-amber-200"
      }`}
      title={known ? undefined : t("basis.missing")}
    >
      <Database className="h-3 w-3" />
      {t("basis.label")}: {known ? copy.basisValues[basis] ?? basis : "—"}
    </span>
  );
}

/**
 * ★행위자 칩. 가명 전체를 뿌리지 않고 앞부분만 보여 준다.
 * `null` 은 **정상**이다(§12.7 — `merge_history` 에 행위자 필드가 없다).
 * 빈칸으로 두면 버그로 보이므로 반드시 '알 수 없음' 이라고 쓴다.
 */
export function ActorChip({
  copy,
  memberKey,
}: {
  copy: TeamCopy;
  memberKey: string | null;
}) {
  const t = textOf(copy);
  const label = memberChipLabel(memberKey);
  if (!label) {
    return (
      <span className="text-[11px] italic text-zinc-500">
        {t("audit.actor.unknown")}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300"
      title={t("audit.actor.pseudonymNote")}
    >
      {label}
    </span>
  );
}

/**
 * 에이전트·담당자 라벨 한 자리.
 *
 * ★서버가 값 수준에서 신원을 가린 자리(`redacted`)와 값이 아예 없는 자리
 *   (`absent`)를 **다른 말로** 그린다. 합치면 "담당자를 가렸음" 이 "담당자 없음"
 *   으로 둔갑하고, 감사 화면에서 그건 조용한 누락이다.
 */
export function AgentLabelText({
  copy,
  label,
}: {
  copy: TeamCopy;
  label: AgentLabel;
}) {
  const t = textOf(copy);
  if (label.kind === "value") return <>{label.value}</>;
  if (label.kind === "redacted") {
    return (
      <span
        className="italic text-zinc-500"
        title={t("audit.actor.redactedNote")}
      >
        {t("audit.actor.redacted")}
      </span>
    );
  }
  return <span className="italic text-zinc-500">{t("audit.unknown")}</span>;
}

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "alert";
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        tone === "alert"
          ? "border-red-900/50 bg-red-950/20"
          : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold ${
          tone === "alert" ? "text-red-300" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// ── 상태 가지 ───────────────────────────────────────────────────────────────

/**
 * ★규칙 1. 목록을 아예 안 그린다.
 * "프로젝트가 없습니다" 라고 **쓰지 않는다** — 권한 없음과 존재하지 않음이
 * 서버에서 같은 응답이라, 화면이 둘을 구분해 말하면 그게 곧 존재 여부 누설이다.
 */
export function AuditDisabled({
  copy,
  reasonCode,
  reason,
}: {
  copy: TeamCopy;
  reasonCode: TeamAuditReasonCode | null;
  reason: string | null;
}) {
  const t = textOf(copy);
  const sentence = resolveAuditReason(
    reasonCode,
    reason,
    copy.reasons,
    t("reason.fallback")
  );
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Ban className="h-4 w-4 text-zinc-600" />
        <h3 className="text-sm font-semibold text-zinc-300">
          {t("audit.disabled.title")}
        </h3>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        {t("audit.disabled.body")}
      </p>
      <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 text-[11px] leading-relaxed text-zinc-300">
        {sentence}
      </p>
    </div>
  );
}

/** ★규칙 2. 빈 피드는 0 이 아니다. */
export function AuditEmpty({
  copy,
  reasonCode,
  reason,
}: {
  copy: TeamCopy;
  reasonCode: TeamAuditReasonCode | null;
  reason: string | null;
}) {
  const t = textOf(copy);
  const sentence = resolveAuditReason(reasonCode, reason, copy.reasons, "");
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-6">
      <h3 className="text-sm font-semibold text-zinc-300">
        {t("audit.empty.title")}
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        {t("audit.empty.body")}
      </p>
      {sentence ? (
        <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 text-[11px] leading-relaxed text-zinc-400">
          {sentence}
        </p>
      ) : null}
    </div>
  );
}

/** ★규칙 3. 목록은 그리되 "전부가 아니다" 를 숫자보다 먼저 말한다. */
export function AuditPartialBanner({
  copy,
  reasonCode,
  reason,
}: {
  copy: TeamCopy;
  reasonCode: TeamAuditReasonCode | null;
  reason: string | null;
}) {
  const t = textOf(copy);
  const sentence = resolveAuditReason(reasonCode, reason, copy.reasons, "");
  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-3">
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        {t("audit.partial.badge")}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-amber-200/80">
        {t("audit.partial.body")}
      </p>
      {sentence ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">
          {sentence}
        </p>
      ) : null}
    </div>
  );
}

// ── 블록 ────────────────────────────────────────────────────────────────────

export function AuditSummaryTiles({
  copy,
  locale,
  env,
  basis,
}: {
  copy: TeamCopy;
  locale: string;
  env: TeamAuditEnvelope;
  basis: string;
}) {
  const t = textOf(copy);
  const summary = env.summary;
  const unknown = t("audit.unknown");
  // ★결측을 0 으로 그리지 않는다. `formatCount` 가 null 을 '모름' 으로 돌린다.
  const n = (v: number | null) => formatCount(v, locale, unknown);
  // ★목록이 뒷받침하는 숫자는 목록에서 센다 — 화면이 스스로와 모순될 자리를 없앤다.
  const derived = derivedCounts(env);
  const critical = derived.critical;
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-300">
          {t("audit.summary.title")}
        </h3>
        <AuditBasisBadge copy={copy} basis={basis} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label={t("audit.summary.events")}
          value={n(summary?.eventsInWindow ?? null)}
        />
        <StatTile
          label={t("audit.summary.tasksOpen")}
          value={n(summary?.tasksOpen ?? null)}
        />
        <StatTile
          label={t("audit.summary.tasksDone")}
          value={n(summary?.tasksDone ?? null)}
        />
        {/* ★머지는 사건 피드에도 나온다. 타일과 피드가 다른 스코프면 "머지 12건"
            이라 써 놓고 피드엔 0건인 화면이 된다(self 스코프에서 실제로 그랬다).
            보이는 것과 같은 출처를 쓴다. */}
        <StatTile
          label={t("audit.summary.merges")}
          value={n(summary?.eventsByKind.merge ?? null)}
        />
        <StatTile label={t("audit.summary.agents")} value={n(derived.agents)} />
        <StatTile
          label={t("audit.summary.missionsActive")}
          value={n(summary?.missionsActive ?? null)}
        />
        <StatTile
          label={t("audit.summary.critical")}
          value={n(critical)}
          tone={critical !== null && critical > 0 ? "alert" : "default"}
        />
      </div>
    </section>
  );
}

export function AuditAttentionList({
  copy,
  rows,
}: {
  copy: TeamCopy;
  rows: TeamAuditTicket[];
}) {
  const t = textOf(copy);
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        {t("audit.attention.title")}
      </h3>
      <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
          >
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                row.attention?.severity === "critical"
                  ? "bg-red-950/60 text-red-300"
                  : "bg-amber-950/60 text-amber-300"
              }`}
            >
              {row.status ?? t("audit.unknown")}
            </span>
            <span className="text-zinc-300">
              {row.title ?? t("audit.unknown")}
            </span>
            {row.claimedBy.kind === "absent" ? null : (
              <span className="font-mono text-[11px] text-zinc-500">
                <AgentLabelText copy={copy} label={row.claimedBy} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AuditEventRow({
  copy,
  locale,
  event,
}: {
  copy: TeamCopy;
  locale: string;
  event: TeamAuditEvent;
}) {
  const t = textOf(copy);
  const unknown = t("audit.unknown");
  const Icon = KIND_ICON[event.kind];
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
      <span className="font-mono text-[11px] text-zinc-500">
        {formatEventTime(event.at, locale, unknown)}
      </span>
      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">
        {t(KIND_KEY[event.kind])}
      </span>
      <ActorChip copy={copy} memberKey={event.memberKey} />
      {event.taskTitle ? (
        <span className="text-zinc-300">{event.taskTitle}</span>
      ) : event.taskId ? (
        <span className="font-mono text-[11px] text-zinc-500">
          {event.taskId}
        </span>
      ) : null}
      {event.merge ? (
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          {event.merge.branch ? (
            <span className="font-mono">{event.merge.branch}</span>
          ) : null}
          {event.merge.prNumber !== null ? (
            <span>{t("audit.merge.pr", { value: event.merge.prNumber })}</span>
          ) : null}
          {/* ★결측은 0 이 아니라 '모름' 이다 — 0줄 변경과 다른 사실이다. */}
          <span>
            {t("audit.merge.files", {
              value: formatCount(event.merge.filesChanged, locale, unknown),
            })}
          </span>
          <span>
            {t("audit.merge.lines", {
              added: formatCount(event.merge.linesAdded, locale, unknown),
              deleted: formatCount(event.merge.linesDeleted, locale, unknown),
            })}
          </span>
        </span>
      ) : null}
      {event.success === false ? (
        <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-[11px] text-red-300">
          {t("audit.events.failed")}
        </span>
      ) : null}
    </li>
  );
}

export function AuditEventFeed({
  copy,
  locale,
  events,
  onLoadMore,
  loadingMore,
}: {
  copy: TeamCopy;
  locale: string;
  events: TeamAuditEvent[];
  onLoadMore?: (() => void) | null;
  loadingMore?: boolean;
}) {
  const t = textOf(copy);
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-zinc-300">
        {t("audit.events.title")}
      </h3>
      {/* ★가명 고지를 피드 **위**에 둔다. 아래 두면 '알 수 없음' 을 먼저 보고
          버그로 읽은 뒤에 설명을 만난다. */}
      <p className="mb-2 flex gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px] leading-relaxed text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t("audit.actor.pseudonymNote")}</span>
      </p>
      <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        {events.map((event) => (
          <AuditEventRow
            key={event.id}
            copy={copy}
            locale={locale}
            event={event}
          />
        ))}
      </ul>
      <div className="mt-2 text-center">
        {onLoadMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore === true}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
          >
            {loadingMore ? t("audit.page.loading") : t("audit.page.more")}
          </button>
        ) : (
          <span className="text-[11px] text-zinc-600">
            {t("audit.page.end")}
          </span>
        )}
      </div>
    </section>
  );
}

export function AuditWorkloadTable({
  copy,
  locale,
  rows,
}: {
  copy: TeamCopy;
  locale: string;
  rows: TeamAuditEnvelope["workload"];
}) {
  const t = textOf(copy);
  const unknown = t("audit.unknown");
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-zinc-300">
        {t("audit.workload.title")}
      </h3>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-900/60 text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t("audit.workload.agent")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("audit.workload.model")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("audit.workload.status")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("audit.workload.open")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("audit.workload.done")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              // ★식별자가 가려질 수 있으므로 행 키로 쓰지 않는다.
              <tr key={i} className="border-t border-zinc-800">
                <td className="px-3 py-2 text-zinc-300">
                  <AgentLabelText
                    copy={copy}
                    label={row.name.kind === "absent" ? row.agentId : row.name}
                  />
                </td>
                <td className="px-3 py-2 text-zinc-400">
                  {row.model ?? unknown}
                </td>
                <td className="px-3 py-2 text-zinc-400">
                  {row.status ?? unknown}
                </td>
                <td className="px-3 py-2 font-mono text-zinc-400">
                  {formatCount(row.openTasks, locale, unknown)}
                </td>
                <td className="px-3 py-2 font-mono text-zinc-400">
                  {formatCount(row.doneTasks, locale, unknown)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * ★서버가 실어 보내는 "일부러 안 보여주는 것" 목록을 **그대로** 그린다(§12.3).
 * 문서에만 있으면 사용자는 못 본다. 계약이 바뀌면 이 자리가 먼저 달라진다.
 */
export function AuditWithheld({
  copy,
  withheld,
}: {
  copy: TeamCopy;
  withheld: CodedLine[];
}) {
  const t = textOf(copy);
  if (withheld.length === 0) return null;
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
        <EyeOff className="h-3.5 w-3.5" />
        {t("audit.withheld.title")}
      </h3>
      <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
        {t("audit.withheld.body")}
      </p>
      <ul className="space-y-1 text-[11px] leading-relaxed text-zinc-500">
        {withheld.map((line, i) => (
          <li key={line.code ?? i}>· {resolveCodedLine(line, copy.reasons)}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 참고 문장 한 줄.
 *
 * ★'정체' 기준만 숫자를 **값으로** 받는다. 서버가 `criteria` 를 주면 숫자가 든
 *   변형 문장을, 안 주면 숫자 없는 문장을 쓴다 — 어느 쪽이든 빈칸도 `{hours}`
 *   자리표시자도 화면에 뜨지 않는다. 문구에 숫자를 박아 두는 것보다 나은 이유:
 *   서버가 상한을 바꿔도 세 로케일 번역이 낡지 않는다.
 */
function noteTextOf(
  line: CodedLine,
  copy: TeamCopy,
  criteria: TeamAuditCriteria | null
): string {
  if (line.code === "note_stalled_threshold") {
    const hours = criteria?.stalledAfterHours ?? null;
    const withHours = copy.reasons["note_stalled_threshold_hours"];
    if (hours !== null && withHours) return fill(withHours, { hours });
  }
  return resolveCodedLine(line, copy.reasons);
}

export function AuditNotes({
  copy,
  notes,
  criteria,
}: {
  copy: TeamCopy;
  notes: CodedLine[];
  criteria: TeamAuditCriteria | null;
}) {
  const t = textOf(copy);
  if (notes.length === 0) return null;
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
        <Info className="h-3.5 w-3.5" />
        {t("audit.notes.title")}
      </h3>
      <ul className="space-y-1 text-[11px] leading-relaxed text-zinc-500">
        {notes.map((line, i) => (
          <li key={line.code ?? i}>· {noteTextOf(line, copy, criteria)}</li>
        ))}
      </ul>
    </section>
  );
}

// ── 본체 ────────────────────────────────────────────────────────────────────

export function TeamAuditView({
  env,
  copy,
  locale,
  onLoadMore,
  loadingMore,
}: AuditViewProps) {
  const t = textOf(copy);
  const gate = env.teamAudit;

  // 봉투가 없는 것은 상태가 아니라 계약 미배선이다. 사건 0건으로 그리지 않는다.
  if (!gate) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-300">
            {t("tabs.audit")}
          </h3>
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
            {t("cell.unwiredBadge")}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          {t("cell.unwiredBody")}
        </p>
      </div>
    );
  }

  // ★규칙 1 — 목록을 아예 안 그린다.
  if (gate.state === "disabled") {
    return (
      <AuditDisabled
        copy={copy}
        reasonCode={gate.reasonCode}
        reason={gate.reason}
      />
    );
  }

  const empty = isAuditEmpty(env);

  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-400">{t("audit.subtitle")}</p>

      {/* ★금액 칸이 없는 것은 누락이 아니라 결정이다. 화면이 그렇게 말한다. */}
      <p className="flex gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] leading-relaxed text-zinc-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span>{t("audit.noMoneyNote")}</span>
      </p>

      {gate.scope === "self" ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] leading-relaxed text-zinc-400">
          {t("audit.scope.selfNote")}
        </p>
      ) : null}

      {isAuditPartial(env) ? (
        <AuditPartialBanner
          copy={copy}
          reasonCode={gate.reasonCode}
          reason={gate.reason}
        />
      ) : null}

      <AuditSummaryTiles
        copy={copy}
        locale={locale}
        env={env}
        basis={gate.basis}
      />

      <AuditAttentionList copy={copy} rows={env.attention} />

      {empty ? (
        <AuditEmpty
          copy={copy}
          reasonCode={gate.reasonCode}
          reason={gate.reason}
        />
      ) : (
        <AuditEventFeed
          copy={copy}
          locale={locale}
          events={env.events}
          onLoadMore={onLoadMore}
          loadingMore={loadingMore}
        />
      )}

      <AuditWorkloadTable copy={copy} locale={locale} rows={env.workload} />
      <AuditNotes copy={copy} notes={env.notes} criteria={env.criteria} />
      <AuditWithheld copy={copy} withheld={env.withheld} />
    </div>
  );
}
