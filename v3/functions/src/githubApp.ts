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
 * v1 이 요청하는 유일한 저장소 권한(설계 §4.1). Metadata:read 는 GitHub 이
 * 강제로 딸려 붙이므로 여기 적지 않는다(적을 수도 없다).
 *
 * ★`contents: "write"` 를 넣지 않는다 — 확정된 결정이다(설계 §4.2). 모든 push
 * 가 `marblo[bot]` 으로 뭉개져 감사 추적이 죽고, 서버 침해 시 폭발 반경이
 * "읽기"에서 "고객 코드 변조"로 뛴다.
 */
export const INSTALLATION_TOKEN_PERMISSIONS: Readonly<Record<string, string>> =
  Object.freeze({ contents: "read" });

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
  | "no-repo-url";

export type IssueDecision =
  | { ok: true; installationId: string; slug: RepoSlug }
  | { ok: false; code: IssueDenyCode };

export interface IssueRequestInput {
  uid: string;
  project: ProjectSnapshotForIssue;
  /** 프로젝트 **오너**의 유효 플랜(resolveEntitledPlan 결과). */
  ownerPlan: string;
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

  const isMember =
    project.exists &&
    !!uid &&
    (project.members.includes(uid) || project.ownerId === uid);
  if (!isMember) return { ok: false, code: "not-a-member" };

  if (!planHasTeamCollab(ownerPlan)) {
    return { ok: false, code: "no-team-entitlement" };
  }

  const installationId = normalizeInstallationId(project.githubInstallationId);
  if (!installationId) return { ok: false, code: "no-installation" };

  const slug = parseGitHubRepoSlug(project.gitRemoteUrl);
  if (!slug) return { ok: false, code: "no-repo-url" };

  return { ok: true, installationId, slug };
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
  slug: RepoSlug
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

  const perms = response.permissions ?? {};
  const entries = Object.entries(perms);
  // metadata:read 는 GitHub 이 강제로 붙이므로 허용한다(설계 §4.1).
  const allowed = new Set(["contents", "metadata"]);
  for (const [key, value] of entries) {
    if (!allowed.has(key))
      return { ok: false, reason: "over-scoped-permissions" };
    if (value !== "read")
      return { ok: false, reason: "over-scoped-permissions" };
  }
  if (perms.contents !== "read") {
    return { ok: false, reason: "over-scoped-permissions" };
  }

  return { ok: true, minted: { token: response.token, expiresAtMs } };
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
}

export function buildAuditEntry(input: {
  uid: string;
  projectId: string;
  slug: RepoSlug | null;
  installationId: string | null;
  outcome: GitHubAppAuditEntry["outcome"];
  reason: string | null;
  nowMs: number;
}): GitHubAppAuditEntry {
  return {
    uid: input.uid,
    projectId: input.projectId,
    repoSlug: input.slug ? repoSlugKey(input.slug) : null,
    installationId: input.installationId,
    outcome: input.outcome,
    reason: input.reason,
    at: input.nowMs,
  };
}

/** 발급 한도(설계 §3.2 2번) — uid+projectId 당 20회/시간. */
export const INSTALLATION_TOKEN_RULES: ReadonlyArray<{
  windowSeconds: number;
  max: number;
}> = [
  { windowSeconds: 3600, max: 20 },
  { windowSeconds: 60, max: 6 },
];

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
  | { ok: true }
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
  return binding.ok ? { ok: true } : { ok: false, reason: binding.reason };
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
  slug: RepoSlug
): MintHttpResult {
  if (status !== 201) {
    return { ok: false, reason: `mint-${status}` as MintHttpFailure };
  }
  const checked = verifyMintedToken(body as AccessTokenResponse, slug);
  return checked.ok
    ? { ok: true, minted: checked.minted }
    : { ok: false, reason: checked.reason };
}
