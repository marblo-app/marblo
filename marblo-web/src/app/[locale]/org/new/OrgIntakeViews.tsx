/**
 * (b) 조직 정보 1화면 — 프레젠테이션(#1338 §3.1 (b)).
 *
 * ★묻는 것은 조직명 하나다. 도메인·로고·업종·규모·주소는 **전부 안 묻는다** —
 * 원장 귀속에 필요한 것은 이름뿐이다(#1204). 검증은 서버의
 * `validateTeamOrgIntake` 가 하고, 이 화면은 그 거절 어휘를 사람 말로 옮길
 * 뿐이다 — 클라이언트에 검증을 복제하지 않는다(두 벌이 되는 순간 어긋난다).
 */
import { Building2, Check, Loader2 } from "lucide-react";
import type {
  CreatedOrganization,
  OrgIntakeFailure,
} from "@/lib/orgOnboarding";
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

export function IntakeLoginRequired({
  copy,
  loginHref,
}: {
  copy: OrgOnboardingCopy;
  loginHref: string;
}) {
  return (
    <Shell>
      <div className="text-center space-y-5">
        <h1 className="text-2xl font-bold">
          {copy["intake.loginRequiredTitle"]}
        </h1>
        <p className="text-zinc-400 leading-relaxed">
          {copy["intake.loginRequiredBody"]}
        </p>
        <a
          href={loginHref}
          className="inline-flex items-center justify-center w-full bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-semibold transition"
        >
          {copy["intake.loginCta"]}
        </a>
      </div>
    </Shell>
  );
}

/** 입력칸 하나짜리 폼. 실패해도 결제는 유효하다 — unavailable 문구가 말한다. */
export function IntakeForm({
  copy,
  value,
  submitting,
  failure,
  onChange,
  onSubmit,
}: {
  copy: OrgOnboardingCopy;
  value: string;
  submitting: boolean;
  failure: Exclude<OrgIntakeFailure, "unauthenticated"> | null;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Shell>
      <div className="space-y-6">
        <div className="text-center space-y-3">
          <Building2 className="w-10 h-10 text-indigo-300 mx-auto" />
          <h1 className="text-2xl font-bold">{copy["intake.title"]}</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            {copy["intake.body"]}
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-4"
        >
          <label className="block text-left">
            <span className="text-sm text-zinc-300">
              {copy["intake.label"]}
            </span>
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={copy["intake.placeholder"]}
              disabled={submitting}
              autoFocus
              className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-400 focus:outline-none focus:border-indigo-500"
            />
          </label>
          {failure && (
            <p className="text-sm text-amber-400 text-left" role="alert">
              {copy[`intake.err.${failure}`]}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? copy["intake.saving"] : copy["intake.submit"]}
          </button>
        </form>
      </div>
    </Shell>
  );
}

/** 생성 완료 — 다음 단계(설치·프로젝트 생성 → 초대)는 조직 홈이 잇는다. */
export function IntakeSuccess({
  copy,
  org,
  orgHomeHref,
  downloadHref,
  guideHrefBase,
}: {
  copy: OrgOnboardingCopy;
  org: CreatedOrganization;
  orgHomeHref: string;
  downloadHref: string;
  guideHrefBase: string;
}) {
  return (
    <Shell wide>
      <div className="text-center space-y-6">
        <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto">
          <Check className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold">
          {formatCopy(copy["intake.successTitle"], { org: org.displayName })}
        </h1>
        <p className="text-zinc-400 leading-relaxed">
          {copy["intake.successBody"]}
        </p>
        <div className="flex flex-col gap-3">
          <a
            href={orgHomeHref}
            className="inline-flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-semibold transition"
          >
            {copy["intake.inviteCta"]}
          </a>
          <a
            href={downloadHref}
            className="inline-flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg transition"
          >
            {copy["join.downloadCta"]}
          </a>
        </div>
        <div className="border-t border-zinc-800 pt-6">
          <GuideEntryPoints copy={copy} guideHrefBase={guideHrefBase} />
        </div>
      </div>
    </Shell>
  );
}
