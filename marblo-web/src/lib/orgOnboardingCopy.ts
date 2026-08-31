/**
 * 온보딩 v0 문구 — ko·en·ja. `teamCopy.ts` 하우스 패턴 그대로:
 *
 *   1. 이 화면들의 규약 절반이 **문구 자체**다 — ★에러 4종(만료·위조/취소·
 *      다른 계정·이미 수락)이 각각 다른 안내를 주고, "오류가 발생했습니다"
 *      로 뭉치지 않는다는 티켓 완료 기준을 테스트가 문구로 검사한다.
 *   2. 프레젠테이션 컴포넌트가 next-intl 훅에 묶이지 않아 `renderToStaticMarkup`
 *      으로 화면 바이트를 검사할 수 있다.
 *
 * 키가 빠지면 영어 폴백으로 떨어지고, 세 로케일 완결성은 테스트가 막는다.
 */

/** 화면이 쓰는 문구 키 전부. ★여기 없는 문자열을 컴포넌트에 하드코딩하지 않는다. */
export const ORG_ONBOARDING_COPY_KEYS = [
  // ── (e) /join/<token> — 초대 랜딩 ────────────────────────────────────────
  "join.badge",
  "join.resolving",
  "join.title",
  "join.invitedBy",
  "join.orgLabel",
  "join.teamLabel",
  "join.projectLabel",
  "join.roleLabel",
  "join.noTeam",
  "join.role.org_owner",
  "join.role.org_admin",
  "join.role.org_member",
  "join.loginHint",
  "join.loginCta",
  "join.signupCta",

  // ── (g) 소속 확인 + 수락 ─────────────────────────────────────────────────
  "join.confirmTitle",
  "join.confirmBody",
  "join.signedInAs",
  "join.accept",
  "join.accepting",
  "join.acceptedTitle",
  "join.acceptedBody",
  "join.downloadCta",
  "join.downloadSkipNote",
  "join.orgHomeCta",

  // ── ★에러 4종 — 각각 다른 안내. 문구를 합치면 테스트가 깨진다 ──────────
  "join.expired.title",
  "join.expired.body",
  "join.expired.at",
  "join.invalid.title",
  "join.invalid.body",
  "join.wrongAccount.title",
  "join.wrongAccount.body",
  "join.wrongAccount.current",
  "join.wrongAccount.switch",
  "join.already.title",
  "join.already.body",

  // 판정 불가(4종 밖) — 링크 탓을 하지 않는다
  "join.unavailable.title",
  "join.unavailable.body",
  "join.retry",
  "join.loginRequiredTitle",
  "join.loginRequiredBody",

  // ── (h) 가이드 진입점 3개 — 기존 guide/ 앵커 재사용, 신규 페이지 0 ──────
  "guideEntry.title",
  "guideEntry.subtitle",
  "guideEntry.prepare.title",
  "guideEntry.prepare.body",
  "guideEntry.firstAgent.title",
  "guideEntry.firstAgent.body",
  "guideEntry.teamwork.title",
  "guideEntry.teamwork.body",
  "guideEntry.open",

  // ── (b) 조직 정보 1화면 ──────────────────────────────────────────────────
  "intake.title",
  "intake.body",
  "intake.label",
  "intake.placeholder",
  "intake.submit",
  "intake.saving",
  "intake.loginRequiredTitle",
  "intake.loginRequiredBody",
  "intake.loginCta",
  "intake.successTitle",
  "intake.successBody",
  "intake.inviteCta",
  "intake.err.name_required",
  "intake.err.too_short",
  "intake.err.too_long",
  "intake.err.invalid_chars",
  "intake.err.unavailable",

  // ── (i) 다운로드 배너 한 줄 ──────────────────────────────────────────────
  "downloadBanner",

  // ── 결제 성공 화면의 재진입 배너(#1338 §3.1 (b)) ─────────────────────────
  "checkoutBanner.title",
  "checkoutBanner.body",
  "checkoutBanner.cta",
] as const;

export type OrgOnboardingCopyKey = typeof ORG_ONBOARDING_COPY_KEYS[number];

export type OrgOnboardingCopy = Record<OrgOnboardingCopyKey, string>;

