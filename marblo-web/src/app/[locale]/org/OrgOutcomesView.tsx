/**
 * 조직 작업 성과(완료·실패) — 프레젠테이션 층.
 *
 * ★firebase 도 next-intl 훅도 import 하지 않는다(`OrgUsageView.tsx` 규약) — 입력은
 *   정규화된 값 + 문구 사전 + 로케일뿐이라 `renderToStaticMarkup` 으로 검사 가능.
 *
 * 이 화면이 지키는 것(`orgOutcomesContract.ts` §설계 그대로):
 *   1. ★결합 0건("아직 프로젝트가 없다")과 결합은 있으나 권한이 하나도 없는
 *      상태("이 계정으로는 못 본다")를 **다른 문장**으로 가른다 — 둘 다 "빈 화면"
 *      으로 뭉개면 관리자가 원인을 못 고친다.
 *   2. ★비율에는 항상 분모: 성공률 옆에 "완료 N · 실패 M 중" 이 붙는다. 분모가
 *      0 이면 0% 이 아니라 "아직 판정 안 됨" 문장이다.
 *   3. ★제외·상한 절단을 조용히 넘기지 않는다 — 있으면 문장으로 밝힌다.
 *   4. ★실패가 많은 팀이 표에서 먼저 보인다 — "실패가 어디서 나는가" 를 순서로 답한다.
 */

import { Ban, Loader2, Users } from "lucide-react";
import type { OrgCopy, OrgCopyKey } from "./orgCopy";
import {
  successRate,
  type OrgOutcomeByTeamRow,
  type OrgOutcomesData,
} from "./orgOutcomesContract";
import { formatInt, formatPercent } from "../team/teamUsageContract";

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

function NoteLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{children}</p>
  );
}

function StatTile({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        alert
          ? "border-red-900/50 bg-red-950/20"
          : "border-zinc-800 bg-zinc-950"
      }`}
    >
      <p className="text-[11px] text-zinc-400">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold ${
          alert ? "text-red-300" : "text-zinc-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function teamLabel(copy: OrgCopy, row: OrgOutcomeByTeamRow): string {
  if (row.teamId === null) return copy.text["usage.table.unassigned"];
  return row.teamDisplayName ?? copy.text["usage.table.unknownTeam"];
}

export function OrgOutcomesSection({
  copy,
  locale,
  state,
}: {
  copy: OrgCopy;
  locale: string;
  state:
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "loaded"; data: OrgOutcomesData };
}) {
  const t = (key: OrgCopyKey, vars?: Record<string, string>): string =>
    vars ? fill(copy.text[key], vars) : copy.text[key];
  const title = t("outcomes.title");

  if (state.kind === "loading") {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h4 className="mb-2 text-sm font-semibold text-zinc-300">{title}</h4>
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("outcomes.loading")}
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h4 className="mb-2 text-sm font-semibold text-zinc-300">{title}</h4>
        <p className="text-xs text-amber-300">{t("outcomes.error")}</p>
      </div>
    );
  }

  const data = state.data;

  if (data.kind === "noBindings") {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-300">
            {t("outcomes.noBindings.title")}
          </h4>
        </div>
        <p className="text-xs leading-relaxed text-zinc-400">
          {t("outcomes.noBindings.body")}
        </p>
      </div>
    );
  }

  if (data.kind === "noAccess") {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Ban className="h-4 w-4 text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-300">
            {t("outcomes.noAccess.title")}
          </h4>
        </div>
        <p className="text-xs leading-relaxed text-zinc-400">
          {t("outcomes.noAccess.body", { n: String(data.attempted) })}
        </p>
      </div>
    );
  }

  const rate = successRate(data.tasksDone, data.tasksFailed);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-sm font-semibold text-zinc-300">{title}</h4>
        <span className="text-[11px] text-zinc-400">
          {t("outcomes.includedNote", { n: String(data.includedProjects) })}
        </span>
      </div>

      {data.excludedProjects > 0 || data.cappedOmitted > 0 ? (
        <p className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          {data.excludedProjects > 0
            ? t("outcomes.excludedNote", {
                n: String(data.excludedProjects),
              })
            : null}
          {data.excludedProjects > 0 && data.cappedOmitted > 0 ? " " : null}
          {data.cappedOmitted > 0
            ? `${copy.text["usage.truncatedFallback"]} (${data.cappedOmitted})`
            : null}
        </p>
      ) : null}

      {data.hasPartialSource ? (
        <p className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          {t("outcomes.partialNote")}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatTile
          label={t("outcomes.doneLabel")}
          value={formatInt(data.tasksDone, locale)}
        />
        <StatTile
          label={t("outcomes.failedLabel")}
          value={formatInt(data.tasksFailed, locale)}
          alert={data.tasksFailed > 0}
        />
        <StatTile
          label={t("outcomes.openLabel")}
          value={formatInt(data.tasksOpen, locale)}
        />
      </div>

      <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <p className="text-[11px] text-zinc-400">{t("outcomes.rate.label")}</p>
        {rate === null ? (
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {t("outcomes.rate.none")}
          </p>
        ) : (
          <p className="mt-1 flex flex-wrap items-baseline gap-1.5">
            <span className="text-lg font-semibold text-zinc-100">
              {formatPercent(rate, locale)}
            </span>
            <span className="text-[11px] text-zinc-400">
              {t("outcomes.rate.denominator", {
                done: formatInt(data.tasksDone, locale),
                failed: formatInt(data.tasksFailed, locale),
              })}
            </span>
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th className="px-3 py-2 font-medium">
                {t("outcomes.table.team")}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t("outcomes.table.done")}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t("outcomes.table.failed")}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t("outcomes.table.open")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.byTeam.map((row) => (
              <tr
                key={row.teamId ?? "__unassigned__"}
                className={`border-b border-zinc-900 last:border-b-0 ${
                  row.tasksFailed > 0 ? "text-red-200" : "text-zinc-300"
                }`}
              >
                <td className="px-3 py-2">
                  {teamLabel(copy, row)}{" "}
                  <span className="font-normal text-zinc-400">
                    ·{" "}
                    {fill(copy.text["usage.table.projectsCount"], {
                      n: String(row.projects),
                    })}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {formatInt(row.tasksDone, locale)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatInt(row.tasksFailed, locale)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">
                  {formatInt(row.tasksOpen, locale)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-zinc-700 font-semibold text-zinc-200">
              <td className="px-3 py-2">{t("outcomes.table.total")}</td>
              <td className="px-3 py-2 text-right">
                {formatInt(data.tasksDone, locale)}
              </td>
              <td className="px-3 py-2 text-right">
                {formatInt(data.tasksFailed, locale)}
              </td>
              <td className="px-3 py-2 text-right">
                {formatInt(data.tasksOpen, locale)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <NoteLine>{t("outcomes.basisNote")}</NoteLine>
    </div>
  );
}
