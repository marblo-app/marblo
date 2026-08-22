// GitHub App 자동상속 — 순수 로직(Firestore·네트워크 무의존). node --test 로
// 단위검증한다(projectAudit.ts / adminAnalytics.ts 와 동일 규약). index.ts 의
// 콜러블은 Admin SDK read/write 와 GitHub HTTP 만 담당하고, **인가 판정·슬러그
// 도출·서명·검증**은 전부 여기로 내려 테스트 가능하게 한다.
//
// 설계 원문: v3/docs/github-app-installation-inheritance-design-2026-08-21.md
// (PR #1092). 이 파일은 그 설계를 구현할 뿐 재설계하지 않는다.
//
// ─────────────────────────────────────────────────────────────────────────────
// ★이 파일이 보안 경계 그 자체다 (설계 §7.3)
// ─────────────────────────────────────────────────────────────────────────────
// 콜라보레이터 모델에서는 GitHub 이 직접 접근을 막지만, App 모델에서는 멤버십
// 판정을 **우리 코드**가 한다. 그래서 `evaluateInstallationTokenRequest` 에
// 버그가 나면 그게 곧 무단 접근이다. 판정 순서(멤버십 → 엔타이틀먼트 → 설치
// → 슬러그)와 거부 코드가 테스트로 못박혀 있는 이유다.
//
// ─────────────────────────────────────────────────────────────────────────────
// ★토큰 규율 (설계 §5)
// ─────────────────────────────────────────────────────────────────────────────
//   - private key·App JWT·installation 토큰은 **로그에 넣지 않는다.** 이 파일은
//     애초에 그 값을 문자열로 반환하는 함수 외에는 어디에도 남기지 않는다.
//   - installation 토큰은 서버가 저장하지 않는다(§5-B2). 발급 응답에 한 번
//     실려 나가고 끝.
//   - 감사 원장에 남는 것은 `{uid, projectId, repoSlug, installationId, outcome}`
//     뿐이다. 토큰은 절대 아니다.

import * as crypto from "node:crypto";

// ── 상수 ────────────────────────────────────────────────────────────────────

export const GITHUB_API_BASE = "https://api.github.com";

/** GitHub API 버전 고정 — 스키마가 조용히 바뀌어 판정이 흔들리지 않게. */
export const GITHUB_API_VERSION = "2022-11-28";

/**
 * 저장소 접근 수준. **역할이 아니라 이 요청이 무엇을 하려는지**다 —
 * clone/fetch 는 read, push 는 write.
 */
export type RepoAccess = "read" | "write";

/**
 * read 요청이 받는 권한(설계 §4.1). Metadata:read 는 GitHub 이 강제로 딸려
 * 붙으므로 여기 적지 않는다(적을 수도 없다).
 *
 * ★v1 의 이름을 그대로 둔다 — 이 상수를 참조하는 곳이 곧 "읽기 경로" 라는
 * 뜻이고, v2 가 그 의미를 바꾸지 않는다.
 */
export const INSTALLATION_TOKEN_PERMISSIONS: Readonly<Record<string, string>> =
  Object.freeze({ contents: "read" });

/**
 * write 요청이 받는 권한(v2, 티켓 FYIyUuhJbv2cDVjgkRGf).
 *
 * ★v1 문서의 "Contents: Write 를 주지 않는다 — 확정된 결정" 은 **v2 로
 * 갱신됐다.** 근거를 다시 적어 둔다:
 *
 *  - 잃는 것: push 이벤트와 PR 작성자가 `marblo[bot]` 으로 기록된다.
 *  - ★잃지 않는 것: **커밋 작성자**. git author 이메일로 GitHub 이 그 사람의
 *    계정에 그대로 귀속시킨다(github-commit-identity.ts 가 그 이메일을 박는다).
 *    "누가 이 코드를 썼나" 는 살아 있고, 사라지는 건 "누가 밀었나" 뿐이다.
 *  - ★여전히 유효한 대가: 서버가 침해되면 폭발 반경이 "읽기" 에서 "고객 코드
 *    변조" 로 뛴다. 그건 없애는 게 아니라 **감수하고 방어를 두껍게** 한다 —
 *    (a) 저장소 1개 다운스코프 유지, (b) 마블로 역할 게이트(viewer 는 write
 *    토큰을 영원히 못 받는다), (c) 기본 브랜치 push 는 merge 권한 역할만,
 *    (d) 발급 응답 권한 재검증(요청보다 넓으면 버린다).
 *
 * `pull_requests: write` 를 함께 요청하는 이유: 브랜치만 밀고 PR 은 브라우저
 * 에서 열라고 하면 "PR 까지 간다" 가 아니다. contents 와 달리 이 권한은
 * **코드를 바꾸지 못한다** — 폭발 반경이 늘지 않는 쪽의 최소 추가다.
 *
 * ★설치가 아직 이 권한을 승인하지 않았으면 요청하지 않는다 —
 * `negotiateInstallationAccess` 가 승인된 만큼으로 깎는다(재승인 전 회귀 0).
 */
export const INSTALLATION_TOKEN_PERMISSIONS_WRITE: Readonly<
  Record<string, string>
> = Object.freeze({ contents: "write", pull_requests: "write" });

/** App JWT 수명 — GitHub 상한은 10분. 시계 흔들림 여유를 두고 9분. */
export const APP_JWT_TTL_SECONDS = 9 * 60;

/** App JWT iat 백데이트 — GitHub 이 미래 iat 를 거부하므로 60초 뒤로 민다. */
export const APP_JWT_CLOCK_SKEW_SECONDS = 60;

/** 설치 콜백 state nonce 수명(설계 §3.1). */
export const SETUP_STATE_TTL_MS = 10 * 60_000;

/**
 * 팀 협업 엔타이틀먼트를 가진 플랜(설계 §3.2 4번).
 * ★MIRROR — `v3/src/lib/planLimits.ts` 의 `hasTeamCollab: true` 와 같은 집합.
 * functions 는 별도 npm 패키지라 렌더러 src 를 import 할 수 없어 부득이 두 벌을
 * 둔다(entitlement.ts 의 MIRROR 규약과 동일). drift 는 githubApp.test.ts 가
 * 잡는다.
 */
export const TEAM_COLLAB_PLANS: readonly string[] = [
  "team",
  "team_plus",
  "enterprise",
];

export function planHasTeamCollab(plan: unknown): boolean {
  return typeof plan === "string" && TEAM_COLLAB_PLANS.includes(plan);
}

// ── 저장소 슬러그 ───────────────────────────────────────────────────────────

export interface RepoSlug {
  owner: string;
  repo: string;
}

