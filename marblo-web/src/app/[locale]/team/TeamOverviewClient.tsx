"use client";

/**
 * 팀 오버뷰 — 데이터 층 + 탭 껍데기.
 *
 * ★이 화면은 Firestore 를 직접 읽지 않는다. `getTeamUsageSummary` 콜러블 하나에서
 *   온다(설계 §3). 웹 클라에 `cost_logs`/`audit_logs`/캐시 read 를 열면 룰 표면이
 *   늘고, 룰 분기와 쿼리 제약이 어긋나는 순간 쿼리 전체가 permission-denied 로
 *   죽는다(#406/#428, `ProjectAuditPanel` 상단이 설명하는 실패 모드).
 *
 * ★권한을 화면에서 판정하지 않는다(설계 §5.2·§5.3). 서버가 `context.auth.uid` 로
 *   테넌트를 도출해 걸러 보내고, 화면은 **못 볼 것을 안 받는다.** 그래서 여기에
 *   role 검사도, owner 비교도 없다 — 있으면 그게 곧 우회 가능한 게이트다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useMessages } from "next-intl";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import app, { auth } from "@/lib/firebase";
import { Loader2, RefreshCw, ClipboardList, BarChart3 } from "lucide-react";
import { buildTeamCopy, type TeamCopy } from "./teamCopy";
import {
  normalizeTeamUsage,
  type TeamUsageEnvelope,
} from "./teamUsageContract";
import { TeamUsageView } from "./TeamUsageView";
import {
  appendEvents,
  nextCursorOf,
  normalizeTeamAudit,
  type TeamAuditEnvelope,
} from "./teamAuditContract";
import { TeamAuditView } from "./TeamAuditView";
import { localeHref } from "@/i18n/routing";

/** 설계 §7 이 이름까지 정해 둔 콜러블. 새 이름을 발명하지 않는다. */
const CALLABLE_TEAM_USAGE = "getTeamUsageSummary";

/** 설계 §12 가 정한 감사 콜러블. ★사용량과 **별개**다(권한 축이 다르다). */
const CALLABLE_TEAM_AUDIT = "getTeamProjectAudit";

const DEFAULT_RANGE_DAYS = 30;
const AUDIT_PAGE_LIMIT = 50;

type Tab = "usage" | "audit";

type CallableError = { code?: string; message?: string };

function mapError(err: CallableError, copy: TeamCopy): string {
  switch (err?.code) {
    case "functions/unauthenticated":
      return copy.text["error.unauthenticated"];
    case "functions/permission-denied":
      return copy.text["error.permissionDenied"];
    case "functions/invalid-argument":
      // ★서버는 깨진 커서를 조용히 1페이지로 접지 않는다(설계 §12.6). 화면도
      //   같은 규율을 지킨다 — 접으면 사용자가 같은 페이지를 무한히 돈다.
      return copy.text["audit.error.invalidCursor"];
    case "functions/not-found":
    case "functions/internal":
      // 콜러블이 아직 배포되지 않은 환경에서 가장 흔한 두 코드다.
      return copy.text["error.notDeployed"];
    default:
      return copy.text["error.unknown"];
  }
}

