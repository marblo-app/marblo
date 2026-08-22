/**
 * GitHub App 자동상속 — main 프로세스 클라이언트 (티켓 ddbN2KvxHZ08rakiVfL0).
 *
 * 설계: v3/docs/github-app-installation-inheritance-design-2026-08-21.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★토큰 경계 (설계 §5-B3)
 * ─────────────────────────────────────────────────────────────────────────────
 * installation 토큰은 **main 프로세스 안에서만** 산다:
 *   콜러블 응답 → 이 파일의 지역변수 → git 자식 프로세스 env → 함수 종료.
 * 렌더러는 존재 자체를 모른다. 이 파일의 어떤 함수도 토큰을 로그하지 않고,
 * 실패 로그에는 **콜러블 에러 코드만** 남긴다(에러 메시지에 서버가 값을 담지
 * 않지만, 담기더라도 새지 않게 코드만 찍는다).
 *
 * ★App private key 는 여기 없다. 서버(Cloud Functions)에만 있다 — asar 는
 * 암호화가 아니라서 데스크톱 바이너리에 넣는 건 전 사용자에게 배포하는 것과
 * 같다(설계 §3.3).
 *
 * ★fail-soft 규율: 이 파일의 공개 함수는 **던지지 않는다.** 실패는 전부
 * null/false 로 흡수된다. App 경로 장애가 기존 device 경로를 막으면 안 되기
 * 때문이다(설계 §6.2 G2).
 */

import { getAuth } from "firebase/auth";
import {
  doc as fbDoc,
  getDoc as fbGetDoc,
  getFirestore,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getMissionFirebaseApp } from "./mission-engine/firebase-app";
import type { WriteTokenOutcome } from "./github-clone-credential";

// renderer 의 src/lib/firebase.ts 와 동일 리전 — main 은 renderer 모듈을
// 임포트할 수 없어 상수를 별도로 둔다(firebase-auth-sync.ts 와 같은 규약).
const FIREBASE_FUNCTIONS_REGION = "us-central1";

function callableErrorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

/** 실사용자로 로그인돼 있을 때만 App 경로를 시도한다. 익명은 판정 불가. */
async function realUserApp(): Promise<
  ReturnType<typeof getMissionFirebaseApp>["app"] | null
> {
  try {
    const { app, authReady } = getMissionFirebaseApp();
    await authReady;
    const user = getAuth(app).currentUser;
    if (!user || user.isAnonymous) return null;
    return app;
  } catch {
    return null;
  }
}

/**
 * 이 프로젝트에 바인딩된 installation id. 없으면 null.
 *
 * ★서버 전용 필드다 — 클라는 읽기만 한다(firestore.rules 의 어떤 write
 * allowlist 에도 없다, #1096). 읽기 실패는 null 로 흡수한다: 실패가 기존
 * device 경로를 막으면 회귀다(G2).
 *
 * ★이 조회는 **GitHub HTTPS + projectId 가 있을 때만** 불린다
 * (github-clone-credential.resolveCloneCredential). 그래서 오늘의 기존
 * 사용자에게는 clone 버튼 한 번당 문서 읽기 1회가 늘 뿐이고, 그 결과가
 * 없으므로 그 뒤 App 코드는 실행되지 않는다(G1).
 */
export async function readProjectInstallationId(
  projectId: string,
): Promise<string | null> {
  const app = await realUserApp();
  if (!app) return null;
  try {
    const snap = await fbGetDoc(
      fbDoc(getFirestore(app), "projects", projectId),
    );
    if (!snap.exists()) return null;
    const raw = (snap.data() as Record<string, unknown>).githubInstallationId;
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) {
      return String(raw);
    }
    if (typeof raw === "string" && /^[1-9][0-9]{0,18}$/.test(raw.trim())) {
      return raw.trim();
    }
    return null;
  } catch (err) {
    console.warn(
      `[githubApp] installation id 조회 실패 (code=${callableErrorCode(err)}) — device 경로로 진행`,
    );
    return null;
  }
}

/**
 * 1시간짜리 installation 토큰 발급. 거부·실패는 null.
 *
 * ★반환값을 **로그하지 않는다.** 호출부도 이 값을 git 자식 env 로만 넘긴다.
 * ★서버는 이 토큰을 저장하지 않고, 우리도 저장하지 않는다 — 1시간짜리를
 * 캐시해서 아끼는 것보다 안 갖고 있는 게 낫다(설계 §5-B2).
 */