/** GitHub 소유자/저장소 이름의 허용 문자. 경로 탈출·추가 세그먼트를 막는다. */
const SLUG_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * `projects.gitRemoteUrl` → `{owner, repo}`. github.com 이 아니거나 모양이
 * 어긋나면 null.
 *
 * ★이 입력은 **멤버가 쓸 수 있는 필드**다(firestore.rules 의
 * projectMemberWritableFields 에 gitRemoteUrl 이 있다). 그래서 여기서 도출한
 * 슬러그를 믿고 토큰을 발급하면 안 되고, 반드시 GitHub 에 "이 저장소가 정말
 * 이 installation 것이냐" 를 되물어야 한다(설계 §3.2 7번, index.ts 가 수행).
 * 이 함수는 그 되묻기 전의 **모양 검증**까지만 책임진다.
 *
 * 허용 형태: https://github.com/o/r[.git], ssh://git@github.com/o/r[.git],
 * git@github.com:o/r[.git]. 자격증명이 박힌 URL(구버전이 Firestore 에 백필한
 * 값)은 userinfo 를 떼고 판정한다 — 토큰을 슬러그로 오독하지 않기 위해서다.
 */
export function parseGitHubRepoSlug(raw: unknown): RepoSlug | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 2048 || /\s/.test(s)) return null;
  // `..` 세그먼트가 든 값은 거부한다. URL 정규화가 `github.com/../../etc/passwd`
  // 를 `github.com/etc/passwd` 로 접어 **보이는 것과 다른 슬러그**를 만들기
  // 때문이다. 정상 저장소 주소에는 `..` 이 들어갈 일이 없다.
  if (/(^|[/:])\.\.([/]|$)/.test(s)) return null;

  let host = "";
  let pathPart = "";

  const scpLike = /^([A-Za-z0-9._-]+@)?([A-Za-z0-9._-]+):(.+)$/.exec(s);
  if (scpLike && !s.includes("://")) {
    host = scpLike[2];
    pathPart = scpLike[3];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") return null;
    host = parsed.hostname;
    pathPart = parsed.pathname;
  }

  if (host.toLowerCase() !== "github.com") return null;

  const parts = pathPart
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!SLUG_PART.test(owner) || !SLUG_PART.test(repo)) return null;
  if (owner.length > 100 || repo.length > 100) return null;
  return { owner, repo };
}

/** 비교·로깅용 정규형. GitHub 이름은 대소문자를 구분하지 않는다. */
export function repoSlugKey(slug: RepoSlug): string {
  return `${slug.owner.toLowerCase()}/${slug.repo.toLowerCase()}`;
}

export function sameRepoSlug(a: RepoSlug, b: RepoSlug): boolean {
  return repoSlugKey(a) === repoSlugKey(b);
}

/** installation id 정규화 — Firestore 에는 문자열/숫자 어느 쪽으로도 올 수 있다. */
export function normalizeInstallationId(v: unknown): string | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) {
    return String(v);
  }
  if (typeof v === "string") {
    const t = v.trim();
    return /^[1-9][0-9]{0,18}$/.test(t) ? t : null;
  }
  return null;
}

// ── 마블로 역할 모델 (v2, 티켓 FYIyUuhJbv2cDVjgkRGf) ────────────────────────
//
// ★권한의 진실원은 GitHub 이 아니라 마블로다. 그래서 GitHub 초대를 쓰지 않고,
// 대신 **우리가 역할을 판정해서** 그만큼의 토큰을 발급한다.
//
// ★MIRROR — `v3/src/types/invitation.ts` 의 `ROLE_PERMISSIONS`,
// `v3/src/lib/teamRoles.ts` 의 `canMergeAsRole`, `v3/firestore.rules` 의
// `getMemberRole`/`isAdminOrOwner` 와 **같은 판정**이다. functions 는 별도 npm
// 패키지라 렌더러 src 를 import 할 수 없어 부득이 두 벌을 둔다(TEAM_COLLAB_PLANS
// 와 같은 규약). drift 는 githubApp.test.ts 가 잡는다.
//
// ★새 권한 개념을 만들지 않았다. write = 기존 `write` 퍼미션, 기본 브랜치 =
// 기존 `merge` 퍼미션. 화면이 막는 것과 토큰이 막는 것이 같아야 게이트가 뚫리지
// 않는다.

export type ProjectRole = "owner" | "admin" | "member" | "viewer";

const PROJECT_ROLES: readonly ProjectRole[] = [
  "owner",
  "admin",
  "member",
  "viewer",
];

/**
 * 역할별 퍼미션 — `src/types/invitation.ts` 의 ROLE_PERMISSIONS 중 이 파일이
 * 쓰는 두 가지(`write`, `merge`)만 옮긴다. 목록 전체를 복사하면 쓰지도 않는
 * 항목이 조용히 갈라진다.
 */
const ROLE_CAN_WRITE: Readonly<Record<ProjectRole, boolean>> = Object.freeze({
  owner: true,
  admin: true,
  member: true,
  viewer: false,
});

const ROLE_CAN_MERGE: Readonly<Record<ProjectRole, boolean>> = Object.freeze({
  owner: true,
  admin: true,
  member: false,
  viewer: false,
});

/** 저장소에 **밀 수** 있는 역할인가(= ROLE_PERMISSIONS 의 `write`). */
export function roleCanWriteRepo(role: ProjectRole): boolean {
  return ROLE_CAN_WRITE[role] === true;
}

/**
 * 코드를 **랜딩**할 수 있는 역할인가(= ROLE_PERMISSIONS 의 `merge`,
 * `teamRoles.canMergeAsRole` 와 같은 집합).
 *
 * ★이게 기본 브랜치 push 게이트다. 화면의 Merge 버튼을 owner/admin 으로
 * 막아 놓고 git 으로는 `push origin main` 이 되면 그 게이트는 뚫린 것이다.
 */
export function roleCanMerge(role: ProjectRole): boolean {
  return ROLE_CAN_MERGE[role] === true;
}

/**
 * `memberRoles/{projectId}_{uid}.role` 원문 → 역할.
 *
 * ★모르는 값·빈 문서는 **member** 로 접는다 — firestore.rules 의
 * `getMemberRole` 이 문서가 없을 때 'member' 를 쓰는 것과 정확히 같다. 여기서
 * viewer 로 접으면 룰이 허용하는 사람을 코드가 막고, owner 로 접으면 그 반대다.
 *
 * ★`owner` 는 이 문서로 얻지 않는다 — 프로젝트 `ownerId` 가 진실원이다
 * (룰의 `isProjectOwner` 와 같다). 멤버가 자기 memberRoles 문서에 'owner' 를
 * 써 넣어 승격하는 경로를 여기서 끊는다.
 */
