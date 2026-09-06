"use client";

/**
 * `/org/me` · `/org/[orgId]` — 조직 홈의 데이터 층.
 *
 * ★URL 의 `orgId` 는 **권한 근거가 아니다** — 서버가 uid 로 만든 멤버십과의
 *   교집합으로만 쓰인다(`team/[projectId]` 규약 그대로). 권한 밖 orgId 는
 *   404 도 403 도 아니라 §3.3 의 기본 조직으로 **조용히 착지**한다(존재
 *   비노출, #1205 §5.8).
 * ★개인 조직은 `/org/me` 별칭 하나로만 연다 — `personal_<uid>` 를 URL 에
 *   싣지 않는다(#1333 §3.1). 서버가 `"me"` 를 풀어 준다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useMessages } from "next-intl";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import app, { auth } from "@/lib/firebase";
import {
  ClipboardCopy,
  Loader2,
  MailX,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { localeHref } from "@/i18n/routing";
import { buildOrgCopy, type OrgCopy } from "./orgCopy";
import {
  currentBindings,
  landingPath,
  normalizeOrganizations,
  resolveOrgLanding,
  PERSONAL_ORG_SENTINEL,
  type OrgsEnvelope,
  type OrgTeamEntry,
} from "./orgContract";
import {
  clearLastSeenOrgId,
  readLastSeenOrgId,
  writeLastSeenOrgId,
} from "./orgStorage";
import { OrgHomeView } from "./OrgViews";
import { OrgUsageSection } from "./OrgUsageView";
import { normalizeOrgUsage, type OrgUsageData } from "./orgUsageContract";
import { OrgOutcomesSection } from "./OrgOutcomesView";
import { OrgDrilldownSection } from "./OrgDrilldownView";
import {
  buildProjectDetail,
  type DrilldownProjectDetail,
} from "./orgDrilldownContract";
import {
  aggregateOrgOutcomes,
  type OrgOutcomeProjectInput,
  type OrgOutcomesData,
} from "./orgOutcomesContract";
import { buildTeamCopy } from "../team/teamCopy";
import {
  normalizeTeamAudit,
  type TeamAuditProjectRef,
} from "../team/teamAuditContract";
import { normalizeTeamUsage } from "../team/teamUsageContract";
import { normalizeTeamExecutionLedger } from "../team/teamExecutionLedgerContract";
import TeamOverviewClient from "../team/TeamOverviewClient";
import {
  CREATE_ORG_INVITATION_CALLABLE,
  LIST_ORG_INVITATIONS_CALLABLE,
  REVOKE_ORG_INVITATION_CALLABLE,
  classifyCreateInviteError,
  classifyRevokeInviteError,
  parseCreateOrgInvitationData,
  parseOrgInvitationList,
  type CreateInviteFailure,
  type CreatedOrgInvitation,
  type PendingOrgInvitation,
  type RevokeInviteFailure,
} from "@/lib/orgOnboarding";

/** #1340 이 배포한 콜러블 둘. 새 이름을 발명하지 않는다. */
const CALLABLE_GET_ORGANIZATIONS = "getOrganizations";
const CALLABLE_BIND_PROJECT = "bindProjectToOrg";

/** Phase 2 조직 롤업(#1333 §4.2). ★org_admin+ 일 때만 부른다. */
const CALLABLE_ORG_USAGE = "getOrgUsageSummary";

/**
 * ★조직 롤업이 요청하는 조회 기간(티켓 EmHUecXSgXSyrF2XgJ8b).
 *
 * 서버(`getOrgUsageSummary` → `parseAnalyticsDays`)는 이미 `days` 를 읽고
 * 365 로 상한만 건다 — **콜러블·서버 배포는 안 건드린다.** 문제는 이 화면이
 * `days` 를 아예 안 실어 서버 기본값(30일)에 묶여 있던 것이다.
 *
 * `TEAM_USAGE_EFFECTIVE_FROM=2026-04-01` 게이트가 창을 뒤로 늘리지 않는다
 * (`clampWindowToGate` 는 fromDay 를 올리기만 한다) — 그래서 창 자체를
 * 넓혀야 발효일 이후 이력이 보인다.
 *
 * ★365(서버 상한)를 기본값으로 쓰지 않는다. 조직 상한(최대 100개 결합
 * 프로젝트)과 곱해지면 매 조회마다 BQ 가 100개 프로젝트 × 365일 파티션을
 * 훑는다 — 오늘(2026-04-01 → 2026-09-07)로부터 필요한 건 약 160일뿐이라
 * 그 두 배 넘게 과다 스캔하는 셈이다. 200일이면 발효일을 40일 넉넉히
 * 덮으면서 서버 상한의 ~55%(365일 대비)로 최악 스캔 비용을 낮춘다.
 * ★캐시(`buildTeamUsageCacheDocId`)가 (projectId, windowKey) 로 15분
 * 걸리므로, 이 확장 비용은 캐시 미스에서만 발생한다 — 시연 중 반복 조회는
 * 캐시를 그대로 재사용한다.
 */
