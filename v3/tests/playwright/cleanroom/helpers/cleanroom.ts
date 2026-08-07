import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MODEL_REGISTRY,
  vendorEnvSecretKeys,
} from "../../../../electron/model-registry";

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
  /**
   * 추가 env — BYOM(env-swap 벤더) 크레덴셜 주입용. **가짜 값만** 넣는다:
   * `checkSpawnAuthGate` 는 키의 **존재**만 보고(값은 스폰 env 조립 때나 쓰인다)
   * 이 하네스는 실제 스폰을 하지 않는다.
   * ※ `cleanEnv` 의 삭제 목록보다 나중에 적용되므로 여기 넣은 키는 살아남는다.
   */
  extraEnv?: Record<string, string>;
  /**
   * PATH 앞에 덧붙일 실제 디렉터리 — **라이브 CLI 가 필요한 시나리오 전용**.
   * (grok MCP 실기동 프로브는 진짜 `grok` 바이너리가 있어야 한다. userData/HOME
   * 격리는 그대로 유지하고 바이너리 해석 경로만 연다.)
   */
  extraPathDirs?: string[];
  /**
   * `orchestratorSession:launch` 가 이 차단 봉투를 돌려주게 한다(null 이면 스텁
   * 없음 = 진짜 핸들러).
   *
   * 오케 스폰 차단은 메인 프로세스의 **환경 판정**(CLI 인증·MCP 프로브)이라
   * 클린룸에서 임의의 사유를 재현할 수 없다. 여기서 보고 싶은 것은 그 판정이
   * 아니라 **차단이 화면에 뜨는가** 이므로, 봉투만 주입하고 렌더러가 그것을
   * 어떻게 다루는지를 본다.
   */
  orchestratorLaunchBlock?: {
    model: string;
    action: string;
    installed: boolean;
    reason?: string;
  } | null;
  /**
   * 비기너 셸(오케챗 하나만 있는 화면)로 부팅한다. 기본 false.
   *
   * ★왜 기본이 false 인가: 클린룸은 정의상 "마커가 하나도 없는 새 설치" 라
   * `lib/beginnerMode` 의 판정이 **비기너**로 떨어진다. 하지만 이 suite 의 기존
   * spec 들은 어드밴스드 온보딩 표면(시작하기 탭·CLI 배너·레거시 모달 위저드)의
   * 회귀 가드다 — 그 표면들은 지금도 살아 있고(기존 유저·승격한 유저의 경로),
   * 검증 대상도 그대로다. 그래서 하네스가 기본으로 비기너를 옵트아웃시켜
   * **기존 spec 의 의미를 보존**하고, 비기너 화면을 보고 싶은 spec 만 이 플래그를
   * 켠다. 설계: v3/docs/BEGINNER-MODE-DESIGN.md
   */
  beginnerShell?: boolean;
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
  /**
   * 메인 프로세스에서 `dist-electron/<module>` 의 export 를 **그대로** 부른다.
   *
   * 왜 필요한가: #638 스폰 게이트 / #639 grok MCP 게이트는 렌더러에서 보이지 않는
   * 메인 프로세스 판정이고, 그 판정의 입력(process.env 벤더 키·PATH·키체인)은
   * 이 클린룸이 만든 격리 환경이다. 유닛테스트는 같은 함수를 **다른 환경**에서
   * 부르므로 "이 환경에서 실제로 어떤 답이 나오나" 는 못 답한다. dist-electron 은
   * 번들이 아니라 모듈별 파일로 나오므로 require 캐시를 통해 앱이 로드한 것과
   * **같은 인스턴스**를 잡는다.
   */
  mainCall<T>(
    moduleFile: string,
    exportName: string,
    args: unknown[],
  ): Promise<T>;
  /**
   * 스텁되지 않은 **진짜** IPC 핸들러를 부른다(렌더러가 보는 것과 같은 payload).
   * 스텁된 채널이면 스텁이 아니라 원본을 부른다.
   */
  callRealIpc<T>(channel: string, payload: unknown): Promise<T>;
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