export function normalizeMemberRole(raw: unknown): ProjectRole {
  if (typeof raw !== "string") return "member";
  const t = raw.trim().toLowerCase();
  if (t === "owner") return "member"; // ownerId 로만 owner 가 된다(위 주석)
  return (PROJECT_ROLES as readonly string[]).includes(t)
    ? (t as ProjectRole)
    : "member";
}

/**
 * 이 uid 의 프로젝트 역할. 멤버가 아니면 null — 그 뒤 어떤 것도 알려주지
 * 않는다(v1 의 `not-a-member` 정보 노출 경계 그대로).
 */
export function resolveProjectRole(input: {
  uid: string;
  project: ProjectSnapshotForIssue;
  memberRole?: unknown;
}): ProjectRole | null {
  const { uid, project } = input;
  if (!project.exists || !uid) return null;
  if (project.ownerId === uid) return "owner";
  if (!project.members.includes(uid)) return null;
  return normalizeMemberRole(input.memberRole);
}

// ── 인가 판정 (설계 §3.2 3~6번) ─────────────────────────────────────────────

export interface ProjectSnapshotForIssue {
  exists: boolean;
  ownerId: string | null;
  members: readonly string[];
  githubInstallationId: unknown;
  gitRemoteUrl: unknown;
}

/**
 * 거부 코드. **클라이언트에 내려가는 메시지는 이것들을 구분하지 않는다** —
 * "왜 거부됐는지" 를 정밀하게 알려주면 남의 프로젝트 존재 여부·설치 여부를
 * 프로빙하는 도구가 된다. 이 코드는 감사 원장과 테스트를 위한 것이다.
 */
export type IssueDenyCode =
  | "not-a-member"
  | "no-team-entitlement"
  | "no-installation"
  | "no-repo-url"
  // v2 — 역할이 쓰기를 허용하지 않는다(viewer). read 요청은 그대로 통과한다.
  | "role-cannot-write";

export type IssueDecision =
  | {
      ok: true;
      installationId: string;
      slug: RepoSlug;
      /** 이 요청자의 마블로 프로젝트 역할. 감사 원장에 남는다. */
      role: ProjectRole;
      /** 이 판정이 허용한 접근 수준. 실제 발급 권한은 설치 승인과 한 번 더 협상한다. */
      access: RepoAccess;
    }
  | { ok: false; code: IssueDenyCode };

export interface IssueRequestInput {
  uid: string;
  project: ProjectSnapshotForIssue;
  /** 프로젝트 **오너**의 유효 플랜(resolveEntitledPlan 결과). */
  ownerPlan: string;
  /**
   * `memberRoles/{projectId}_{uid}.role` 원문. 문서가 없으면 undefined —
   * firestore.rules 의 `getMemberRole` 과 **같은 기본값**(member)으로 접힌다.
   */
  memberRole?: unknown;
  /** 이 요청이 원하는 접근 수준. 생략하면 read(= v1 동작 그대로). */
  requestedAccess?: RepoAccess;
}

/**
 * 토큰 발급 인가 판정. 순서가 곧 정보 노출 경계다:
 *
 *  1. **멤버십 먼저.** 남이면 그 뒤 어떤 것도 알려주지 않는다 — 설치 유무조차.
 *     (`not-a-member` 는 프로젝트가 없을 때도 같은 코드다. 존재 여부를
 *     구분해 주면 projectId 열거가 된다.)
 *  2. 엔타이틀먼트 — 팀 기능이 유료 게이트를 우회하지 못하게(설계 §3.2 4번).
 *     ★판정 대상은 **오너의 플랜**이다. 멤버 각자가 결제하는 모델이 아니다
 *     (enforceProjectLimit 이 오너 구독을 보는 것과 같은 규율).
 *  3. 설치 없음 → `no-installation`. 클라는 이걸 받으면 device 경로로 간다
 *     (설계 §6, 폴백이 아니라 분기 선택).
 *  4. 슬러그 도출 실패 → `no-repo-url`.
 *
 * ★여기서 ok:true 가 나와도 **아직 발급하면 안 된다.** gitRemoteUrl 과
 * githubInstallationId 중 전자는 멤버가 쓸 수 있으므로, GitHub 에 되물어
 * "그 슬러그가 정말 이 installation 것" 임을 확인해야 한다(설계 §3.2 7번).
 */
export function evaluateInstallationTokenRequest(
  input: IssueRequestInput
): IssueDecision {
  const { uid, project, ownerPlan } = input;
  const requestedAccess: RepoAccess = input.requestedAccess ?? "read";

  const role = resolveProjectRole({ uid, project, memberRole: input.memberRole });
  if (!role) return { ok: false, code: "not-a-member" };

  if (!planHasTeamCollab(ownerPlan)) {
    return { ok: false, code: "no-team-entitlement" };
  }

  // ★v2 역할 게이트 — **엔타이틀먼트 다음, 설치 조회 앞**이다.
  //
  // 앞에 두지 않는 이유: 역할 거부가 멤버십 거부보다 먼저 나오면 "너는 멤버는
  // 맞는데 역할이 모자라다" 가 새어 프로젝트 존재를 프로빙할 수 있다.
  // 뒤에 두지 않는 이유: 설치 조회는 GitHub 왕복이다 — 어차피 줄 수 없는
  // 권한이면 남의 저장소에 요청을 쏘기 전에 끝낸다.
  if (requestedAccess === "write" && !roleCanWriteRepo(role)) {
    return { ok: false, code: "role-cannot-write" };
  }

  const installationId = normalizeInstallationId(project.githubInstallationId);
  if (!installationId) return { ok: false, code: "no-installation" };

  const slug = parseGitHubRepoSlug(project.gitRemoteUrl);
  if (!slug) return { ok: false, code: "no-repo-url" };

  return { ok: true, installationId, slug, role, access: requestedAccess };
}

// ── App JWT (RS256) ─────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * 환경변수에 담긴 PEM 정규화. Cloud Functions 환경변수는 개행을 그대로 담기
 * 어려워 `\n` 이스케이프로 넣는 게 관행이라 그걸 되돌린다. 형식이 PEM 이
 * 아니면 null — **값은 절대 로그에 남기지 않는다.**
 */
export function normalizePrivateKeyPem(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const pem = raw.includes("\\n") ? raw.split("\\n").join("\n") : raw;
  const trimmed = pem.trim();
  if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(trimmed)) return null;
  if (!/-----END [A-Z ]*PRIVATE KEY-----$/.test(trimmed)) return null;
  return `${trimmed}\n`;
}

