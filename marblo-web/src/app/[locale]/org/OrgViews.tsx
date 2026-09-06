/**
 * 조직 화면 — 프레젠테이션 층.
 *
 * ★firebase 도 next-intl 훅도 import 하지 않는다. 입력은 정규화된 봉투 + 문구
 *   사전 + 로케일뿐이라, 테스트가 `renderToStaticMarkup` 으로 **화면 바이트**를
 *   그대로 검사할 수 있다(`TeamUsageView` 와 같은 규약).
 *
 * 이 화면의 규약(설계 #1333 · #1336 · #1205):
 *   1. ★조직이 하나뿐이면(=개인 조직만) 스위처를 그리지 않는다 — 잡음이다.
 *   2. ★개인 조직에는 팀 개념을 그리지 않는다(#1336 §4.1) — 콤보도, 미지정
 *      버킷도, 팀 접기도 없다.
 *   3. ★권한으로 가려진 칸은 빈칸이 아니라 `restricted` 로 그린다(#1205 §4.2).
 *   4. ★빈 상태가 기본값이다 — 조직 0·팀 0·결합 0 에서 깨지지 않아야 한다.
 */

import Link from "next/link";
import { Building2, FolderGit2, Lock, Tags } from "lucide-react";
import { localeHref } from "@/i18n/routing";
import type { OrgCopy } from "./orgCopy";
import {
  currentBindings,
  deriveOrgTotalsCell,
  isSwitcherVisible,
  orgPath,
  type OrgDetail,
  type OrgListEntry,
  type OrgRole,
} from "./orgContract";
import type { TeamCopy } from "../team/teamCopy";
import { UsageCellView } from "../team/TeamUsageView";

function RoleBadge({ copy, role }: { copy: OrgCopy; role: OrgRole }) {
  return (
    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
      {copy.text[`role.${role}`]}
    </span>
  );
}

/** 조직 표시명. ★이름이 없어도 id 를 화면에 뿌리지 않는다(`/team` 규약과 동일). */
export function orgDisplayName(
  copy: OrgCopy,
  org: Pick<OrgListEntry, "displayName" | "isPersonal">
): string {
  if (org.isPersonal) return copy.text["org.personalName"];
  return org.displayName ?? copy.text["org.unnamed"];
}

// ── 스위처 — ★조직이 하나뿐이면 아예 그리지 않는다 ──────────────────────────