export async function issueRepoInstallationToken(
  projectId: string,
): Promise<string | null> {
  const app = await realUserApp();
  if (!app) return null;
  try {
    const callable = httpsCallable<
      { projectId: string },
      { token?: unknown; expiresAt?: unknown; repo?: unknown }
    >(
      getFunctions(app, FIREBASE_FUNCTIONS_REGION),
      "issueRepoInstallationToken",
    );
    const { data } = await callable({ projectId });
    const token = data?.token;
    if (typeof token !== "string" || !token) return null;
    return token;
  } catch (err) {
    // ★거부(failed-precondition/permission-denied)는 정상 경로다 — 설치가
    // 없거나 자격이 없으면 device 로 간다. 소음이 되지 않게 info 로 남긴다.
    console.info(
      `[githubApp] installation 토큰 미발급 (code=${callableErrorCode(err)}) — device 경로로 진행`,
    );
    return null;
  }
}

/**
 * push 용 write 토큰 발급 (v2, 티켓 FYIyUuhJbv2cDVjgkRGf).
 *
 * ★clone 경로(`issueRepoInstallationToken`)와 **같은 콜러블**을 부른다 —
 * `access: "write"` 와 밀려는 `ref` 를 얹을 뿐이다. 서버가 역할·기본 브랜치·
 * 설치 승인 권한을 판정한다.
 *
 * ★반환은 **실패 종류를 구분한다.** 이게 v1 의 `null` 하나와 다른 점이고,
 * 그 구분이 게이트를 지킨다: 역할 거부(`role-denied`)를 "그냥 실패" 로 접으면
 * 호출부가 device 토큰으로 폴백해 화면의 Merge 게이트를 스스로 뚫는다.
 *
 * ★던지지 않는다. 토큰 값을 로그하지 않는다.
 */
export async function issueRepoInstallationWriteToken(
  projectId: string,
  ref: string,
): Promise<WriteTokenOutcome> {
  const app = await realUserApp();
  if (!app) return { kind: "unavailable" };
  try {
    const callable = httpsCallable<
      { projectId: string; access: "write"; ref: string },
      { token?: unknown; access?: unknown; downgraded?: unknown }
    >(
      getFunctions(app, FIREBASE_FUNCTIONS_REGION),
      "issueRepoInstallationToken",
    );
    const { data } = await callable({ projectId, access: "write", ref });
    // ★서버가 read 로 깎아 보냈으면(오너 재승인 전) 그 토큰으로는 못 민다.
    // 실패가 아니라 v1 상태다 — 호출부가 device 경로로 내려간다(회귀 0).
    if (data?.downgraded === true || data?.access !== "write") {
      return { kind: "needs-owner-approval" };
    }
    const token = data?.token;
    if (typeof token !== "string" || !token) return { kind: "unavailable" };
    return { kind: "granted", token };
  } catch (err) {
    if (isRoleDenial(err)) {
      return { kind: "role-denied", message: callableErrorMessage(err) };
    }
    console.info(
      `[githubApp] write 토큰 미발급 (code=${callableErrorCode(err)})`,
    );
    return { kind: "unavailable" };
  }
}

/**
 * ★역할 거부인가. 서버가 `permission-denied` + `details.denyClass === "role"`
 * 로만 표시한다(그 외 거부는 전부 뭉뚱그린 `failed-precondition`).
 *
 * 코드만 보고 판정하지 않는 이유: `permission-denied` 는 다른 이유로도 나올
 * 수 있고, 그걸 역할 거부로 오독하면 폴백해야 할 상황에서 사용자를 막는다.
 */
function isRoleDenial(err: unknown): boolean {
  if (callableErrorCode(err) !== "functions/permission-denied") return false;
  if (typeof err !== "object" || err === null || !("details" in err)) {
    return false;
  }
  const details = (err as { details?: unknown }).details;
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { denyClass?: unknown }).denyClass === "role"
  );
}

/** 사용자에게 보여줄 거부 문구. 서버가 준 게 없으면 일반 문구. */
function callableErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "이 프로젝트에서 코드를 밀 수 있는 역할이 아닙니다.";
}