const ORG_USAGE_RANGE_DAYS = 200;

/** 결합 폼의 프로젝트 목록에 쓰는 기존 콜러블(`/team` 감사 봉투의 `projects`). */
const CALLABLE_TEAM_AUDIT = "getTeamProjectAudit";

/**
 * 프로젝트 하나의 사용량(멤버·모델 분해). ★5단 드릴다운의 4·5단이 이걸로 온다.
 * 새 콜러블이 아니라 `/team` 화면이 이미 쓰는 그것이다 — 권한도 그쪽이 판정한다
 * (그 프로젝트의 오너·관리자가 아니면 멤버 분해가 안 온다).
 */
const CALLABLE_TEAM_USAGE = "getTeamUsageSummary";

/**
 * 실행 원장(Mission→Ticket→Agent→Model→Cost→Result). 티켓
 * uYcCq9DRPLT8ZEh0rlkh — `getTeamProjectAudit` 과 별도 콜러블인 이유는
 * `orgDrilldownContract.ts` 헤더 주석 참조(비용 축, 별도 게이트).
 */
const CALLABLE_TEAM_EXECUTION_LEDGER = "getTeamProjectExecutionLedger";

type CallableError = { code?: string; message?: string };

export default function OrgHomeClient({ orgId }: { orgId: string }) {
  const locale = useLocale();
  const messages = useMessages();
  const router = useRouter();
  const msgRecord = messages as Record<string, unknown> | undefined;
  const copy = useMemo(() => buildOrgCopy(msgRecord?.["org"]), [msgRecord]);
  const teamCopy = useMemo(
    () => buildTeamCopy(msgRecord?.["team"]),
    [msgRecord]
  );

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [env, setEnv] = useState<OrgsEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 초대를 하나 만들 때마다 대기 목록을 다시 읽는다(방금 만든 초대가 보여야
  // 그 자리에서 취소할 수 있다).
  const [inviteEpoch, setInviteEpoch] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable<{ orgId: string }, unknown>(
        getFunctions(app, "us-central1"),
        CALLABLE_GET_ORGANIZATIONS
      );
      const res = await fn({ orgId });
      // ★신뢰 경계. 정규화를 거치지 않은 값은 화면으로 내려보내지 않는다.
      setEnv(normalizeOrganizations(res.data));
    } catch (err: unknown) {
      const code = (err as CallableError)?.code;
      setEnv(null);
      setError(
        code === "functions/unauthenticated"
          ? copy.text["error.unauthenticated"]
          : code === "functions/not-found" || code === "functions/internal"
          ? copy.text["error.notDeployed"]
          : copy.text["error.unknown"]
      );
    } finally {
      setLoading(false);
    }
  }, [orgId, copy]);

  useEffect(() => {
    if (!authReady || !user) return;
    void load();
  }, [authReady, user, load]);

  // ── 조직 롤업(L0) — ★org_admin+ 이고 비개인 조직일 때만 부른다.
  //    org_member 는 부르지 않고 restricted 셀로 접힌다(서버도 같은 판정을
  //    한 번 더 한다 — 화면 가림은 편의, 강제는 서버).
  const [usage, setUsage] = useState<OrgUsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState(false);
  // ★에러 카드의 "다시 시도" 가 이 값을 올리면 아래 effect 가 다시 돈다
  //   (감사 #1495 P1-5). `inviteEpoch` 와 같은 패턴 — 전역 새로고침처럼
  //   화면 전체를 다시 부르지 않고 실패한 콜러블 하나만 다시 부른다.
  const [usageEpoch, setUsageEpoch] = useState(0);

  useEffect(() => {
    const d = env?.detail;
    if (!d || d.isPersonal || d.myRole === "org_member") {
      setUsage(null);
      setUsageError(false);
      return;
    }
    let cancelled = false;
    setUsageLoading(true);
    setUsageError(false);
    (async () => {
      try {
        const fn = httpsCallable<{ orgId: string; days: number }, unknown>(
          getFunctions(app, "us-central1"),
          CALLABLE_ORG_USAGE
        );
        const res = await fn({ orgId: d.orgId, days: ORG_USAGE_RANGE_DAYS });
        if (cancelled) return;
        // ★신뢰 경계. 정규화를 거치지 않은 값은 화면으로 내려보내지 않는다.
        setUsage(normalizeOrgUsage(res.data));
      } catch {
        if (cancelled) return;
        setUsage(null);
        setUsageError(true);
      } finally {
        if (!cancelled) setUsageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [env, usageEpoch]);

  // ── 조직 작업 성과(완료·실패) — ★새 콜러블이 아니다. 이미 배포된
  //    `getTeamProjectAudit`(#1124, 2026-08-22 — org 롤업보다 열흘 이른 기존
  //    기능이라 배포 갭 위험이 없다)를 결합 프로젝트마다 불러 접는다
  //    (`orgOutcomesContract.ts`). 사용량 롤업과 같은 게이트(org_admin+·비개인)
  //    로만 부른다 — org_member 는 이 슬롯 자체가 안 온다.
  const ORG_OUTCOMES_MAX_PROJECTS = 20;
  const [outcomes, setOutcomes] = useState<OrgOutcomesData | null>(null);
  const [outcomesLoading, setOutcomesLoading] = useState(false);
  const [outcomesError, setOutcomesError] = useState(false);

  useEffect(() => {
    const d = env?.detail;
    if (!d || d.isPersonal || d.myRole === "org_member") {
      setOutcomes(null);
      setOutcomesError(false);
      return;
    }
    const bindings = currentBindings(d.bindings ?? []);
    if (bindings.length === 0) {
      setOutcomes({ kind: "noBindings" });
      setOutcomesError(false);
      return;
    }
    const teamDisplayNameOf = (teamId: string | null): string | null =>
      teamId === null
        ? null
        : (d.teams ?? []).find((t) => t.teamId === teamId)?.displayName ?? null;
    // ★결정적 순서로 자른다 — 어느 프로젝트가 상한 안에 드는지가 새로고침마다
    //   바뀌면 "왜 이번엔 다른 숫자가 나오지" 라는 오경보를 만든다.
    const scoped = [...bindings]
      .sort((a, b) => a.projectId.localeCompare(b.projectId))
      .slice(0, ORG_OUTCOMES_MAX_PROJECTS);

    let cancelled = false;
    setOutcomesLoading(true);
    setOutcomesError(false);
    (async () => {
      const fn = httpsCallable<{ projectId: string }, unknown>(
        getFunctions(app, "us-central1"),
        CALLABLE_TEAM_AUDIT
      );
      const settled = await Promise.allSettled(
        scoped.map((b) => fn({ projectId: b.projectId }))
      );
      if (cancelled) return;
      const rows: OrgOutcomeProjectInput[] = settled.map((r, i) => ({
        projectId: scoped[i].projectId,
        teamId: scoped[i].teamId,
        teamDisplayName: teamDisplayNameOf(scoped[i].teamId),
        // ★신뢰 경계. 정규화를 거치지 않은 값은 집계로 내려보내지 않는다.
        // 호출 자체가 실패해도(rejected) null 로 접는다 — 던지지 않는다.
        envelope:
          r.status === "fulfilled" ? normalizeTeamAudit(r.value.data) : null,
      }));
      setOutcomes(aggregateOrgOutcomes(bindings.length, rows));
      setOutcomesLoading(false);
    })().catch(() => {
      if (cancelled) return;
      setOutcomes(null);
      setOutcomesError(true);
      setOutcomesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [env]);

  // ── 5단 드릴다운(Phase 3) — 사람 › 에이전트·모델 ──────────────────────────
  //
  // ★**지연 로딩이다.** 프로젝트를 펼칠 때만 그 프로젝트 두 콜러블을 부른다.
  //   결합 프로젝트가 스물이면 미리 부르는 순간 마흔 번이 나가고, 그 대부분은
  //   아무도 안 펼친다. 위 성과 롤업(N× 감사 호출)이 이미 나가고 있으므로
  //   여기서 한 번 더 팬아웃을 만들지 않는다.
  //
  // ★권한은 여기서 판정하지 않는다. 두 콜러블이 **그 프로젝트의** 역할을
  //   서버에서 스스로 확인하고, 없으면 `disabled(no_role)` 를 돌려준다 —
  //   조직 관리자라는 사실은 프로젝트 안을 열어 주지 않는다(#1333 §6.1).
  //   화면은 그 봉투를 `buildProjectDetail` 로 접어 `restricted` 로 그린다.
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
    null
  );
  const [drilldown, setDrilldown] = useState<DrilldownProjectDetail | null>(
    null
  );

  useEffect(() => {
    const d = env?.detail;
    if (!d || d.isPersonal || d.myRole === "org_member") {
      setExpandedProjectId(null);
      setDrilldown(null);
      return;
    }
    if (expandedProjectId === null) {
      setDrilldown(null);
      return;
    }
    let cancelled = false;
    setDrilldown({ kind: "loading" });
    (async () => {
      const fns = getFunctions(app, "us-central1");
      const usageFn = httpsCallable<{ projectId: string }, unknown>(
        fns,
        CALLABLE_TEAM_USAGE
      );
      const auditFn = httpsCallable<{ projectId: string }, unknown>(
        fns,
        CALLABLE_TEAM_AUDIT
      );
      const ledgerFn = httpsCallable<{ projectId: string }, unknown>(
        fns,
        CALLABLE_TEAM_EXECUTION_LEDGER
      );
      const [usageRes, auditRes, ledgerRes] = await Promise.allSettled([
        usageFn({ projectId: expandedProjectId }),
        auditFn({ projectId: expandedProjectId }),
        ledgerFn({ projectId: expandedProjectId }),
      ]);
      if (cancelled) return;
      // ★신뢰 경계. 정규화를 거치지 않은 값은 집계로 내려보내지 않는다. 한쪽만
      //   실패해도 던지지 않고 그쪽만 null 로 접는다(`buildProjectDetail` 이
      //   둘 다 없을 때만 오류로 판정한다). 원장 콜러블이 실패해도 사람 축은
      //   그대로 그려진다 — `unwired` 로 접힐 뿐이다.
      setDrilldown(
        buildProjectDetail(
          usageRes.status === "fulfilled"
            ? normalizeTeamUsage(usageRes.value.data)
            : null,
          auditRes.status === "fulfilled"
            ? normalizeTeamAudit(auditRes.value.data)
            : null,
          ledgerRes.status === "fulfilled"
            ? normalizeTeamExecutionLedger(ledgerRes.value.data)
            : null
        )
      );
    })().catch(() => {
      if (cancelled) return;
      setDrilldown({ kind: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [env, expandedProjectId]);

  // ── 착지·기억 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!env) return;
    if (env.detail) {
      // ★개인 조직은 orgId 대신 센티널을 적는다 — uid 를 저장소에 흘리지 않는다.
      writeLastSeenOrgId(
        env.detail.isPersonal ? PERSONAL_ORG_SENTINEL : env.detail.orgId
      );
      return;
    }
    // detail: null = 없거나 권한 없음(구분해 주지 않는다). ★"그 조직은 없습니다"
    // 도 "볼 수 없습니다" 도 그리지 않고 기본 조직으로 조용히 착지한다(§5.8).
    const lastSeen = readLastSeenOrgId();
    if (lastSeen === orgId) clearLastSeenOrgId();
    const landing = resolveOrgLanding(
      env.orgs,
      lastSeen === orgId ? null : lastSeen
    );
    router.replace(localeHref(locale, landingPath(landing)));
  }, [env, orgId, router, locale]);

  if (!authReady) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <h1 className="text-xl font-semibold text-zinc-100">
          {copy.text["title"]}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {copy.text["state.signInRequired"]}
        </p>
        <Link
          href={localeHref(
            locale,
            `/auth/login?redirect=${encodeURIComponent(
              localeHref(
                locale,
                orgId === PERSONAL_ORG_SENTINEL ? "/org/me" : `/org/${orgId}`
              )
            )}`
          )}
          className="mt-4 inline-flex items-center rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900"
        >
          {copy.text["action.signIn"]}
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-5">
          <p className="text-sm text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-200"
          >
            {copy.text["action.retry"]}
          </button>
        </div>
      </div>
    );
  }

  if (!env || !env.detail) {
    // detail: null 은 위 효과가 조용히 다른 곳으로 보낸다 — 여기는 로딩만.
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {copy.text["state.loading"]}
      </div>
    );
  }

  const detail = env.detail;
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
          {copy.text["action.refresh"]}
        </button>
      </div>
      <div className={loading ? "opacity-60" : undefined}>
        <OrgHomeView
          copy={copy}
          teamCopy={teamCopy}
          locale={locale}
          detail={detail}
          orgs={env.orgs}
          bindForm={
            detail.isPersonal ? null : (
              <BindProjectForm
                copy={copy}
                orgId={detail.orgId}
                teams={detail.teams ?? []}
                onBound={() => void load()}
              />
            )
          }
          inviteForm={
            // ★초대 생성은 org_admin+ 의 일이다(#1343 planOrgInviteCreate).
            //   화면 가림은 편의일 뿐 강제는 서버가 한다 — org_member 에게
            //   실패할 폼을 보여주지 않는 것뿐이다.
            !detail.isPersonal && detail.myRole !== "org_member" ? (
              <>
                <InviteMemberForm
                  copy={copy}
                  locale={locale}
                  orgId={detail.orgId}
                  onInvited={() => setInviteEpoch((n) => n + 1)}
                />
                {/* ★취소 경로의 나머지 절반(티켓 3PRpIVJdyE5dUWQWwy6Y):
                    되돌릴 대상이 화면에 있어야 되돌릴 수 있다. */}
                <PendingInvitesPanel
                  copy={copy}
                  locale={locale}
                  orgId={detail.orgId}
                  reloadKey={inviteEpoch}
                />
              </>
            ) : null
          }
          usageSection={
            // ★org_member 에는 슬롯을 꽂지 않는다 — OrgHomeView 가 restricted
            //   셀로 그린다(0 으로 접히지 않는다). 관리자에게만 롤업을 그린다.
            !detail.isPersonal && detail.myRole !== "org_member" ? (
              <OrgUsageSection
                copy={copy}
                teamCopy={teamCopy}
                locale={locale}
                now={Date.now()}
                state={
                  usageLoading || (usage === null && !usageError)
                    ? { kind: "loading" }
                    : usage === null
                    ? {
                        kind: "error",
                        onRetry: () => setUsageEpoch((n) => n + 1),
                      }
                    : { kind: "loaded", data: usage }
                }
              />
            ) : undefined
          }
          outcomesSection={
            // ★org_member 에는 슬롯 자체를 꽂지 않는다 — usageSection 과 달리
            //   대체 셀도 없다(새 콜러블이 아니라 기존 감사 콜러블을 여러 번
            //   부른 결과라, 부르지 않았으면 그릴 것도 없다).
            !detail.isPersonal && detail.myRole !== "org_member" ? (
              <OrgOutcomesSection
                copy={copy}
                locale={locale}
                state={
                  outcomesLoading || (outcomes === null && !outcomesError)
                    ? { kind: "loading" }
                    : outcomes === null
                    ? { kind: "error" }
                    : { kind: "loaded", data: outcomes }
                }
              />
            ) : undefined
          }
          drilldownSection={
            // ★usageSection 과 같은 게이트 — org_member 에는 슬롯 자체를 안 꽂는다.
            //   프로젝트 목록은 Phase 2 봉투의 `byProject` 를 **그대로** 쓴다
            //   (여기서 다시 집계하지 않는다 — 두 표가 다른 숫자를 말하지 않게).
            !detail.isPersonal &&
            detail.myRole !== "org_member" &&
            usage !== null &&
            usage.kind === "data" ? (
              <OrgDrilldownSection
                copy={copy}
                locale={locale}
                projects={usage.byProject}
                expandedProjectId={expandedProjectId}
                onToggle={setExpandedProjectId}
                detail={drilldown}
              />
            ) : undefined
          }
        />
        {detail.isPersonal ? (
          // ★개인 조직 = 오늘의 `/team` 을 조직 문맥으로(#1333 §7). 팀 개념은
          //   여기 없고, 아래 화면도 프로젝트·멤버·모델 축만 그린다.
          <TeamOverviewClient projectId={null} />
        ) : null}
      </div>
    </div>
  );
}

// ── 결합 폼 — #1336 §4.1 "조직이 문맥에 들어온 순간에만 묻는다" ──────────────

/** 콤보의 팀 선택값. ★서버 계약: `teamId` 와 `newTeamName` 은 동시에 못 준다. */
type TeamChoice =
  | { kind: "none" }
  | { kind: "existing"; teamId: string }
  | { kind: "new" };

function BindProjectForm({
  copy,
  orgId,
  teams,
  onBound,
}: {
  copy: OrgCopy;
  orgId: string;
  teams: OrgTeamEntry[];
  onBound: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<TeamAuditProjectRef[] | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [choice, setChoice] = useState<TeamChoice>({ kind: "none" });
  const [newTeamName, setNewTeamName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeTeams = teams.filter((t) => !t.archived);

  // ★권한을 화면에서 판정하지 않는다. 목록은 서버가 준 것(호출자가 역할을
  //   가진 프로젝트)이고, 결합 가능 여부는 서버가 결정한다(#1336 §4.4).
  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const fn = httpsCallable<{ limit: number }, unknown>(
        getFunctions(app, "us-central1"),
        CALLABLE_TEAM_AUDIT
      );
      const res = await fn({ limit: 1 });
      setProjects(normalizeTeamAudit(res.data).projects);
    } catch {
      // 목록을 못 받아도 폼은 남긴다 — 빈 목록 문구가 사유를 말한다.
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || projects !== null || projectsLoading) return;
    void loadProjects();
  }, [open, projects, projectsLoading, loadProjects]);

  const submit = useCallback(async () => {
    if (projectId === "") return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const fn = httpsCallable<
        {
          projectId: string;
          orgId: string;
          teamId?: string;
          newTeamName?: string;
        },
        unknown
      >(getFunctions(app, "us-central1"), CALLABLE_BIND_PROJECT);
      await fn({
        projectId,
        orgId,
        ...(choice.kind === "existing" ? { teamId: choice.teamId } : {}),
        ...(choice.kind === "new" && newTeamName.trim() !== ""
          ? { newTeamName: newTeamName.trim() }
          : {}),
      });
      setNotice(copy.text["bind.success"]);
      setOpen(false);
      setProjectId("");
      setChoice({ kind: "none" });
      setNewTeamName("");
      onBound();
    } catch (err: unknown) {
      const code = (err as CallableError)?.code;
      setError(
        code === "functions/permission-denied"
          ? copy.text["bind.error.permission"]
          : code === "functions/invalid-argument"
          ? copy.text["bind.error.invalid"]
          : copy.text["bind.error.unknown"]
      );
    } finally {
      setSubmitting(false);
    }
  }, [projectId, orgId, choice, newTeamName, copy, onBound]);

  if (!open) {
    return (
      <section className="mb-8">
        {notice ? (
          <p className="mb-2 text-xs text-emerald-300">{notice}</p>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
        >
          {copy.text["bind.open"]}
        </button>
      </section>
    );
  }

  return (
    <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-300">
        {copy.text["bind.title"]}
      </h3>

      <label
        className="mb-1 block text-[11px] text-zinc-400"
        htmlFor="org-bind-project"
      >
        {copy.text["bind.projectLabel"]}
      </label>
      {projectsLoading || projects === null ? (
        <p className="mb-3 text-xs text-zinc-400">
          {copy.text["bind.projectLoading"]}
        </p>
      ) : projects.length === 0 ? (
        <p className="mb-3 text-xs text-zinc-400">
          {copy.text["bind.projectEmpty"]}
        </p>
      ) : (
        <select
          id="org-bind-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200"
        >
          <option value="">—</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ?? p.id}
            </option>
          ))}
        </select>
      )}

      <label
        className="mb-1 block text-[11px] text-zinc-400"
        htmlFor="org-bind-team"
      >
        {copy.text["bind.teamLabel"]}
      </label>
      <select
        id="org-bind-team"
        value={
          choice.kind === "none"
            ? ""
            : choice.kind === "new"
            ? "__new__"
            : choice.teamId
        }
        onChange={(e) => {
          const v = e.target.value;
          setChoice(
            v === ""
              ? { kind: "none" }
              : v === "__new__"
              ? { kind: "new" }
              : { kind: "existing", teamId: v }
          );
        }}
        className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200"
      >
        {/* ★"팀 없음" 은 기본값이자 정상값이다(#1336 §6 — "없다고 답함"). */}
        <option value="">{copy.text["bind.teamNone"]}</option>
        {activeTeams.map((t) => (
          <option key={t.teamId} value={t.teamId}>
            {t.displayName}
          </option>
        ))}
        <option value="__new__">{copy.text["bind.teamNew"]}</option>
      </select>

      {choice.kind === "new" ? (
        <input
          type="text"
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          placeholder={copy.text["bind.teamNewPlaceholder"]}
          aria-label={copy.text["bind.teamNewPlaceholder"]}
          className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200"
        />
      ) : null}

      {error ? <p className="mb-3 text-xs text-red-300">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={
            submitting ||
            projectId === "" ||
            (choice.kind === "new" && newTeamName.trim() === "")
          }
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 disabled:opacity-50"
        >
          {submitting ? copy.text["bind.submitting"] : copy.text["bind.submit"]}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={submitting}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
        >
          {copy.text["bind.cancel"]}
        </button>
      </div>
    </section>
  );
}

// ── 초대 폼 — #1338 §3.1 (d) v0: 초대 생성 + ★링크 복사(메일 발송 없음) ──────

/** 초대로 줄 수 있는 조직 역할(#1343 INVITABLE_ORG_ROLES) — owner 는 없다. */
// ── 대기 중 초대 + 철회 — 티켓 3PRpIVJdyE5dUWQWwy6Y (감사 #1378 §3.1 F4) ─────
//
// ★F4 가 말한 "취소 경로가 없다"는 두 가지가 없었다는 뜻이다: 철회 콜러블과,
//   철회할 대상을 보여 주는 화면. 여기가 그 화면이다.
// ★★목록은 토큰을 받지 않는다(listOrgInvitations 가 싣지 않는다). 링크는
//   만든 그 순간에만 화면에 나타난다 — 이 패널이 링크 창고가 되면 F4 를
//   고치면서 그보다 큰 노출을 새로 만드는 셈이다.
// ★확인 대화를 한 번 거친다 — 철회는 이미 남에게 전달된 링크를 죽이는,
//   되돌릴 수 없는 행위다(다시 초대하면 링크 주소 자체가 달라진다).

function PendingInvitesPanel({
  copy,
  locale,
  orgId,
  reloadKey,
}: {
  copy: OrgCopy;
  locale: string;
  orgId: string;
  /** 값이 바뀌면 다시 읽는다 — 초대 생성 직후 목록을 최신으로. */
  reloadKey: number;
}) {
  const [rows, setRows] = useState<PendingOrgInvitation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  /** 지금 철회 중인 이메일 — 행 단위로 버튼을 잠근다. */
  const [revoking, setRevoking] = useState<string | null>(null);
  const [failure, setFailure] = useState<RevokeInviteFailure | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const fn = httpsCallable<{ orgId: string }, unknown>(
        getFunctions(app, "us-central1"),
        LIST_ORG_INVITATIONS_CALLABLE
      );
      const res = await fn({ orgId });
      setRows(parseOrgInvitationList(res.data));
    } catch {
      // 목록을 못 읽는 것이 초대 생성을 막지는 않는다 — 문구로만 말한다.
      setRows(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const revoke = useCallback(
    async (invitedEmail: string) => {
      if (revoking !== null) return;
      if (!window.confirm(copy.text["pending.revokeConfirm"])) return;
      setRevoking(invitedEmail);
      setFailure(null);
      try {
        const fn = httpsCallable<{ orgId: string; email: string }, unknown>(
          getFunctions(app, "us-central1"),
          REVOKE_ORG_INVITATION_CALLABLE
        );
        await fn({ orgId, email: invitedEmail });
        // 서버가 진실원이다 — 낙관적으로 지우지 않고 다시 읽는다.
        await load();
      } catch (err: unknown) {
        setFailure(classifyRevokeInviteError(err));
      } finally {
        setRevoking(null);
      }
    },
    [orgId, revoking, load, copy]
  );

  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
        <MailX className="h-4 w-4 text-zinc-400" />
        {copy.text["pending.title"]}
      </h2>
      <p className="mb-3 text-xs text-zinc-400">
        {copy.text["pending.subtitle"]}
      </p>

      {failure !== null ? (
        <p className="mb-3 text-xs text-red-300" role="alert">
          {copy.text[`pending.error.${failure}`]}
        </p>
      ) : null}

      {loading && rows === null ? (
        <p className="text-xs text-zinc-400">{copy.text["pending.loading"]}</p>
      ) : loadFailed ? (
        <p className="text-xs text-zinc-400">
          {copy.text["pending.loadError"]}
        </p>
      ) : rows === null || rows.length === 0 ? (
        <p className="text-xs text-zinc-400">{copy.text["pending.empty"]}</p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900">
          {rows.map((row) => (
            <li
              key={row.invitedEmail}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-xs text-zinc-200">
                  {row.invitedEmail}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  {copy.text[`role.${row.orgRole}`]}
                  {row.projectCount > 0
                    ? ` · ${copy.text["pending.projects"].replace(
                        "{n}",
                        String(row.projectCount)
                      )}`
                    : ""}
                  {row.expired ? (
                    <span className="ml-1.5 text-amber-300">
                      {copy.text["pending.expiredBadge"]}
                    </span>
                  ) : row.expiresAtMs !== null ? (
                    ` · ${copy.text["pending.expires"].replace(
                      "{date}",
                      new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                      }).format(new Date(row.expiresAtMs))
                    )}`
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void revoke(row.invitedEmail)}
                disabled={revoking !== null}
                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
              >
                {revoking === row.invitedEmail
                  ? copy.text["pending.revoking"]
                  : copy.text["pending.revoke"]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type InvitableRole = "org_member" | "org_admin";

function InviteMemberForm({
  copy,
  locale,
  orgId,
  onInvited,
}: {
  copy: OrgCopy;
  locale: string;
  orgId: string;
  onInvited: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("org_member");
  const [projects, setProjects] = useState<TeamAuditProjectRef[] | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedOrgInvitation | null>(null);
  const [failure, setFailure] = useState<CreateInviteFailure | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );

  // ★체크 목록에는 내가 owner/admin 인 프로젝트만 — 서버가 어차피 거부하는
  //   항목(#1343 planProjectInviteCreate)을 체크하게 두지 않는다.
  const invitableProjects = (projects ?? []).filter(
    (p) => p.role === "owner" || p.role === "admin"
  );

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const fn = httpsCallable<{ limit: number }, unknown>(
        getFunctions(app, "us-central1"),
        CALLABLE_TEAM_AUDIT
      );
      const res = await fn({ limit: 1 });
      setProjects(normalizeTeamAudit(res.data).projects);
    } catch {
      // 목록을 못 받아도 조직 초대는 보낼 수 있다 — 빈 목록 문구가 말한다.
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || projects !== null || projectsLoading) return;
    void loadProjects();
  }, [open, projects, projectsLoading, loadProjects]);

  const submit = useCallback(async () => {
    if (email.trim() === "" || submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const fn = httpsCallable<
        {
          orgId: string;
          email: string;
          orgRole: InvitableRole;
          projects?: Array<{ projectId: string }>;
        },
        unknown
      >(getFunctions(app, "us-central1"), CREATE_ORG_INVITATION_CALLABLE);
      const checkedIds = invitableProjects
        .map((p) => p.id)
        .filter((id) => checked.has(id));
      const res = await fn({
        orgId,
        email: email.trim(),
        orgRole: role,
        // 프로젝트 역할은 싣지 않는다 — 서버 기본(member)을 그대로 쓴다.
        ...(checkedIds.length > 0
          ? { projects: checkedIds.map((projectId) => ({ projectId })) }
          : {}),
      });
      const parsed = parseCreateOrgInvitationData(res.data);
      if (parsed) {
        setResult(parsed);
        setCopyState("idle");
        onInvited();
      } else {
        setFailure("unavailable");
      }
    } catch (err: unknown) {
      setFailure(classifyCreateInviteError(err));
    } finally {
      setSubmitting(false);
    }
  }, [email, submitting, orgId, role, checked, invitableProjects, onInvited]);

  const inviteHref =
    result === null ? null : localeHref(locale, result.joinPath);
  // 복사되는 것은 절대 주소다 — 상대 경로를 받은 사람은 열 수 없다.
  const inviteUrl =
    inviteHref === null
      ? null
      : typeof window === "undefined"
      ? inviteHref
      : `${window.location.origin}${inviteHref}`;

  const copyLink = useCallback(async () => {
    if (inviteUrl === null) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyState("copied");
    } catch {
      // 권한 거부·비보안 문맥 — 링크는 화면에 있으니 손 복사를 안내한다.
      setCopyState("failed");
    }
  }, [inviteUrl]);

  const reset = useCallback(() => {
    setResult(null);
    setEmail("");
    setRole("org_member");
    setChecked(new Set());
    setFailure(null);
    setCopyState("idle");
  }, []);

  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-300">
        <UserPlus className="h-4 w-4 text-zinc-400" />
        {copy.text["invite.title"]}
      </h2>
      {/* ★v0 규약을 화면이 말한다 — 메일이 갈 것이라는 오해가 초대를 잃는다. */}
      <p className="mb-3 text-xs text-zinc-400">
        {copy.text["invite.subtitle"]}
      </p>

      {result !== null ? (
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
          <h3 className="text-sm font-semibold text-emerald-200">
            {copy.text["invite.linkTitle"]}
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            {copy.text["invite.linkBody"]}
          </p>
          {result.reused ? (
            <p className="mt-1 text-xs text-zinc-400">
              {copy.text["invite.reusedNote"]}
            </p>
          ) : (
            // ★재초대는 토큰 회전이다 — 옛 링크가 아직 산다고 믿게 두지 않는다.
            <p className="mt-1 text-xs text-amber-300">
              {copy.text["invite.rotatedNote"]}
            </p>
          )}
          <p className="mt-3 select-all break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200">
            {inviteUrl}
          </p>
          {result.expiresAtMs !== null ? (
            <p className="mt-2 text-[11px] text-zinc-400">
              {copy.text["invite.expires"].replace(
                "{date}",
                new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                  new Date(result.expiresAtMs)
                )
              )}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              {copy.text["invite.copy"]}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
            >
              {copy.text["invite.another"]}
            </button>
            {copyState === "copied" ? (
              <span className="text-xs text-emerald-300" role="status">
                {copy.text["invite.copied"]}
              </span>
            ) : copyState === "failed" ? (
              <span className="text-xs text-amber-300" role="status">
                {copy.text["invite.copyFailed"]}
              </span>
            ) : null}
          </div>
        </div>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
        >
          {copy.text["invite.open"]}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
        >
          <label
            className="mb-1 block text-[11px] text-zinc-400"
            htmlFor="org-invite-email"
          >
            {copy.text["invite.emailLabel"]}
          </label>
          <input
            id="org-invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200"
          />

          <label
            className="mb-1 block text-[11px] text-zinc-400"
            htmlFor="org-invite-role"
          >
            {copy.text["invite.roleLabel"]}
          </label>
          <select
            id="org-invite-role"
            value={role}
            onChange={(e) =>
              setRole(
                e.target.value === "org_admin" ? "org_admin" : "org_member"
              )
            }
            disabled={submitting}
            className="mb-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200"
          >
            <option value="org_member">{copy.text["role.org_member"]}</option>
            <option value="org_admin">{copy.text["role.org_admin"]}</option>
          </select>
          {/* ★owner 가 선택지에 없는 이유를 말한다(#1343 — 초대는 승격 통로가 아니다). */}
          <p className="mb-3 text-[11px] text-zinc-400">
            {copy.text["invite.roleNote"]}
          </p>

          <span className="mb-1 block text-[11px] text-zinc-400">
            {copy.text["invite.projectsLabel"]}
          </span>
          {projectsLoading || projects === null ? (
            <p className="mb-3 text-xs text-zinc-400">
              {copy.text["invite.projectsLoading"]}
            </p>
          ) : invitableProjects.length === 0 ? (
            <p className="mb-3 text-xs text-zinc-400">
              {copy.text["invite.projectsEmpty"]}
            </p>
          ) : (
            <div className="mb-3">
              <ul className="space-y-1">
                {invitableProjects.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={checked.has(p.id)}
                        disabled={submitting}
                        onChange={(e) => {
                          const next = new Set(checked);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          setChecked(next);
                        }}
                      />
                      {p.name ?? p.id}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-zinc-400">
                {copy.text["invite.projectsHint"]}
              </p>
            </div>
          )}

          {failure !== null ? (
            <p className="mb-3 text-xs text-red-300" role="alert">
              {
                copy.text[
                  `invite.error.${
                    failure === "unauthenticated" ? "unavailable" : failure
                  }`
                ]
              }
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || email.trim() === ""}
              className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 disabled:opacity-50"
            >
              {submitting
                ? copy.text["invite.submitting"]
                : copy.text["invite.submit"]}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setFailure(null);
              }}
              disabled={submitting}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
            >
              {copy.text["invite.cancel"]}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