export interface AppJwtInput {
  appId: string;
  privateKeyPem: string;
  /** 현재 epoch 초. 테스트가 고정할 수 있게 인자로 받는다. */
  nowSec: number;
}

/**
 * GitHub App JWT — `/app*` 엔드포인트 인증용. 요청 시마다 즉석 생성하고
 * **어디에도 저장·로그하지 않는다**(설계 §3.3).
 */
export function buildAppJwt(input: AppJwtInput): string {
  const { appId, privateKeyPem, nowSec } = input;
  if (!/^[0-9]{1,20}$/.test(appId)) {
    throw new Error("GitHub App id must be numeric");
  }
  const header = base64url(
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }), "utf8")
  );
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        iat: nowSec - APP_JWT_CLOCK_SKEW_SECONDS,
        exp: nowSec + APP_JWT_TTL_SECONDS,
        iss: appId,
      }),
      "utf8"
    )
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

// ── 설치 콜백 state nonce (설계 §3.1) ───────────────────────────────────────

export interface SetupStatePayload {
  /** nonce 문서 id — 1회성 소비를 Firestore 트랜잭션이 강제한다. */
  nonce: string;
  uid: string;
  projectId: string;
  /** 만료 epoch ms. */
  exp: number;
}

/**
 * state 서명. **서명만으로는 1회성이 보장되지 않는다** — 재사용 차단은
 * Firestore 의 nonce 문서 소비(index.ts) 몫이다. 여기서 막는 것은 "위조" 다:
 * 공격자가 자기 uid·남의 projectId 로 state 를 지어내 콜백을 때리는 경로.
 */
export function signSetupState(
  payload: SetupStatePayload,
  secret: string
): string {
  if (!secret) throw new Error("setup state secret is not configured");
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = base64url(
    crypto.createHmac("sha256", secret).update(body).digest()
  );
  return `v1.${body}.${sig}`;
}

export type SetupStateFailure =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "bad-payload";

export type SetupStateResult =
  | { ok: true; payload: SetupStatePayload }
  | { ok: false; reason: SetupStateFailure };

/** state 검증 — 서명 → 만료 → 모양 순. 서명 비교는 timing-safe. */
export function verifySetupState(
  token: unknown,
  secret: string,
  nowMs: number
): SetupStateResult {
  if (typeof token !== "string" || !secret) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { ok: false, reason: "malformed" };
  }
  const [, body, sig] = parts;
  const expected = base64url(
    crypto.createHmac("sha256", secret).update(body).digest()
  );
  const a = new Uint8Array(Buffer.from(sig, "utf8"));
  const b = new Uint8Array(Buffer.from(expected, "utf8"));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "bad-payload" };
  }
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.nonce !== "string" ||
    typeof p.uid !== "string" ||
    typeof p.projectId !== "string" ||
    typeof p.exp !== "number" ||
    !p.nonce ||
    !p.uid ||
    !p.projectId
  ) {
    return { ok: false, reason: "bad-payload" };
  }
  if (!Number.isFinite(p.exp) || p.exp <= nowMs) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    payload: {
      nonce: p.nonce,
      uid: p.uid,
      projectId: p.projectId,
      exp: p.exp,
    },
  };
}

/** 설치 시작 URL(설계 §3.1). slug 는 App 등록 후에야 정해진다. */
export function buildInstallUrl(appSlug: string, state: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(appSlug)) {
    throw new Error("GitHub App slug is not configured");
  }
  return (
    `https://github.com/apps/${appSlug}/installations/new` +
    `?state=${encodeURIComponent(state)}`
  );
}

// ── GitHub 응답 판정 ────────────────────────────────────────────────────────

export interface RepoInstallationResponse {
  /** `GET /repos/{owner}/{repo}/installation` 의 installation id. */
  id: unknown;
  account?: { login?: unknown } | null;
  repository_selection?: unknown;
  /**
   * ★이 설치에 **오너가 실제로 승인한** 권한(v2). 우리가 원하는 것이 아니라
   * GitHub 이 지금 인정하는 것이다 — 권한을 올려도 기존 설치처는 오너가
   * 재승인하기 전까지 옛 권한 그대로다. `negotiateInstallationAccess` 가
   * 이 값으로 요청을 깎아 **재승인 전 회귀 0** 을 만든다.
   */
  permissions?: Record<string, unknown> | null;
}

export type RepoBindingFailure =
  | "installation-mismatch"
  | "account-mismatch"
  | "malformed";

export type RepoBindingResult =
  | { ok: true }
  | { ok: false; reason: RepoBindingFailure };

/**
 * ★크로스테넌트 차단의 핵심(설계 §3.2 7번의 "GitHub 에 되묻기").
 *
 * `gitRemoteUrl` 은 멤버가 조작할 수 있으므로, 프로젝트 A 의 멤버가 A 의
 * gitRemoteUrl 을 **B 의 저장소**로 바꿔 B 의 토큰을 받아내려 할 수 있다.
 * 그래서 GitHub 에 "이 저장소를 지금 이 App 이 어느 installation 으로 보고
 * 있냐" 를 물어(`GET /repos/{owner}/{repo}/installation`) 그 id 가 프로젝트에
 * 바인딩된 id 와 **정확히 일치**할 때만 통과시킨다.
 *
 * - 저장소에 App 이 안 깔려 있으면 GitHub 이 404 를 준다 → 호출부가 거부.
 * - 다른 팀 저장소면 다른 installation id 가 온다 → `installation-mismatch`.
 * - 오너가 App 을 제거했으면 404 → 거부. **탈퇴/제거 차단이 여기서 실동작한다.**
 *
 * 계정 로그인까지 함께 보는 이유: 토큰 다운스코프를 저장소 **이름**으로 하기
 * 때문이다(`repositories: [repo]`). 이름은 계정 안에서만 유일하므로, 응답
 * 계정이 슬러그 소유자와 다르면 이름이 엉뚱한 저장소로 풀릴 여지가 있다.
 */
export function verifyRepoInstallationBinding(
  response: RepoInstallationResponse | null | undefined,
  expectedInstallationId: string,
  slug: RepoSlug
): RepoBindingResult {
  if (!response) return { ok: false, reason: "malformed" };
  const actual = normalizeInstallationId(response.id);
  if (!actual) return { ok: false, reason: "malformed" };
  if (actual !== expectedInstallationId) {
    return { ok: false, reason: "installation-mismatch" };
  }
  const login = response.account?.login;
  if (typeof login !== "string" || !login) {
    return { ok: false, reason: "malformed" };
  }
  if (login.toLowerCase() !== slug.owner.toLowerCase()) {
    return { ok: false, reason: "account-mismatch" };
  }
  return { ok: true };
}

