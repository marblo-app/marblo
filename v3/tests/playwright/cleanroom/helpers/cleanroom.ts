import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * 클린룸(최초실행) 하네스 — 신규 유저가 앱을 "처음" 켠 상태를 이 맥에서
 * 재현한다. 활성화 퍼널(설치 → 인증 → PRD → 첫 티켓)의 두 게이트를 라이브
 * 검증하기 위한 것:
 *   - #579  codex 만 인증된 상태에서 온보딩 팝업이 영구 재노출되지 않는가
 *   - #580  4스텝 위저드의 마지막 "첫 티켓 만들기"가 실제로 오케스트레이터
 *           라우팅까지 도달하는가 (로컬 성공 오판이 아니라)
 *
 * ── 격리 (기존 사용자 상태 오염 금지) ────────────────────────────────────────
 *  1. `--user-data-dir=<tmp>` — localStorage(온보딩 dismissed 플래그·위저드
 *     진행상태·로케일)·세션·캐시가 전부 임시 디렉터리로. 실제 앱의
 *     ~/Library/Application Support/Marblo 를 절대 건드리지 않는다.
 *  2. `HOME=<tmp>/home` — harness-manager 의 CLAUDE_DIR/CODEX_DIR/GEMINI_DIR 과
 *     bundle-installer 의 ~/.claude 설치가 전부 임시 HOME 으로. os.homedir() 은
 *     POSIX 에서 $HOME 을 따르므로 main process 전체가 같이 격리된다.
 *  3. `PATH=<tmp>/bin:<최소 시스템 경로>` + 인증 관련 env 제거
 *     (ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY / GEMINI_API_KEY …).
 *     env 키 하나만 새어도 probeCliAuth 가 authenticated=true 를 돌려준다.
 *
 * ── 왜 IPC 를 스텁하는가 (★ 이 맥에서 진짜 probe 는 클린룸이 될 수 없다) ───
 * harness-manager.getEnrichedPathForDetection() 은 PATH 와 무관하게
 * `/opt/homebrew/bin`·`/usr/local/bin`·`/usr/bin` 을 **하드코딩**으로 덧붙이고,
 * claude 인증은 macOS 키체인(`security find-generic-password -s
 * "Claude Code-credentials"`)까지 본다. 즉 개발용 맥에서는 HOME/PATH 를 아무리
 * 갈아끼워도 "CLI 미설치 / 미인증" 상태를 만들 수 없다(→ 발견사항 F1).
 * 그래서 시나리오 축(설치/인증 조합)은 main process 의 IPC 핸들러를 교체해
 * 결정적으로 구동하고, 파일시스템·HOME 격리는 그대로 유지한다. 렌더러 →
 * preload → IPC 경로는 진짜 그대로다.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DIST_MAIN = path.join(REPO_ROOT, "dist-electron", "main.js");
const SHOT_DIR = path.join(REPO_ROOT, "test-results", "cleanroom");

/** CLI 한 줄의 상태. ready = 설치 + 인증 완료. */
export type CliStateName = "missing" | "installed" | "ready";

export interface CleanRoomScenario {
  claude?: CliStateName;
  codex?: CliStateName;
  grok?: CliStateName;
  antigravity?: CliStateName;
  /** harness:install(자동설치)이 성공하는지. node/npm 부재 시나리오는 false. */
  installSucceeds?: boolean;
  /** 자동설치 성공 시 어떤 상태가 되는지 (기본 installed — 인증은 아직). */
  installResultsIn?: CliStateName;
  /** orchestrator:injectMessage 가 delivered:true 를 돌려주는지. */
  orchestratorRunning?: boolean;
  /** 재시작 시나리오용 — 앞선 런의 root 를 그대로 재사용(=같은 userData/HOME). */
  reuseRoot?: string;
}

export interface InjectedMessage {
  projectId: string;
  message: string;
}

export interface CliProbeResult {
  installed: boolean;
  authenticated: boolean;
  action?: string;
}