export function OrgSwitcherView({
  copy,
  locale,
  orgs,
  currentOrgId,
}: {
  copy: OrgCopy;
  locale: string;
  orgs: OrgListEntry[];
  /** 지금 보고 있는 조직. 개인 조직 화면이면 개인 항목의 orgId. */
  currentOrgId: string | null;
}) {
  // 대부분의 사용자는 개인 조직 하나뿐이다 — 그때 이 스위처는 잡음이다(#1333 §3.3).
  if (!isSwitcherVisible(orgs)) return null;
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-zinc-500">
        {copy.text["switcher.label"]}
      </span>
      {orgs.map((o) => (
        <Link
          key={o.orgId}
          href={localeHref(locale, orgPath(o))}
          aria-current={o.orgId === currentOrgId ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${
            o.orgId === currentOrgId
              ? "bg-zinc-100 text-zinc-900"
              : "border border-zinc-800 text-zinc-400"
          }`}
        >
          {orgDisplayName(copy, o)}
          <span className="text-[10px] opacity-70">
            {copy.text[`role.${o.role}`]}
          </span>
        </Link>
      ))}
    </nav>
  );
}

// ── 조직 선택 화면 — §5.8 규칙 3. 여러 조직 소속자만 도달한다 ────────────────

export function OrgChooserView({
  copy,
  locale,
  orgs,
}: {
  copy: OrgCopy;
  locale: string;
  orgs: OrgListEntry[];
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-100">
          {copy.text["choose.title"]}
        </h1>
        {/* ★자동 착지하지 않는 이유를 화면이 말한다 — 대행사가 고객 A 화면을
            열어 둔 채 B 와 회의하는 사고 방지(§5.8). */}
        <p className="mt-1 text-sm text-zinc-400">{copy.text["choose.body"]}</p>
      </header>
      <ul className="space-y-2">
        {orgs.map((o) => (
          <li key={o.orgId}>
            <Link
              href={localeHref(locale, orgPath(o))}
              className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-600"
            >
              <Building2 className="h-5 w-5 shrink-0 text-zinc-500" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-zinc-200">
                  {orgDisplayName(copy, o)}
                </span>
                {o.isPersonal ? (
                  <span className="block text-[11px] text-zinc-500">
                    {copy.text["org.personalNote"]}
                  </span>
                ) : null}
              </span>
              <RoleBadge copy={copy} role={o.role} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 조직 홈 ─────────────────────────────────────────────────────────────────

export function OrgHomeView({
  copy,
  teamCopy,
  locale,
  detail,
  orgs,
  bindForm,
  inviteForm,
  usageSection,
  outcomesSection,
  drilldownSection,
}: {
  copy: OrgCopy;
  teamCopy: TeamCopy;
  locale: string;
  detail: OrgDetail;
  orgs: OrgListEntry[];
  /** 결합 폼 슬롯 — 데이터 층이 꽂는다. ★비개인 조직에서만 그려진다. */
  bindForm?: React.ReactNode;
  /** 초대 폼 슬롯(#1338 §3.1 (d)) — 데이터 층이 org_admin+ 일 때만 꽂는다. */
  inviteForm?: React.ReactNode;
  /**
   * 조직 롤업(L0) 슬롯 — 데이터 층이 org_admin+ 일 때만 꽂는다(Phase 2,
   * `getOrgUsageSummary`). 없으면 역할 판정 셀(restricted/unwired)로 그린다 —
   * org_member 는 콜러블을 부르지도 않고 restricted 로 접힌다(0 이 아니다).
   */
  usageSection?: React.ReactNode;
  /**
   * 조직 작업 성과(완료·실패) 슬롯 — 데이터 층이 org_admin+ 일 때만 꽂는다
   * (`getTeamProjectAudit` 를 결합 프로젝트마다 모은 롤업, `orgOutcomesContract.ts`).
   * 없으면 아무것도 그리지 않는다 — org_member 화면에는 이 슬롯 자체가 안 온다.
   */
  outcomesSection?: React.ReactNode;
  /**
   * 5단 드릴다운(사람 › 에이전트·모델) 슬롯 — Phase 3. 위 세 단(조직›팀›
   * 프로젝트)은 `usageSection` 이 이미 그리고, 이 슬롯은 그 아래 두 단이다.
   * ★`outcomesSection` 과 같은 규약: org_admin+ 일 때만 데이터 층이 꽂고,
   * 안 꽂혔으면 대체 셀 없이 아무것도 안 그린다(부르지 않았으면 그릴 것도 없다).
   */
  drilldownSection?: React.ReactNode;
}) {
  const personal = detail.isPersonal;
  // ★빈 상태 규약(#1333 §7): 비개인 조직 0건이 기본값이다 — 개인 조직 화면이
  //   "왜 이것뿐이고 언제 차는지" 를 말한다. 비개인 조직이 있으면 잡음이라 접는다.
  const hasNonPersonalOrg = orgs.some((o) => !o.isPersonal);
  return (
    <div>
      <OrgSwitcherView
        copy={copy}
        locale={locale}
        orgs={orgs}
        currentOrgId={detail.orgId}
      />

      <header className="mb-6">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-zinc-100">
          {orgDisplayName(copy, detail)}
          <RoleBadge copy={copy} role={detail.myRole} />
        </h1>
        {personal ? (
          // ★개인 조직 안내 한 줄 — 그리고 끝. 팀 개념은 여기 등장하지 않는다
          //   (#1336 §4.1 "혼자인 사람에게 팀을 그리는 것은 빈 개념을 파는 것").
          <p className="mt-1 text-sm text-zinc-400">
            {copy.text["personal.subtitle"]}
          </p>
        ) : null}
        {personal && !hasNonPersonalOrg ? (
          <p className="mt-2 text-xs text-zinc-500">
            {copy.text["personal.createHint"]}{" "}
            <Link
              href={localeHref(locale, "/org/new")}
              className="text-zinc-300 underline underline-offset-2"
            >
              {copy.text["personal.createCta"]}
            </Link>
          </p>
        ) : null}
      </header>

      {personal ? null : (
        <>
          {/* ── 조직 전체 사용량(L0) — Phase 2 롤업. 관리자는 데이터 층이 꽂은
              슬롯(getOrgUsageSummary)을 그리고, org_member 는 restricted 셀로
              접힌다. 어느 쪽에도 0 이나 빈칸은 없다(#1205 §4.2). */}
          <section className="mb-8">
            {usageSection ?? (
              <UsageCellView
                copy={teamCopy}
                locale={locale}
                cell={deriveOrgTotalsCell(detail.myRole)}
                title={copy.text["usage.title"]}
                basis=""
              />
            )}
          </section>

          {/* ── 조직 작업 성과(완료·실패) — org_admin+ 일 때만 데이터 층이 꽂는다.
              org_member 화면에는 이 슬롯이 아예 안 온다(usageSection 과 달리
              대체 셀을 그리지 않는다 — 새 콜러블이 아니라 기존 감사 콜러블을
              여러 번 부른 결과라, 부르지 않았으면 그릴 것도 없다). */}
          {outcomesSection ? (
            <section className="mb-8">{outcomesSection}</section>
          ) : null}

          {/* ── 5단 드릴다운 — 사람 › 에이전트·모델(Phase 3). 위 롤업 표에서
              프로젝트 하나를 펼치면 그 아래 두 단이 열린다. ★같은 표를 다시
              그리지 않는다 — 층 이름만 빵부스러기로 잇는다. */}
          {drilldownSection ? (
            <section className="mb-8">{drilldownSection}</section>
          ) : null}

          {/* ── 팀 라벨 — 비개인 조직 전용. ★팀 0개가 기본값이다. */}
          {detail.teams !== null ? (
            <section className="mb-8">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
                <Tags className="h-4 w-4 text-zinc-500" />
                {copy.text["teams.title"]}
              </h2>
              {detail.teams.filter((t) => !t.archived).length === 0 ? (
                <p className="text-xs text-zinc-500">
                  {copy.text["teams.empty"]}
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {detail.teams
                    .filter((t) => !t.archived)
                    .map((t) => (
                      <li
                        key={t.teamId}
                        className="rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300"
                      >
                        {t.displayName}
                      </li>
                    ))}
                </ul>
              )}
            </section>
          ) : null}

          {/* ── 결합된 프로젝트 — 목록은 조직 편제 관리 정보(org_admin+).
              org_member 에게는 봉투에 아예 안 실리고(null), 화면은 빈칸 대신
              누가 볼 수 있는지를 말한다. */}
          <section className="mb-8">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
              <FolderGit2 className="h-4 w-4 text-zinc-500" />
              {copy.text["bindings.title"]}
            </h2>
            {detail.bindings === null ? (
              <p className="flex items-start gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-4 text-xs leading-relaxed text-zinc-400">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                {copy.text["bindings.restricted"]}
              </p>
            ) : (
              <BindingsTable copy={copy} detail={detail} />
            )}
          </section>

          {bindForm}

          {inviteForm}
        </>
      )}
    </div>
  );
}

function BindingsTable({ copy, detail }: { copy: OrgCopy; detail: OrgDetail }) {
  const rows = currentBindings(detail.bindings ?? []);
  if (rows.length === 0) {
    // ★결합 0건이 기본값이다(#1333 §7) — 깨진 화면이 아니라 문장 하나.
    return (
      <p className="text-xs text-zinc-500">{copy.text["bindings.empty"]}</p>
    );
  }
  const teamName = (teamId: string | null): string => {
    if (teamId === null) return copy.text["bindings.noTeam"];
    // 보관된 팀도 라벨은 해석한다 — 과거 결합 행이 그 id 를 가리킨다.
    const hit = (detail.teams ?? []).find((t) => t.teamId === teamId);
    return hit ? hit.displayName : copy.text["bindings.teamUnknown"];
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500">
            <th className="px-3 py-2 font-medium">
              {copy.text["bindings.project"]}
            </th>
            <th className="px-3 py-2 font-medium">
              {copy.text["bindings.team"]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr
              key={b.bindingId}
              className="border-b border-zinc-900 last:border-b-0"
            >
              <td className="px-3 py-2 font-mono text-zinc-300">
                {b.projectId}
              </td>
              <td className="px-3 py-2 text-zinc-400">{teamName(b.teamId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
