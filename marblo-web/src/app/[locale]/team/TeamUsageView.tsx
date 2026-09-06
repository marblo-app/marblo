/**
 * 팀 오버뷰 — 프레젠테이션 층.
 *
 * ★firebase 도 next-intl 훅도 import 하지 않는다. 입력은 정규화된 봉투 + 문구
 *   사전 + 로케일뿐이라, 테스트가 `renderToStaticMarkup` 으로 **화면 바이트**를
 *   그대로 검사할 수 있다(`AnalyticsPanel.test.tsx` 와 같은 규약).
 *
 * 이 화면의 규약 셋(설계 §7 화면규칙):
 *   1. `0` · `미수집` · `적재 전` 을 **갈라 그린다.** 미수집·적재 전 칸에는
 *      숫자 0 이 아예 등장하지 않는다.
 *   2. 금액은 **사용량 추정 비용**이다. '청구액' 이라는 말을 쓰지 않는다.
 *   3. **빈 상태가 기본값이다.** 데이터가 없을 때가 깨지지 않는 쪽이어야 한다.
 */

import {
  AlertTriangle,
  Ban,
  Clock,
  Database,
  Info,
  Clock4,
  Lock,
  Users,
  Unplug,
} from "lucide-react";
import { fill, type TeamCopy, type TeamCopyKey } from "./teamCopy";
import {
  deriveOrchestratorCell,
  formatInt,
  formatPercent,
  formatUsd,
  freshnessMinutes,
  isUsageEmpty,
  isUsageNotProvisioned,
  pickActorKind,
  resolveReason,
  resolveWindow,
  type ByDayRow,
  type TeamUsageEnvelope,
  type UsageCell,
} from "./teamUsageContract";

export type ViewProps = {
  env: TeamUsageEnvelope;
  copy: TeamCopy;
  locale: string;
  /** 서버 `generatedAt` 대비 신선도 계산 기준. 테스트가 시계를 고정할 수 있게 주입. */
  now: number;
};

type Text = (
  key: TeamCopyKey,
  values?: Record<string, string | number>
) => string;

function textOf(copy: TeamCopy): Text {
  return (key, values) =>
    values ? fill(copy.text[key], values) : copy.text[key];
}

// ── 라벨 ────────────────────────────────────────────────────────────────────

/**
 * ★사용량 숫자 옆에 **항상** 붙는 배지. 이 화면에서 금액을 그리는 자리는
 * `MoneyValue` 하나뿐이고, 그 컴포넌트가 라벨을 필수로 끼워 넣는다 —
 * "기준 라벨 없는 숫자 금지" 를 주석이 아니라 호출 경로가 지킨다.
 */
export function BasisBadge({ copy, basis }: { copy: TeamCopy; basis: string }) {
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
      {/* ★모르는 값은 원문 그대로 — 라벨이 사라지는 경로를 만들지 않는다. */}
      {t("basis.label")}: {known ? copy.basisValues[basis] ?? basis : "—"}
    </span>
  );
}

/**
 * 금액 한 자리. ★라벨(`money.label`)이 옵셔널이 아니다.
 * '청구액' 이라는 말은 이 화면 어디에도 없다(설계 §1.5).
 */
export function MoneyValue({
  copy,
  locale,
  value,
  size = "md",
}: {
  copy: TeamCopy;
  locale: string;
  value: number;
  size?: "md" | "lg";
}) {
  const t = textOf(copy);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <span
        className={
          size === "lg"
            ? "text-2xl font-bold text-zinc-100"
            : "font-mono text-sm text-zinc-200"
        }
      >
        {formatUsd(value, locale)}
      </span>
      <span className="text-[11px] text-zinc-400">{t("money.label")}</span>
    </span>
  );
}

/** ★'청구액이 아니다' 를 숫자 **앞**에 둔다. 각주로 내리면 안 읽힌다. */
export function MoneyDisclaimer({ copy }: { copy: TeamCopy }) {
  const t = textOf(copy);
  return (
    <p className="flex gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] leading-relaxed text-zinc-400">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
      <span>{t("money.note")}</span>
    </p>
  );
}

// ── ★칸 하나 — 0 / 미수집 / 적재 전 / 부분 / 미배선 ──────────────────────────

/**
 * ★이 화면에서 사용량 칸을 그리는 **유일한** 컴포넌트.
 *
 * `UsageCell` 이 판별 유니온이라 호출부가 "숫자만" 그릴 방법이 없다. 미수집·적재
 * 전·미배선 가지에는 숫자 자체를 렌더하지 않는다 — 0 을 회색으로 흐리게 그리는
 * 타협도 하지 않는다. 흐린 0 도 0 으로 읽힌다.
 */