export default function TeamOverviewClient({
  projectId,
}: {
  /** 라우트가 준 프로젝트. ★권한 근거가 아니다 — 서버가 교집합 필터로만 쓴다. */
  projectId: string | null;
}) {
  const locale = useLocale();
  const messages = useMessages();
  const copy = useMemo(
    () =>
      buildTeamCopy(
        (messages as Record<string, unknown> | undefined)?.["team"]
      ),
    [messages]
  );

  const [tab, setTab] = useState<Tab>("usage");
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [env, setEnv] = useState<TeamUsageEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
      const fn = httpsCallable<
        { projectIds?: string[]; days?: number },
        unknown
      >(getFunctions(app, "us-central1"), CALLABLE_TEAM_USAGE);
      const res = await fn({
        ...(projectId ? { projectIds: [projectId] } : {}),
        days: DEFAULT_RANGE_DAYS,
      });
      // ★신뢰 경계. 정규화를 거치지 않은 값은 화면으로 내려보내지 않는다.
      setEnv(normalizeTeamUsage(res.data));
      setNow(Date.now());
    } catch (err: unknown) {
      setEnv(null);
      setError(mapError(err as CallableError, copy));
    } finally {
      setLoading(false);
    }
  }, [projectId, copy]);

  useEffect(() => {
    if (!authReady || !user) return;
    void load();
  }, [authReady, user, load]);

  // ── 감사 탭 (설계 §12) ────────────────────────────────────────────────────
  // ★사용량과 **별개 콜러블**이다. 권한 축이 다르고(팀 역할 vs 사용량 게이트)
  //   금액이 한 필드도 없다. 하나로 합치면 그 경계가 화면에서 흐려진다.
  const [auditEnv, setAuditEnv] = useState<TeamAuditEnvelope | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPaging, setAuditPaging] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadAudit = useCallback(
    async (cursor: string | null) => {
      const paging = cursor !== null;
      if (paging) setAuditPaging(true);
      else setAuditLoading(true);
      setAuditError(null);
      try {
        const fn = httpsCallable<
          { projectId?: string; limit?: number; cursor?: string },
          unknown
        >(getFunctions(app, "us-central1"), CALLABLE_TEAM_AUDIT);
        const res = await fn({
          ...(projectId ? { projectId } : {}),
          limit: AUDIT_PAGE_LIMIT,
          // ★커서를 가공하지 않고 그대로 되돌려 준다(설계 §12.6 키셋 페이징).
          ...(cursor ? { cursor } : {}),
        });
        const next = normalizeTeamAudit(res.data);
        setAuditEnv((prev) =>
          paging && prev
            ? // 페이지를 이어 붙인다. 봉투 자체는 새 것을 쓰되 사건만 누적한다 —
              // 요약·권한·withheld 는 최신 응답이 정본이다.
              { ...next, events: appendEvents(prev.events, next.events) }
            : next
        );
      } catch (err: unknown) {
        // ★페이징 실패는 이미 그린 목록을 지우지 않는다. 지우면 사용자가 보고
        //   있던 감사 기록이 오류 하나로 사라진다.
        if (!paging) setAuditEnv(null);
        setAuditError(mapError(err as CallableError, copy));
      } finally {
        setAuditPaging(false);
        setAuditLoading(false);
      }
    },
    [projectId, copy]
  );

  // 감사 탭은 **열었을 때** 부른다 — 안 볼 수도 있는 원장 조회를 미리 돌리지 않는다.
  useEffect(() => {
    if (!authReady || !user) return;
    if (tab !== "audit") return;
    if (auditEnv !== null || auditLoading) return;
    void loadAudit(null);
  }, [authReady, user, tab, auditEnv, auditLoading, loadAudit]);

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
          href={localeHref(locale, `/auth/login?redirect=${encodeURIComponent(
            projectId ? `/${locale}/team/${projectId}` : `/${locale}/team`
          )}`)}
          className="mt-4 inline-flex items-center rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900"
        >
          {copy.text["action.signIn"]}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-100">
          {copy.text["title"]}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">{copy.text["subtitle"]}</p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <nav className="flex gap-1" aria-label={copy.text["title"]}>
          <TabButton
            active={tab === "usage"}
            onClick={() => setTab("usage")}
            label={copy.text["tabs.usage"]}
            icon={<BarChart3 className="h-3.5 w-3.5" />}
          />
          <TabButton
            active={tab === "audit"}
            onClick={() => setTab("audit")}
            label={copy.text["tabs.audit"]}
            icon={<ClipboardList className="h-3.5 w-3.5" />}
          />
        </nav>
        <button
          type="button"
          onClick={() => {
            if (tab === "audit") {
              // 새로고침은 1페이지부터. 누적된 사건을 버리고 다시 받는다.
              setAuditEnv(null);
              void loadAudit(null);
            } else {
              void load();
            }
          }}
          disabled={tab === "audit" ? auditLoading : loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${
              (tab === "audit" ? auditLoading : loading) ? "animate-spin" : ""
            }`}
          />
          {copy.text["action.refresh"]}
        </button>
      </div>

      {/* ★프로젝트 셀렉터는 **서버가 준 목록**으로만 만든다(감사 봉투의
          `projects` = 호출자가 역할을 가진 것만). 화면이 프로젝트를 찾아 나서면
          그게 곧 권한 판정이다. */}
      {auditEnv && auditEnv.projects.length > 1 ? (
        <ProjectSwitcher
          copy={copy}
          locale={locale}
          projects={auditEnv.projects}
          currentId={auditEnv.projectId}
        />
      ) : null}

      {tab === "usage" ? (
        <UsageTab
          copy={copy}
          locale={locale}
          now={now}
          env={env}
          loading={loading}
          error={error}
          onRetry={() => void load()}
        />
      ) : (
        <AuditTab
          copy={copy}
          locale={locale}
          env={auditEnv}
          loading={auditLoading}
          paging={auditPaging}
          error={auditError}
          onRetry={() => void loadAudit(null)}
          onLoadMore={(cursor) => void loadAudit(cursor)}
        />
      )}
    </div>
  );
}

function ProjectSwitcher({
  copy,
  locale,
  projects,
  currentId,
}: {
  copy: TeamCopy;
  locale: string;
  projects: TeamAuditEnvelope["projects"];
  currentId: string | null;
}) {
  const roleKey = {
    owner: "audit.role.owner",
    admin: "audit.role.admin",
    member: "audit.role.member",
  } as const;
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-zinc-500">
        {copy.text["audit.project.label"]}
      </span>
      {projects.map((p) => (
        <Link
          key={p.id}
          href={localeHref(locale, `/team/${p.id}`)}
          aria-current={p.id === currentId ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${
            p.id === currentId
              ? "bg-zinc-100 text-zinc-900"
              : "border border-zinc-800 text-zinc-400"
          }`}
        >
          {/* ★프로젝트 이름이 없으면 id 를 그대로 쓰지 않는다 — 화면에 식별자를
              뿌리는 대신 '이름 없는 프로젝트' 로 접는다. */}
          {p.name ?? copy.text["projects.unnamed"]}
          <span className="text-[10px] opacity-70">
            {copy.text[roleKey[p.role]]}
          </span>
        </Link>
      ))}
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
        active
          ? "bg-zinc-100 text-zinc-900"
          : "border border-zinc-800 text-zinc-400"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function UsageTab({
  copy,
  locale,
  now,
  env,
  loading,
  error,
  onRetry,
}: {
  copy: TeamCopy;
  locale: string;
  now: number;
  env: TeamUsageEnvelope | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-5">
        <p className="text-sm text-red-200">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-200"
        >
          {copy.text["action.retry"]}
        </button>
      </div>
    );
  }
  if (!env) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {copy.text["state.loading"]}
      </div>
    );
  }
  return (
    <div className={loading ? "opacity-60" : undefined}>
      <TeamUsageView env={env} copy={copy} locale={locale} now={now} />
    </div>
  );
}

