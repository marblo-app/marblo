/**
 * 온보딩 v0(#1338) 웹 절반이 부르는 콜러블 계약 — 한 파일에 모은다.
 *
 * ★서버 절반(콜러블 구현)은 동시 티켓(온보딩 ① backend, cOOR4tUE)이 만든다.
 * 이 모듈은 그 계약의 클라이언트 절반이고, 계약이 확정되어 여기와 다르면
 * **이 파일 하나만** 맞추면 화면 전부가 따라온다. 화면은 이 모듈이 돌려주는
 * 판별 유니언만 보고 그린다.
 *
 * 가정한 계약(콜러블 이름은 백엔드 티켓 활동로그의 계획과 맞춤):
 *   - `resolveInvite({ token })` — 로그인 전에도 부를 수 있고, 그때는 최소
 *     정보(조직 표시명·초대자·역할)만 온다. 조직 존재를 떠볼 수 있는 값은
 *     응답에 애초에 없다(#1338 §5 존재 비노출).
 *   - `acceptInvite({ token })` — 로그인 필수. org_members(+ 프로젝트 초대가
 *     있으면 memberRoles)를 한 폼으로 쓴다. ★멱등(#1205 §5.3) — 두 번 눌러도
 *     안전하므로 화면은 재시도 버튼을 그냥 둔다.
 *   - `createOrganization({ displayName })` — 서버가 `validateTeamOrgIntake`
 *     (#1204, v3/functions/src/orgIdentity.ts)로 검증한다. 거절 어휘도 그
 *     함수의 것을 그대로 받는다 — ★클라이언트에서 검증을 새로 만들지 않는다.
 *
 * 에러 → 화면 상태 매핑 규율(#1205 §5.4·§5.5):
 *   - 만료는 만료라고 말한다(토큰 소지자는 이미 초대 링크를 가진 사람이다).
 *   - 취소·오타·위조는 **한 문구로 접는다** — 구별해 주는 순간 "초대가
 *     실재했다/않았다"를 링크 소지자에게 확인해 주게 된다.
 *   - 다른 계정 로그인은 초대된 이메일을 **보여주지 않고** 계정 전환만 권한다.
 *   - 분류 불가능한 실패는 링크 탓을 하지 않는다(unavailable) — 콜러블이 아직
 *     배포 전이거나 네트워크 문제일 때 "링크가 잘못됐다"고 말하면 거짓말이다.
 */

export const RESOLVE_INVITE_CALLABLE = "resolveInvite";
export const ACCEPT_INVITE_CALLABLE = "acceptInvite";
export const CREATE_ORGANIZATION_CALLABLE = "createOrganization";

// ── 초대 해석 ────────────────────────────────────────────────────────────────

/** 조직 역할 — 서버 어휘(orgStructure.ts ORG_ROLES)를 그대로 쓴다. */
export type OrgRoleKey = "org_owner" | "org_admin" | "org_member";

const ORG_ROLE_KEYS: readonly OrgRoleKey[] = [
  "org_owner",
  "org_admin",
  "org_member",
];

/** 서버 역할 문자열 → 화면 라벨 키. 모르는 값은 접지 않고 null(라벨 생략). */
export function normalizeOrgRoleKey(raw: unknown): OrgRoleKey | null {
  return typeof raw === "string" && (ORG_ROLE_KEYS as string[]).includes(raw)
    ? (raw as OrgRoleKey)
    : null;
}

/** 초대 해석이 화면에 주는 것 전부. ★여기 없는 값은 화면이 그릴 수 없다. */
export interface ResolvedInvite {
  orgDisplayName: string;
  /** 초대자 표시명(또는 도메인). 서버가 안 주면 null — 화면은 줄을 생략한다. */
  inviterName: string | null;
  orgRole: OrgRoleKey | null;
  /** 경량 팀 라벨(#1336). null = "(팀 없음)" 이 정상값. */
  teamName: string | null;
  /** 프로젝트 초대 동반 시. 로그인 전에는 서버가 안 줄 수 있다(존재 비노출). */
  projectName: string | null;
  /**
   * 초대된 이메일 — 서버가 이메일 결속을 확인한 경우에만 온다(가입 프리필용).
   * 로그인 전 응답에는 없을 수 있다. 없으면 프리필을 생략할 뿐이다.
   */
  invitedEmail: string | null;
  /** 만료 시각(ms). 만료 안내에 시점을 보여줄 때만 쓴다. */
  expiresAtMs: number | null;
}

/**
 * 초대 화면이 구분해 그리는 실패 상태 — ★4종이 각각 다른 안내를 받는다
 * (티켓 완료 기준). unavailable 은 그 4종이 아니라 "판정 불가"다.
 */
