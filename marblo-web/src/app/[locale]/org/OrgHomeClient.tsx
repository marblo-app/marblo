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
import { ClipboardCopy, Loader2, RefreshCw, UserPlus } from "lucide-react";
import { localeHref } from "@/i18n/routing";
import { buildOrgCopy, type OrgCopy } from "./orgCopy";
import {
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
import { buildTeamCopy } from "../team/teamCopy";
import {
  normalizeTeamAudit,
  type TeamAuditProjectRef,
} from "../team/teamAuditContract";
import TeamOverviewClient from "../team/TeamOverviewClient";
import {
  CREATE_ORG_INVITATION_CALLABLE,
  classifyCreateInviteError,
  parseCreateOrgInvitationData,
  type CreateInviteFailure,
  type CreatedOrgInvitation,
} from "@/lib/orgOnboarding";

/** #1340 이 배포한 콜러블 둘. 새 이름을 발명하지 않는다. */
const CALLABLE_GET_ORGANIZATIONS = "getOrganizations";
const CALLABLE_BIND_PROJECT = "bindProjectToOrg";

/** 결합 폼의 프로젝트 목록에 쓰는 기존 콜러블(`/team` 감사 봉투의 `projects`). */
const CALLABLE_TEAM_AUDIT = "getTeamProjectAudit";

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
              <InviteMemberForm copy={copy} locale={locale} orgId={detail.orgId} />
            ) : null
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
        className="mb-1 block text-[11px] text-zinc-500"
        htmlFor="org-bind-project"
      >
        {copy.text["bind.projectLabel"]}
      </label>
      {projectsLoading || projects === null ? (
        <p className="mb-3 text-xs text-zinc-500">
          {copy.text["bind.projectLoading"]}
        </p>
      ) : projects.length === 0 ? (
        <p className="mb-3 text-xs text-zinc-500">
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
        className="mb-1 block text-[11px] text-zinc-500"
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
type InvitableRole = "org_member" | "org_admin";

function InviteMemberForm({
  copy,
  locale,
  orgId,
}: {
  copy: OrgCopy;
  locale: string;
  orgId: string;
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
      } else {
        setFailure("unavailable");
      }
    } catch (err: unknown) {
      setFailure(classifyCreateInviteError(err));
    } finally {
      setSubmitting(false);
    }
  }, [email, submitting, orgId, role, checked, invitableProjects]);

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
        <UserPlus className="h-4 w-4 text-zinc-500" />
        {copy.text["invite.title"]}
      </h2>
      {/* ★v0 규약을 화면이 말한다 — 메일이 갈 것이라는 오해가 초대를 잃는다. */}
      <p className="mb-3 text-xs text-zinc-500">{copy.text["invite.subtitle"]}</p>

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
          ) : null}
          <p className="mt-3 select-all break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200">
            {inviteUrl}
          </p>
          {result.expiresAtMs !== null ? (
            <p className="mt-2 text-[11px] text-zinc-500">
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
            className="mb-1 block text-[11px] text-zinc-500"
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
            className="mb-1 block text-[11px] text-zinc-500"
            htmlFor="org-invite-role"
          >
            {copy.text["invite.roleLabel"]}
          </label>
          <select
            id="org-invite-role"
            value={role}
            onChange={(e) =>
              setRole(e.target.value === "org_admin" ? "org_admin" : "org_member")
            }
            disabled={submitting}
            className="mb-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200"
          >
            <option value="org_member">{copy.text["role.org_member"]}</option>
            <option value="org_admin">{copy.text["role.org_admin"]}</option>
          </select>
          {/* ★owner 가 선택지에 없는 이유를 말한다(#1343 — 초대는 승격 통로가 아니다). */}
          <p className="mb-3 text-[11px] text-zinc-500">
            {copy.text["invite.roleNote"]}
          </p>

          <span className="mb-1 block text-[11px] text-zinc-500">
            {copy.text["invite.projectsLabel"]}
          </span>
          {projectsLoading || projects === null ? (
            <p className="mb-3 text-xs text-zinc-500">
              {copy.text["invite.projectsLoading"]}
            </p>
          ) : invitableProjects.length === 0 ? (
            <p className="mb-3 text-xs text-zinc-500">
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
              <p className="mt-1 text-[11px] text-zinc-500">
                {copy.text["invite.projectsHint"]}
              </p>
            </div>
          )}

          {failure !== null ? (
            <p className="mb-3 text-xs text-red-300" role="alert">
              {copy.text[`invite.error.${failure === "unauthenticated" ? "unavailable" : failure}`]}
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