export function UsageCellView({
  copy,
  locale,
  cell,
  title,
  basis,
}: {
  copy: TeamCopy;
  locale: string;
  cell: UsageCell;
  title: string;
  basis: string;
}) {
  const t = textOf(copy);

  if (cell.kind === "measured") {
    const isZero = cell.costUsd === 0 && cell.tokens === 0;
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
          {isZero ? (
            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
              {t("cell.zeroBadge")}
            </span>
          ) : null}
          <BasisBadge copy={copy} basis={basis} />
        </div>
        <MoneyValue
          copy={copy}
          locale={locale}
          value={cell.costUsd}
          size="lg"
        />
        <div className="mt-1 text-xs text-zinc-400">
          {formatInt(cell.tokens, locale)} · {t("totals.tokens")}
        </div>
        {isZero ? (
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
            {t("cell.zeroNote")}
          </p>
        ) : null}
      </div>
    );
  }

  if (cell.kind === "partial") {
    return (
      <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
          <span className="rounded-full border border-amber-800/60 bg-amber-950/30 px-2 py-0.5 text-[11px] text-amber-200">
            {t("cell.partialBadge")}
          </span>
          <BasisBadge copy={copy} basis={basis} />
        </div>
        <MoneyValue copy={copy} locale={locale} value={cell.costUsd} />
        <p className="mt-2 text-[11px] leading-relaxed text-amber-200/80">
          {t("cell.partialBody", { from: cell.coveredFrom })}
        </p>
      </div>
    );
  }

  // ── 여기서부터는 숫자를 **그리지 않는다** ────────────────────────────────

  if (cell.kind === "notCollected") {
    const reason = resolveReason(
      cell.reasonCode,
      cell.reason,
      copy.reasons,
      t("reason.fallback")
    );
    return (
      <div className="rounded-xl border border-dashed border-red-900/50 bg-red-950/10 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Ban className="h-4 w-4 text-red-400/80" />
          <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
          <span className="rounded-full border border-red-900/60 bg-red-950/30 px-2 py-0.5 text-[11px] text-red-200">
            {t("cell.notCollectedBadge")}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-zinc-400">
          {t("cell.notCollectedBody")}
        </p>
        <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 text-[11px] leading-relaxed text-zinc-300">
          {reason}
        </p>
        {cell.legacySegment ? (
          // ★그 구간 문장은 서버가 코드+문장으로 준다. 화면이 해석을 지어내지
          //   않는다 — 그 행들이 무엇이었는지는 원장을 실측한 쪽이 안다.
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
            {resolveReason(
              cell.legacySegment.noteCode,
              cell.legacySegment.note,
              copy.reasons,
              t("cell.legacySegment", {
                from: cell.legacySegment.from,
                to: cell.legacySegment.to,
              })
            )}
          </p>
        ) : null}
      </div>
    );
  }

  if (cell.kind === "pending") {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Clock className="h-4 w-4 text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
            {t("cell.pendingBadge")}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-zinc-400">
          {t("cell.pendingBody")}
        </p>
        {cell.since ? (
          <p className="mt-2 text-[11px] text-zinc-400">
            {t("cell.pendingSince", { since: cell.since })}
          </p>
        ) : null}
      </div>
    );
  }

  if (cell.kind === "restricted") {
    // ★여섯 번째 부재 — 권한으로 가려진 값(#1205 §4.2). 빈칸도 0 도 아니다.
    //   "권한이 없습니다" 로 끝내지 않고 무엇이 필요한지(requires)까지 말한다 —
    //   막다른 길이 아니라 길을 준다.
    const reason = resolveReason(
      cell.reasonCode,
      cell.reason,
      copy.reasons,
      t("reason.fallback")
    );
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Lock className="h-4 w-4 text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
          <span className="rounded-full border border-zinc-600 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
            {t("cell.restrictedBadge")}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-zinc-400">
          {t("cell.restrictedBody")}
        </p>
        <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 text-[11px] leading-relaxed text-zinc-300">
          {reason}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          {t(
            cell.requires === "org_admin"
              ? "cell.restrictedRequiresOrgAdmin"
              : "cell.restrictedRequiresProjectAdmin"
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Unplug className="h-4 w-4 text-zinc-400" />
        <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
          {t("cell.unwiredBadge")}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">
        {t("cell.unwiredBody")}
      </p>
    </div>
  );
}

// ── 게이트 닫힘 ─────────────────────────────────────────────────────────────

/**
 * ★'적재 전' 과 **다른 말**을 쓴다. 소스가 없는 게 아니라 아직 열지 않은 것이고,
 * '곧 채워집니다' 로 읽히면 안 된다(`PersonAxisDisabled` 와 같은 규율).
 * 그리고 숫자를 **한 개도** 그리지 않는다(설계 §7 화면규칙 1).
 */
export function UsageDisabled({
  copy,
  reasonCode,
  reason,
}: {
  copy: TeamCopy;
  reasonCode: string | null;
  reason: string | null;
}) {
  const t = textOf(copy);
  const sentence = resolveReason(
    reasonCode,
    reason,
    copy.reasons,
    t("reason.fallback")
  );
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Lock className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-300">
          {t("disabled.title")}
        </h3>
        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
          {t("disabled.badge")}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        {t("disabled.body")}
      </p>
      <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 text-[11px] leading-relaxed text-zinc-400">
        {sentence}
      </p>
    </div>
  );
}

