/**
 * clone 자격증명 분기 선택 (티켓 ddbN2KvxHZ08rakiVfL0).
 *
 * 설계: v3/docs/github-app-installation-inheritance-design-2026-08-21.md §6
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★"폴백" 이 아니라 분기 선택이다
 * ─────────────────────────────────────────────────────────────────────────────
 * 폴백이면 device 사용자가 매번 실패 한 번을 먹고 지나가고, 로그가 더러워지고,
 * 언젠가 "레거시니까 지우자" 가 된다. 그래서 두 경로가 **같은 타입**을 만들어
 * **하나의 clone 구현**(repo-clone.cloneRepo, PR #1097)에 들어간다.
 *
 * ★clone 구현을 새로 만들지 않는다. #1097 이 이미 토큰을 URL 이 아니라
 * `GIT_CONFIG_*` 환경변수(`http.<url>.extraHeader`)로 넘기게 고쳐 놨고,
 * installation 토큰도 **같은 경로**로 들어간다. 두 벌이 되면 한쪽만 고쳐진다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★기존 사용자 회귀 0 (설계 §6.2)
 * ─────────────────────────────────────────────────────────────────────────────
 *  G1 오늘 존재하는 모든 프로젝트에는 `githubInstallationId` 가 없다 → App 분기
 *     조건이 거짓이라 **네트워크 호출조차 일어나지 않는다.**
 *  G2 App 경로 장애(서버 5xx·레이트리밋·설치 삭제·네트워크)는 전부 흡수돼
 *     device 분기로 내려온다. App→device 방향의 저하만 있고 그 역은 없다.
 *  G3 개인 저장소·비 Marblo 저장소는 영구히 device 경로. 이건 "옛 방식" 이
 *     아니라 그 사용 사례의 정답이다.
 *  G5 SSH·타 호스트는 App 경로를 아예 타지 않는다(githubHttpsCloneTarget).
 *
 * ★토큰 경계: 이 모듈이 반환하는 토큰은 main 프로세스 안에서만 산다 —
 * IPC 응답·로그·Firestore 어디에도 실리지 않는다(설계 §5-B3/B4).
 */

/** clone 에 쓸 자격증명. `token` 은 절대 렌더러로 나가지 않는다. */
export type CloneCredential =
  | { kind: "installation"; token: string }
  | { kind: "device"; token: string }
  | { kind: "none" };

export interface CloneCredentialDeps {
  /**
   * 이 프로젝트에 바인딩된 GitHub App installation id. 없으면 null.
   * ★서버가 쓴 필드다(firestore.rules 클라 write 금지, #1096).
   * 조회 실패는 null 로 흡수한다 — 실패가 기존 경로를 막으면 안 된다(G2).
   */
  getInstallationId: (projectId: string) => Promise<string | null>;
  /**
   * 서버(`issueRepoInstallationToken`)에서 1시간짜리 토큰을 받아온다.
   * 거부·실패는 null. **던지지 않는다** — 던지면 G2 가 깨진다.
   */
  issueInstallationToken: (projectId: string) => Promise<string | null>;
  /** safeStorage 의 device OAuth 토큰(기존 경로 그대로). */
  getDeviceToken: () => string | null;
}

export interface CloneCredentialInput {
  /** 프로젝트가 특정되지 않으면(수동 URL clone 등) App 경로는 없다. */
  projectId?: string | null;
  /** clone 대상 URL. GitHub HTTPS 가 아니면 App 경로를 타지 않는다(G5). */
  repoUrl: string;
}

/**
 * App 경로를 검토할 가치가 있는 URL 인가 — `https://github.com/...` 만.
 *
 * repo-clone.githubTokenGitConfigEnv 와 **같은 게이트**다(설계 G5). 여기서
 * 걸러야 SSH·타 호스트 clone 이 서버 호출을 유발하지 않는다.
 */
export function isGitHubHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "github.com"
    );
  } catch {
    return false;
  }
}

/**
 * App 경로를 시도할 자격이 되는 요청인가 — G5(GitHub HTTPS) + G1(설치 바인딩).
 *
 * clone(read)과 push(write)가 **같은 게이트**를 쓰게 하려고 뽑아낸다. 여기가
 * 두 벌이 되면 한쪽만 고쳐진다.
 *
 * 반환: 바인딩된 installationId, 또는 null(= App 경로 없음).
 */
