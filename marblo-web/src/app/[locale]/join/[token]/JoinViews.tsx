/**
 * (e) 초대 랜딩 + (g) 소속 확인 + 수락 후 (h)(i) 진입 — 프레젠테이션 전부.
 *
 * ★next-intl 훅 없이 copy 프랍만 받는다(teamCopy 하우스 패턴) —
 * `JoinViews.test.tsx` 가 `renderToStaticMarkup` 으로 상태 전수를 렌더해
 * 에러 4종(만료·위조/취소·다른 계정·이미 수락)이 **각각 다른 안내**를 주는지
 * 화면 바이트로 검사한다.
 *
 * 상태 → 화면 매핑(#1205 §5.2 상태표·#1338 §3.2):
 *   - 만료: 만료라고 말하고 재발송 요청을 안내한다(만료 시각은 서버가 준 경우만).
 *   - 위조·취소·오타: **한 문구로 접는다**(§5.5 존재 비노출) — 구별이 곧
 *     "초대가 실재했다"는 신호이므로 셋을 가르지 않는다. 만료와는 가른다.
 *   - 다른 계정: 초대된 이메일을 보여줄 수 없고(§5.4 룰이 read 거부) 보여주지
 *     않는다 — 지금 로그인된 계정만 보여주고 전환을 권한다.
 *   - 이미 수락: 에러가 아니다 — 수락 완료와 같은 "다음 단계" 화면으로 잇는다.
 */
import {
  Building2,
  Check,
  Download,
  Loader2,
  MailWarning,
  TimerOff,
  Unlink,
} from "lucide-react";
import type { InviteFailure, ResolvedInvite } from "@/lib/orgOnboarding";
import { formatCopy, type OrgOnboardingCopy } from "@/lib/orgOnboardingCopy";
import GuideEntryPoints from "@/components/GuideEntryPoints";

function Shell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="py-24 px-4">
      <div
        className={`${
          wide ? "max-w-2xl" : "max-w-md"
        } mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-8`}
      >
        {children}
      </div>
    </div>
  );
}

function Badge({ copy }: { copy: OrgOnboardingCopy }) {
  return (
    <span className="inline-flex items-center gap-2 bg-indigo-600/15 text-indigo-300 border border-indigo-500/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
      <Building2 className="w-3.5 h-3.5" />
      {copy["join.badge"]}
    </span>
  );
}

export function JoinResolving({ copy }: { copy: OrgOnboardingCopy }) {
  return (
    <Shell>
      <div className="text-center space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-400 mx-auto" />
        <p className="text-zinc-400">{copy["join.resolving"]}</p>
      </div>
    </Shell>
  );
}

/** 조직 › (팀) › 프로젝트 · 역할 · 초대자 — (e)와 (g)가 같은 행을 그린다. */
export function InviteDetails({
  copy,
  invite,
}: {
  copy: OrgOnboardingCopy;
  invite: ResolvedInvite;
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: copy["join.orgLabel"], value: invite.orgDisplayName },
  ];
  // ★"(팀 없음)" 이 정상값(#1336 §6) — 팀 행은 항상 그리고 없음을 말로 쓴다.
  rows.push({
    label: copy["join.teamLabel"],
    value: invite.teamName ?? copy["join.noTeam"],
  });
  if (invite.projectName) {
    rows.push({ label: copy["join.projectLabel"], value: invite.projectName });
  }
  if (invite.orgRole) {
    rows.push({
      label: copy["join.roleLabel"],
      value: copy[`join.role.${invite.orgRole}`],
    });
  }
  return (
    <dl className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-5 space-y-3 text-left">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-4">
          <dt className="text-sm text-zinc-400">{row.label}</dt>
          <dd className="text-sm font-semibold text-zinc-100 text-right">
            {row.value}
          </dd>
        </div>
      ))}
      {invite.inviterName && (
        <p className="text-xs text-zinc-500 border-t border-zinc-800 pt-3">
          {formatCopy(copy["join.invitedBy"], { name: invite.inviterName })}
        </p>
      )}
    </dl>
  );
}