/**
 * ★'적재 전'. `empty` 와 **다른 말**을 쓴다(계약 §7 규칙 7).
 *
 * `empty` 는 "팀이 아직 안 들어왔다"(정상)이고, 이쪽은 **읽어 올 자리가 아직
 * 없다**는 뜻이다. 같은 문구로 그리면 오너가 "우리 팀이 안 썼구나" 로 읽는다.
 * ★숫자를 한 개도 그리지 않는다.
 */
export function UsageNotProvisioned({ copy }: { copy: TeamCopy }) {
  const t = textOf(copy);
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Clock4 className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-300">
          {t("notProvisioned.title")}
        </h3>
        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
          {t("notProvisioned.badge")}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        {t("notProvisioned.body")}
      </p>
    </div>
  );
}

// ── ★빈 상태 — 기본값 ───────────────────────────────────────────────────────

/**
 * 계정 5개, 멤버 2명 이상인 프로젝트 1개(설계 §1.2). **대부분의 방문이 여기로
 * 떨어진다.** 그래서 이 가지가 가장 잘 만들어져 있어야 한다 — 빈 표도, 0 도,
 * 스켈레톤도 그리지 않고 "무엇이 답해질 것인지" 를 보여 준다.
 */
export function UsageEmpty({ copy }: { copy: TeamCopy }) {
  const t = textOf(copy);
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-300">
          {t("empty.title")}
        </h3>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        {t("empty.body")}
      </p>
      <p className="mt-4 text-xs font-medium text-zinc-400">
        {t("empty.willShowTitle")}
      </p>
      <ul className="mt-2 space-y-1 text-xs text-zinc-400">
        {copy.willShow.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] text-zinc-400">{t("empty.invite")}</p>
    </div>
  );
}

// ── 표 ──────────────────────────────────────────────────────────────────────