async function appPathInstallationId(
  input: CloneCredentialInput,
  deps: Pick<CloneCredentialDeps, "getInstallationId">,
): Promise<string | null> {
  const projectId =
    typeof input.projectId === "string" && input.projectId.trim()
      ? input.projectId.trim()
      : null;

  // G5 — GitHub HTTPS 가 아니면 App 은 애초에 답할 게 없다.
  if (!projectId || !isGitHubHttpsUrl(input.repoUrl)) return null;

  // G1 — installation 이 없으면 서버를 부르지 않는다. 기존 사용자에게는
  // 이 코드가 사실상 실행되지 않는다.
  try {
    return await deps.getInstallationId(projectId);
  } catch {
    return null; // G2
  }
}

/**
 * 어떤 자격증명으로 clone 할지 고른다.
 *
 * 순서:
 *   1. GitHub HTTPS 가 아니면 → device 토큰이 있어도 git 이 안 쓴다(#1097 게이트).
 *      그래도 기존 동작과 **바이트 동일**하게 device 를 그대로 넘긴다.
 *   2. projectId 가 있고 installation 이 바인딩돼 있으면 → 서버에 발급 요청.
 *      성공하면 1급 경로 A.
 *   3. 그 외 전부 → device(1급 경로 B). 없으면 none(public repo / ssh).
 *
 * ★v2 가 이 함수를 바꾸지 않았다. read 경로의 반환 모양·폴백 규율은 v1 그대로다.
 */
export async function resolveCloneCredential(
  input: CloneCredentialInput,
  deps: CloneCredentialDeps,
): Promise<CloneCredential> {
  const deviceToken = deps.getDeviceToken();
  const device = (): CloneCredential =>
    deviceToken ? { kind: "device", token: deviceToken } : { kind: "none" };

  const installationId = await appPathInstallationId(input, deps);
  if (!installationId) return device();

  const projectId = (input.projectId as string).trim();
  let token: string | null = null;
  try {
    token = await deps.issueInstallationToken(projectId);
  } catch {
    return device(); // G2 — 발급 실패는 기존 경로를 막지 않는다
  }
  if (token) return { kind: "installation", token };
  return device();
}

// ─────────────────────────────────────────────────────────────────────────────
// push 자격증명 (v2, 티켓 FYIyUuhJbv2cDVjgkRGf)
// ─────────────────────────────────────────────────────────────────────────────

export type RepoAccess = "read" | "write";

/** 서버 `issueRepoInstallationToken` 의 write 요청 결과. */
export type WriteTokenOutcome =
  /** write 토큰을 받았다. */
  | { kind: "granted"; token: string }
  /**
   * 설치가 아직 `contents: write` 를 승인하지 않아 서버가 read 로 깎았다.
   * ★서버가 명확히 답한 "write 불가"다. 설치 바인딩이 있는 상태에서 이걸
   * device 로 내려보내면 App 역할 게이트를 우회한다.
   */
  | { kind: "needs-owner-approval" }
  /**
   * ★역할이 막았다(viewer / member 의 기본 브랜치). **폴백 금지.**
   * 여기서 device 토큰으로 내려가면 화면의 Merge 게이트를 우리 손으로 뚫는다.
   */
  | { kind: "role-denied"; message: string }
  /** 서버가 답하지 못했거나 일시 장애다. 설치 바인딩이 있으면 재시도 대상이다. */
  | { kind: "unavailable" };

export interface PushCredentialDeps extends Pick<
  CloneCredentialDeps,
  "getInstallationId" | "getDeviceToken"
> {
  /**
   * write 토큰 발급. **던지지 않는다** — 실패 종류를 outcome 으로 돌려준다.
   * `ref` 는 서버의 기본 브랜치 게이트 입력이다(밀려는 브랜치).
   */
  issueWriteToken: (
    projectId: string,
    ref: string,
  ) => Promise<WriteTokenOutcome>;
}

export interface PushCredentialInput extends CloneCredentialInput {
  /** 밀려는 브랜치. 서버가 기본 브랜치 여부를 판정한다. */
  ref: string;
}

