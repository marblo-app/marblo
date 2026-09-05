/**
 * 온보딩 v0(#1338) 웹 절반이 부르는 콜러블 계약 — 한 파일에 모은다.
 *
 * ★서버 절반은 #1343(cOOR4tUE)이 배포했고, 이 파일이 그 **확정 계약**의
 * 클라이언트 절반이다(v3/functions/src/index.ts 의 콜러블 3종이 정본).
 * 계약이 또 바뀌면 **이 파일 하나만** 맞추면 화면 전부가 따라온다. 화면은
 * 이 모듈이 돌려주는 판별 유니언만 보고 그린다.
 *
 * 확정 계약(#1343 배포분):
 *   - `resolveOrgInvitation({ token })` — 로그인 전에도 부를 수 있고, 그때는
 *     최소 정보(조직 표시명·초대자·역할)만 온다. 판별 키는 `state`
 *     (valid·unusable·expired·email_mismatch·already_accepted). 조직 존재를
 *     떠볼 수 있는 값은 응답에 애초에 없다(#1338 §5 존재 비노출).
 *   - `acceptOrgInvitation({ token })` — 로그인 필수. 성공은
 *     `{ ok, orgId, noop }` — `noop: true` = 이미 멤버(멱등 재수락, #1205
 *     §5.3). 두 번 눌러도 안전하므로 화면은 재시도 버튼을 그냥 둔다.
 *   - `createOrgInvitation({ orgId, email, orgRole?, projects? })` — 초대
 *     생성 + 링크 복사용 토큰(#1338 §3.1 (d)). 좌석·플랜 강제가 여기 붙어
 *     있다(#1353). ★메일은 발송되지 않는다 — 응답 `joinPath` 를 복사해
 *     직접 전달한다(v0 규약).
 *   - `createOrganization({ displayName })` — #1360(R3EZtQPri5wHjix8s833)이
 *     콜러블을 배선했다(2026-09-01, 프로덕션 배포 컷오프 이전 머지 — 라이브).
 *     생성자가 원자 트랜잭션으로 org_owner 가 된다.
 *
 * 에러 → 화면 상태 매핑 규율(#1205 §5.4·§5.5):
 *   - 만료는 만료라고 말한다(토큰 소지자는 이미 초대 링크를 가진 사람이다).
 *   - 취소·오타·위조는 **한 문구로 접는다** — 구별해 주는 순간 "초대가
 *     실재했다/않았다"를 링크 소지자에게 확인해 주게 된다.
 *   - 다른 계정 로그인은 초대된 이메일을 **보여주지 않고** 계정 전환만 권한다.
 *   - 분류 불가능한 실패는 링크 탓을 하지 않는다(unavailable) — 콜러블이 아직
 *     배포 전이거나 네트워크 문제일 때 "링크가 잘못됐다"고 말하면 거짓말이다.
 */

export const RESOLVE_INVITE_CALLABLE = "resolveOrgInvitation";
export const ACCEPT_INVITE_CALLABLE = "acceptOrgInvitation";
export const CREATE_ORGANIZATION_CALLABLE = "createOrganization";
export const CREATE_ORG_INVITATION_CALLABLE = "createOrgInvitation";
/**
 * 대기 중 초대 목록 — ★응답에 토큰이 없다(서버가 싣지 않는다).
 * ★2026-09-05 실측: 프로덕션 functions 마지막 배포(2026-09-01 08:41 UTC, v13)
 *   이후 머지돼(#1409, 2026-09-04) 아직 라이브에 없다 — 배포 대기(devops
 *   nHsOwE1IPk8nfEUMyPBu). 이 화면에서 실패하면 배포 갭이지 코드 결함이 아니다.
 */
export const LIST_ORG_INVITATIONS_CALLABLE = "listOrgInvitations";
/**
 * 초대 철회 — (조직, 이메일)로 지목한다. 토큰을 클라이언트가 다시 다루지 않는다.
 * ★위와 같은 배포 갭(#1409, 아직 라이브 아님) — nHsOwE1IPk8nfEUMyPBu 가 배포하면 풀린다.
 */
export const REVOKE_ORG_INVITATION_CALLABLE = "revokeOrgInvitation";

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

