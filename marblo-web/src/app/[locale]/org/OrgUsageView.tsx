/**
 * 조직 전체 사용량(L0) — 프레젠테이션 층.
 *
 * ★firebase 도 next-intl 훅도 import 하지 않는다(`OrgViews.tsx` 규약) — 입력은
 *   정규화된 값 + 문구 사전 + 로케일뿐이라 `renderToStaticMarkup` 으로 검사 가능.
 *
 * 이 화면의 규약(#1333 §7 · #1336 §5·§6):
 *   1. ★빈 상태가 기본값이다 — 조직 0·결합 0 이 정상이고, "왜 비었고 언제
 *      차는가" 를 화면이 말한다. `0`·`미수집`·`적재 전`·`restricted`·`empty` 를
 *      가른다.
 *   2. ★층을 늘리지 않는다 — 팀은 L0 주 표의 그룹핑(소계 행)이다. 미지정은
 *      버킷 행으로 남는다(숨기지도, 임의 팀에 밀지도 않는다).
 *   3. ★잘린 프로젝트 개수를 밝힌다 — `projectsOmitted > 0` 이면 합계가 전체가
 *      아니라는 문장이 표 위에 뜬다(조용한 절단 금지).
 *   4. ★집계 기준(로그인한 계정)을 상시 표기한다 — 미인증 사용량은 기록 자체가
 *      없다(`logCostBatch` 가 로그인을 요구한다).
 */

import { Loader2, RefreshCw } from "lucide-react";
import type { OrgCopy } from "./orgCopy";
import {
  groupProjectsByTeam,
  type OrgUsageByTeamRow,
  type OrgUsageData,
} from "./orgUsageContract";
import {
  formatInt,
  formatUsd,
  freshnessMinutes,
  isUsageEmpty,
  isUsageNotProvisioned,
} from "../team/teamUsageContract";
import type { TeamCopy } from "../team/teamCopy";
import { UsageCellView } from "../team/TeamUsageView";

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

function NoteLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{children}</p>
  );
}

function teamLabel(copy: OrgCopy, team: OrgUsageByTeamRow): string {
  if (team.teamId === null) return copy.text["usage.table.unassigned"];
  return team.teamDisplayName ?? copy.text["usage.table.unknownTeam"];
}

