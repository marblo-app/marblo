import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

/**
 * Marblo Electron 앱을 띄우는 공용 helper.
 *
 * 전략 A (production build): build 산출물을 직접 launch — 안정적, CI 친화.
 * 전략 B (dev mode): vite + electron 동시 — 빠른 반복용, race condition 관리 필요.
 *
 * 환경변수:
 *   MARBLO_TEST_BUILD = "prod" | "dev"  (기본 prod)
 *   MARBLO_TEST_BUILD_SKIP = "1"        — 이미 빌드된 dist 재사용
 *
 * 첫 호출 시 자동 빌드 수행. Tier 1 unit + Tier 2 mocked 가 공유.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DIST_MAIN = path.join(REPO_ROOT, "dist-electron", "main.js");

export interface LaunchOptions {
  /** 추가 환경변수. ANTHROPIC_API_KEY 등 mock 키 주입에 사용. */
  env?: Record<string, string>;
  /** Electron CLI args 추가. 보통 비워둠. */
  args?: string[];
  /** Mock 모드 — Firestore/LLM 호출을 fixture 가 stub 한다는 신호 */
  mock?: boolean;
  /**
   * missionService 를 Firestore 대신 in-memory 백엔드로 — 결정적 미션탭 E2E.
   * preload 가 MARBLO_TEST_MISSIONS_INMEM=1 을 testMode.missionsInMemory 로
   * 노출하고, missionService 가 그 플래그를 보고 분기한다.
   */
  missionsInMem?: boolean;
  /**
   * Firebase Auth 게이트 우회 (기본 true). preload 가
   * MARBLO_TEST_BYPASS_AUTH=1 을 보고 mock user 를 주입한다. 인증 흐름 자체를
   * 테스트하는 spec 만 false 로 끄면 된다.
   */
  bypassAuth?: boolean;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

async function ensureBuilt(): Promise<void> {
  if (process.env.MARBLO_TEST_BUILD_SKIP === "1") return;
  if (fs.existsSync(DIST_MAIN)) return;
  // Electron tsc + vite build. tests/playwright/README.md 안내.
  throw new Error(
    `Electron main.js 가 없습니다. 먼저 빌드하세요: cd ${REPO_ROOT} && npm run build`,
  );
}

/** 마블로 Electron 앱을 launch. 호출자는 close() 보장 필요. */
export async function launchMarblo(
  opts: LaunchOptions = {},
): Promise<LaunchedApp> {
  await ensureBuilt();

  const bypassAuth = opts.bypassAuth ?? true;
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    // Mock 모드 시그널 — main process 에서 의존성 lazy/stub 선택 시 참고.
    MARBLO_TEST_MODE: opts.mock ? "mock" : "prod",
    // 빌드 산출물(dist-electron/main.js)을 직접 launch 하면 app.isPackaged=false →
    // main.ts 의 isDev 가 true 로 평가돼 vite dev 서버(localhost:5173)를 로드하려다
    // 실패한다(테스트 중엔 dev 서버 미실행). FORCE_PROD=1 로 내장 http 정적
    // 서버(dist/)에서 로드하게 강제 — production build 전략(전략 A)의 전제.
    MARBLO_FORCE_PROD: "1",
    // Firebase Auth 우회 — preload 가 이 env 를 보고 testMode.bypassAuth 노출.
    ...(bypassAuth ? { MARBLO_TEST_BYPASS_AUTH: "1" } : {}),
    // missionService in-memory 백엔드 — preload 가 testMode.missionsInMemory 노출.
    ...(opts.missionsInMem ? { MARBLO_TEST_MISSIONS_INMEM: "1" } : {}),
    // BYOK 키 없이 부팅 가능하도록 빈 슬롯 보장 (이미 LLM lazy init 패치 적용됨)
    ...opts.env,
  };

  const app = await electron.launch({
    args: [DIST_MAIN, ...(opts.args ?? [])],
    cwd: REPO_ROOT,
    env,
    // 헤드리스가 기본. 디버그는 PWDEBUG=1 / --headed.
    timeout: 30_000,
  });

  // 첫 번째 BrowserWindow = mainWindow 가 띄워질 때까지 대기.
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  return {
    app,
    page,
    close: async () => {
      try {
        await app.close();
      } catch {
        /* 이미 닫혔으면 무시 */
      }
    },
  };
}