export function MemberTable({
  copy,
  locale,
  rows,
  basis,
}: {
  copy: TeamCopy;
  locale: string;
  rows: TeamUsageEnvelope["byMember"];
  basis: string;
}) {
  const t = textOf(copy);
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-300">
          {t("members.title")}
        </h3>
        <BasisBadge copy={copy} basis={basis} />
      </div>
      {/* ★순위 위에 둔다. 표를 읽고 나서 읽으면 이미 사람을 평가한 뒤다. */}
      <p className="mb-3 flex gap-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-[11px] leading-relaxed text-amber-200/90">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {t("members.optOutNote")} {t("members.noRowsNote")}{" "}
          {t("members.hostNote")}
        </span>
      </p>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-900/60 text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">{t("members.name")}</th>
              <th className="px-3 py-2 font-medium">{t("money.label")}</th>
              <th className="px-3 py-2 font-medium">{t("totals.tokens")}</th>
              <th className="px-3 py-2 font-medium">{t("members.share")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.memberKey} className="border-t border-zinc-800">
                <td className="px-3 py-2 text-zinc-300">
                  {row.displayName ?? t("members.unnamed")}
                </td>
                {/* ★기록이 없는 멤버에 0 을 그리지 않는다(계약 §7 규칙 8).
                    0 으로 그리면 텔레메트리를 끈 사람이 "가장 일 안 한 사람" 이 된다. */}
                {row.hasRows === false ? (
                  <td
                    className="px-3 py-2 text-[11px] italic text-zinc-400"
                    colSpan={3}
                  >
                    {t("members.noRows")}
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2 font-mono text-zinc-200">
                      {formatUsd(row.costUsd, locale)}
                    </td>
                    <td className="px-3 py-2 font-mono text-zinc-400">
                      {formatInt(row.tokens, locale)}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">
                      {formatPercent(row.share, locale)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Breakdown({
  copy,
  locale,
  title,
  rows,
  basis,
}: {
  copy: TeamCopy;
  locale: string;
  title: string;
  rows: { key: string; label: string; costUsd: number; tokens: number }[];
  basis: string;
}) {
  const t = textOf(copy);
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-300">{title}</h3>
        <BasisBadge copy={copy} basis={basis} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-900/60 text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">{title}</th>
              <th className="px-3 py-2 font-medium">{t("money.label")}</th>
              <th className="px-3 py-2 font-medium">{t("totals.tokens")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-zinc-800">
                <td className="px-3 py-2 text-zinc-300">{row.label}</td>
                <td className="px-3 py-2 font-mono text-zinc-200">
                  {formatUsd(row.costUsd, locale)}
                </td>
                <td className="px-3 py-2 font-mono text-zinc-400">
                  {formatInt(row.tokens, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 일별. ★오늘 막대에는 `진행 중` 배지가 붙는다(설계 §6.3). */
export function ByDayList({
  copy,
  locale,
  rows,
}: {
  copy: TeamCopy;
  locale: string;
  rows: ByDayRow[];
}) {
  const t = textOf(copy);
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-zinc-300">
        {t("byDay.title")}
      </h3>
      <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        {rows.map((row) => (
          <li
            key={row.day}
            className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
          >
            <span className="font-mono text-zinc-400">{row.day}</span>
            <span className="font-mono text-zinc-200">
              {formatUsd(row.costUsd, locale)}
            </span>
            <span className="text-zinc-400">{t("money.label")}</span>
            {row.partial ? (
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                {t("today.partialBadge")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "이 화면은 전부가 아니다". 값이 없으면 0% 가 아니라 **모른다**고 쓴다. */
export function CoverageNote({
  copy,
  locale,
  coverage,
}: {
  copy: TeamCopy;
  locale: string;
  coverage: TeamUsageEnvelope["coverage"];
}) {
  const t = textOf(copy);
  const lines: string[] = [];
  if (coverage) {
    if (coverage.rowsZeroPct !== null)
      lines.push(
        t("coverage.rowsZero", {
          value: formatPercent(coverage.rowsZeroPct, locale),
        })
      );
    if (coverage.rowsWithoutTaskPct !== null)
      lines.push(
        t("coverage.rowsWithoutTask", {
          value: formatPercent(coverage.rowsWithoutTaskPct, locale),
        })
      );
    if (coverage.unattributedRows !== null)
      lines.push(
        t("coverage.unattributed", {
          value: formatInt(coverage.unattributedRows, locale),
        })
      );
    if (coverage.membersWithNoRows !== null)
      lines.push(
        t("coverage.membersWithNoRows", {
          value: formatInt(coverage.membersWithNoRows, locale),
        })
      );
    if (coverage.telemetryOptOutNote) lines.push(coverage.telemetryOptOutNote);
  }
  if (lines.length === 0) lines.push(t("coverage.unknown"));

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
        <Info className="h-3.5 w-3.5" />
        {t("coverage.title")}
      </h3>
      <ul className="space-y-1 text-[11px] leading-relaxed text-zinc-400">
        {lines.map((line, i) => (
          <li key={i}>· {line}</li>
        ))}
      </ul>
    </section>
  );
}

/** 헤더 — 신선도와 스코프. 숫자보다 먼저 읽혀야 하는 줄들이다. */
export function UsageHeader({ env, copy, now }: Omit<ViewProps, "locale">) {
  const t = textOf(copy);
  const minutes = freshnessMinutes(env.generatedAt, now);
  const freshness =
    minutes === null
      ? t("freshness.unknown")
      : minutes === 0
      ? t("freshness.justNow")
      : t("freshness.minutes", { minutes });
  const scope = env.teamUsage?.scope ?? "self";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {freshness}
      </span>
      {env.cache ? (
        <span>· {env.cache.hit ? t("cache.hit") : t("cache.miss")}</span>
      ) : null}
      {env.teamUsage ? (
        <span>
          ·{" "}
          {t("scope.projectsInScope", {
            count: env.teamUsage.projectsInScope,
          })}
        </span>
      ) : null}
      {scope === "self" ? (
        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
          {t("scope.selfBadge")}
        </span>
      ) : null}
    </div>
  );
}

// ── 본체 ────────────────────────────────────────────────────────────────────

export function TeamUsageView({ env, copy, locale, now }: ViewProps) {
  const t = textOf(copy);
  const gate = env.teamUsage;

  // ★규칙 1 — 닫혔으면 숫자를 아예 안 그린다. 다른 무엇도 그리지 않는다.
  if (!gate || gate.state === "disabled") {
    return (
      <div className="space-y-4">
        <UsageHeader env={env} copy={copy} now={now} />
        <UsageDisabled
          copy={copy}
          reasonCode={gate?.disabledReasonCode ?? null}
          reason={gate?.disabledReason ?? null}
        />
      </div>
    );
  }

  const basis = gate.basis;
  const window = resolveWindow(env.generatedAt, env.rangeDays);
  const orchestratorCell = deriveOrchestratorCell(
    env.orchestratorAxis,
    pickActorKind(env.byActorKind, "orchestrator"),
    window
  );
  const workerMeasured = pickActorKind(env.byActorKind, "worker");
  const workerCell: UsageCell = workerMeasured
    ? { kind: "measured", ...workerMeasured }
    : { kind: "pending", since: null };

  const notProvisioned = isUsageNotProvisioned(env);
  const empty = isUsageEmpty(env);

  return (
    <div className="space-y-6">
      <UsageHeader env={env} copy={copy} now={now} />
      <MoneyDisclaimer copy={copy} />

      {gate.scope === "self" ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] leading-relaxed text-zinc-400">
          {t("scope.selfNote")}
        </p>
      ) : null}

      {/* ★오케 축은 데이터가 있든 없든 **항상** 그린다. 비었을 때 사라지면
          그 자체가 "오케 비용이 없다" 는 메시지가 된다. */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-300">
            {t("orchestrator.title")}
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
            {t("orchestrator.stake")}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <UsageCellView
            copy={copy}
            locale={locale}
            cell={workerCell}
            title={t("orchestrator.worker")}
            basis={basis}
          />
          <UsageCellView
            copy={copy}
            locale={locale}
            cell={orchestratorCell}
            title={t("orchestrator.orchestrator")}
            basis={basis}
          />
        </div>
      </section>

      {notProvisioned ? (
        <UsageNotProvisioned copy={copy} />
      ) : empty ? (
        <UsageEmpty copy={copy} />
      ) : (
        <>
          {env.totals ? (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-300">
                  {t("totals.title")}
                </h3>
                <BasisBadge copy={copy} basis={basis} />
              </div>
              <MoneyValue
                copy={copy}
                locale={locale}
                value={env.totals.costUsd}
                size="lg"
              />
              <dl className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-3">
                <div>
                  <dt>{t("totals.tokens")}</dt>
                  <dd className="font-mono text-zinc-300">
                    {formatInt(
                      env.totals.inputTokens + env.totals.outputTokens,
                      locale
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("totals.cacheRead")}</dt>
                  <dd className="font-mono text-zinc-300">
                    {formatInt(env.totals.cacheReadTokens, locale)}
                  </dd>
                </div>
                <div>
                  <dt>{t("totals.cacheWrite")}</dt>
                  <dd className="font-mono text-zinc-300">
                    {formatInt(env.totals.cacheWriteTokens, locale)}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}

          {env.byMember.length > 0 ? (
            <MemberTable
              copy={copy}
              locale={locale}
              rows={env.byMember}
              basis={basis}
            />
          ) : null}

          {env.byProject.length > 0 ? (
            <Breakdown
              copy={copy}
              locale={locale}
              title={t("projects.title")}
              basis={basis}
              rows={env.byProject.map((r) => ({
                key: r.projectId,
                label: r.projectName ?? t("projects.unnamed"),
                costUsd: r.costUsd,
                tokens: r.tokens,
              }))}
            />
          ) : null}

          {env.byModel.length > 0 ? (
            <Breakdown
              copy={copy}
              locale={locale}
              title={t("models.title")}
              basis={basis}
              rows={env.byModel.map((r) => ({
                key: r.model,
                label: r.model,
                costUsd: r.costUsd,
                tokens: r.tokens,
              }))}
            />
          ) : null}

          {env.byDay.length > 0 ? (
            <ByDayList copy={copy} locale={locale} rows={env.byDay} />
          ) : null}
        </>
      )}

      <CoverageNote copy={copy} locale={locale} coverage={env.coverage} />
    </div>
  );
}
