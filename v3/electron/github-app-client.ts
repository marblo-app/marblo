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

export interface GitHubAppStatus {
  /** 이 프로젝트에 App 설치가 바인딩돼 있는가. */
  installed: boolean;
  /** 그 설치가 지금 이 저장소를 실제로 열 수 있는가(GitHub 에 되물은 결과). */
  repoAccessible: boolean;
  /** 서버에 App 이 설정돼 있는가(미등록이면 기능 자체가 잠들어 있다). */
  configured: boolean;
}

const STATUS_OFF: GitHubAppStatus = {
  installed: false,
  repoAccessible: false,
  configured: false,
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
      { installed?: unknown; repoAccessible?: unknown; configured?: unknown }
    >(getFunctions(app, FIREBASE_FUNCTIONS_REGION), "getGitHubAppStatus");
    const { data } = await callable({ projectId });
    return {
      installed: data?.installed === true,
      repoAccessible: data?.repoAccessible === true,
      configured: data?.configured === true,
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
