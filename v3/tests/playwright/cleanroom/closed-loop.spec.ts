/**
 * 폐루프 클린룸 E2E — 마블로봇 → 오케브레인 한 바퀴 (티켓 ze7wa88AtFheuQ2ApSOU).
 *
 * ## 무엇을 재는가
 * 사장님 요청이 들어가 오케브레인(work chain)에 남고, 보드 사실로 상태가 굴러
 * 완료보고가 오케 PTY 까지 **돌아오는지** — 그 한 바퀴를 마디로 끊어 단언한다.
 * 통과/실패가 아니라 **어느 마디에서 끊겼는지**가 이 스펙의 산출물이다.
 *
 *   M0 격리          — userData·HOME 이 클린룸이고 사장님 실사용 상태가 안 변한다
 *   M1 요청 투입      — 마블로봇 표면이 열리고 요청을 받을 자리가 있다
 *   M2 마블로봇 수신  — 그 요청이 프로젝트 설정 쓰기까지 실제로 도달한다
 *   M3 체인 생성      — 오케브레인에 항목이 생겨 화면에 그려진다
 *   M4 상태 전이      — 대기 → 준비 → 완료가 **보드 티켓 status 로** 파생된다
 *   M5 완료보고 도달  — 그 완료가 오케 PTY 로 다시 주입된다(재동기화 스위프)
 *
 * ## 왜 마디마다 이름을 붙였나
 * "루프 실패" 는 답이 아니다. `segment()` 가 실패를 감싸 `★루프 마디 [M4 …]
 * 에서 끊겼습니다` 로 다시 던지므로, CI 로그 한 줄이 곧 끊긴 지점이다.
 *
 * ## 하네스
 * 새 하네스를 만들지 않는다 — `helpers/cleanroom.ts` 의 launchCleanRoom ·
 * passFirstRunModals · waitForAppShell 을 그대로 쓰고, `marblo-bots-triggers.
 * spec.ts` 와 겹치는 프로젝트 주입은 같은 모양으로 재사용한다. 새로 덧댄 것은
 * 루프 연결부(M3·M4·M5)뿐이다.
 *
 * ## ★M5 는 렌더러가 아니라 메인 프로세스에서 잰다
 * 완료보고 경로(`OrchestratorBoardResync`)는 렌더러에 없다. `cr.injected()` 가
 * 잡는 것은 IPC 채널 `orchestrator:injectMessage`(렌더러→메인)이고, 스위프는
 * 그 채널이 아니라 `OrchestratorManager.injectMessage` 를 직접 부른다. 그래서
 * M5 는 `app.evaluate` 로 **메인 프로세스 안에서 빌드 산출물
 * `dist-electron/orchestrator-board-resync.js` 의 진짜 클래스**를 DI 로 돌린다.
 * 유닛 테스트와 다른 점: 여기서 도는 것은 소스가 아니라 실제로 앱에 실려 나가는
 * 번들이다.
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  launchCleanRoom,
  passFirstRunModals,
  waitForAppShell,
  type CleanRoom,
} from "./helpers/cleanroom";

/** 루프 마디 이름 — 실패 메시지가 이 문자열로 지점을 특정한다. */
const M = {
  isolation: "M0 격리(userData·HOME)",
  intake: "M1 요청 투입(마블로봇 표면)",
  received: "M2 마블로봇 수신(설정 쓰기 도달)",
  chain: "M3 오케브레인 체인 생성",
  transition: "M4 상태 전이(대기→준비→완료)",
  report: "M5 완료보고 도달(오케 PTY 주입)",
} as const;

/**
 * 화면을 덮고 있는 오버레이의 정체. 클린룸에서 클릭이 막히는 사고는 거의 전부
 * "무엇인지 모르는 전면 모달" 이었으므로, 마디가 끊길 때 이것부터 남긴다.
 */
async function describeOverlays(page: Page): Promise<string> {
  try {
    const nodes = await page.locator("div.fixed.inset-0").all();
    const lines: string[] = [];
    for (const node of nodes) {
      if (!(await node.isVisible().catch(() => false))) continue;
      const text = (await node.innerText().catch(() => "")).trim();
      lines.push(`  · 오버레이: ${text.slice(0, 300).replace(/\n+/g, " / ")}`);
    }
    return lines.length
      ? `\n[화면을 덮고 있던 것]\n${lines.join("\n")}`
      : "\n[화면을 덮고 있던 것] 없음";
  } catch {
    return "";
  }
}

/**
 * 루프와 무관한 전면 모달을 치운다.
 *
 * 클린룸의 mock 유저는 무료 플랜이라, 프로젝트를 주입하면 **"업그레이드 필요 —
 * 프로젝트 추가 기능은 Pro 플랜부터"** 페이월이 `fixed inset-0 z-50` 로 덮인다
 * (실측: 이것이 M2 의 탭 클릭을 30초 내내 가로챘다). 폐루프와 아무 상관이 없는
 * 표면이므로 닫고 간다 — 다만 **닫았다는 사실은 로그로 남긴다.** 조용히 지나가면
 * 다음 사람이 같은 30초를 다시 태운다.
 */