export interface GitHubAppStatus {
  /** 이 프로젝트에 App 설치가 바인딩돼 있는가. */
  installed: boolean;
  /** 그 설치가 지금 이 저장소를 실제로 열 수 있는가(GitHub 에 되물은 결과). */
  repoAccessible: boolean;
  /** 서버에 App 이 설정돼 있는가(미등록이면 기능 자체가 잠들어 있다). */
  configured: boolean;
  /** ★v2 — 이 사용자의 마블로 프로젝트 역할. 판정 불가면 null. */
  role: string | null;
  /** 역할이 push 를 허용하는가(viewer 는 거짓). */
  canWrite: boolean;
  /** 역할이 기본 브랜치 랜딩을 허용하는가(owner/admin 만). */
  canMerge: boolean;
  /**
   * ★오너가 이 설치에 `contents: write` 를 승인했는가.
   * `canWrite && !writeGranted` = **오너 재승인 대기**. 그동안 clone 은 그대로
   * 되고 push 만 device 경로로 간다(회귀 0).
   */
  writeGranted: boolean;
}

const STATUS_OFF: GitHubAppStatus = {
  installed: false,
  repoAccessible: false,
  configured: false,
  role: null,
  canWrite: false,
  canMerge: false,
  writeGranted: false,
};

/**
 * 화면용 상태. ★토큰을 반환하지 않는다 — 기존 `github:status` 가
 * `{connected: boolean}` 만 주는 규약을 그대로 따른다(설계 §5-B3).
 *
 * `installed && !repoAccessible` 는 "오너가 App 을 제거했거나 저장소를
 * 이전했다" 는 뜻이다. 그 때 화면이 오너에게 재설치를 안내할 수 있다
 * (설계 §7.3).
 */
export async function getGitHubAppStatus(
  projectId: string,
): Promise<GitHubAppStatus> {
  const app = await realUserApp();
  if (!app) return STATUS_OFF;
  try {
    const callable = httpsCallable<
      { projectId: string },
      {
        installed?: unknown;
        repoAccessible?: unknown;
        configured?: unknown;
        role?: unknown;
        canWrite?: unknown;
        canMerge?: unknown;
        writeGranted?: unknown;
      }
    >(getFunctions(app, FIREBASE_FUNCTIONS_REGION), "getGitHubAppStatus");
    const { data } = await callable({ projectId });
    return {
      installed: data?.installed === true,
      repoAccessible: data?.repoAccessible === true,
      configured: data?.configured === true,
      // ★모르는 값은 전부 "못 한다" 로 접는다 — 구버전 서버(v1)를 상대해도
      // 쓰기 가능이 참으로 새지 않는다.
      role: typeof data?.role === "string" ? data.role : null,
      canWrite: data?.canWrite === true,
      canMerge: data?.canMerge === true,
      writeGranted: data?.writeGranted === true,
    };
  } catch (err) {
    console.info(`[githubApp] 상태 조회 실패 (code=${callableErrorCode(err)})`);
    return STATUS_OFF;
  }
}

export interface GitHubAppInstallStart {
  ok: boolean;
  /** 시스템 브라우저로 열 설치 URL. 서명된 state 가 붙어 있다. */
  installUrl?: string;
  error?: string;
}

/**
 * 설치 시작 URL 발급 — **오너만** 성공한다(서버가 판정한다).
 * ★여기서 URL 을 열지는 않는다. 여는 것은 main.ts 의 IPC 핸들러 몫이고,
 * 앱 창을 navigate 하지 않고 시스템 브라우저로 연다(drive 커넥터와 같은 규율).
 */
export async function startGitHubAppInstall(
  projectId: string,
): Promise<GitHubAppInstallStart> {
  const app = await realUserApp();
  if (!app) return { ok: false, error: "로그인이 필요합니다." };
  try {
    const callable = httpsCallable<
      { projectId: string },
      { installUrl?: unknown; expiresAt?: unknown }
    >(getFunctions(app, FIREBASE_FUNCTIONS_REGION), "startGitHubAppInstall");
    const { data } = await callable({ projectId });
    const url = data?.installUrl;
    if (
      typeof url !== "string" ||
      !url.startsWith("https://github.com/apps/")
    ) {
      return { ok: false, error: "설치 링크를 받지 못했습니다." };
    }
    return { ok: true, installUrl: url };
  } catch (err) {
    const code = callableErrorCode(err);
    console.info(`[githubApp] 설치 시작 실패 (code=${code})`);
    return {
      ok: false,
      error:
        code === "functions/permission-denied"
          ? "프로젝트 오너만 App 을 설치할 수 있습니다."
          : "GitHub App 설치를 시작하지 못했습니다.",
    };
  }
}