export function OrgUsageSection({
  copy,
  teamCopy,
  locale,
  now,
  state,
}: {
  copy: OrgCopy;
  teamCopy: TeamCopy;
  locale: string;
  /** 신선도 계산용 현재 시각(ms). 테스트가 고정할 수 있게 값으로 받는다. */
  now: number;
  state:
    | { kind: "loading" }
    /**
     * ★복구 경로를 카드 안에 둔다(감사 #1495 P1-5). 없으면 되돌리는 길이
     *   페이지 우상단 전역 새로고침뿐이라, 에러를 보고 있는 사람의 시선에서
     *   멀다. `onRetry` 가 없으면 버튼을 그리지 않는다 — 누를 데가 없는
     *   버튼을 그리는 것이 없는 것보다 나쁘다.
     */
    | { kind: "error"; onRetry?: () => void }
    | { kind: "loaded"; data: OrgUsageData };
}) {
  const title = copy.text["usage.title"];

  if (state.kind === "loading") {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h4 className="mb-2 text-sm font-semibold text-zinc-300">{title}</h4>
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {copy.text["usage.loading"]}
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h4 className="mb-2 text-sm font-semibold text-zinc-300">{title}</h4>
        <p className="text-xs text-amber-300">{copy.text["usage.error"]}</p>
        {state.onRetry ? (
          <button
            type="button"
            onClick={state.onRetry}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {copy.text["action.retry"]}
          </button>
        ) : null}
      </div>
    );
  }

  const data = state.data;

  // ★서버가 restricted 를 돌려준 경우(심층 방어) — org_member 화면과 같은 칸.
  if (data.kind === "restricted") {
    return (
      <UsageCellView
        copy={teamCopy}
        locale={locale}
        cell={{
          kind: "restricted",
          requires: data.requires,
          reasonCode: data.reasonCode,
          reason: data.reason,
        }}
        title={title}
        basis=""
      />
    );
  }

  const env = data.envelope;
  const meta = env.teamUsage;

  // 봉투에 상태 축이 없다 = 계약 미배선. 모르는 것을 0 으로 그리지 않는다.
  if (meta === null) {
    return (
      <UsageCellView
        copy={teamCopy}
        locale={locale}
        cell={{ kind: "unwired" }}
        title={title}
        basis=""
      />
    );
  }

  // ── 게이트 닫힘 — 숫자를 아예 그리지 않고 사유만 ──────────────────────────
  if (meta.state === "disabled") {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-4">
        <h4 className="mb-1 text-sm font-semibold text-zinc-300">{title}</h4>
        <p className="text-xs leading-relaxed text-zinc-400">
          {meta.disabledReason ?? copy.text["usage.disabledFallback"]}
        </p>
      </div>
    );
  }

  // ── 적재 전 — ★0 이 아니다 ───────────────────────────────────────────────
  if (isUsageNotProvisioned(env)) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-4">
        <h4 className="mb-1 text-sm font-semibold text-zinc-300">{title}</h4>
        <p className="text-xs leading-relaxed text-zinc-400">
          {meta.disabledReason ?? copy.text["usage.notProvisionedFallback"]}
        </p>
        <NoteLine>{data.basisLabel ?? copy.text["usage.loginBasis"]}</NoteLine>
      </div>
    );
  }

  // ── ★빈 상태가 기본이다 — 왜 비었고 언제 차는가 ──────────────────────────
  if (isUsageEmpty(env)) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-4">
        <h4 className="mb-1 text-sm font-semibold text-zinc-300">
          {title} · {copy.text["usage.empty.title"]}
        </h4>
        <p className="text-xs leading-relaxed text-zinc-400">
          {copy.text["usage.empty.why"]}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          {copy.text["usage.empty.when"]}
        </p>
        {data.windowFromDay && data.windowToDay ? (
          <NoteLine>
            {fill(copy.text["usage.window"], {
              from: data.windowFromDay,
              to: data.windowToDay,
            })}
          </NoteLine>
        ) : null}
        {meta.effectiveFrom ? (
          <NoteLine>
            {fill(copy.text["usage.effectiveFrom"], {
              date: meta.effectiveFrom,
            })}
          </NoteLine>
        ) : null}
        <NoteLine>{copy.text["usage.loginBasis"]}</NoteLine>
      </div>
    );
  }

  // ── 실측 — 총계 · 팀별 › 프로젝트별 · 일별 ────────────────────────────────
  // ★조회 창의 실제 경계. `usage.effectiveFrom`(게이트 발효일)과 **다른
  //   문장**이다 — 그 옆에만 숫자가 뜨면 "발효일부터의 합계" 로 읽힌다(오케가
  //   정확히 이렇게 속았다, 티켓 EmHUecXSgXSyrF2XgJ8b). 둘 다 항상 같이 그린다.
  const totals = env.totals;
  const groups = groupProjectsByTeam(data.byTeam, data.byProject);
  const minutes = freshnessMinutes(env.generatedAt, now);
  const realZero =
    (totals?.costUsd ?? 0) === 0 && (env.coverage?.rowsInWindow ?? 0) > 0;
  const totalTokens = (totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
        <span className="text-[11px] text-zinc-400">
          {fill(copy.text["usage.projectsInScope"], {
            n: String(meta.projectsInScope),
          })}
        </span>
        {data.windowFromDay && data.windowToDay ? (
          <span className="text-[11px] font-medium text-zinc-300">
            {fill(copy.text["usage.window"], {
              from: data.windowFromDay,
              to: data.windowToDay,
            })}
          </span>
        ) : null}
        {meta.effectiveFrom ? (
          <span className="text-[11px] text-zinc-400">
            {fill(copy.text["usage.effectiveFrom"], {
              date: meta.effectiveFrom,
            })}
          </span>
        ) : null}
        {minutes !== null ? (
          <span className="text-[11px] text-zinc-400">
            {fill(copy.text["usage.freshness"], { minutes: String(minutes) })}
          </span>
        ) : null}
      </div>

      {/* ★조용한 절단 금지 — 잘렸으면 합계가 전체가 아니라는 문장이 먼저 뜬다. */}
      {data.projectsOmitted > 0 ? (
        <p className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          {data.projectsTruncatedNote ?? copy.text["usage.truncatedFallback"]} (
          {data.projectsOmitted})
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <p className="text-[11px] text-zinc-400">
            {data.costLabel ?? copy.text["usage.costTitle"]}
          </p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {formatUsd(totals?.costUsd ?? 0, locale)}
          </p>
          {realZero ? (
            <p className="mt-1 text-[11px] text-zinc-400">
              {copy.text["usage.realZero"]}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <p className="text-[11px] text-zinc-400">
            {copy.text["usage.tokensTitle"]}
          </p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {formatInt(totalTokens, locale)}
          </p>
        </div>
      </div>

      {/* ── 주 표: 팀별 › 프로젝트별 — 층이 아니라 그룹핑(#1336 §5) ── */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th className="px-3 py-2 font-medium">
                {copy.text["usage.table.team"]}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {copy.text["usage.table.cost"]}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {copy.text["usage.table.tokens"]}
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <TeamGroupRows
                key={g.team.teamId ?? "__unassigned__"}
                copy={copy}
                locale={locale}
                group={g}
              />
            ))}
            <tr className="border-t border-zinc-700 font-semibold text-zinc-200">
              <td className="px-3 py-2">{copy.text["usage.table.total"]}</td>
              <td className="px-3 py-2 text-right">
                {formatUsd(totals?.costUsd ?? 0, locale)}
              </td>
              <td className="px-3 py-2 text-right">
                {formatInt(totalTokens, locale)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {groups.some((g) => g.team.teamId === null) ? (
        <NoteLine>{copy.text["usage.table.unassignedHint"]}</NoteLine>
      ) : null}

      {/* ── 일별 ── */}
      {env.byDay.length > 0 ? (
        <div className="mt-4">
          <h5 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {copy.text["usage.byDay.title"]}
          </h5>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left text-xs">
              <tbody>
                {env.byDay.map((d) => (
                  <tr
                    key={d.day}
                    className="border-b border-zinc-900 last:border-b-0"
                  >
                    <td className="px-3 py-1.5 font-mono text-zinc-400">
                      {d.day}
                      {d.partial ? (
                        <span className="ml-2 rounded-full border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400">
                          {copy.text["usage.byDay.partial"]}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-right text-zinc-300">
                      {formatUsd(d.costUsd, locale)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-zinc-400">
                      {formatInt(d.tokens, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ★라벨 없는 숫자 금지 — 집계 기준(로그인한 계정)·청구액 아님을 상시. */}
      <NoteLine>{data.basisLabel ?? copy.text["usage.loginBasis"]}</NoteLine>
      {data.costNotBillingNote ? (
        <NoteLine>{data.costNotBillingNote}</NoteLine>
      ) : null}
    </div>
  );
}

function TeamGroupRows({
  copy,
  locale,
  group,
}: {
  copy: OrgCopy;
  locale: string;
  group: ReturnType<typeof groupProjectsByTeam>[number];
}) {
  const { team, rows } = group;
  return (
    <>
      {/* 팀 소계 행 — 사장님이 원하신 "팀 단위 분석" 의 실체(#1336 §5.2). */}
      <tr className="border-b border-zinc-900 bg-zinc-950/60 font-medium text-zinc-200">
        <td className="px-3 py-2">
          {teamLabel(copy, team)}{" "}
          <span className="font-normal text-zinc-400">
            ·{" "}
            {fill(copy.text["usage.table.projectsCount"], {
              n: String(team.projects),
            })}
          </span>
        </td>
        <td className="px-3 py-2 text-right">
          {formatUsd(team.costUsd, locale)}
        </td>
        <td className="px-3 py-2 text-right">
          {formatInt(team.tokens, locale)}
        </td>
      </tr>
      {rows.map((p) => (
        <tr
          key={p.projectId}
          className="border-b border-zinc-900 last:border-b-0"
        >
          <td className="px-3 py-1.5 pl-6 text-zinc-400">
            {p.projectName ?? p.projectId}
          </td>
          <td className="px-3 py-1.5 text-right text-zinc-300">
            {formatUsd(p.costUsd, locale)}
          </td>
          <td className="px-3 py-1.5 text-right text-zinc-400">
            {formatInt(p.tokens, locale)}
          </td>
        </tr>
      ))}
    </>
  );
}