/** 서버 state/status 어휘 → 화면 상태. 모르는 어휘는 null(호출부가 unavailable 로). */
const STATUS_TO_OUTCOME: Record<string, "valid" | InviteFailure> = {
  valid: "valid",
  pending: "valid",
  expired: "expired",
  invalid: "invalid",
  not_found: "invalid",
  revoked: "invalid",
  // ★서버 정본 어휘(#1343) — 취소·오타·위조·타인 수락분이 전부 이 하나로
  //   접혀 온다(#1205 §5.5). 화면도 한 문구로 접는다.
  unusable: "invalid",
  already_accepted: "already_accepted",
  already_member: "already_accepted",
  accepted: "already_accepted",
  wrong_account: "wrong_account",
  email_mismatch: "wrong_account",
};

/**
 * 서버 valid 응답의 `projects[]`(본인 로그인 시에만 옴) → 표시용 이름 하나.
 * 여럿이면 이름을 쉼표로 잇는다 — 소속 확인 화면(g)의 한 행이다.
 */
function projectNamesFrom(rec: Record<string, unknown>): string | null {
  if (!Array.isArray(rec.projects)) return null;
  const names = rec.projects.flatMap((row) => {
    const p = asRecord(row);
    if (!p) return [];
    const name = pickString(p, "name") ?? pickString(p, "projectId");
    return name ? [name] : [];
  });
  return names.length > 0 ? names.join(", ") : null;
}

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
    projectName: pickString(rec, "projectName") ?? projectNamesFrom(rec),
    // ★서버는 마스킹된 이메일(maskedInvitedEmail)만 준다 — 그건 프리필에 못
    //   쓰는 값이라 여기 싣지 않는다(isPlausibleEmail 이 걸러 주지만 애초에).
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

  // ★서버 정본 키는 `state`(#1343). status 는 과거 가정 계약의 잔재 폴백이다.
  const status =
    typeof rec.state === "string"
      ? rec.state
      : typeof rec.status === "string"
      ? rec.status
      : null;
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
  // ★서버 정본(#1343)은 성공을 `{ ok: true, orgId, noop }` 로 준다 —
  //   실패는 전부 HttpsError(throw)라 여기 오면 성공이다. `ok` 가 명시적으로
  //   false 인 응답만 판정 불가로 접는다(모르는 모양을 성공으로 치지 않는다).
  if (rec.ok === false) return { kind: "unavailable" };
  return {
    kind: "accepted",
    result: {
      alreadyMember:
        status === "already_member" ||
        rec.alreadyMember === true ||
        // noop = 이미 멤버였던 멱등 재수락(#1205 §5.3).
        rec.noop === true,
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

// ── 초대 생성(d) — createOrgInvitation 계약의 클라이언트 절반 ────────────────

/**
 * `createOrgInvitation` 성공 응답(#1343):
 * `{ ok, reused, joinPath, token, expiresAtMs, projects[] }`.
 * ★링크는 서버 문자열(joinPath)을 그대로 쓰지 않고 token 에서 `joinPath()`
 *   로 재조립한다 — 인코딩 규약을 한 곳(이 파일)에 유지한다.
 */
export interface CreatedOrgInvitation {
  token: string;
  /** `/join/<token>` — 내부 상대 경로. 절대 주소는 화면이 origin 을 붙인다. */
  joinPath: string;
  /**
   * true = **방금 만든** 초대의 토큰을 그대로 돌려받았다(제출 더블클릭 — 먼저
   * 준 링크가 산다). false 이면서 같은 사람의 초대가 이미 있었다면 그 이전
   * 링크는 이 순간 죽었다(티켓 3PRpIVJdyE5dUWQWwy6Y — 재초대는 토큰 회전이다).
   */
  reused: boolean;
  expiresAtMs: number | null;
}

export function parseCreateOrgInvitationData(
  data: unknown
): CreatedOrgInvitation | null {
  const rec = asRecord(data);
  if (!rec || rec.ok !== true) return null;
  const token = pickString(rec, "token");
  if (!token || !isPlausibleInviteToken(token)) return null;
  return {
    token,
    joinPath: joinPath(token),
    reused: rec.reused === true,
    expiresAtMs: pickMillis(rec, "expiresAtMs"),
  };
}

/**
 * 초대 생성 실패 — 관리자가 **다르게 행동해야 하는** 단위로만 가른다:
 *   - permission: 조직 관리자가 아니거나, 관리하지 않는 프로젝트를 체크했다.
 *   - already_member: 이미 멤버 — 초대장이 안 만들어진 게 정상이다(#1330).
 *   - seat_limit: 좌석 한도(#1353) — 요금제 좌석을 늘리거나 체크를 줄인다.
 *   - plan_required: 팀 협업 요금제 없음(#1353) — 결제가 선행이다.
 *   - invalid: 이메일·역할 등 입력 문제 — 고쳐서 다시.
 *   - unavailable: 판정 불가 — 입력 탓을 하지 않는다.
 */
export type CreateInviteFailure =
  | "permission"
  | "already_member"
  | "seat_limit"
  | "plan_required"
  | "invalid"
  | "unauthenticated"
  | "unavailable";

export function classifyCreateInviteError(err: unknown): CreateInviteFailure {
  const { code, message } = readCallableError(err);
  // 서버 메시지 어휘 먼저(#1343·#1353의 한국어 문장), 그 다음 code 폴백.
  if (/좌석 한도|seat/.test(message)) return "seat_limit";
  if (/요금제|entitle|plan/.test(message)) return "plan_required";
  if (/이미 이 조직의 멤버|already.*member/.test(message)) {
    return "already_member";
  }
  if (code.includes("resource-exhausted")) return "seat_limit";
  if (code.includes("permission-denied")) return "permission";
  if (code.includes("unauthenticated")) return "unauthenticated";
  if (code.includes("invalid-argument")) return "invalid";
  return "unavailable";
}

// ── 조직 정보(b) — validateTeamOrgIntake 거절 어휘의 클라이언트 매핑 ─────────

/**
 * 화면이 구분해 안내하는 거절. 서버 어휘(`TeamOrgIntakeRejection`)를 사람이
 * 행동할 수 있는 단위로 접는다: control_char·invisible_or_bidi 는 둘 다
 * "쓸 수 없는 문자" 하나로(사용자가 고칠 행동이 같다).
 */
// ── 대기 중 초대 목록 · 철회(F4) — 티켓 3PRpIVJdyE5dUWQWwy6Y ────────────────

/**
 * `listOrgInvitations` 의 한 행. ★`token` 이 없다 — 서버가 싣지 않고, 이 타입도
 * 그 자리를 만들어 두지 않는다(누가 나중에 채워 넣을 자리를 남기지 않는다).
 */
export interface PendingOrgInvitation {
  /** 소문자 정규화된 원문 이메일 — 무엇을 취소하는지 보여야 고를 수 있다. */
  invitedEmail: string;
  orgRole: OrgRoleKey;
  expiresAtMs: number | null;
  /** 서버 판정 그대로(손상된 만료값은 만료로 접힌다). */
  expired: boolean;
  projectCount: number;
}

/** ★신뢰 경계 — 어떤 입력이 와도 던지지 않는다. 못 읽은 행은 조용히 버린다. */
export function parseOrgInvitationList(data: unknown): PendingOrgInvitation[] {
  const rec = asRecord(data);
  if (!rec || rec.ok !== true || !Array.isArray(rec.invitations)) return [];
  const rows: PendingOrgInvitation[] = [];
  for (const raw of rec.invitations) {
    const row = asRecord(raw);
    if (!row) continue;
    const invitedEmail = pickString(row, "invitedEmail");
    const orgRole = normalizeOrgRoleKey(row.orgRole);
    if (!invitedEmail || !orgRole) continue;
    const projectCount = row.projectCount;
    rows.push({
      invitedEmail,
      orgRole,
      expiresAtMs: pickMillis(row, "expiresAtMs"),
      expired: row.expired === true,
      projectCount:
        typeof projectCount === "number" && Number.isFinite(projectCount)
          ? Math.max(0, Math.trunc(projectCount))
          : 0,
    });
  }
  return rows;
}

/**
 * 철회 실패 — 관리자가 다르게 행동해야 하는 단위로만 가른다.
 *   - permission: 조직 관리자가 아니다.
 *   - already_accepted: 이미 수락됐다 — 멤버 제거가 맞는 행동이다.
 *   - unknown: 그 외(없는 초대 포함). 목록이 낡았을 뿐이니 새로고침이 답이다.
 */
export type RevokeInviteFailure =
  | "permission"
  | "already_accepted"
  | "unknown";

export function classifyRevokeInviteError(err: unknown): RevokeInviteFailure {
  const { code, message } = readCallableError(err);
  if (/이미 수락된|already.*accepted/.test(message)) return "already_accepted";
  if (code.includes("permission-denied")) return "permission";
  if (code.includes("unauthenticated")) return "permission";
  return "unknown";
}

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