export interface AccessTokenResponse {
  token?: unknown;
  expires_at?: unknown;
  permissions?: Record<string, unknown> | null;
  repositories?: Array<{ full_name?: unknown }> | null;
}

export type MintedToken = {
  token: string;
  expiresAtMs: number;
};

export type MintFailure =
  | "no-token"
  | "bad-expiry"
  | "over-scoped-repos"
  | "over-scoped-permissions";

export type MintResult =
  | { ok: true; minted: MintedToken }
  | { ok: false; reason: MintFailure };

/**
 * 발급 응답 검증 — **받은 토큰이 정말 우리가 요청한 만큼만 여는지** 확인한다.
 * GitHub 이 요청대로 내려준다고 가정하지 않는다: 응답의 `repositories` 가
 * 우리 저장소 하나가 아니거나 `permissions` 에 contents:read 외의 것이 있으면
 * **그 토큰을 쓰지 않고 버린다.** (설계 §4.3 "발급되는 토큰은 요청한 1개만".)
 *
 * 이건 편집증이 아니라 값싼 안전장치다 — 나중에 누가 App 권한을 넓히면
 * 여기서 red 가 나서 알게 된다.
 */
export function verifyMintedToken(
  response: AccessTokenResponse | null | undefined,
  slug: RepoSlug,
  /**
   * 우리가 **요청한** 권한. 기본값은 v1 의 contents:read 라서, 이 인자를 안
   * 넘기는 호출부는 v1 과 바이트 동일하게 동작한다.
   */
  expectedPermissions: Readonly<
    Record<string, string>
  > = INSTALLATION_TOKEN_PERMISSIONS
): MintResult {
  if (!response || typeof response.token !== "string" || !response.token) {
    return { ok: false, reason: "no-token" };
  }
  const expiresAtMs =
    typeof response.expires_at === "string"
      ? Date.parse(response.expires_at)
      : NaN;
  if (!Number.isFinite(expiresAtMs)) return { ok: false, reason: "bad-expiry" };

  const repos = response.repositories;
  if (!Array.isArray(repos) || repos.length !== 1) {
    return { ok: false, reason: "over-scoped-repos" };
  }
  const fullName = repos[0]?.full_name;
  if (
    typeof fullName !== "string" ||
    fullName.toLowerCase() !== repoSlugKey(slug)
  ) {
    return { ok: false, reason: "over-scoped-repos" };
  }

  // ★"요청한 만큼만 왔는가" 를 **요청과 대조**해서 본다. v1 은 contents:read
  // 를 상수로 박아 놨는데, v2 는 요청 자체가 두 가지(read/write)라 그 방식으로는
  // write 토큰이 전부 over-scoped 로 버려진다. 대신 규칙을 일반화한다:
  //   - 응답에 요청하지 않은 **권한 이름**이 있으면 버린다(metadata 는 예외 —
  //     GitHub 이 강제로 붙인다, 설계 §4.1).
  //   - 요청한 이름이라도 **수준이 더 높으면** 버린다(read 요청에 write 응답).
  //   - 요청한 이름이 응답에 **없으면** 버린다 — 있다고 믿고 push 했다가
  //     403 을 만나는 것보다, 여기서 끊고 read 로 내려가는 편이 낫다.
  const perms = response.permissions ?? {};
  const rank = (v: unknown): number =>
    v === "admin" ? 3 : v === "write" ? 2 : v === "read" ? 1 : 0;
  for (const [key, value] of Object.entries(perms)) {
    if (key === "metadata") {
      if (value !== "read") return { ok: false, reason: "over-scoped-permissions" };
      continue;
    }
    const want = expectedPermissions[key];
    if (!want) return { ok: false, reason: "over-scoped-permissions" };
    if (rank(value) > rank(want) || rank(value) === 0) {
      return { ok: false, reason: "over-scoped-permissions" };
    }
  }
  for (const [key, want] of Object.entries(expectedPermissions)) {
    if (rank(perms[key]) < rank(want)) {
      return { ok: false, reason: "over-scoped-permissions" };
    }
  }

  return { ok: true, minted: { token: response.token, expiresAtMs } };
}

// ── 기본 브랜치 게이트 (v2) ─────────────────────────────────────────────────

/**
 * 밀려는 ref 정규화. `refs/heads/x` · `x` 둘 다 받고 브랜치 이름만 돌려준다.
 * git 이 거부하는 모양(`-` 시작, 공백, `..`, `~^:?*[`, 끝의 `.lock`)은 null —
 * 이 값은 인자로 git 에 들어가므로 옵션 주입도 함께 막는다.
 */
export function normalizePushRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let t = raw.trim();
  if (!t || t.length > 255) return null;
  if (t.startsWith("refs/heads/")) t = t.slice("refs/heads/".length);
  if (!t || t.startsWith("-") || t.startsWith("/") || t.endsWith("/")) return null;
  if (t.endsWith(".lock") || t.endsWith(".")) return null;
  if (t.includes("..") || t.includes("@{")) return null;
  if (/[\s~^:?*[\\]/.test(t)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(t)) return null;
  return t;
}

export type PushRefDenyCode =
  | "no-push-ref"
  | "unknown-default-branch"
  | "default-branch-requires-merge-role";

export type PushRefDecision =
  | { ok: true; branch: string; isDefaultBranch: boolean }
  | { ok: false; code: PushRefDenyCode };

/**
 * ★역할 게이트와 화면 게이트의 모순을 없애는 자리.
 *
 * 마블로는 "코드 머지 = owner/admin" 을 화면(WorktreeTab Merge 버튼)과
 * Firestore 룰(REVIEW→DONE)에서 이미 막고 있다. 그런데 member 에게 준
 * `contents: write` 토큰으로 `git push origin main` 이 되면 **그 게이트는 뚫린
 * 것**이다. 그래서 write 토큰을 발급하기 전에 "어느 ref 로 밀 건가" 를 받아
 * 기본 브랜치면 merge 권한 역할만 통과시킨다.
 *
 * ★정직하게 — 이건 **암호학적 경계가 아니다.** installation 토큰에는 브랜치
 * 스코프가 없어서, 일단 손에 들어간 write 토큰은 어느 브랜치로든 밀 수 있다.
 * 이 판정이 막는 것은 "마블로를 통한 경로" 이고, 그걸 넘어서는 강제는
 * **오너 저장소의 브랜치 보호 규칙**뿐이다(그건 App 이 아니라 저장소 설정이라
 * GitHub 이 App 토큰에도 똑같이 적용한다). 등록 문서가 그 설정을 권고한다.
 */