async function dismissUpgradeModal(page: Page): Promise<boolean> {
  const close = page
    .locator("div.fixed.inset-0")
    .getByRole("button", { name: "닫기", exact: true })
    .first();
  if (!(await close.isVisible().catch(() => false))) return false;
  await close.click().catch(() => {});
  await page.waitForTimeout(300);
  console.log(
    "[closed-loop] 업그레이드 페이월 모달을 닫았습니다(루프와 무관).",
  );
  return true;
}

/**
 * 마디 하나를 감싼다. 안에서 터진 것은 마디 이름을 붙여 다시 던진다 —
 * "루프가 실패했다" 가 아니라 "어느 마디가 끊겼다" 가 남아야 한다.
 * 끊긴 순간의 오버레이와 스크린샷도 같이 남긴다(원인 추적용).
 */
async function segment<T>(
  name: string,
  cr: CleanRoom,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const overlays = await describeOverlays(cr.page);
    const shot = await cr
      .shot(`closed-loop-broke-${name.slice(0, 2)}`)
      .catch(() => "(스크린샷 실패)");
    throw new Error(
      `★루프 마디 [${name}] 에서 끊겼습니다:\n${detail}${overlays}\n[스크린샷] ${shot}`,
    );
  }
}

/** 사장님 실사용 상태 — 클린룸이 절대 건드리면 안 되는 경로. */
const LIVE_STATE_PATHS = [
  path.join(os.homedir(), "Library", "Application Support", "marblo-v3"),
  path.join(os.homedir(), ".marblo", "app-state.json"),
];

/** 있으면 mtime, 없으면 null(없는 것도 사실이므로 그대로 비교한다). */
function stateFingerprint(): Array<string | null> {
  return LIVE_STATE_PATHS.map((p) => {
    try {
      return String(fs.statSync(p).mtimeMs);
    } catch {
      return null;
    }
  });
}

// ── 루프에 태울 고정 사실 ──────────────────────────────────────────────────
// 체인 항목 하나가 티켓 하나를 근거로 물고, 그 티켓의 보드 status 가 굴러야
// 항목이 대기 → 준비 → 완료로 파생된다. 이 값들이 M3·M4 의 입력이다.
const PROJECT_ID = "cleanroom-closed-loop-project";
const LEAD_TASK = "closed-loop-lead"; // 선행 티켓 — DONE 이 되어야 항목이 준비됨
const WORK_TASK = "closed-loop-work"; // 근거 티켓 — DONE 이 되어야 항목이 완료
const CHAIN_ITEM = "closed-loop-item";
const CHAIN_WHAT = "폐루프 검증 항목";

/**
 * 마블로봇 트리거 스펙과 같은 모양의 프로젝트 주입 + 워크체인 해치 설치.
 * `subscribeWorkChain` 은 `window.__marbloTest.workChain.subscribe` 가 있으면
 * Firestore 대신 그것을 탄다(workChainService.ts:53-61) — 클린룸은 로그인이
 * 없어 Firestore 를 못 타므로 이 해치가 유일한 정직한 입구다.
 */
/**
 * 창을 넓힌다. 셸은 `bodyWidth < NARROW_BREAKPOINT(880)` 이면 터미널 열을
 * 자동으로 접고(splitWorkspaceLayout.ts:382), 접히면 오케 패널이 안 실려
 * WorkChainPanel 도 사라진다 — M3 가 "화면이 좁아서" 끊기는 것을 막는다.
 */
async function widenWindow(cr: CleanRoom): Promise<void> {
  await cr.app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.setSize(1600, 1000);
  });
  await cr.page.waitForTimeout(300);
}