/** 영어 폴백 — 키 누락 사고 방지책이지 번역 누락을 눈감는 장치가 아니다. */
const FALLBACK_TEXT: OrgOnboardingCopy = {
  "join.badge": "Team invitation",
  "join.resolving": "Checking your invitation…",
  "join.title": "You're invited to {org}",
  "join.invitedBy": "Invited by {name}",
  "join.orgLabel": "Organization",
  "join.teamLabel": "Team",
  "join.projectLabel": "Project",
  "join.roleLabel": "Role",
  "join.noTeam": "(no team)",
  "join.role.org_owner": "Owner",
  "join.role.org_admin": "Admin",
  "join.role.org_member": "Member",
  "join.loginHint":
    "Sign in with the email this invitation was sent to — that's what links you to the team.",
  "join.loginCta": "Sign in to accept",
  "join.signupCta": "Create an account",

  "join.confirmTitle": "Confirm where you'll belong",
  "join.confirmBody":
    "One click and you're in. Nothing else to fill out — your account already has everything we need.",
  "join.signedInAs": "Signed in as {email}",
  "join.accept": "Accept and join",
  "join.accepting": "Joining…",
  "join.acceptedTitle": "You're in {org}",
  "join.acceptedBody":
    "Your membership is set. Install the app and sign in with this account — you'll land in your team automatically.",
  "join.downloadCta": "Download the app",
  "join.downloadSkipNote":
    "The guides below are optional — if your agent CLI accounts are ready, download away.",
  "join.orgHomeCta": "Open organization home",

  "join.expired.title": "This invitation has expired",
  "join.expired.body":
    "Ask the person who invited you to send a fresh link. Once you have it, accepting takes under a minute.",
  "join.expired.at": "Expired on {date}",
  "join.invalid.title": "This invitation link doesn't work",
  "join.invalid.body":
    "The link may have been cut off in the middle — check that you opened it in full. If it still doesn't work, ask the person who invited you for a new link.",
  "join.wrongAccount.title": "This account can't open this invitation",
  "join.wrongAccount.body":
    "Invitations are tied to the email they were sent to. Sign in with the account that received the invitation email.",
  "join.wrongAccount.current": "Currently signed in as {email}",
  "join.wrongAccount.switch": "Sign in with a different account",
  "join.already.title": "Already accepted",
  "join.already.body":
    "You're already a member of this organization — nothing left to accept. Continue below.",

  "join.unavailable.title": "We couldn't check this invitation",
  "join.unavailable.body":
    "This looks like a temporary problem on our side, not a problem with your link. Please try again in a moment.",
  "join.retry": "Try again",
  "join.loginRequiredTitle": "Sign in to continue",
  "join.loginRequiredBody":
    "To accept, sign in with the email this invitation was sent to.",

  "guideEntry.title": "Get set up",
  "guideEntry.subtitle": "Three entry points — start where you are.",
  "guideEntry.prepare.title": "Before you download",
  "guideEntry.prepare.body":
    "Check the agent CLI account you'll use (Claude subscription, Codex, or your own API key) so your first agent runs within minutes of installing.",
  "guideEntry.firstAgent.title": "Install to first agent",
  "guideEntry.firstAgent.body":
    "Install, sign in to your CLIs, pick a project folder, and watch your first mission run.",
  "guideEntry.teamwork.title": "Working as a team",
  "guideEntry.teamwork.body":
    "The shared board, tickets, and how work flows from mission to merge.",
  "guideEntry.open": "Open guide",

  "intake.title": "Name your organization",
  "intake.body":
    "One field and you're done. Your team's usage ledger is recorded under this name — you can rename it later, past records keep the name they were written under.",
  "intake.label": "Organization name",
  "intake.placeholder": "e.g. Acme Inc.",
  "intake.submit": "Create organization",
  "intake.saving": "Creating…",
  "intake.loginRequiredTitle": "Sign in to continue",
  "intake.loginRequiredBody":
    "Sign in with the account that completed the Team payment.",
  "intake.loginCta": "Sign in",
  "intake.successTitle": "{org} is ready",
  "intake.successBody":
    "Next: install the app, create your first project, then invite your teammates from the organization home.",
  "intake.inviteCta": "Go to organization home",
  "intake.err.name_required":
    "Enter an organization name — that's the only required field.",
  "intake.err.too_short": "That name is too short. Use at least 2 characters.",
  "intake.err.too_long": "That name is too long. Keep it within 60 characters.",
  "intake.err.invalid_chars":
    "The name contains characters we can't accept (control or invisible characters). Remove them and try again.",
  "intake.err.unavailable":
    "We couldn't save right now. Your payment is unaffected — come back and try again in a moment.",

  downloadBanner: "Installing as a member of {org}",

  "checkoutBanner.title": "Name your organization",
  "checkoutBanner.body":
    "One name is all that's left — your team's usage will be recorded under it.",
  "checkoutBanner.cta": "Choose a name",
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** 점 경로로 문자열 하나를 꺼낸다. 없거나 빈 문자열이면 null. */
function pickString(root: unknown, path: string): string | null {
  let node: unknown = root;
  for (const segment of path.split(".")) {
    const rec = asRecord(node);
    if (!rec) return null;
    node = rec[segment];
  }
  return typeof node === "string" && node !== "" ? node : null;
}

/**
 * `messages/<locale>.json` 의 `orgOnboarding` 블록 → copy.
 * ★신뢰 경계다 — 어떤 입력이 와도 던지지 않고, 빠진 자리는 영어로 채운다.
 */
export function buildOrgOnboardingCopy(raw: unknown): OrgOnboardingCopy {
  const copy = {} as Record<OrgOnboardingCopyKey, string>;
  for (const key of ORG_ONBOARDING_COPY_KEYS) {
    copy[key] = pickString(raw, key) ?? FALLBACK_TEXT[key];
  }
  return copy;
}

/** 폴백으로 떨어진 키 목록 — 로케일 세 벌 완결성을 테스트가 이걸로 본다. */
export function missingOrgOnboardingCopyKeys(raw: unknown): string[] {
  return ORG_ONBOARDING_COPY_KEYS.filter(
    (key) => pickString(raw, key) === null
  );
}

/** `{name}` 자리 치환. 없는 파라미터는 자리 그대로 남긴다(조용한 빈칸 방지). */
export function formatCopy(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? params[name] : whole
  );
}