export function evaluatePushRef(input: {
  role: ProjectRole;
  ref: unknown;
  /** `GET /repos/{o}/{r}` 의 `default_branch`. 모르면 null. */
  defaultBranch: string | null;
}): PushRefDecision {
  const branch = normalizePushRef(input.ref);
  if (!branch) return { ok: false, code: "no-push-ref" };

  // ★기본 브랜치를 모르면 판정을 하지 않고 **거부**한다. merge 권한이 있는
  // 역할까지 같이 막히지만, 그 반대(모르니까 통과)는 GitHub 조회가 한 번
  // 흔들릴 때마다 게이트가 열린다는 뜻이라 받아들일 수 없다. 호출부는 이
  // 코드를 GitHub 도달 실패와 같은 등급으로 다룬다.
  const known = input.defaultBranch?.trim();
  if (!known) return { ok: false, code: "unknown-default-branch" };

  const isDefaultBranch = branch.toLowerCase() === known.toLowerCase();
  if (isDefaultBranch && !roleCanMerge(input.role)) {
    return { ok: false, code: "default-branch-requires-merge-role" };
  }
  return { ok: true, branch, isDefaultBranch };
}

/** `GET /repos/{o}/{r}` 응답에서 기본 브랜치만 뽑는다. 모양이 어긋나면 null. */
export function parseDefaultBranch(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { default_branch?: unknown }).default_branch;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * 감사 원장에 남길 행. ★`token` 필드가 **존재하지 않는다** — 타입 수준에서
 * 토큰이 원장에 들어갈 길을 없앤다(설계 §5-B4).
 */
export interface GitHubAppAuditEntry {
  uid: string;
  projectId: string;
  repoSlug: string | null;
  installationId: string | null;
  outcome: "issued" | "denied" | "error";
  reason: string | null;
  at: number;
  /**
   * ★v2 — "누가 밀었나" 가 GitHub 쪽에서 `marblo[bot]` 으로 뭉개지는 대신,
   * **여기**에 남는다. 발급 시점의 역할·접근수준·대상 브랜치가 있으면
   * "이 사람이 이 시각에 write 를 받아 갔다" 를 우리 원장이 답할 수 있다.
   * 읽기 경로(v1)에는 role 만 붙고 나머지는 null 이다.
   */
  role: ProjectRole | null;
  access: RepoAccess | null;
  branch: string | null;
}

export function buildAuditEntry(input: {
  uid: string;
  projectId: string;
  slug: RepoSlug | null;
  installationId: string | null;
  outcome: GitHubAppAuditEntry["outcome"];
  reason: string | null;
  nowMs: number;
  role?: ProjectRole | null;
  access?: RepoAccess | null;
  branch?: string | null;
}): GitHubAppAuditEntry {
  return {
    uid: input.uid,
    projectId: input.projectId,
    repoSlug: input.slug ? repoSlugKey(input.slug) : null,
    installationId: input.installationId,
    outcome: input.outcome,
    reason: input.reason,
    at: input.nowMs,
    role: input.role ?? null,
    access: input.access ?? null,
    branch: input.branch ?? null,
  };
}

// ── 발급 한도 (설계 §3.2 2번) ───────────────────────────────────────────────
//
// ★read 와 write 를 **다른 예산**으로 나눈다. 느슨하게 만드는 게 아니라
// 분리하는 것이다 — 아래가 그 근거다.
//
// 레이트리밋의 목적은 "계정이 털렸을 때 토큰 양산을 막는다" 였다(§3.2 2번).
// 그런데 그 목적에 대해 read 와 write 는 **성격이 다른 위험**이고, v1 은 그
// 둘을 한 숫자로 관리하고 있었다:
//
//  - **read** — 털린 계정이 토큰을 **1개**만 받아도 그 저장소를 통째로 읽는다.
//    상한이 20이든 60이든 **피해가 같다.** 여기서 횟수 상한은 폭발 반경을
//    줄이지 못한다. 남는 역할은 GitHub API 호출·Firestore 쓰기의 비용/DoS
//    방어뿐이고, 그건 20/시간으로 이미 충분하다. ★그래서 read 는 **안 건드린다.**
//  - **write** — 발급 횟수가 곧 "탐지 전까지 망칠 수 있는 양"이다. 토큰 하나의
//    수명은 60분이지만 그 창이 지나면 다음 변조에는 새 발급이 필요하고, 발급은
//    전부 `github_app_access_logs` 에 한 행씩 남는다. 즉 상한은 **자동화된 남용의
//    템포를 원장에서 눈에 띄는 속도까지 떨어뜨린다.** 여기선 상한이 실제로
//    의미가 있다.
//
// ★이 주석을 지우지 마라. 없으면 다음 사람이 "write 만 왜 느슨하지 = 보안을
// 풀었네" 로 읽고 되돌린다. 되돌리면 아래의 UX 절벽이 그대로 돌아온다.
//
// ── 왜 지금 나누나 — v2 가 만든 UX 절벽 ─────────────────────────────────────
//
// v1 은 이 예산을 **clone 만** 썼다(프로젝트당 사실상 1회). v2 부터 **push 가
// 같은 예산을 쓴다.** 우리는 토큰을 캐시하지 않으므로 **push 1회 = 발급 1회**다.
// ★그 "캐시 없음" 은 결함이 아니라 **역할 회수가 T+0 에 먹히는 이유**이므로,
// 캐시로 푸는 건 답이 아니다. 예산을 나누는 게 답이다.
//
// 20회/시간이면 에이전트 주도 워크플로가 넘긴다 → `resource-exhausted` →
// device 경로 폴백 → **콜라보레이터가 아닌 팀원은 push 실패** → "팀원은 GitHub
// 초대가 필요 없다" 는 전제가 그 시점에 깨진다.
//
// ── 숫자의 근거 (★관측이 아니라 추정이다) ───────────────────────────────────
//
// 실사용자가 0이라 관측으로 정할 수 없다. 추정을 그대로 적어 둔다:
//
//  - 티켓 1건당 push ≈ **6회** — 최초 1 + 리베이스 재시도 ~2 + 리뷰 반영 ~3.
//  - 한 프로젝트에 에이전트 2~3대가 붙어 시간당 진행 티켓 ~4건 → **~24회/시간**.
//  - 실패 재시도·사람의 수동 push 여유 2배 → ~50 → **60회/시간**으로 잡는다.
//  - 분당: 리베이스 재시도 루프가 1분 안에 3~4회 몰리고 동시 에이전트 2~3대 →
//    ~10 → **12회/분**.
//
// ★분당 상한을 같이 올리지 않으면 시간당만 올려도 **버스트에서 여전히 막힌다** —
// 에이전트는 연속으로 민다. 12×60=720 ≫ 60 이므로 실제 구속은 시간당 상한이고,
// 분당 상한은 병리적 루프만 끊는 안전핀이다.
//
// ★**재조정 계획** — 이 숫자는 굳은 게 아니다. `github_app_access_logs` 에서
// `outcome:"issued"` 를 `uid+projectId` × 시간 으로 묶어 발급 횟수의 p95/p99 를
// 본다. (a) `resource-exhausted` 거부가 실제로 관측되면 즉시 올리고,
// (b) p99 가 상한의 50% 를 넘으면 올리고, (c) p99 가 상한의 10% 도 안 되면
// 내린다. 첫 실사용 팀이 한 주를 돌린 뒤 한 번 본다.