export interface CleanRoom {
  app: ElectronApplication;
  page: Page;
  /** 클린룸 루트 (재시작 시 reuseRoot 로 넘기면 같은 상태로 재기동). */
  root: string;
  home: string;
  userData: string;
  /** 폴더 연결 시나리오에서 fs:selectDirectory 가 돌려줄 프로젝트 폴더. */
  projectDir: string;
  /** cliAuthCheck 호출 횟수 (재프로브가 실제로 돌았는지 확인용). */
  probeCalls(): Promise<number>;
  /** harness:install 로 요청된 row id 목록. */
  installCalls(): Promise<string[]>;
  /** orchestrator:injectMessage 로 실제 전달된 메시지들 (#580 의 증거). */
  injected(): Promise<InjectedMessage[]>;
  /** 스텁 없이 진짜 probeCliAuth — 클린룸 격리의 실효성 관측용(F1). */
  realProbe(model: "claude" | "codex"): Promise<CliProbeResult>;
  /** 시나리오 중간에 CLI 상태를 바꾼다(로그인 완료 흉내). */
  setCli(model: string, state: CliStateName): Promise<void>;
  /** 실패 지점 증거 — test-results/cleanroom/<name>.png */
  shot(name: string): Promise<string>;
  close(): Promise<void>;
}

function stateToProbe(state: CliStateName, action: string): CliProbeResult {
  if (state === "ready") return { installed: true, authenticated: true };
  if (state === "installed")
    return { installed: true, authenticated: false, action };
  return { installed: false, authenticated: false, action };
}

/** 임시 HOME 안에 실제 인증 파일을 깔아 둔다 — 진짜 probe 도 같은 답을 보도록. */
function seedHomeAuthState(home: string, scenario: CleanRoomScenario): void {
  fs.mkdirSync(home, { recursive: true });
  if (scenario.codex === "ready") {
    const dir = path.join(home, ".codex");
    fs.mkdirSync(dir, { recursive: true });
    // 실제 `codex login` 산출물과 같은 모양 (tokens 존재 = 로그인 완료).
    fs.writeFileSync(
      path.join(dir, "auth.json"),
      JSON.stringify({ tokens: { access_token: "cleanroom-fake" } }),
    );
  }
  if (scenario.claude === "ready") {
    const dir = path.join(home, ".claude");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "cleanroom-fake" } }),
    );
  }
}