/** push 에 쓸 자격증명. `token` 은 절대 렌더러로 나가지 않는다. */
export type PushCredential =
  | { kind: "installation"; token: string }
  | { kind: "device"; token: string }
  | { kind: "none" }
  /** ★역할 거부 — 어떤 자격증명으로도 진행하지 않는다. */
  | {
      kind: "denied";
      message: string;
      reason: "role-denied" | "needs-owner-approval";
    }
  /** ★설치 바인딩은 있지만 서버가 write 판정을 못 했다. device 로 우회하지 않는다. */
  | { kind: "unavailable"; message: string };

export interface PushCredentialAuditFields {
  credentialKind: PushCredential["kind"];
  reason: string | null;
  projectId: string | null;
  repoHost: string | null;
  branch: string | null;
}

const OWNER_APPROVAL_MESSAGE =
  "GitHub App 쓰기 권한이 아직 승인되지 않았습니다. 프로젝트 오너에게 GitHub App 재승인을 요청하세요.";

const WRITE_TOKEN_UNAVAILABLE_MESSAGE =
  "GitHub App 권한 확인이 일시적으로 실패했습니다. 잠시 후 다시 시도하세요.";

/**
 * 어떤 자격증명으로 push 할지 고른다.
 *
 * ★clone 과 다른 점은 **폴백 규율 하나**다. clone 은 App 이 안 되면 무조건
 * device 로 내려간다(G2). push 는 그러면 안 된다 — 설치가 있는데 App write
 * 토큰을 못 받은 사실을 device 토큰이 덮어쓰면 "화면에서 머지를 막아놓고 GitHub 에서는 밀 수 있는" 상태가 되고,
 * 그건 게이트가 뚫린 것이다. 그래서:
 *
 *   role-denied         → denied. **폴백 없음.**
 *   needs-owner-approval→ denied. 설치가 답했지만 write 를 주지 않은 상태다.
 *   unavailable         → unavailable. 일시 장애로 보고 재시도하게 한다.
 *   granted             → App write 토큰.
 *
 * ★App 설치가 없는 프로젝트는 이 함수가 서버를 부르지도 않는다(G1) — 오늘의
 * 모든 프로젝트가 여기 해당하고, 그래서 push 경로도 회귀 0 이다.
 *
 * ★v1 호환: App 설치가 없는 프로젝트는 여전히 device 로 간다. 좁히는 것은
 * "installationId 가 있는데 write 토큰을 못 받은" 경우뿐이다.
 */
export async function resolvePushCredential(
  input: PushCredentialInput,
  deps: PushCredentialDeps,
): Promise<PushCredential> {
  const deviceToken = deps.getDeviceToken();
  const device = (): PushCredential =>
    deviceToken ? { kind: "device", token: deviceToken } : { kind: "none" };

  const installationId = await appPathInstallationId(input, deps);
  if (!installationId) return device();

  const projectId = (input.projectId as string).trim();
  let outcome: WriteTokenOutcome;
  try {
    outcome = await deps.issueWriteToken(projectId, input.ref);
  } catch {
    return { kind: "unavailable", message: WRITE_TOKEN_UNAVAILABLE_MESSAGE };
  }

  switch (outcome.kind) {
    case "granted":
      return { kind: "installation", token: outcome.token };
    case "role-denied":
      return {
        kind: "denied",
        message: outcome.message,
        reason: "role-denied",
      };
    case "needs-owner-approval":
      return {
        kind: "denied",
        message: OWNER_APPROVAL_MESSAGE,
        reason: "needs-owner-approval",
      };
    case "unavailable":
      return { kind: "unavailable", message: WRITE_TOKEN_UNAVAILABLE_MESSAGE };
  }
}

export function pushCredentialAuditFields(
  input: PushCredentialInput,
  credential: PushCredential,
): PushCredentialAuditFields {
  const projectId =
    typeof input.projectId === "string" && input.projectId.trim()
      ? input.projectId.trim()
      : null;
  const branch =
    typeof input.ref === "string" && input.ref.trim() ? input.ref.trim() : null;
  let repoHost: string | null = null;
  try {
    repoHost = new URL(input.repoUrl).hostname.toLowerCase();
  } catch {
    repoHost = null;
  }

  return {
    credentialKind: credential.kind,
    reason:
      credential.kind === "denied"
        ? credential.reason
        : credential.kind === "unavailable"
          ? "write-token-unavailable"
          : null,
    projectId,
    repoHost,
    branch,
  };
}