/**
 * 인증 상태를 새게 만드는 env 를 전부 제거한 launch env.
 *
 * ★벤더(env-swap) 크레덴셜도 지운다 — **레지스트리에서 파생**해서. 개발자 셸엔
 * `ZAI_API_KEY`·`MINIMAX_API_KEY` 같은 키가 실제로 살아 있고(이 맥 실측), 그게
 * 새면 "키가 없는 신규 유저" 시나리오가 성립하지 않는다(BYOM 게이트가 항상
 * 통과해 테스트가 vacuous 해진다). 목록을 손으로 적지 않으므로 레지스트리에
 * 벤더가 늘어도 이 격리는 저절로 따라간다.
 *
 * 삭제는 **extra 보다 먼저** 한다 — 시나리오가 명시적으로 넣은 키(BYOM 준비됨
 * 시나리오)는 살아남아야 하기 때문이다.
 */
function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  const vendorKeys = new Set(
    MODEL_REGISTRY.flatMap((m) => vendorEnvSecretKeys(m.id)),
  );
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
    ...vendorKeys,
  ]) {
    delete env[key];
  }
  return { ...env, ...extra };
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
      PATH: [
        bin,
        ...(scenario.extraPathDirs ?? []),
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ].join(path.delimiter),
      // 벤더 키(ZAI_API_KEY 등)는 cleanEnv 의 삭제 목록에 없으므로 그대로 산다.
      // 삭제 목록에 있는 키(ANTHROPIC_*/OPENAI_* …)는 여기 넣어도 지워진다 —
      // 그 축은 이 하네스가 일부러 닫아 둔 인증 누수 경로다.
      ...(scenario.extraEnv ?? {}),
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
          orchestratorLaunchBlock: {
            model: string;
            action: string;
            installed: boolean;
            reason?: string;
          } | null;
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
        orchestratorLaunchBlock: s.orchestratorLaunchBlock,
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

      // 오케 스폰이 막혔을 때의 봉투 — 렌더러가 이걸 화면에 어떻게 옮기는지가
      // 검증 대상이다(무음 차단 회귀 d44PLFhR).
      if (cr.orchestratorLaunchBlock) {
        rehandle("orchestratorSession:launch", () => ({
          sessionId: "",
          ptySessionId: "",
          status: "blocked",
          needsAuth: cr.orchestratorLaunchBlock,
        }));
      }

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
          "curl -fsSL https://claude.ai/install.sh | bash",
        ),
        codex: stateToProbe(
          scenario.codex ?? "missing",
          "curl -fsSL https://chatgpt.com/codex/install.sh | bash",
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
      orchestratorLaunchBlock: scenario.orchestratorLaunchBlock ?? null,
    },
  );

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  // 비기너 셸 옵트아웃 (기본). 셸 분기는 스토어의 모듈 평가 시점에 확정되므로
  // 시드 뒤 한 번 리로드해야 반영된다 — switchToLegacyLayout 과 같은 패턴이다.
  // `beginnerShell: true` 인 시나리오는 건드리지 않고 그대로 비기너로 부팅한다.
  if (!scenario.beginnerShell) {
    await page.evaluate(() => {
      localStorage.setItem(
        "marblo.beginnerMode",
        JSON.stringify({
          state: "advanced",
          enteredAt: 0,
          firstCompletionAt: 0,
          promotionShownAt: 0,
        }),
      );
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  }

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
    mainCall: <T>(moduleFile: string, exportName: string, args: unknown[]) =>
      app.evaluate(
        async (_electron, a) => {
          // evaluate 는 모듈 스코프가 아니라 `require` 도 `import()` 도 렉시컬로
          // 없다(각각 ReferenceError / "dynamic import callback was not
          // specified"). 남는 정직한 입구가 `process.getBuiltinModule`(Node 22+)
          // 이다 — 거기서 얻은 createRequire 는 **표준 CJS 캐시**를 타므로 앱이
          // 이미 로드한 모듈 인스턴스가 그대로 잡힌다(새 사본이 아니다).
          const nodeModule = (
            process as unknown as {
              getBuiltinModule?: (id: string) => {
                createRequire: (from: string) => (id: string) => unknown;
              };
            }
          ).getBuiltinModule?.("module");
          if (!nodeModule?.createRequire) {
            throw new Error(
              "process.getBuiltinModule('module') 을 못 얻었습니다 — 메인 프로세스 모듈 접근 불가",
            );
          }
          const mod = nodeModule.createRequire(a.file)(a.file) as Record<
            string,
            unknown
          >;
          const fn = mod[a.exportName];
          if (typeof fn !== "function") {
            throw new Error(`${a.file} 에 ${a.exportName} export 가 없습니다`);
          }
          return await (fn as (...x: unknown[]) => unknown)(...a.args);
        },
        {
          file: path.join(REPO_ROOT, "dist-electron", moduleFile),
          exportName,
          args,
        },
      ) as Promise<T>,
    callRealIpc: <T>(channel: string, payload: unknown) =>
      app.evaluate(
        async ({ ipcMain }, a) => {
          // 스텁으로 갈아끼운 채널이면 보관해 둔 원본을, 아니면 등록된 핸들러를.
          const originals = (
            globalThis as unknown as {
              __cleanroomOriginals?: Map<
                string,
                (e: unknown, p: unknown) => unknown
              >;
            }
          ).__cleanroomOriginals;
          const handler =
            originals?.get(a.channel) ??
            (
              ipcMain as unknown as {
                _invokeHandlers: Map<
                  string,
                  (e: unknown, p: unknown) => unknown
                >;
              }
            )._invokeHandlers?.get(a.channel);
          if (!handler) throw new Error(`IPC 핸들러 없음: ${a.channel}`);
          // 렌더러 event 대신 최소 stub — 이 하네스가 부르는 경로는 게이트에서
          // 되돌아오므로 event 를 만지지 않는다(만지면 여기서 바로 터진다).
          return await handler({ sender: { id: 1 } }, a.payload);
        },
        { channel, payload },
      ) as Promise<T>,
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

/** 최초실행 모달 통과 결과 — 단계 목록 + F5(모달 간 시차) 실측. */
export interface FirstRunModalPass {
  /** 통과한 단계 이름들 (퍼널 기록용). */
  passed: string[];
  /**
   * ★F5 지표 — 언어 선택을 확정한 시점부터 동의 모달이 뜨기까지의 ms.
   * 둘 중 하나라도 안 떴으면 null.
   *
   * 고침 전에는 이 값이 4~5초였다(동의가 auth uid → Firestore 읽기 뒤에 붙어
   * 있었다). 그 사이 화면은 조작 가능한 상태였고, 유저가 클릭을 시작한 뒤에
   * 두 번째 전면 오버레이가 떨어졌다. 지금은 같은 흐름 안에서 연속으로 뜬다.
   */
  gapMs: number | null;
  /** 첫 모달이 사라질 때까지 걸린 총 시간(ms) — 호출 시작 기준. */
  totalMs: number;
}

/**
 * 최초실행 모달들을 신규 유저가 하듯 통과시키고 시차를 실측한다. 이 함수가 하는
 * 클릭 하나하나가 신규 유저에게 요구되는 실제 단계다 — 늘어나면 그만큼 활성화
 * 마찰이다.
 *
 * 최초실행 모달은 한 흐름(FirstRunFlow) 안에서 순차로 뜬다:
 *   ① 언어 선택 (LanguageFirstRun)
 *   ② 개인정보/텔레메트리 동의 (PrivacyConsentModal) — ①을 닫는 같은 커밋에서
 *      렌더된다. 로그인·Firestore 를 기다리지 않는다(F5 수정).
 * 둘 다 전면 오버레이(fixed inset-0)라 안 닫으면 이후 모든 클릭이 막힌다.
 */
export async function passFirstRunModalsTimed(
  page: Page,
): Promise<FirstRunModalPass> {
  const startedAt = Date.now();
  const passed: string[] = [];
  // 아무 모달도 안 뜨는 상태(=재시작 런)에서 오래 붙잡히지 않도록, 마지막
  // 동작 이후 조용하면 끝낸다. 동의가 네트워크 뒤에 붙어 있던 시절엔 12초가
  // 필요했지만(부팅 후 ~8-12초), 이제 ①과 같은 틱에 뜨므로 5초면 충분하다.
  const QUIET_MS = 5_000;
  let deadline = Date.now() + QUIET_MS;
  let langAt: number | null = null;
  let consentAt: number | null = null;

  while (Date.now() < deadline) {
    // 각 단계는 한 번씩만 처리한다 — click 직후 재렌더 전에 루프가 한 바퀴 더
    // 돌면 같은 버튼을 두 번 눌러 단계가 중복 기록될 수 있다.
    if (!passed.includes("language")) {
      const lang = page
        .getByRole("button", { name: "계속", exact: true })
        .first();
      if (await lang.isVisible().catch(() => false)) {
        await lang.click().catch(() => {});
        langAt = Date.now();
        passed.push("language");
        deadline = Date.now() + QUIET_MS;
        continue;
      }
    }
    // 정확 일치 — "나중에 설정하기" 같은 다른 버튼과 헷갈리면 모달이 안 닫힌다.
    const consent = page
      .getByRole("button", { name: "나중에", exact: true })
      .first();
    if (await consent.isVisible().catch(() => false)) {
      consentAt = Date.now();
      await consent.click().catch(() => {});
      passed.push("privacy-consent");
      // 동의까지 닫았으면 더 기다릴 이유가 없다.
      await page.waitForTimeout(500);
      break;
    }
    // 100ms 폴링 — 측정 대상이 "두 모달 사이의 시차" 자체라 폴링 간격이
    // 그대로 측정 오차가 된다.
    await page.waitForTimeout(100);
  }

  return {
    passed,
    gapMs: langAt !== null && consentAt !== null ? consentAt - langAt : null,
    totalMs: Date.now() - startedAt,
  };
}

/**
 * `passFirstRunModalsTimed` 의 단계 목록만 필요한 호출부용 얇은 래퍼.
 * @returns 통과한 단계 이름들
 */
export async function passFirstRunModals(page: Page): Promise<string[]> {
  return (await passFirstRunModalsTimed(page)).passed;
}

/**
 * 앱 셸이 실제로 뜰 때까지(BrandLoader 가 사라질 때까지) 기다린다.
 *
 * ★F5 수정 이후 필요해진 대기다. 예전엔 동의 모달이 부팅 뒤에 붙어 있어서
 * "모달을 다 닫았다 = 셸이 이미 떴다" 였다. 지금은 모달이 부팅보다 먼저
 * 끝나므로(실측 ~0.7s vs 부팅 ~5s), 고정 대기로 관측하면 아직 로더인 화면을
 * 보게 된다. 부팅 시간 자체가 줄어든 건 아니다 — 유저가 그 시간을 **모달에
 * 가로막힌 채**가 아니라 로더를 보며 기다린다는 것이 달라진 점이다.
 *
 * @returns 제한시간 안에 셸이 떴는가
 */
export async function waitForAppShell(
  page: Page,
  timeoutMs = 30_000,
): Promise<boolean> {
  const LOADER = /불러오는 중|로딩 중|Loading projects|Loading\.\.\./;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    // 빈 문자열 = 아직 렌더 전. 로더 문구가 사라진 시점이 셸 등장이다.
    if (text.trim() && !LOADER.test(text)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * 온보딩 진행상태에서 "완료로 찍힌 단계" 목록(`marblo.onboarding.progress.done`).
 *
 * 활성화 검증의 핵심 축이다 — 화면 문구보다 이쪽이 정직하다. F3(#635)의 계약이
 * 여기 걸린다: 전달되지 않은 첫 티켓을 완료로 찍으면 유저는 아무 일도 안 일어난
 * 화면을 온보딩 종료로 읽는다.
 */
export async function doneSteps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("marblo.onboarding.progress");
      const parsed = raw ? (JSON.parse(raw) as { done?: string[] }) : {};
      return parsed.done ?? [];
    } catch {
      return [];
    }
  });
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
 * ※ 제목 문자열이 아니라 testid 로 잡는다: 제목은 이제 단계별로 달라진다(F2
 *   수정). 문구로 잡으면 "제목이 바뀌었다"를 "배너가 사라졌다"로 오독한다.
 */
export async function bannerVisible(page: Page): Promise<boolean> {
  return page
    .getByTestId("cli-setup-banner")
    .first()
    .isVisible()
    .catch(() => false);
}

/** 배너 제목의 실제 문구 — 제목이 상황과 맞는지(F2) 확인용. 없으면 null. */
export async function bannerTitle(page: Page): Promise<string | null> {
  const el = page.getByTestId("cli-setup-banner-title").first();
  if (!(await el.isVisible().catch(() => false))) return null;
  return (await el.textContent())?.trim() ?? null;
}

/** 배너의 ✕(닫기 = 다시 띄우지 않기). 배너가 없으면 조용히 통과. */
export async function dismissBanner(page: Page): Promise<void> {
  const x = page.getByTestId("cli-setup-banner-dismiss").first();
  if (await x.isVisible().catch(() => false)) {
    await x.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

/** 워크스페이스 셸의 우측 탭 전환 (라벨 = WorkTabs 의 i18n 라벨). */
export async function openWorkTab(page: Page, label: string): Promise<void> {
  // 탭은 셸에만 있다. 예전엔 동의 모달이 부팅 뒤에 떠서 "모달을 닫았다"가
  // 곧 "셸이 떴다"였지만(F5), 이제 모달이 먼저 끝나므로 명시적으로 기다린다.
  await waitForAppShell(page);
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
 * 어드밴스드 셸의 보드 탭을 연다.
 *
 * 라벨이 두 벌인 이유: 워크스페이스 셸의 WorkTabs 는 i18n 라벨("보드")이고,
 * 옵트아웃 경로인 레거시 Layout 의 TabBar 는 하드코딩 영문("Board")이다. 진입판정
 * 회귀가드는 두 경로를 다 지나므로(workspaceMode.enabled="0" 마커가 레거시로
 * 떨어뜨린다) 어느 쪽이 떠 있든 보드에 닿아야 한다.
 */
export async function openBoardTab(page: Page): Promise<void> {
  await waitForAppShell(page);
  for (const label of ["보드", "Board"]) {
    const tab = page.locator(`button:has-text("${label}")`).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click().catch(() => {});
      await page.waitForTimeout(400);
      return;
    }
  }
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
  // 셸이 뜨기 전에 넣으면 부팅 중 projects 하이드레이션이 currentProject 를
  // 도로 비운다 — 폴더 미연결로 보여 ④단계 버튼이 disabled 로 남는다.
  await waitForAppShell(page);
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

// ── 비기너 모드 (설계: v3/docs/BEGINNER-MODE-DESIGN.md) ──────────────────────

/**
 * "이 설치는 처음이 아니다" 를 증명하는 localStorage 마커 →
 * `lib/beginnerMode.PriorInstallMarkers` 의 필드와 1:1.
 *
 * 키를 여기 다시 적는 것은 의도적이다. 앱 코드에서 import 하면 키 이름이 바뀔 때
 * 테스트도 같이 따라가 **판정이 조용히 죽는 회귀를 놓친다** — 이 표가 묻는 것은
 * "규칙이 어떤 키를 보기로 했는가" 가 아니라 "실제로 그 키가 깔린 프로필이
 * 어드밴스드로 떨어지는가" 다.
 */
export const PRIOR_INSTALL_MARKERS = {
  onboardingProgress: "marblo.onboarding.progress",
  workspaceTab: "marblo.workspaceSplit.activeTab",
  workspaceModeFlag: "marblo.workspaceMode.enabled",
  legacyGateDismissed: "marblo.cliSetupGateDismissed",
} as const;

export type PriorInstallMarkerName = keyof typeof PRIOR_INSTALL_MARKERS;

/**
 * 마커별로 실제 앱이 쓰는 모양의 값.
 *
 * ★`workspaceModeFlag: "0"` 이 이 표의 핵심 표본이다. 워크스페이스 셸을 **끈**
 * 유저의 값이 "0" 인데, 판정 규칙은 값이 아니라 **존재**만 본다(설계 §진입판정).
 * 값으로 읽는 구현으로 되돌아가면 "0" 이 falsy 라 그 유저가 비기너로 떨어지고,
 * 즉 보드를 쓰던 사람의 보드가 사라진다.
 */
const MARKER_VALUE: Record<PriorInstallMarkerName, string> = {
  onboardingProgress: JSON.stringify({ done: ["install"] }),
  workspaceTab: "board",
  workspaceModeFlag: "0",
  legacyGateDismissed: "1",
};

export const BEGINNER_MODE_LS_KEY = "marblo.beginnerMode";
export const COACHMARK_LS_KEY = "marblo.coachmark";

export interface BeginnerRecordView {
  /** 저장된 판정. 키가 아예 없으면 null. */
  state: "beginner" | "advanced" | null;
  enteredAt: number;
  firstCompletionAt: number;
  promotionShownAt: number;
}

/** 영속된 비기너 판정 레코드를 읽는다(화면 문구보다 이쪽이 정직하다). */
export async function readBeginnerRecord(
  page: Page,
): Promise<BeginnerRecordView> {
  return page.evaluate((key) => {
    const empty = {
      state: null as "beginner" | "advanced" | null,
      enteredAt: 0,
      firstCompletionAt: 0,
      promotionShownAt: 0,
    };
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return empty;
      const p = JSON.parse(raw) as Partial<BeginnerRecordViewShape>;
      return {
        state:
          p.state === "beginner" || p.state === "advanced" ? p.state : null,
        enteredAt: Number(p.enteredAt) || 0,
        firstCompletionAt: Number(p.firstCompletionAt) || 0,
        promotionShownAt: Number(p.promotionShownAt) || 0,
      };
    } catch {
      return empty;
    }
  }, BEGINNER_MODE_LS_KEY);
}

/** page.evaluate 안에서 쓰는 구조 타입(브라우저 컨텍스트로 넘어가지 않는다). */
interface BeginnerRecordViewShape {
  state: "beginner" | "advanced";
  enteredAt: number;
  firstCompletionAt: number;
  promotionShownAt: number;
}

/**
 * 진입판정을 **처음 상태로 되돌리고** 지정한 이전-사용 마커만 심은 뒤 재부팅한다.
 *
 * 판정은 스토어의 모듈 평가 시점에 한 번 확정되므로(첫 렌더 전에 셸이 정해져야
 * 깜빡임이 없다) 리로드가 곧 재부팅이다 — `switchToLegacyLayout` 과 같은 패턴.
 *
 * ★굳은 판정(`marblo.beginnerMode`)과 **모든** 마커를 먼저 지운다. 앱은 부팅하며
 * 스스로 마커를 쓰므로(셸이 활성 탭을 persist 한다), 지우지 않으면 두 번째
 * 조합부터는 "직전 런이 남긴 마커" 를 재는 셈이 되어 표 전체가 vacuous 해진다.
 */
export async function reseedBeginnerDecision(
  page: Page,
  markers: readonly PriorInstallMarkerName[],
): Promise<void> {
  const seed = markers.map((m) => [PRIOR_INSTALL_MARKERS[m], MARKER_VALUE[m]]);
  await page.evaluate(
    (arg) => {
      try {
        for (const key of arg.clear) localStorage.removeItem(key);
        for (const [key, value] of arg.seed) localStorage.setItem(key, value);
      } catch {
        /* 프라이빗 모드 — 이 하네스에선 일어나지 않는다 */
      }
    },
    {
      clear: [
        BEGINNER_MODE_LS_KEY,
        ...Object.values(PRIOR_INSTALL_MARKERS),
      ] as string[],
      seed,
    },
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}

/**
 * 비기너 셸이 떠 있는가.
 *
 * 상단바의 개발모드 전환 버튼을 지문으로 쓴다 — 연결 게이트·폴더 게이트·챗 어느
 * 국면에 있든 항상 그려지는 유일한 요소다(#857 이 추가한 상시 어포던스).
 */
export async function beginnerShellVisible(page: Page): Promise<boolean> {
  return page
    .getByTestId("beginner-go-advanced")
    .first()
    .isVisible()
    .catch(() => false);
}

/** 첫 실행 코치마크 투어가 떠 있는가. */
export async function beginnerTourVisible(page: Page): Promise<boolean> {
  return page
    .getByTestId("beginner-tour")
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * 투어가 떠 있으면 '다시 보지 않기' 로 치운다.
 *
 * 오버레이 자체는 `pointer-events-none` 이라 아래 화면을 막지 않지만, 카드는
 * `pointer-events-auto` 라 그 아래 버튼을 가릴 수 있다. 투어가 검증 대상이 아닌
 * spec 은 이걸로 먼저 치우고 시작한다.
 */
export async function dismissBeginnerTour(page: Page): Promise<boolean> {
  const never = page.getByTestId("beginner-tour-never").first();
  try {
    await never.waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    return false;
  }
  await never.click().catch(() => {});
  await page.waitForTimeout(300);
  return true;
}

export interface SeedTask {
  id: string;
  title: string;
  status: string;
}

export interface SeedAgent {
  id: string;
  name: string;
  status: string;
}

/**
 * 티켓을 taskStore 에 직접 넣는다 — 비기너 라이브 스트립의 유일한 데이터원.
 *
 * 진짜 티켓 생성은 Firestore 쓰기를 타는데 이 하네스는 bypassAuth mock 유저라
 * 거절된다. 두 번 쓰는 이유는 team-collaboration spec 과 같다: 구독이 늦게
 * 정착하면서 빈 스냅샷으로 덮을 수 있다.
 */
export async function injectTasks(
  page: Page,
  tasks: readonly SeedTask[],
): Promise<void> {
  const write = async () => {
    await page.evaluate((seed) => {
      const hatch = (
        window as unknown as {
          __marbloTest?: {
            stores: { task: { setState: (s: unknown) => void } };
          };
        }
      ).__marbloTest;
      if (!hatch) throw new Error("cleanroom test hatch is unavailable");
      hatch.stores.task.setState({
        tasks: seed.map((t) => ({
          id: t.id,
          projectId: "cleanroom-project",
          title: t.title,
          description: "",
          status: t.status,
          dependsOn: [],
          dependsOnCompleted: true,
          priority: 1,
          role: "test",
          claimedBy: null,
          claimedAt: null,
          scope: [],
          comment: "",
          prUrl: "",
          hasPmFeedback: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        loading: false,
      });
    }, tasks as SeedTask[]);
  };
  await write();
  await page.waitForTimeout(400);
  await write();
  await page.waitForTimeout(300);
}

/** 에이전트를 agentStore 에 직접 넣는다(미니 에이전트 뷰의 데이터원). */
export async function injectAgents(
  page: Page,
  agents: readonly SeedAgent[],
): Promise<void> {
  const write = async () => {
    await page.evaluate((seed) => {
      const hatch = (
        window as unknown as {
          __marbloTest?: {
            stores: { agent: { setState: (s: unknown) => void } };
          };
        }
      ).__marbloTest;
      if (!hatch) throw new Error("cleanroom test hatch is unavailable");
      hatch.stores.agent.setState({
        agents: seed.map((a) => ({
          id: a.id,
          projectId: "cleanroom-project",
          ownerId: "test-user-bypass",
          name: a.name,
          model: "claude",
          role: "test",
          status: a.status,
          currentTaskId: null,
          command: "claude",
          skillFile: "",
          createdAt: new Date(),
        })),
        loading: false,
        hydrated: true,
      });
    }, agents as SeedAgent[]);
  };
  await write();
  await page.waitForTimeout(400);
  await write();
  await page.waitForTimeout(300);
}