async function installLoopHarness(page: Page): Promise<void> {
  await waitForAppShell(page);
  await page.waitForFunction(
    () => {
      const hatch = (
        window as unknown as {
          __marbloTest?: { stores?: { project?: unknown } };
        }
      ).__marbloTest;
      return Boolean(hatch?.stores?.project);
    },
    null,
    { timeout: 15_000 },
  );

  await page.evaluate(
    (fixed) => {
      const win = window as unknown as {
        __marbloLoopE2E?: {
          saves: Array<{ id: string; data: Record<string, unknown> }>;
          pushChain: (items: unknown[]) => void;
        };
        __marbloTest: {
          workChain?: unknown;
          botDefinitions?: unknown;
          stores: Record<
            string,
            {
              setState: (partial: Record<string, unknown>) => void;
              getState: () => Record<string, unknown>;
            }
          >;
        };
        electronAPI?: {
          drive?: { status?: () => Promise<{ scopes: string[] }> };
          slackChannel?: { status?: (p: string) => Promise<unknown> };
          telegramChannel?: { status?: (p: string) => Promise<unknown> };
        };
      };

      // ① 워크체인 해치 — 스펙이 항목을 밀어 넣고 화면이 그것을 그린다.
      let emit: ((value: unknown) => void) | null = null;
      let latest: unknown[] = [];
      win.__marbloTest.workChain = {
        subscribe: (_projectId: string, callback: (value: unknown) => void) => {
          emit = callback;
          callback({
            kind: "data",
            snapshot: {
              projectId: fixed.projectId,
              exists: true,
              rev: 1,
              items: latest,
            },
          });
          return () => {
            emit = null;
          };
        },
      };

      win.__marbloLoopE2E = {
        saves: [],
        pushChain: (items: unknown[]) => {
          latest = items;
          emit?.({
            kind: "data",
            snapshot: {
              projectId: fixed.projectId,
              exists: true,
              rev: 2,
              items,
            },
          });
        },
      };

      // ② 마블로봇 갤러리가 Firestore 없이 뜨도록 — 트리거 스펙과 같은 스텁.
      const savedBots: Array<Record<string, unknown>> = [];
      win.__marbloTest.botDefinitions = {
        create: async () => `bot-${savedBots.length + 1}`,
        upsertSeed: async (draft: Record<string, unknown>) => {
          const id = `${draft.projectId}_${draft.seedId}`;
          savedBots.push({ ...draft, id });
          return id;
        },
        subscribe: (_p: string, cb: (bots: unknown[]) => void) => {
          cb([...savedBots]);
          return () => {};
        },
      };

      if (win.electronAPI?.drive) {
        win.electronAPI.drive.status = async () => ({ scopes: [] });
      }
      if (win.electronAPI?.slackChannel) {
        win.electronAPI.slackChannel.status = async () => ({
          active: true,
          canEnable: true,
        });
      }
      if (win.electronAPI?.telegramChannel) {
        win.electronAPI.telegramChannel.status = async () => ({
          active: false,
          canEnable: false,
        });
      }

      const project = {
        id: fixed.projectId,
        name: "Cleanroom Closed Loop",
        ownerId: "test-user-bypass",
        members: ["test-user-bypass"],
        kind: "assistant",
        enabledModels: ["claude", "gpt"],
        assistantTriggers: {
          enabled: true,
          outputs: ["slack"],
          schedule: {
            enabled: true,
            cron: "0 9 * * 1-5",
            timezone: "Asia/Seoul",
          },
          calendar: { enabled: false, upcomingMinutes: 15, pollMinutes: 5 },
          gmail: {
            enabled: false,
            query: "in:inbox newer_than:1d",
            pollMinutes: 5,
          },
          webhook: { enabled: false, pollMinutes: 1 },
          sheets: {
            enabled: false,
            spreadsheetId: "",
            range: "A:Z",
            pollMinutes: 5,
          },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // ③ 오케브레인 패널이 실제로 마운트되기까지의 게이트 셋. 하나라도
      //    빠지면 M3 가 "패널 없음" 으로 끊긴다(실측으로 하나씩 확인한 것):
      //    · beginnerMode advanced — 비기너 셸은 hideModelControls 로 숨긴다
      //      (OrchestratorPanel.tsx:1205)
      //    · orchestrator.isCollapsed=false — 기본값이 true 이고
      //      (orchestratorStore.ts:382) 자동 해제는 PTY 가 running 일 때만
      //      일어난다(OrchestratorPanel.tsx:378). 클린룸엔 PTY 가 없다
      //    · splitWorkspace.terminalCollapsed=false — 접히면 TerminalColumn 이
      //      오케를 안 싣는다(WorkspaceShell.tsx:302)
      win.__marbloTest.stores.beginnerMode.setState({ state: "advanced" });
      win.__marbloTest.stores.orchestrator.setState({ isCollapsed: false });
      win.__marbloTest.stores.editor.setState({ rootPath: "" });
      win.__marbloTest.stores.splitWorkspace.setState({
        activeTab: "agents",
        terminalCollapsed: false,
      });
      win.__marbloTest.stores.agent.setState({
        agents: [],
        loading: false,
        subscribeToAgents: () => () => {},
      });
      // 보드 티켓 — M4 의 진실원. 처음엔 둘 다 미완료다.
      win.__marbloTest.stores.task.setState({
        loading: false,
        subscribeToTasks: () => () => {},
        tasks: [
          {
            id: fixed.leadTask,
            projectId: fixed.projectId,
            title: "선행 티켓",
            status: "IN_PROGRESS",
            role: "backend",
            priority: 3,
            dependsOn: [],
            dependsOnCompleted: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: fixed.workTask,
            projectId: fixed.projectId,
            title: "근거 티켓",
            status: "TODO",
            role: "test",
            priority: 3,
            dependsOn: [],
            dependsOnCompleted: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });
      win.__marbloTest.stores.project.setState({
        subscribeToProjects: () => () => {},
        currentProject: project,
        projects: [project],
        subscribedUserId: "test-user-bypass",
        projectsHydrated: true,
        loading: false,
        updateProject: async (id: string, data: Record<string, unknown>) => {
          win.__marbloLoopE2E?.saves.push({ id, data });
          win.__marbloTest.stores.project.setState({
            currentProject: { ...project, ...data },
            projects: [{ ...project, ...data }],
          });
        },
      });
    },
    {
      projectId: PROJECT_ID,
      leadTask: LEAD_TASK,
      workTask: WORK_TASK,
    },
  );

  // 프로젝트 주입 직후 뜨는 무료플랜 페이월을 치운다(위 주석 참조).
  await page.waitForTimeout(500);
  await dismissUpgradeModal(page);
}

/** 체인 항목 1건을 화면으로 민다. 선행 티켓이 끝나야 준비됨이 되는 모양. */
async function pushChainItem(page: Page): Promise<void> {
  await page.evaluate(
    (fixed) => {
      (
        window as unknown as {
          __marbloLoopE2E: { pushChain: (items: unknown[]) => void };
        }
      ).__marbloLoopE2E.pushChain([
        {
          id: fixed.itemId,
          what: fixed.what,
          why: "폐루프가 실제로 닫히는지 본다",
          afterTaskIds: [fixed.leadTask],
          afterItemIds: [],
          taskIds: [fixed.workTask],
          doneWhen: "done",
          source: "owner",
          createdAt: 1,
          updatedAt: 1,
          createdBy: "test",
        },
      ]);
    },
    {
      itemId: CHAIN_ITEM,
      what: CHAIN_WHAT,
      leadTask: LEAD_TASK,
      workTask: WORK_TASK,
    },
  );
}

/** 보드 티켓 status 를 바꾼다 — M4 의 유일한 손잡이(화면엔 완료 버튼이 없다). */
async function setTaskStatus(
  page: Page,
  taskId: string,
  status: string,
): Promise<void> {
  await page.evaluate(
    (arg) => {
      const store = (
        window as unknown as {
          __marbloTest: {
            stores: {
              task: {
                setState: (p: Record<string, unknown>) => void;
                getState: () => { tasks: Array<Record<string, unknown>> };
              };
            };
          };
        }
      ).__marbloTest.stores.task;
      const tasks = store
        .getState()
        .tasks.map((t) =>
          t.id === arg.taskId ? { ...t, status: arg.status } : t,
        );
      store.setState({ tasks });
    },
    { taskId, status },
  );
}

/** 오케브레인 요약 줄의 "열림 n · 준비 m" 을 읽는다. */
async function readChainSummary(page: Page): Promise<string> {
  return page.getByTestId("work-chain-summary").innerText();
}

// ── M5 — 메인 프로세스에서 진짜 스위프를 돌린다 ────────────────────────────

interface SweepResult {
  injects: string[];
  seenCount: number;
}

/**
 * 빌드 산출물의 `OrchestratorBoardResync` 를 메인 프로세스 안에서 DI 로 돌린다.
 * `mainCall` 은 함수 export 만 부를 수 있어 클래스를 `new` 할 수 없으므로
 * `app.evaluate` 로 같은 입구(getBuiltinModule → createRequire)를 직접 쓴다 —
 * 앱이 이미 로드한 것과 **같은 모듈 인스턴스**다.
 */
async function runRealSweep(
  cr: CleanRoom,
  arg: {
    rows: Array<Record<string, unknown>>;
    chain: Array<{ itemId: string; what: string }>;
    injectOk: boolean;
    maxDigestItems?: number;
    ticks: number;
  },
): Promise<SweepResult> {
  return cr.app.evaluate(
    async (_electron, a) => {
      const nodeModule = (
        process as unknown as {
          getBuiltinModule?: (id: string) => {
            createRequire: (from: string) => (id: string) => unknown;
          };
        }
      ).getBuiltinModule?.("module");
      if (!nodeModule?.createRequire) {
        throw new Error("메인 프로세스 모듈 입구를 못 얻었습니다");
      }
      const mod = nodeModule.createRequire(a.file)(a.file) as {
        OrchestratorBoardResync: new (deps: Record<string, unknown>) => {
          tickOnce: () => Promise<void>;
          seenCount: (id: string) => number;
        };
      };

      const injects: string[] = [];
      const resync = new mod.OrchestratorBoardResync({
        listBoardOrchestratorProjects: () => ["p1"],
        getOrchestratorSession: () => ({
          ptySessionId: "pty-cleanroom",
          status: "running",
        }),
        listAttentionTasks: async () => a.rows,
        isAgentAliveInFleet: () => true,
        listReadyChainItems: async () => a.chain,
        inject: async (_p: string, message: string) => {
          injects.push(message);
          return a.injectOk;
        },
        log: () => {},
        logError: () => {},
        minAgeMs: 180_000,
        orphanMinAgeMs: 600_000,
        ...(a.maxDigestItems ? { maxDigestItems: a.maxDigestItems } : {}),
      });

      for (let i = 0; i < a.ticks; i++) await resync.tickOnce();
      return { injects, seenCount: resync.seenCount("pty-cleanroom") };
    },
    {
      file: path.join(
        __dirname,
        "..",
        "..",
        "..",
        "dist-electron",
        "orchestrator-board-resync.js",
      ),
      ...arg,
    },
  );
}

/**
 * ★non-vacuous 확인의 도구. 루프 마디의 단언을 **깨뜨린 입력**으로 돌려서
 * 그 단언이 실제로 터지는지 본다. 안 터지면 그 마디는 무엇이든 초록으로
 * 만드는 가짜 가드이므로, 여기서 그 사실을 실패로 드러낸다.
 */
async function expectSegmentToFail(
  label: string,
  assertion: () => Promise<void>,
): Promise<void> {
  let threw = false;
  try {
    await assertion();
  } catch {
    threw = true;
  }
  expect(
    threw,
    `★non-vacuous 실패: [${label}] 마디를 일부러 깨뜨렸는데 단언이 그대로 통과했습니다 — 이 마디는 아무것도 지키지 않습니다`,
  ).toBe(true);
}

/** REVIEW 로 올라온 티켓 1행 — 완료보고가 태워질 실체. */
function reviewRow(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    taskId: WORK_TASK,
    projectId: "p1",
    status: "REVIEW",
    title: "폐루프 완료보고",
    role: "test",
    prUrl: null,
    contextId: "board",
    isMission: false,
    claimedBy: null,
    ageMs: 10 * 60_000,
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// ① 루프 한 바퀴 — 마디별 단언
// ══════════════════════════════════════════════════════════════════════════

test("@cleanroom @closed-loop 루프 한 바퀴 — 요청 투입부터 완료보고 도달까지 마디별로 끊어 단언한다", async () => {
  test.setTimeout(180_000);
  const before = stateFingerprint();
  const cr = await launchCleanRoom({ codex: "ready" });

  try {
    // ── M0 격리 ────────────────────────────────────────────────────────────
    await segment(M.isolation, cr, async () => {
      const paths = await cr.app.evaluate(({ app }) => ({
        userData: app.getPath("userData"),
        envHome: process.env.HOME,
      }));
      console.log("[closed-loop] 격리 경로:", paths);
      expect(
        paths.userData,
        `userData 가 클린룸이 아닙니다(${paths.userData}) — 사장님 실사용 프로필을 쓸 뻔했습니다`,
      ).toContain("marblo-cleanroom-");
      expect(paths.userData).toContain("/userData");
      expect(
        paths.envHome,
        `HOME 이 클린룸이 아닙니다(${paths.envHome}) — ~/.marblo 를 건드릴 뻔했습니다`,
      ).toContain("marblo-cleanroom-");
      expect(paths.envHome).toContain("/home");
    });

    await passFirstRunModals(cr.page);

    // ── M1 요청 투입 ───────────────────────────────────────────────────────
    await segment(M.intake, cr, async () => {
      await cr.page.evaluate(() => localStorage.setItem("marblo:locale", "ko"));
      await cr.page.reload();
      await cr.page.waitForLoadState("domcontentloaded");
      await installLoopHarness(cr.page);

      const tab = cr.page.locator('button:has-text("마블로봇")').first();
      await expect(
        tab,
        "마블로봇 탭이 없습니다 — 요청을 넣을 표면 자체가 없습니다",
      ).toBeVisible({ timeout: 15_000 });
      await tab.click();
      await cr.page.waitForTimeout(400);

      const sectionTabs = cr.page.getByRole("tablist", { name: "마블로봇 탭" });
      await expect(
        sectionTabs,
        "마블로봇 3섹션 탭바가 안 보입니다 — 요청 투입 지점에 도달 못 했습니다",
      ).toBeVisible();
    });

    // ── M2 마블로봇 수신 ───────────────────────────────────────────────────
    await segment(M.received, cr, async () => {
      const sectionTabs = cr.page.getByRole("tablist", { name: "마블로봇 탭" });
      await sectionTabs
        .getByRole("tab", { name: "트리거", exact: true })
        .click();
      await expect(
        cr.page.getByRole("heading", { name: "스케줄·조건 트리거" }),
        "트리거 패널이 안 열립니다 — 마블로봇이 요청을 받을 자리에 도달 못 했습니다",
      ).toBeVisible();

      await cr.page
        .getByRole("checkbox", { name: /트리거 엔진 사용/ })
        .uncheck();
      await cr.page.getByRole("button", { name: /^저장$/ }).click();

      const saves = await cr.page.evaluate(
        () =>
          (
            window as unknown as {
              __marbloLoopE2E?: { saves: Array<{ id: string }> };
            }
          ).__marbloLoopE2E?.saves ?? [],
      );
      expect(
        saves.length,
        "마블로봇에서 낸 요청이 프로젝트 쓰기까지 도달하지 못했습니다(updateProject 미호출)",
      ).toBeGreaterThan(0);
      expect(saves[0]?.id).toBe(PROJECT_ID);
    });

    // ── M3 오케브레인 체인 생성 ────────────────────────────────────────────
    await segment(M.chain, cr, async () => {
      await pushChainItem(cr.page);

      await expect(
        cr.page.getByTestId("work-chain-panel"),
        "오케브레인 패널이 안 뜹니다 — 요청이 체인으로 이어질 자리가 없습니다",
      ).toBeVisible({ timeout: 15_000 });
      // ★항목이 **생겼다**는 사실은 요약의 "열림 n" 으로 잰다.
      //   `work-chain-next` 는 READY 항목이 있을 때만 렌더되므로(파생 next =
      //   ready[0] ?? null, work-chain-core.ts:490) 아직 대기인 지금은 없는 게
      //   정상이다 — 그 등장은 M4(b)에서 준비 전이의 증거로 쓴다.
      await expect
        .poll(() => readChainSummary(cr.page), {
          timeout: 10_000,
          message: `체인에 '${CHAIN_WHAT}' 항목이 안 잡힙니다 — 요청이 오케브레인에 남지 않았습니다`,
        })
        .toContain("열림 1");
      await cr.shot("closed-loop-m3-chain");
    });

    // ── M4 상태 전이 ───────────────────────────────────────────────────────
    await segment(M.transition, cr, async () => {
      // (a) 대기 — 선행 티켓이 아직 안 끝났다.
      const waiting = await readChainSummary(cr.page);
      console.log("[closed-loop] M4(a) 대기:", waiting.replace(/\n/g, " | "));
      expect(
        waiting,
        `선행 미완료인데 준비로 셉니다(요약="${waiting}") — 대기 판정이 안 섭니다`,
      ).toContain("준비 0");
      expect(waiting).toContain("열림 1");

      // (b) 준비 — 선행 티켓이 DONE 이 되면 파생이 준비로 넘어가야 한다.
      await setTaskStatus(cr.page, LEAD_TASK, "DONE");
      await expect
        .poll(() => readChainSummary(cr.page), {
          timeout: 10_000,
          message:
            "선행 티켓을 DONE 으로 만들었는데 체인이 '준비 1' 로 넘어가지 않습니다 — 대기→준비 전이가 끊겼습니다",
        })
        .toContain("준비 1");
      // 준비로 넘어갔으면 '▶ 다음 항목' 이 그 항목을 가리켜야 한다 — 오케가
      // 다음에 무엇을 할지가 여기서 처음 이름으로 드러난다.
      await expect(
        cr.page.getByTestId("work-chain-next"),
        `준비 전이는 됐는데 '다음 항목' 이 '${CHAIN_WHAT}' 을 가리키지 않습니다 — 오케가 다음 마디를 못 집습니다`,
      ).toContainText(CHAIN_WHAT, { timeout: 10_000 });

      // (c) 완료 — 근거 티켓이 DONE 이면 항목이 열림에서 빠져야 한다.
      //     ★완료는 화면이 적는 게 아니라 보드가 판정한다(완료 버튼이 없다).
      await setTaskStatus(cr.page, WORK_TASK, "DONE");
      await expect
        .poll(() => readChainSummary(cr.page), {
          timeout: 10_000,
          message:
            "근거 티켓을 DONE 으로 만들었는데 체인 항목이 열림에 남아 있습니다 — 준비→완료 전이가 끊겼습니다",
        })
        .toContain("열림 0");
      await cr.shot("closed-loop-m4-done");
    });

    // ── M5 완료보고 도달 ───────────────────────────────────────────────────
    await segment(M.report, cr, async () => {
      const swept = await runRealSweep(cr, {
        rows: [reviewRow()],
        chain: [{ itemId: CHAIN_ITEM, what: CHAIN_WHAT }],
        injectOk: true,
        ticks: 1,
      });
      console.log("[closed-loop] M5 주입 메시지:\n" + swept.injects[0]);

      expect(
        swept.injects.length,
        "재동기화 스위프가 오케 PTY 로 아무것도 밀지 않았습니다 — 완료보고가 오케에 도달하지 못합니다",
      ).toBe(1);
      expect(
        swept.injects[0],
        `완료보고 다이제스트에 티켓 id(${WORK_TASK})가 없습니다 — 오케가 무엇을 검증해야 할지 알 수 없습니다`,
      ).toContain(WORK_TASK);
      expect(
        swept.injects[0],
        "완료보고 다이제스트에 체인 READY 항목이 실리지 않았습니다 — 다음 마디로 이어지지 않습니다",
      ).toContain(CHAIN_ITEM);
    });

    // ── 루프 종료 후에도 사장님 실사용 상태는 그대로여야 한다 ──────────────
    expect(
      stateFingerprint(),
      "★클린룸이 사장님 실사용 상태(~/Library/Application Support/marblo-v3 · ~/.marblo/app-state.json)를 변경했습니다",
    ).toEqual(before);
  } finally {
    await cr.close();
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ② ★non-vacuous — 마디를 일부러 깨뜨리면 스펙이 실제로 실패하는가
// ══════════════════════════════════════════════════════════════════════════

/**
 * 초록은 가드의 존재 증명이 아니다. 위 스펙의 각 마디 단언이 **가짜 통과**가
 * 아님을 보이려면, 그 마디의 입력을 깨뜨렸을 때 같은 단언이 실제로 터져야 한다.
 * 아래는 M3·M4·M5 를 하나씩 깨뜨려 그것을 확인한다(M0·M1·M2 는 깨뜨리면 앱을
 * 못 띄우거나 화면 자체가 없어 위 스펙이 자명하게 터진다).
 */
test("@cleanroom @closed-loop ★non-vacuous — 루프 중간 마디를 깨뜨리면 단언이 실제로 실패한다", async () => {
  test.setTimeout(180_000);
  const cr = await launchCleanRoom({ codex: "ready" });

  try {
    await passFirstRunModals(cr.page);
    await cr.page.evaluate(() => localStorage.setItem("marblo:locale", "ko"));
    await cr.page.reload();
    await cr.page.waitForLoadState("domcontentloaded");
    await passFirstRunModals(cr.page);
    await widenWindow(cr);
    await installLoopHarness(cr.page);

    await expect(
      cr.page.getByTestId("work-chain-panel"),
      "오케브레인 패널이 안 뜨면 파괴 실험 자체가 성립하지 않습니다",
    ).toBeVisible({ timeout: 15_000 });

    // ── 파괴 ① M3 — 체인에 항목을 넣지 않는다 ──────────────────────────────
    // 위 스펙의 M3 단언은 요약의 "열림 1" 이다. 항목이 없으면 그 단언은
    // **반드시** 실패해야 한다. 통과한다면 M3 는 무엇이든 초록으로 만든다.
    await expectSegmentToFail("M3(체인 생성)", async () => {
      await expect
        .poll(() => readChainSummary(cr.page), { timeout: 3_000 })
        .toContain("열림 1");
    });

    // ── 파괴 ② M4(b) — 선행 티켓을 DONE 으로 만들지 않는다 ─────────────────
    await pushChainItem(cr.page);
    await expect
      .poll(() => readChainSummary(cr.page), { timeout: 10_000 })
      .toContain("열림 1");

    // 선행이 IN_PROGRESS 인 채로 M4(b) 단언("준비 1")을 돌리면 실패해야 한다.
    await expectSegmentToFail("M4(b) 대기→준비", async () => {
      await expect
        .poll(() => readChainSummary(cr.page), { timeout: 3_000 })
        .toContain("준비 1");
    });
    // 같은 상태에서 '다음 항목' 도 없어야 한다(준비된 게 없으므로).
    await expectSegmentToFail("M4(b) 다음 항목 등장", async () => {
      await expect(cr.page.getByTestId("work-chain-next")).toContainText(
        CHAIN_WHAT,
        { timeout: 3_000 },
      );
    });

    // ── 파괴 ③ M4(c) — 근거 티켓을 DONE 으로 만들지 않는다 ─────────────────
    // 선행만 끝내 준비까지 보낸 뒤, 근거 티켓은 REVIEW 에 둔다. 항목의
    // doneWhen 은 "done" 이므로 REVIEW 로는 완료가 되면 안 된다.
    await setTaskStatus(cr.page, LEAD_TASK, "DONE");
    await expect
      .poll(() => readChainSummary(cr.page), { timeout: 10_000 })
      .toContain("준비 1");
    await setTaskStatus(cr.page, WORK_TASK, "REVIEW");
    await cr.page.waitForTimeout(500);
    await expectSegmentToFail("M4(c) 준비→완료", async () => {
      await expect
        .poll(() => readChainSummary(cr.page), { timeout: 3_000 })
        .toContain("열림 0");
    });
    const atReview = await readChainSummary(cr.page);
    console.log(
      "[closed-loop][non-vacuous] 근거 티켓 REVIEW 상태:",
      atReview.replace(/\n/g, " | "),
    );

    // ── 파괴 ④ M5 — 오케 PTY 가 주입을 거절한다 ────────────────────────────
    const failed = await runRealSweep(cr, {
      rows: [reviewRow()],
      chain: [],
      injectOk: false,
      ticks: 1,
    });
    expect(
      failed.injects.length,
      "주입 시도 자체가 없었다면 이 실험은 M5 를 검사하지 않습니다",
    ).toBe(1);
    // ★계약의 심장: 실패는 seen 으로 남지 않아야 재시도가 산다.
    expect(
      failed.seenCount,
      "★non-vacuous 실패: 주입이 실패(false)했는데 seen 으로 기록됐습니다 — 재시도가 영영 안 일어나 알림이 사라집니다",
    ).toBe(0);

    // 주입이 성공하면 이번엔 seen 이 남아 같은 항목을 다시 밀지 않아야 한다.
    const ok = await runRealSweep(cr, {
      rows: [reviewRow()],
      chain: [],
      injectOk: true,
      ticks: 2,
    });
    expect(
      ok.injects.length,
      "★non-vacuous 실패: 주입 성공 후에도 같은 항목을 매 틱 다시 밀고 있습니다 — seen 추적이 동작하지 않습니다",
    ).toBe(1);
    expect(ok.seenCount).toBe(1);
  } finally {
    await cr.close();
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ③ ★루프가 닫히지 않는 구간 — 그대로 고정한다(느슨하게 만들지 않는다)
// ══════════════════════════════════════════════════════════════════════════

/**
 * ★발견: 다이제스트 절삭분이 **전달되지 않았는데 seen 으로 찍힌다.**
 *
 * `orchestrator-board-resync.ts:23-25` 의 계약은 이렇게 적혀 있다 —
 *   "주입이 성공(injectMessage=true)한 항목만 seen 으로 기록한다."
 * 그런데 `resyncProject` 는 `buildBoardResyncDigest(entries, chain, maxItems)`
 * 로 **자른 메시지**를 보낸 뒤, 성공하면 `entries` **전부**를 seen 에 넣는다
 * (:409-412). 잘려 나간 항목은 "…외 N건" 이라는 숫자로만 남고 taskId 는 오케에게
 * 한 번도 불리지 않는데, 그 세션 동안 재통보 대상에서 영구히 빠진다.
 *
 * 기본값은 `maxDigestItems = 15` 이므로 한 프로젝트의 한 틱에 관심항목이 16건
 * 이상이면 16번째부터 이 경로로 사라진다. 복구는 오케 PTY 세션이 갈릴 때뿐 —
 * 이 모듈이 고치려던 "재시작 전까지 아무도 모른다" 상태로 되돌아간다.
 *
 * ★이 스펙은 그 동작을 **현재 사실 그대로** 고정한다. 통과시키려고 느슨하게
 * 쓰지 않았다. 고쳐서 절삭분이 seen 에서 빠지게 되면 이 테스트가 빨개지고,
 * 그때 기대값을 뒤집으면서 "닫혔다" 를 기록하면 된다.
 */
test("@cleanroom @closed-loop ★결손 고정 — 다이제스트 절삭분은 전달 없이 seen 으로 찍혀 루프가 닫히지 않는다", async () => {
  test.setTimeout(120_000);
  const cr = await launchCleanRoom({ codex: "ready" });

  try {
    const rows = Array.from({ length: 5 }, (_, i) =>
      reviewRow({ taskId: `overflow-${i}`, title: `초과 티켓 ${i}` }),
    );
    const swept = await runRealSweep(cr, {
      rows,
      chain: [],
      injectOk: true,
      maxDigestItems: 3,
      ticks: 2, // 2틱: 절삭분이 재통보되는지 본다
    });
    console.log("[closed-loop][결손] 1틱 메시지:\n" + swept.injects[0]);

    // 전달된 것: 앞 3건만 이름이 실렸다.
    expect(swept.injects[0]).toContain("overflow-0");
    expect(swept.injects[0]).toContain("overflow-2");
    expect(
      swept.injects[0],
      "절삭 동작이 사라졌다면 이 결손 고정 테스트의 전제가 바뀐 것입니다 — 기대값을 다시 세우세요",
    ).not.toContain("overflow-3");
    expect(swept.injects[0]).toContain("외 2건");

    // ★결손: 이름이 불리지 않은 2건까지 seen 으로 찍힌다.
    expect(
      swept.seenCount,
      "절삭분이 seen 에서 빠지도록 고쳐졌다면(=루프가 닫혔다면) 이 값은 3 이어야 합니다 — 기대값을 3 으로 뒤집고 이 주석을 '닫힘' 으로 갱신하세요",
    ).toBe(5);

    // ★그래서 2틱째에 재통보가 없다 — overflow-3·overflow-4 는 이 PTY 세션
    //   동안 오케에게 영영 닿지 않는다.
    expect(
      swept.injects.length,
      "재통보가 생겼다면 루프가 닫힌 것입니다 — 기대값을 2 로 뒤집으세요",
    ).toBe(1);
  } finally {
    await cr.close();
  }
});