/**
 * 발급 한도가 구분하는 접근 수준. clone/fetch = read, push = write.
 *
 * ★`RepoAccess` 의 별칭이다 — 같은 축이므로 갈라 두면 반드시 어긋난다.
 * 예산을 고르는 값과 권한을 협상하는 값이 **같은 타입**이어야, 호출부에서
 * `decision.access` 를 그대로 넘기는 것이 타입으로 보장된다.
 */
export type TokenRateAccess = RepoAccess;

export interface InstallationTokenRule {
  windowSeconds: number;
  max: number;
}

/**
 * read 예산 — ★v1 값 그대로다(20회/시간, 6회/분). 이 티켓은 read 를 **느슨하게
 * 하지 않는다.** 위 근거대로 read 는 횟수로 폭발 반경이 줄지 않으므로 올릴
 * 이유가 없고, 비용/DoS 방어로는 이 값으로 충분하다.
 */
export const INSTALLATION_TOKEN_RULES_READ: ReadonlyArray<InstallationTokenRule> =
  Object.freeze([
    { windowSeconds: 3600, max: 20 },
    { windowSeconds: 60, max: 6 },
  ]);

/** write 예산 — 근거는 위 "숫자의 근거". 60회/시간, 12회/분. */
export const INSTALLATION_TOKEN_RULES_WRITE: ReadonlyArray<InstallationTokenRule> =
  Object.freeze([
    { windowSeconds: 3600, max: 60 },
    { windowSeconds: 60, max: 12 },
  ]);

/** 이 요청에 적용할 예산. */
export function installationTokenRules(
  access: TokenRateAccess
): ReadonlyArray<InstallationTokenRule> {
  return access === "write"
    ? INSTALLATION_TOKEN_RULES_WRITE
    : INSTALLATION_TOKEN_RULES_READ;
}

/**
 * 예산 버킷의 키. ★read/write 가 **서로 다른 문서**를 써야 한다 —
 * `rateLimit.enforce()` 는 키 하나에 시도 타임스탬프 배열 하나를 두므로, 같은
 * 키에 다른 룰을 주면 두 예산이 같은 배열을 갉아먹어 분리가 무의미해진다.
 *
 * ★키를 잡는 기준은 **이 요청이 무엇을 발급받으려 하는가**이되, 클라이언트의
 * 주장이 아니라 **서버가 인가한 수준**이다 — `issueRepoInstallationToken` 은
 * `evaluateInstallationTokenRequest` 의 판정(`decision.access`)을 넘긴다.
 * 그래서 다음 불변식이 성립한다:
 *
 *   ★**read 예산으로는 write 토큰을 얻을 수 없다.** — 지켜야 하는 건 이쪽이다.
 *   ★**write 버킷은 마블로 역할 게이트를 통과한 요청만 고를 수 있다.** viewer 가
 *     `access:"write"` 를 실어 60회/시간 버킷을 스스로 고르는 길은 없다 —
 *     그 요청은 키를 잡기 전에 `role-cannot-write` 로 죽는다.
 *
 * 반대 방향은 열려 있다: write 를 요청했다가 설치 권한 미승인으로 read 로
 * 깎여 발급되면(v2 의 `negotiateInstallationAccess`, #1119) 그 요청은
 * write 슬롯을 먹고 read 토큰을 받는다 — 즉 read 상한을 우회하는 셈이다.
 * **알고 받아들인다.** 위 근거대로 read 는 횟수가 폭발 반경을 줄이지 않으므로
 * 잃는 게 없고, 대신 "write 를 시도했다" 는 사실이 write 예산에 정확히 기록된다.
 *
 * ★v1 키(`ghapp:{uid}:{projectId}`)와 다르다. 기존 버킷 문서는 그냥 만료돼
 * 사라진다(가장 긴 창이 1시간). 실사용자 0 시점이라 이관할 상태가 없다.
 */
export function installationTokenRateKey(
  uid: string,
  projectId: string,
  access: TokenRateAccess
): string {
  return `ghapp:${access}:${uid}:${projectId}`;
}

/** 인가된 발급 판정 — `evaluateInstallationTokenRequest` 의 ok 분기. */
export type AuthorizedIssueDecision = Extract<IssueDecision, { ok: true }>;

/** 이 요청에 적용할 예산 — 버킷 키와 룰은 항상 같은 접근 수준에서 나온다. */
export interface InstallationTokenBudget {
  key: string;
  rules: ReadonlyArray<InstallationTokenRule>;
}

/**
 * 인가 판정 → 발급 예산.
 *
 * ★이 함수가 존재하는 이유는 **타입으로 사고를 막기 위해서**다. 예산 선택을
 * 호출부에 맡기면 `const access = "read"` 같은 한 줄이 남고, 그건 컴파일도 되고
 * 테스트도 통과하면서 **효과만 0**이다(v2 write push 가 read 예산 20회/시간을
 * 쓰게 된다 — 이 티켓이 고치려던 바로 그 결함). 그래서 접근 수준을 문자열로
 * 받지 않고 **판정 객체**로 받는다: 리터럴을 넘기려면 가짜 판정을 지어내야 하고,
 * 그건 리뷰에서 보인다.
 *
 * ★`decision.access` 는 클라이언트의 주장이 아니라 마블로 역할 게이트를 통과한
 * 값이다(viewer 의 write 요청은 `role-cannot-write` 로 죽는다). 그래서 write
 * 버킷은 실제로 밀 수 있는 역할만 고를 수 있다.
 */
export function installationTokenBudgetFor(
  uid: string,
  projectId: string,
  decision: AuthorizedIssueDecision
): InstallationTokenBudget {
  const access: TokenRateAccess = decision.access;
  return {
    key: installationTokenRateKey(uid, projectId, access),
    rules: installationTokenRules(access),
  };
}