/** (e) 로그인 전 랜딩 — 표시만 하고 로그인/가입으로 잇는다. 입력 0. */
export function InviteLanding({
  copy,
  invite,
  loginHref,
  signupHref,
}: {
  copy: OrgOnboardingCopy;
  invite: ResolvedInvite;
  loginHref: string;
  signupHref: string;
}) {
  return (
    <Shell>
      <div className="text-center space-y-6">
        <Badge copy={copy} />
        <h1 className="text-2xl font-bold">
          {formatCopy(copy["join.title"], { org: invite.orgDisplayName })}
        </h1>
        <InviteDetails copy={copy} invite={invite} />
        <p className="text-sm text-zinc-400 leading-relaxed">
          {copy["join.loginHint"]}
        </p>
        <div className="flex flex-col gap-3">
          <a
            href={loginHref}
            className="inline-flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-semibold transition"
          >
            {copy["join.loginCta"]}
          </a>
          <a
            href={signupHref}
            className="inline-flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg transition"
          >
            {copy["join.signupCta"]}
          </a>
        </div>
      </div>
    </Shell>
  );
}

/** (g) 소속 확인 — ★아무것도 묻지 않는다. [수락] 버튼 하나. 10초짜리 화면. */
export function InviteConfirm({
  copy,
  invite,
  signedInEmail,
  accepting,
  errorNote,
  onAccept,
}: {
  copy: OrgOnboardingCopy;
  invite: ResolvedInvite;
  signedInEmail: string | null;
  accepting: boolean;
  /** 수락 실패 중 화면을 떠날 필요 없는 것(unavailable)의 인라인 안내. */
  errorNote: string | null;
  onAccept: () => void;
}) {
  return (
    <Shell>
      <div className="text-center space-y-6">
        <Badge copy={copy} />
        <h1 className="text-2xl font-bold">{copy["join.confirmTitle"]}</h1>
        <InviteDetails copy={copy} invite={invite} />
        <p className="text-sm text-zinc-400 leading-relaxed">
          {copy["join.confirmBody"]}
        </p>
        {signedInEmail && (
          <p className="text-xs text-zinc-500">
            {formatCopy(copy["join.signedInAs"], { email: signedInEmail })}
          </p>
        )}
        {errorNote && <p className="text-sm text-amber-400">{errorNote}</p>}
        <button
          type="button"
          onClick={onAccept}
          disabled={accepting}
          className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-semibold transition"
        >
          {accepting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          {accepting ? copy["join.accepting"] : copy["join.accept"]}
        </button>
      </div>
    </Shell>
  );
}

/**
 * 수락 완료(및 "이미 수락함") — 다음 단계로 잇는 화면.
 * ★다운로드 버튼이 가이드 위에 상시 노출된다(#1338 §3.2 (h)) — 가이드는
 * 문이지 벽이 아니다. 준비된 사람은 여기서 바로 나간다.
 */
export function InviteAccepted({
  copy,
  orgDisplayName,
  alreadyMember,
  orgHomeHref,
  downloadHref,
  guideHrefBase,
  onDownloadClick,
}: {
  copy: OrgOnboardingCopy;
  orgDisplayName: string | null;
  alreadyMember: boolean;
  orgHomeHref: string | null;
  downloadHref: string;
  guideHrefBase: string;
  onDownloadClick?: () => void;
}) {
  const title = alreadyMember
    ? copy["join.already.title"]
    : formatCopy(copy["join.acceptedTitle"], {
        org: orgDisplayName ?? copy["join.orgLabel"],
      });
  const body = alreadyMember
    ? copy["join.already.body"]
    : copy["join.acceptedBody"];
  return (
    <Shell wide>
      <div className="text-center space-y-6">
        <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto">
          <Check className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-zinc-400 leading-relaxed">{body}</p>
        <div className="flex flex-col gap-3">
          <a
            href={downloadHref}
            onClick={onDownloadClick}
            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-semibold transition"
          >
            <Download className="w-5 h-5" />
            {copy["join.downloadCta"]}
          </a>
          {orgHomeHref && (
            <a
              href={orgHomeHref}
              className="inline-flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg transition"
            >
              {copy["join.orgHomeCta"]}
            </a>
          )}
        </div>
        <p className="text-xs text-zinc-500">{copy["join.downloadSkipNote"]}</p>
        <div className="border-t border-zinc-800 pt-6">
          <GuideEntryPoints copy={copy} guideHrefBase={guideHrefBase} />
        </div>
      </div>
    </Shell>
  );
}

/**
 * 실패 화면 — ★만료·위조(취소/오타 포함)·다른 계정이 각각 다른 제목·본문·
 * 다음 행동을 받는다. unavailable 은 링크 탓을 하지 않고 재시도를 준다.
 * (이미 수락함은 실패가 아니다 — `InviteAccepted` 가 그린다.)
 */
export function InviteFailureCard({
  copy,
  failure,
  locale,
  expiresAtMs,
  signedInEmail,
  loginHref,
  onRetry,
  onSwitchAccount,
}: {
  copy: OrgOnboardingCopy;
  failure: Exclude<InviteFailure, "already_accepted">;
  locale: string;
  expiresAtMs: number | null;
  signedInEmail: string | null;
  loginHref: string;
  onRetry: () => void;
  onSwitchAccount: () => void;
}) {
  if (failure === "expired") {
    return (
      <Shell>
        <div className="text-center space-y-5">
          <TimerOff className="w-10 h-10 text-amber-400 mx-auto" />
          <h1 className="text-2xl font-bold">{copy["join.expired.title"]}</h1>
          {expiresAtMs !== null && (
            <p className="text-sm text-zinc-500">
              {formatCopy(copy["join.expired.at"], {
                date: new Date(expiresAtMs).toLocaleDateString(locale),
              })}
            </p>
          )}
          <p className="text-zinc-400 leading-relaxed">
            {copy["join.expired.body"]}
          </p>
        </div>
      </Shell>
    );
  }

  if (failure === "invalid") {
    return (
      <Shell>
        <div className="text-center space-y-5">
          <Unlink className="w-10 h-10 text-zinc-400 mx-auto" />
          <h1 className="text-2xl font-bold">{copy["join.invalid.title"]}</h1>
          <p className="text-zinc-400 leading-relaxed">
            {copy["join.invalid.body"]}
          </p>
        </div>
      </Shell>
    );
  }

  if (failure === "wrong_account") {
    return (
      <Shell>
        <div className="text-center space-y-5">
          <MailWarning className="w-10 h-10 text-amber-400 mx-auto" />
          <h1 className="text-2xl font-bold">
            {copy["join.wrongAccount.title"]}
          </h1>
          <p className="text-zinc-400 leading-relaxed">
            {copy["join.wrongAccount.body"]}
          </p>
          {signedInEmail && (
            <p className="text-sm text-zinc-500">
              {formatCopy(copy["join.wrongAccount.current"], {
                email: signedInEmail,
              })}
            </p>
          )}
          <button
            type="button"
            onClick={onSwitchAccount}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-semibold transition"
          >
            {copy["join.wrongAccount.switch"]}
          </button>
        </div>
      </Shell>
    );
  }

  if (failure === "unauthenticated") {
    return (
      <Shell>
        <div className="text-center space-y-5">
          <h1 className="text-2xl font-bold">
            {copy["join.loginRequiredTitle"]}
          </h1>
          <p className="text-zinc-400 leading-relaxed">
            {copy["join.loginRequiredBody"]}
          </p>
          <a
            href={loginHref}
            className="inline-flex items-center justify-center w-full bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-semibold transition"
          >
            {copy["join.loginCta"]}
          </a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center space-y-5">
        <h1 className="text-2xl font-bold">{copy["join.unavailable.title"]}</h1>
        <p className="text-zinc-400 leading-relaxed">
          {copy["join.unavailable.body"]}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-semibold transition"
        >
          {copy["join.retry"]}
        </button>
      </div>
    </Shell>
  );
}