export type InviteFailure =
  | "expired"
  | "invalid"
  | "wrong_account"
  | "already_accepted"
  | "unauthenticated"
  | "unavailable";

export type ResolveInviteOutcome =
  | { kind: "valid"; invite: ResolvedInvite }
  | { kind: InviteFailure; invite?: ResolvedInvite };

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function pickString(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function pickMillis(rec: Record<string, unknown>, key: string): number | null {
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** 서버 status 어휘 → 화면 상태. 모르는 어휘는 null(호출부가 unavailable 로). */
const STATUS_TO_OUTCOME: Record<string, "valid" | InviteFailure> = {
  valid: "valid",
  pending: "valid",
  expired: "expired",
  invalid: "invalid",
  not_found: "invalid",
  revoked: "invalid",
  already_accepted: "already_accepted",
  already_member: "already_accepted",
  accepted: "already_accepted",
  wrong_account: "wrong_account",
  email_mismatch: "wrong_account",
};

function parseInvitePayload(
  rec: Record<string, unknown>
): ResolvedInvite | null {
  const orgDisplayName = pickString(rec, "orgDisplayName");
  if (!orgDisplayName) return null;
  return {
    orgDisplayName,
    inviterName: pickString(rec, "inviterName"),
    orgRole: normalizeOrgRoleKey(rec.orgRole ?? rec.role),
    teamName: pickString(rec, "teamName"),
    projectName: pickString(rec, "projectName"),
    invitedEmail: pickString(rec, "invitedEmail"),
    expiresAtMs: pickMillis(rec, "expiresAtMs"),
  };
}

/**
 * `resolveInvite` 응답 → 화면 상태. ★신뢰 경계다 — 어떤 입력이 와도 던지지
 * 않고, 조직 표시명 없는 "valid" 는 valid 로 치지 않는다(그릴 것이 없다).
 */
export function parseResolveInviteData(data: unknown): ResolveInviteOutcome {
  const rec = asRecord(data);
  if (!rec) return { kind: "unavailable" };

  const status = typeof rec.status === "string" ? rec.status : null;
  const invitePayload = asRecord(rec.invite) ?? rec;
  const invite = parseInvitePayload(invitePayload) ?? undefined;

  if (status) {
    const mapped = STATUS_TO_OUTCOME[status];
    if (!mapped) return { kind: "unavailable" };
    if (mapped === "valid") {
      return invite ? { kind: "valid", invite } : { kind: "unavailable" };
    }
    return { kind: mapped, invite };
  }

  // status 없이 초대 내용만 온 응답 — 내용이 온전하면 valid 로 읽는다.
  return invite ? { kind: "valid", invite } : { kind: "unavailable" };
}

/** `acceptInvite` 성공 응답. orgId 는 조직 홈(/org/<orgId>) 링크에 쓴다. */
export interface AcceptedInvite {
  alreadyMember: boolean;
  orgId: string | null;
  orgDisplayName: string | null;
}

export type AcceptInviteOutcome =
  | { kind: "accepted"; result: AcceptedInvite }
  | { kind: InviteFailure };

export function parseAcceptInviteData(data: unknown): AcceptInviteOutcome {
  const rec = asRecord(data);
  if (!rec) return { kind: "unavailable" };
  const status = typeof rec.status === "string" ? rec.status : null;
  if (
    status &&
    !["accepted", "already_member", "ok", "success"].includes(status)
  ) {
    const mapped = STATUS_TO_OUTCOME[status];
    return mapped && mapped !== "valid"
      ? { kind: mapped }
      : { kind: "unavailable" };
  }
  return {
    kind: "accepted",
    result: {
      alreadyMember: status === "already_member" || rec.alreadyMember === true,
      orgId: pickString(rec, "orgId"),
      orgDisplayName: pickString(rec, "orgDisplayName"),
    },
  };
}

// ── 콜러블 에러 분류 ─────────────────────────────────────────────────────────

interface CallableErrorLike {
  code: string;
  message: string;
}

function readCallableError(err: unknown): CallableErrorLike {
  const rec = asRecord(err);
  return {
    code: rec && typeof rec.code === "string" ? rec.code.toLowerCase() : "",
    message:
      rec && typeof rec.message === "string" ? rec.message.toLowerCase() : "",
  };
}

/**
 * 콜러블이 HttpsError 로 실패를 던지는 계약일 때의 분류.
 *
 * 순서가 규율이다: 메시지의 서버 어휘를 먼저 보고, 그 다음에야 code 로
 * 접는다. ★`functions/not-found` 를 곧장 invalid 로 접지 않는 이유 —
 * **콜러블 자체가 아직 배포 전**일 때도 같은 code 가 온다. 그때 "링크가
 * 잘못됐다"고 말하면 유효한 초대를 들고 온 사람을 쫓아내는 것이다. 메시지에
 * 초대 어휘(invite/token/초대)가 있을 때만 초대 판정으로 읽는다.
 */
export function classifyInviteCallableError(err: unknown): InviteFailure {
  const { code, message } = readCallableError(err);

  if (/expired|만료/.test(message)) return "expired";
  if (/already|이미/.test(message)) return "already_accepted";
  if (
    /mismatch|wrong[_-]?account|different.*(email|account)|다른 (계정|이메일)/.test(
      message
    )
  ) {
    return "wrong_account";
  }
  const mentionsInvite = /invite|invitation|token|초대/.test(message);
  if (
    mentionsInvite &&
    /invalid|not[_ -]?found|revoked|취소|없/.test(message)
  ) {
    return "invalid";
  }

  if (code.includes("unauthenticated")) return "unauthenticated";
  if (code.includes("permission-denied")) return "wrong_account";
  if (code.includes("already-exists")) return "already_accepted";
  if (code.includes("not-found") && mentionsInvite) return "invalid";
  return "unavailable";
}

// ── 조직 정보(b) — validateTeamOrgIntake 거절 어휘의 클라이언트 매핑 ─────────

/**
 * 화면이 구분해 안내하는 거절. 서버 어휘(`TeamOrgIntakeRejection`)를 사람이
 * 행동할 수 있는 단위로 접는다: control_char·invisible_or_bidi 는 둘 다
 * "쓸 수 없는 문자" 하나로(사용자가 고칠 행동이 같다).
 */
export type OrgIntakeFailure =
  | "name_required"
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "unauthenticated"
  | "unavailable";

const INTAKE_REASON_MAP: Record<string, OrgIntakeFailure> = {
  name_required_for_team_plan: "name_required",
  empty: "name_required",
  too_short: "too_short",
  too_long: "too_long",
  control_char: "invalid_chars",
  invisible_or_bidi: "invalid_chars",
};

export function classifyOrgIntakeError(err: unknown): OrgIntakeFailure {
  const { code, message } = readCallableError(err);
  for (const [reason, mapped] of Object.entries(INTAKE_REASON_MAP)) {
    if (message.includes(reason)) return mapped;
  }
  if (code.includes("unauthenticated")) return "unauthenticated";
  return "unavailable";
}

export interface CreatedOrganization {
  orgId: string;
  displayName: string;
}

export function parseCreateOrganizationData(
  data: unknown
): CreatedOrganization | null {
  const rec = asRecord(data);
  if (!rec) return null;
  const orgId = pickString(rec, "orgId");
  const displayName = pickString(rec, "displayName");
  return orgId && displayName ? { orgId, displayName } : null;
}

// ── getOrganizations(#1340, 배포됨) 응답의 최소 독해 ────────────────────────

/**
 * 결제 성공 화면의 "조직 이름을 정해주세요" 재진입 배너 판정용 —
 * `getOrganizations` 응답에 비개인 조직이 하나라도 있으면 배너를 접는다.
 * 응답이 이상하면 false(= 배너를 열어 둔다) — 새 팀 관리자에게 조직 생성은
 * 결정적 경로이고, 이미 조직이 있는 사람에게 배너 하나는 소음일 뿐이다.
 */
export function hasNonPersonalOrg(data: unknown): boolean {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.orgs)) return false;
  return rec.orgs.some((entry) => {
    const org = asRecord(entry);
    return org !== null && org.isPersonal === false;
  });
}

// ── 경로·입력 위생 ──────────────────────────────────────────────────────────

/**
 * 초대 토큰의 겉모양 검사 — 서버를 부르기 전의 위생이지 검증이 아니다.
 * 빈 값·공백·비출력 문자·비상식적 길이만 거른다(백엔드 토큰 알파벳이 아직
 * 확정 전이므로 일부러 느슨하다 — 유효한 토큰을 여기서 쫓아내면 안 된다).
 */
export function isPlausibleInviteToken(raw: string): boolean {
  if (raw.length < 8 || raw.length > 512) return false;
  // 출력 가능한 ASCII 만(공백 제외). 제어·보이지 않는 문자가 든 토큰은 없다.
  return /^[\x21-\x7e]+$/.test(raw);
}

/** /join/<token> 경로 — sanitizeRedirect 를 통과하는 내부 상대 경로다. */
export function joinPath(token: string): string {
  return `/join/${encodeURIComponent(token)}`;
}

/** 가입/로그인 프리필에 실어도 되는 이메일인지 — 겉모양만 본다. */
export function isPlausibleEmail(raw: string): boolean {
  return raw.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}