/** PATH 위의 가짜 CLI 셸 스크립트 (probe 는 파일 존재만 본다). */
function seedFakeBinaries(bin: string, scenario: CleanRoomScenario): void {
  fs.mkdirSync(bin, { recursive: true });
  const write = (name: string) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/sh\necho "${name} 0.0.0-cleanroom"\n`);
    fs.chmodSync(p, 0o755);
  };
  if (scenario.claude && scenario.claude !== "missing") write("claude");
  if (scenario.codex && scenario.codex !== "missing") write("codex");
  if (scenario.grok && scenario.grok !== "missing") write("grok");
  if (scenario.antigravity && scenario.antigravity !== "missing") write("agy");
}

/** 인증 상태를 새게 만드는 env 를 전부 제거한 launch env. */
function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...extra,
  };
  for (const key of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "XAI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
  ]) {
    delete env[key];
  }
  return env;
}

export async function launchCleanRoom(
  scenario: CleanRoomScenario = {},
): Promise<CleanRoom> {
  if (!fs.existsSync(DIST_MAIN)) {
    throw new Error(
      `dist-electron/main.js 가 없습니다. 먼저 빌드하세요: cd ${REPO_ROOT} && npm run build`,
    );
  }

  const root =
    scenario.reuseRoot ??
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-cleanroom-"));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  const userData = path.join(root, "userData");
  const projectDir = path.join(root, "project");
  for (const d of [home, bin, userData, projectDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  seedHomeAuthState(home, scenario);
  seedFakeBinaries(bin, scenario);
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const app = await electron.launch({
    args: [
      DIST_MAIN,
      // ★ 온보딩 상태(localStorage)까지 진짜 first-run 으로 리셋되는 지점.
      `--user-data-dir=${userData}`,
    ],
    cwd: REPO_ROOT,
    env: cleanEnv({
      HOME: home,
      PATH: [bin, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(
        path.delimiter,
      ),
      MARBLO_TEST_MODE: "cleanroom",
      // 빌드 산출물 직접 launch → isDev 오판 방지 (helpers/launch.ts 와 동일).
      MARBLO_FORCE_PROD: "1",
      // Firebase 로그인 자체는 이 하네스의 검증 대상이 아니다(별도 수동 QA).
      MARBLO_TEST_BYPASS_AUTH: "1",
    }),
    timeout: 60_000,
  });

  // ── main process IPC 스텁 (시나리오 축) ──────────────────────────────────
  await app.evaluate(
    ({ ipcMain }, s) => {
      const g = globalThis as unknown as {
        __cleanroom?: {
          probeCalls: number;
          installCalls: string[];
          injected: Array<{ projectId: string; message: string }>;
          cli: Record<string, { installed: boolean; authenticated: boolean }>;
          installSucceeds: boolean;
          installResultsIn: { installed: boolean; authenticated: boolean };
          orchestratorRunning: boolean;
          projectDir: string;
        };
      };
      g.__cleanroom = {
        probeCalls: 0,
        installCalls: [],
        injected: [],
        cli: s.cli,
        installSucceeds: s.installSucceeds,
        installResultsIn: s.installResultsIn,
        orchestratorRunning: s.orchestratorRunning,
        projectDir: s.projectDir,
      };
      const cr = g.__cleanroom!;

      // Electron 은 handle() 로 넘긴 listener 를 _invokeHandlers 에 그대로
      // 보관한다. 교체 전에 원본을 붙잡아 두면 스텁을 우회한 "진짜" 핸들러를
      // 그대로 부를 수 있다 — realProbe(격리 누수 관측)가 이걸 쓴다.
      const invokeHandlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<string, (...a: unknown[]) => unknown>;
        }
      )._invokeHandlers;
      const originals = new Map<string, (...a: unknown[]) => unknown>();

      const rehandle = (
        channel: string,
        fn: (...args: unknown[]) => unknown,
      ) => {
        const orig = invokeHandlers?.get(channel);
        if (orig) originals.set(channel, orig);
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_e: unknown, ...args: unknown[]) =>
          fn(...args),
        );
      };
      (
        globalThis as unknown as {
          __cleanroomOriginals?: Map<string, (...a: unknown[]) => unknown>;
        }
      ).__cleanroomOriginals = originals;

      // 설치/인증 상태 — 이 하나가 위저드 전체의 게이트다.
      rehandle("harness:cliAuthCheck", (payload) => {
        cr.probeCalls += 1;
        const model = (payload as { model: string }).model;
        return (
          cr.cli[model] ?? {
            installed: false,
            authenticated: false,
            action: "unknown",
          }
        );
      });

      // 자동설치 — node/npm 부재 시나리오는 여기서 실패한다.
      rehandle("harness:install", (id) => {
        cr.installCalls.push(String(id));
        if (!cr.installSucceeds) {
          return {
            success: false,
            error: "npm 을 찾을 수 없습니다 (cleanroom: node 미설치 시나리오)",
          };
        }
        const model = String(id).includes("codex")
          ? "codex"
          : String(id).includes("claude")
            ? "claude"
            : String(id).includes("grok")
              ? "grok"
              : "antigravity";
        cr.cli[model] = { ...cr.installResultsIn };
        return { success: true };
      });

      // 버전 조회는 npm 네트워크 호출 → 클린룸에선 무의미하니 비운다.
      rehandle("harness:versions", () => ({}));

      // 폴더 선택 다이얼로그(네이티브)는 자동화 불가 → 임시 프로젝트 폴더 반환.
      rehandle("fs:selectDirectory", () => cr.projectDir);

      // ★ #580 의 증거 지점: 위저드 마지막 버튼이 여기까지 오는지.
      rehandle("orchestrator:injectMessage", (payload) => {
        const p = payload as { projectId: string; message: string };
        cr.injected.push({ projectId: p.projectId, message: p.message });
        return cr.orchestratorRunning
          ? { delivered: true }
          : { delivered: false, reason: "no-local-orchestrator" };
      });
    },
    {
      cli: {
        claude: stateToProbe(
          scenario.claude ?? "missing",
          "npm install -g @anthropic-ai/claude-code",
        ),
        codex: stateToProbe(
          scenario.codex ?? "missing",
          "npm install -g @openai/codex",
        ),
        grok: stateToProbe(
          scenario.grok ?? "missing",
          "curl -fsSL https://x.ai/cli/install.sh | bash",
        ),
        antigravity: stateToProbe(
          scenario.antigravity ?? "missing",
          "curl -fsSL https://antigravity.google/cli/install.sh | bash",
        ),
      },
      installSucceeds: scenario.installSucceeds ?? false,
      installResultsIn: stateToProbe(
        scenario.installResultsIn ?? "installed",
        "login",
      ),
      orchestratorRunning: scenario.orchestratorRunning ?? false,
      projectDir,
    },
  );

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  return {
    app,
    page,
    root,
    home,
    userData,
    projectDir,
    probeCalls: () =>
      app.evaluate(
        () =>
          (globalThis as unknown as { __cleanroom: { probeCalls: number } })
            .__cleanroom.probeCalls,
      ),
    installCalls: () =>
      app.evaluate(
        () =>
          (globalThis as unknown as { __cleanroom: { installCalls: string[] } })
            .__cleanroom.installCalls,
      ),
    injected: () =>
      app.evaluate(
        () =>
          (
            globalThis as unknown as {
              __cleanroom: { injected: InjectedMessage[] };
            }
          ).__cleanroom.injected,
      ),
    realProbe: (model) =>
      app.evaluate(async (_electron, m) => {
        // 스텁을 우회해 진짜 harness:cliAuthCheck(=probeCliAuth) 를 부른다 —
        // 클린룸 격리가 실제로 먹히는지(하드코딩 PATH·키체인 누수) 관측용.
        const orig = (
          globalThis as unknown as {
            __cleanroomOriginals: Map<
              string,
              (e: unknown, p: unknown) => Promise<CliProbeResult>
            >;
          }
        ).__cleanroomOriginals.get("harness:cliAuthCheck");
        if (!orig) throw new Error("원본 cliAuthCheck 핸들러를 못 잡았습니다");
        return orig(null, { model: m });
      }, model) as Promise<CliProbeResult>,
    setCli: async (model, state) => {
      await app.evaluate(
        (_electron, arg) => {
          const cr = (
            globalThis as unknown as {
              __cleanroom: {
                cli: Record<
                  string,
                  { installed: boolean; authenticated: boolean }
                >;
              };
            }
          ).__cleanroom;
          cr.cli[arg.model] = arg.probe;
        },
        { model, probe: stateToProbe(state, "login") },
      );
    },
    shot: async (name) => {
      const file = path.join(SHOT_DIR, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      return file;
    },
    close: async () => {
      try {
        await app.close();
      } catch {
        /* 이미 닫혔으면 무시 */
      }
    },
  };
}

/**
 * 최초실행 모달들을 신규 유저가 하듯 통과시킨다. 이 함수가 하는 클릭 하나하나가
 * 신규 유저에게 요구되는 실제 단계다 — 늘어나면 그만큼 활성화 마찰이다.
 * @returns 통과한 단계 이름들 (퍼널 기록용)
 */
export async function passFirstRunModals(page: Page): Promise<string[]> {
  const passed: string[] = [];
  // 아무 모달도 안 뜨는 상태(=재시작 런)에서 오래 붙잡히지 않도록, 마지막
  // 동작 이후 12초간 조용하면 끝낸다. 동의 모달은 부팅 후 ~8-12초에 뜬다.
  const QUIET_MS = 12_000;
  let deadline = Date.now() + QUIET_MS;

  // 최초실행 모달은 순차·비동기로 뜬다:
  //   ① 언어 선택 (LanguageFirstRun) — 클린 userData 면 즉시
  //   ② 개인정보/텔레메트리 동의 (PrivacyConsentModal) — auth user uid 를
  //      받은 뒤에야 판정하므로 부팅 후 수 초 뒤. 한 번의 짧은 대기로는 놓친다.
  // 둘 다 전면 오버레이(fixed inset-0)라 안 닫으면 이후 모든 클릭이 막힌다.
  while (Date.now() < deadline) {
    const lang = page
      .getByRole("button", { name: "계속", exact: true })
      .first();
    if (await lang.isVisible().catch(() => false)) {
      await lang.click().catch(() => {});
      passed.push("language");
      deadline = Date.now() + QUIET_MS;
      await page.waitForTimeout(500);
      continue;
    }
    // 정확 일치 — "나중에 설정하기" 같은 다른 버튼과 헷갈리면 모달이 안 닫힌다.
    const consent = page
      .getByRole("button", { name: "나중에", exact: true })
      .first();
    if (await consent.isVisible().catch(() => false)) {
      await consent.click().catch(() => {});
      passed.push("privacy-consent");
      // 동의까지 닫았으면 더 기다릴 이유가 없다.
      await page.waitForTimeout(800);
      break;
    }
    await page.waitForTimeout(500);
  }

  return passed;
}

/** 레거시 모달 위저드가 현재 떠 있는지 (제목 = 스텝별 h2). */
export async function wizardVisible(page: Page): Promise<boolean> {
  const titles = [
    "① CLI 설치",
    "② 로그인(인증)",
    "③ 샘플 PRD",
    "④ 첫 티켓 만들기",
  ];
  for (const t of titles) {
    if (await page.locator(`h2:has-text("${t}")`).first().isVisible()) {
      return true;
    }
  }
  return false;
}

/**
 * 워크스페이스 셸(기본 ON)의 비차단 배너 — 모달의 대체물. 이게 계속 뜨면
 * 셸에서의 "온보딩 팝업 영구노출"에 해당한다.
 * ※ 시작하기 탭에 서 있으면 배너는 의도적으로 숨는다(CliSetupHost) — 배너를
 *   관측하려면 다른 탭으로 옮긴 뒤 봐야 한다.
 */
export async function bannerVisible(page: Page): Promise<boolean> {
  return page
    .locator('text="CLI 인증이 필요합니다"')
    .first()
    .isVisible()
    .catch(() => false);
}

/** 워크스페이스 셸의 우측 탭 전환 (라벨 = WorkTabs 의 i18n 라벨). */
export async function openWorkTab(page: Page, label: string): Promise<void> {
  await page.locator(`button:has-text("${label}")`).first().click();
  await page.waitForTimeout(400);
}

/**
 * 레거시 Layout(모달 위저드) 경로로 전환. workspaceMode 는 기본 ON 이라
 * 신규 유저의 기본 화면은 셸이지만, 옵트아웃한 유저는 여전히 모달을 본다 —
 * #579 의 원래 무대라 두 경로 모두 검증한다.
 */
export async function switchToLegacyLayout(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem("marblo.workspaceMode.enabled", "0");
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}

/**
 * 프로젝트 연결 상태를 주입한다. 진짜 폴더 연결은 Firestore createProject
 * 쓰기를 타므로(bypassAuth mock 유저로는 통과 못 함) 스토어에 직접 넣는다 —
 * 위저드 이후 단계(PRD/첫 티켓)의 게이트는 `currentProject.folderPath` 하나다.
 */
export async function injectProject(
  page: Page,
  folderPath: string,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const tw = (
        window as unknown as {
          __marbloTest?: { stores?: { project?: unknown } };
        }
      ).__marbloTest;
      return !!tw?.stores?.project;
    },
    null,
    { timeout: 15_000 },
  );
  await page.evaluate((folder) => {
    const tw = (
      window as unknown as {
        __marbloTest: {
          stores: {
            project: {
              getState: () => { setCurrentProject: (p: unknown) => void };
            };
          };
        };
      }
    ).__marbloTest;
    tw.stores.project.getState().setCurrentProject({
      id: "cleanroom-project",
      name: "cleanroom",
      ownerId: "test-user-bypass",
      members: ["test-user-bypass"],
      folderPath: folder,
      enabledModels: ["claude"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, folderPath);
}