/**
 * 감사 탭 — `getTeamProjectAudit` 하나에서 온다(설계 §12).
 *
 * ★권한 판정은 여기에도 없다. 오너/admin 이면 `scope:"team"`, 일반 멤버면
 *   `scope:"self"`(자기 사건만), 역할이 없으면 `state:"disabled"` + 0행을
 *   **서버가** 골라서 준다. 화면은 못 볼 것을 안 받는다.
 */
function AuditTab({
  copy,
  locale,
  env,
  loading,
  paging,
  error,
  onRetry,
  onLoadMore,
}: {
  copy: TeamCopy;
  locale: string;
  env: TeamAuditEnvelope | null;
  loading: boolean;
  paging: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: (cursor: string) => void;
}) {
  // ★오류가 나도 이미 받은 목록은 남긴다 — 페이징 실패로 감사 기록이 통째로
  //   사라지면 사용자는 "기록이 없다" 로 읽는다.
  const banner = error ? (
    <div className="mb-4 rounded-xl border border-red-900/50 bg-red-950/20 p-4">
      <p className="text-sm text-red-200">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-200"
      >
        {copy.text["action.retry"]}
      </button>
    </div>
  ) : null;

  if (!env) {
    return (
      <div>
        {banner}
        {error ? null : (
          <div className="flex items-center gap-2 py-16 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {copy.text["state.loading"]}
          </div>
        )}
      </div>
    );
  }

  const cursor = nextCursorOf(env);
  return (
    <div className={loading ? "opacity-60" : undefined}>
      {banner}
      <TeamAuditView
        env={env}
        copy={copy}
        locale={locale}
        // ★커서가 없으면 "더 보기" 를 아예 안 보여준다. `hasMore` 만 믿고 같은
        //   인자로 다시 부르면 화면이 1페이지를 무한히 돈다(설계 §12.6).
        onLoadMore={cursor ? () => onLoadMore(cursor) : null}
        loadingMore={paging}
      />
    </div>
  );
}