// ── 접근 차단 경로 (설계 §7) ────────────────────────────────────────────────
//
// ★"설계상 그렇다" 로 끝내지 않기 위해, GitHub 응답 → 판정의 **매핑 전체**를
// 순수 함수로 내린다. 그래야 "오너가 App 을 제거하면 접근이 끊긴다" 를
// 라이브 App 없이도 테스트가 증명할 수 있다(githubApp.test.ts 의 차단 시나리오).
// index.ts 는 이 함수의 결과를 그대로 따르고 자체 판정을 하지 않는다.

export type RepoAccessDenyReason =
  | "app-unauthorized"
  | "repo-installation-404"
  | `repo-installation-${number}`
  | RepoBindingFailure;

export type RepoAccessCheck =
  | {
      ok: true;
      /** 오너가 이 설치에 승인해 둔 권한(`{contents: "read"}` 등). */
      permissions: Readonly<Record<string, string>>;
    }
  | { ok: false; reason: RepoAccessDenyReason };

/**
 * `GET /repos/{owner}/{repo}/installation` 응답 → 접근 판정.
 *
 * 끊기는 경로가 여기 전부 모여 있다:
 *  - **404** — 오너가 App 을 제거했거나, 설치에서 이 저장소를 뺐거나, 애초에
 *    안 깔렸거나, 저장소가 org 로 이전돼 개인 계정 설치 범위에서 빠졌다.
 *    GitHub 은 이 넷을 구분해 주지 않고, **우리도 구분할 필요가 없다** —
 *    전부 "지금 이 App 은 이 저장소를 못 연다" 이고 결론은 하나다.
 *  - **401/403** — 우리 App JWT 가 잘못됐다(키 회전 사고). 접근 허용으로
 *    위장하지 않는다.
 *  - **200 + id 불일치** — 남의 저장소다(크로스테넌트).
 *
 * ★차단은 "언젠가 만료돼서" 가 아니라 **다음 발급 요청에서 즉시** 일어난다.
 * 이미 발급된 토큰의 최대 잔여 노출은 60분이고, 그것을 더 줄이는 유일한 수단은
 * 오너의 App 제거(break-glass)다 — 그런데 그 제거가 바로 이 404 를 만든다.
 */
export function evaluateRepoInstallationLookup(
  status: number,
  body: unknown,
  expectedInstallationId: string,
  slug: RepoSlug
): RepoAccessCheck {
  if (status === 401 || status === 403) {
    return { ok: false, reason: "app-unauthorized" };
  }
  if (status !== 200) {
    return {
      ok: false,
      reason: `repo-installation-${status}` as RepoAccessDenyReason,
    };
  }
  const binding = verifyRepoInstallationBinding(
    body as RepoInstallationResponse,
    expectedInstallationId,
    slug
  );
  return binding.ok
    ? {
        ok: true,
        permissions: parseInstallationPermissions(
          (body as RepoInstallationResponse | null)?.permissions
        ),
      }
    : { ok: false, reason: binding.reason };
}

// ── 설치 승인 권한 ↔ 요청 권한 협상 (v2) ────────────────────────────────────

/**
 * `GET /repos/{o}/{r}/installation` 의 `permissions` 를 문자열 맵으로 정규화.
 * 모르는 모양은 통째로 버린다 — "없다" 로 접히면 read 로 내려가고, 그건
 * 안전한 쪽 오답이다.
 */
export function parseInstallationPermissions(
  raw: unknown
): Readonly<Record<string, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") out[k] = v;
  }
  return Object.freeze(out);
}

export interface AccessNegotiation {
  /** 실제로 발급할 접근 수준. */
  access: RepoAccess;
  /** 발급 요청에 실을 `permissions` 본문. */
  permissions: Readonly<Record<string, string>>;
  /**
   * ★write 를 원했지만 설치가 아직 승인하지 않아 read 로 내려갔는가.
   * 이게 참이면 **오너의 재승인이 필요하다** — 화면이 그렇게 안내한다.
   * 실패가 아니라 v1 동작으로의 정상 강등이다(회귀 0).
   */
  downgraded: boolean;
}

/**
 * 요청 접근 수준 × 설치가 승인한 권한 → 실제 발급 권한.
 *
 * ★권한을 올리면 GitHub 이 **기존 설치처 오너에게 재승인을 요구**하고, 그
 * 전까지 그 설치는 옛 권한(contents:read)만 갖는다. 그 상태에서 write 를
 * 요청하면 GitHub 은 422 로 발급 자체를 거절한다 — 그러면 clone 까지 같이
 * 죽는다. 그래서 **요청 전에** 승인된 만큼으로 깎는다.
 *
 * `pull_requests` 는 승인됐을 때만 붙인다. 없어도 push 는 되고 PR 은 브라우저
 * 에서 열 수 있으므로, 이것 때문에 write 전체를 포기하지 않는다.
 */
export function negotiateInstallationAccess(
  requested: RepoAccess,
  installationPermissions: Readonly<Record<string, string>>
): AccessNegotiation {
  if (requested !== "write") {
    return {
      access: "read",
      permissions: INSTALLATION_TOKEN_PERMISSIONS,
      downgraded: false,
    };
  }
  if (installationPermissions.contents !== "write") {
    return {
      access: "read",
      permissions: INSTALLATION_TOKEN_PERMISSIONS,
      downgraded: true,
    };
  }
  const permissions: Record<string, string> = { contents: "write" };
  if (installationPermissions.pull_requests === "write") {
    permissions.pull_requests = "write";
  }
  return {
    access: "write",
    permissions: Object.freeze(permissions),
    downgraded: false,
  };
}

export type MintHttpFailure = MintFailure | `mint-${number}`;

export type MintHttpResult =
  | { ok: true; minted: MintedToken }
  | { ok: false; reason: MintHttpFailure };

/**
 * `POST /app/installations/{id}/access_tokens` 응답 → 판정.
 * 201 이 아니면 거부(설치가 그 사이 지워지면 404, 권한이 없으면 422).
 * 201 이어도 **요청보다 넓으면 버린다**(verifyMintedToken).
 */
export function evaluateMintResponse(
  status: number,
  body: unknown,
  slug: RepoSlug,
  /** 우리가 요청한 권한. 생략하면 v1 의 contents:read. */
  expectedPermissions: Readonly<
    Record<string, string>
  > = INSTALLATION_TOKEN_PERMISSIONS
): MintHttpResult {
  if (status !== 201) {
    return { ok: false, reason: `mint-${status}` as MintHttpFailure };
  }
  const checked = verifyMintedToken(
    body as AccessTokenResponse,
    slug,
    expectedPermissions
  );
  return checked.ok
    ? { ok: true, minted: checked.minted }
    : { ok: false, reason: checked.reason };
}
