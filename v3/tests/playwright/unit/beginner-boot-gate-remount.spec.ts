import { afterAll, expect } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { test } from "../helpers/fixtures";

/**
 * 회귀 — 비기너 대화창이 "준비하고 있어요" 골격 뒤에 영원히 갇힌다
 * (티켓 vnJWQrrfdLoXPR13rx1B).
 *
 * 사장님 증상: 이미 대화 중인 세션으로 화면이 다시 뜨면 오케 패널이 로딩 골격만
 * 그린 채 영원히 안 풀린다.
 *
 * 원인: `lib/orchestratorBootGate` 의 안전망 3개(probeMaxChars/probeMaxMs/
 * maxArmedMs)가 **전부 `feed()` 안에서만** 무장됐다. PTY 가 0바이트를 주면
 * 타이머가 하나도 돌지 않아 `probing` 에 갇히고, `BootGateOverlay` 가
 * `absolute inset-0 z-10` 으로 터미널을 영구히 덮는다.
 *
 * 이 스펙은 **진짜 Electron 앱 + 진짜 PTY** 로 두 가지를 한 번에 지킨다:
 *   ① 첫 마운트 — 부트 배너·주입 프롬프트 에코·tool call 원문은 화면에 안 뜨고
 *      오케의 인사말부터 뜬다 (티켓 fDceJJvz3eam2PMNOWyB 가 만든 문 — 이 티켓이
 *      그 문을 없애지 않았음을 지킨다).
 *   ② 0바이트 리마운트 — 골격이 풀리고 터미널이 보인다 (이 티켓의 버그).
 *
 * ★②의 0바이트를 만드는 법: 같은 sid 로 PTY 를 죽였다 다시 만든다. main 의
 * 재생 링은 PTY **프로세스** 단위로 초기화되므로(`resetPtyScrollback`), 새
 * 프로세스가 아직 아무것도 안 뱉은 순간의 `pty:replay` 는 실제로 빈 배열이다 —
 * 렌더러가 받는 바이트가 사장님 화면과 같은 조건이 된다.
 */

const userDataDir = mkdtempSync(join(tmpdir(), "marblo-bootgate-"));

/** 스크린샷 산출물 — PR 에 붙일 실화면. */
const SHOT_DIR =
  process.env.MARBLO_SHOT_DIR ?? join(tmpdir(), "marblo-bootgate-shots");
mkdirSync(SHOT_DIR, { recursive: true });

test.use({
  marbloOptions: {
    mock: true,
    beginnerShell: true,
    args: [`--user-data-dir=${userDataDir}`],
  },
});

afterAll(() => rmSync(userDataDir, { recursive: true, force: true }));

/** 화면에 절대 나오면 안 되는 것 — 전부 더미 맥락 안의 문자열이다. */
const FORBIDDEN = [
  "YOLO mode",
  "/var/folders",
  "You are the Marblo Orchestrator",
] as const;

const GREETING = "안녕하세요! 마블로 오케스트레이터예요";

const GATE = '[data-testid="orchestrator-boot-gate"]';

test.describe("비기너 부트 게이트 — 0바이트 리마운트", () => {
  test("@unit 부트는 가려지고, 0바이트로 다시 떠도 골격에 갇히지 않는다", async ({
    marblo,
  }) => {
    const { page } = marblo;

    // 갓 만든 프로필은 언어 선택부터 묻는다.
    const languageDialog = page.getByRole("dialog", {
      name: "언어를 선택하세요",
    });
    try {
      await languageDialog.waitFor({ state: "visible", timeout: 8000 });
      await languageDialog.getByRole("button", { name: /한국어/ }).click();
      await languageDialog.getByRole("button", { name: "계속" }).click();
      await languageDialog.waitFor({ state: "hidden" });
    } catch {
      // 이미 로케일이 굳은 프로필에는 안 뜬다.
    }
    await page.waitForTimeout(1200);

    // 온보딩 안내 모달은 화면을 가린다 — 스크린샷을 위해 건너뛴다.
    const skipGuide = page.getByRole("button", { name: "건너뛰기" });
    if (await skipGuide.count()) await skipGuide.first().click();

    const sid = `orch-bootgate-${Date.now()}`;

    // ── ① 첫 마운트: 진짜 PTY 가 부트(배너·에코·tool call)를 뱉고 인사말을 낸다.
    await page.evaluate(
      async ({ id, greeting, cwd }) => {
        const harness = (
          window as unknown as { __marbloTest?: Record<string, unknown> }
        ).__marbloTest;
        if (!harness) throw new Error("missing Playwright test hatch");
        const stores = harness.stores as {
          beginnerMode: { setState: (v: { state: string }) => void };
          project: { setState: (v: Record<string, unknown>) => void };
          orchestrator: {
            setState: (v: Record<string, unknown>) => void;
          };
        };
        stores.beginnerMode.setState({ state: "beginner" });

        // 비기너 셸은 열린 폴더가 있어야 오케 패널을 그린다.
        const project = {
          id: "bootgate-project",
          name: "부트게이트 더미 프로젝트",
          ownerId: "test-user",
          members: ["test-user"],
          folderPath: cwd,
        };
        stores.project.setState({
          currentProject: project,
          projects: [project],
        });

        await window.electronAPI.pty.create({
          id,
          name: "OrchBootGate",
          command: "sh",
          args: [],
          cwd: undefined,
        });
        // 셸이 뜨기 전에 쓰면 그대로 흘린다 — 프롬프트가 나올 때까지 기다린다.
        await new Promise((r) => setTimeout(r, 1200));

        // 실제 codex 부트가 내는 것과 같은 **모양**의 더미 스트림.
        const boot = [
          "\u2502 >_ OpenAI Codex (v0.149.0) \u2502",
          "  model: dummy-model",
          "  permissions: YOLO mode",
          "  Tip: 더미 팁 줄입니다",
          "\u203a You are the Marblo Orchestrator Agent. Read the orchestrator skill",
          "  /var/folders/xx/dummy-tmp/T/marblo-fallback",
          '\u2022 Called marblo.get_agent_skill({"role":"orchestrator"})',
          "  \u2514 # Orchestrator Agent 스킬 (더미 본문)",
        ];
        const emit = async (line: string) => {
          window.electronAPI.pty.write(id, `printf '%s\\n' '${line}'\r`);
          await new Promise((r) => setTimeout(r, 220));
        };
        for (const line of boot) await emit(line);
        // 오케의 첫 발화 — 여기부터가 사용자에게 보일 것이다.
        await emit(`\u2022 ${greeting}`);

        // 출력이 링에 다 쌓인 뒤에 패널을 올린다 = "이미 대화 중인 세션" 상태.
        await new Promise((r) => setTimeout(r, 2000));

        stores.orchestrator.setState({
          sessionId: "bootgate-session",
          ptySessionId: id,
          status: "running",
          isCollapsed: false,
          runningModel: "codex",
        });
      },
      { id: sid, greeting: GREETING, cwd: userDataDir },
    );

    // 게이트가 인사말에서 열린다.
    await expect(page.locator(GATE)).toBeHidden({ timeout: 20_000 });
    await page.waitForTimeout(1500);

    const firstText = await page.evaluate(() => document.body.innerText);
    expect(firstText).toContain(GREETING);
    for (const s of FORBIDDEN) expect(firstText).not.toContain(s);

    await page.screenshot({
      path: join(SHOT_DIR, "1-first-mount-boot-hidden.png"),
    });

    // ── ② 0바이트 리마운트: 같은 sid 의 PTY 를 갈아 끼우고(링 초기화) 패널을
    //     접었다 편다 = OrchestratorTerminal 이 언마운트→마운트되며 게이트를
    //     새로 만든다. 이때 replay 가 실제로 빈 배열이다.
    const replayWasEmpty = await page.evaluate(async (id) => {
      const harness = (
        window as unknown as { __marbloTest?: Record<string, unknown> }
      ).__marbloTest!;
      const stores = harness.stores as {
        beginnerMode: { setState: (v: { state: string }) => void };
      };

      // ★티켓의 실제 경로 — 모드 전환. `App.tsx` 가 BeginnerShell 과
      // WorkspaceShell 을 형제 분기로 그리므로 서브트리째 언마운트된다.
      stores.beginnerMode.setState({ state: "advanced" });
      await new Promise((r) => setTimeout(r, 1200));

      // 같은 sid, 새 프로세스 — 조용한 `cat` 이라 한 바이트도 안 나온다.
      window.electronAPI.pty.kill(id);
      await new Promise((r) => setTimeout(r, 500));
      await window.electronAPI.pty.create({
        id,
        name: "OrchBootGate",
        command: "cat",
        args: [],
        cwd: undefined,
      });
      await new Promise((r) => setTimeout(r, 500));

      // 사장님 화면과 같은 조건인지 실측한다.
      const probe = await window.electronAPI.pty.replay(id);
      const empty = probe.join("").length === 0;

      // 비기너로 돌아온다 = 리마운트.
      stores.beginnerMode.setState({ state: "beginner" });

      // ★리마운트하면 useOrchestratorAutoLaunch 의 `autoConnectRef` 도 새로
      // 나서 auto-connect 가 다시 돈다. 이 하네스에는 진짜 오케 세션이 없어
      // 새 CLI 를 띄우고 스토어의 sid 를 자기 것으로 바꿔 버린다 — 그러면 우리가
      // 재현하려는 "0바이트 세션" 이 화면에서 밀려난다. 그 CLI 를 걷어내고
      // 패널을 다시 우리 세션에 붙인다.
      await new Promise((r) => setTimeout(r, 1500));
      const orchStore = (
        harness.stores as {
          orchestrator: {
            getState: () => Record<string, unknown>;
            setState: (v: Record<string, unknown>) => void;
          };
        }
      ).orchestrator;
      const hijacked = orchStore.getState().ptySessionId as string | null;
      if (hijacked && hijacked !== id) window.electronAPI.pty.kill(hijacked);
      orchStore.setState({
        sessionId: "bootgate-session",
        ptySessionId: id,
        status: "running",
        isCollapsed: false,
      });
      return empty;
    }, sid);

    // 전제 확인 — 이 단언이 깨지면 아래 결과는 이 버그의 증거가 아니다.
    expect(
      replayWasEmpty,
      "리마운트 시점의 replay 가 실제로 0바이트여야 한다",
    ).toBe(true);

    // ★수정 전에는 여기서 `probing` 에 갇혔다(실측: HEAD 에서 6초 뒤에도 probing,
    //   20초 대기까지 그대로 → 이 단언이 실패한다). 이제 부트를 지난 sid 라 풀린다.
    await expect(page.locator(GATE)).toBeHidden({ timeout: 20_000 });
    await page.waitForTimeout(1200);

    // 터미널이 실제로 화면에 있다(골격이 덮고 있지 않다).
    await expect(page.locator(".xterm").first()).toBeVisible();
    // 골격이 DOM 에서 아예 사라졌다 — 가려진 게 아니라 열렸다.
    await expect(page.locator(GATE)).toHaveCount(0);

    // ★"골격이 걷혔다" 로 끝내지 않는다 — 대화가 이어지는지까지 본다. 게이트가
    //   열린 뒤의 출력은 그대로 통과해야 하므로, 지금 한 줄을 보내면 화면에 뜬다.
    //   (재생성한 PTY 는 `cat` 이라 받은 줄을 그대로 되돌려준다.)
    const RESUMED = "전환 후에도 대화가 이어집니다 — 마블로";
    await page.evaluate(
      ({ id, line }) => window.electronAPI.pty.write(id, `${line}\r`),
      { id: sid, line: RESUMED },
    );
    await expect(page.locator(".xterm-screen")).toContainText(RESUMED, {
      timeout: 10_000,
    });

    await page.screenshot({
      path: join(SHOT_DIR, "2-after-remount-terminal-visible.png"),
    });

    await page.evaluate((id) => window.electronAPI.pty.kill(id), sid);
  });
});

/**
 * ── 사장님 경로: 마블로 모드로 뜬 앱을 **비기너로 전환**한다 ─────────────────
 * (티켓 04mJqRvSi0QDCboyxzKF)
 *
 * 위 스펙 ②는 "0바이트 리마운트"다. 사장님이 겪는 것은 그게 아니다: PTY 는
 * 살아 있고 재생 링에는 **부팅 출력이 가득**하다. 앱이 마블로(엑스퍼트) 모드로
 * 뜨면 그 화면엔 게이트가 없으므로(원시 출력이 진단이다) 부트를 **본 게이트가
 * 하나도 없다**. 그 상태에서 비기너로 전환하면 게이트가 처음 만들어지고, 재생
 * 링의 **지나간 배너**를 지금 일어나는 부팅으로 오인해 `armed` 로 들어간다.
 *
 * `armed` 를 푸는 길은 셋뿐인데 셋 다 막힌다:
 *   - 어시스턴트 줄  → 오케가 아직 사람에게 말한 적이 없으면 링에 없다
 *   - quiet-after-echo(2.5초) → 일하는 TUI 는 상태줄(`esc to interrupt`)을
 *     0.5초마다 다시 그려서 이 타이머를 매번 되감는다
 *   - maxArmedMs → **60초**
 * 실측(수정 전 HEAD): `data-gate-state` 가 probing(105ms) → armed(301ms) 뒤
 * **60.2초**를 꽉 채우고 빈 터미널로 열렸다. 증상 분류는 (1) 골격이 안 걷힌다.
 *
 * ★PTY 나이를 sid 로 준다. 프로덕션의 sid 는 `orch-<sess>-<Date.now()>` 라
 * 스폰 시각을 그 자체로 싣는다(`orchestrator-manager.launch`). 그러니 "5분째
 * 돌고 있는 오케" 는 5분 전 타임스탬프를 단 sid 로 정확히 모형화된다 — 테스트를
 * 5분 재우지 않고 같은 조건을 만든다.
 */
const switchUserDataDir = mkdtempSync(
  join(tmpdir(), "marblo-bootgate-switch-"),
);
afterAll(() => rmSync(switchUserDataDir, { recursive: true, force: true }));

/** 실제 codex 부트가 내는 것과 같은 **모양**의 더미 스트림(어시스턴트 발화 전까지). */
const BOOT_LINES = [
  "│ >_ OpenAI Codex (v0.149.0) │",
  "  model: dummy-model",
  "  permissions: YOLO mode",
  "  Tip: 더미 팁 줄입니다",
  "› You are the Marblo Orchestrator Agent. Read the orchestrator skill",
  "  /var/folders/xx/dummy-tmp/T/marblo-fallback",
  '• Called marblo.get_agent_skill({"role":"orchestrator"})',
  "  └ # Orchestrator Agent 스킬 (더미 본문)",
];

interface SwitchProbe {
  /** 게이트 상태별 최초 등장 시각(전환 시점 기준 ms). */
  first: Record<string, number>;
  /** 게이트가 사라진(=열린) 시각. 끝까지 안 열렸으면 null. */
  openedAfterMs: number | null;
  /** 화면 전체 텍스트 — 금지 문자열 검사를 위해. */
  bodyText: string;
  /**
   * ★관측이 끝날 때까지 PTY 가 **계속** 뱉고 있었는가. 이게 false 면 그 실행의
   * 결과는 이 버그의 증거가 못 된다: 스트림이 조용해지면 `quiet-after-echo`
   * (2.5초)가 게이트를 열어 버려서, "예산이 짧아져서 열린 것"과 구분되지 않는다.
   */
  stayedBusy: boolean;
}

test.describe("비기너 부트 게이트 — 마블로→비기너 전환", () => {
  test.use({
    marbloOptions: {
      mock: true,
      // ★사장님 경로: 앱은 **마블로(엑스퍼트) 모드로 뜬다**. 비기너로 부팅하는
      //   경로가 아니다 — 전환이 게이트를 처음 만드는 순간이 문제의 자리다.
      beginnerShell: false,
      args: [`--user-data-dir=${switchUserDataDir}`],
    },
  });

  // 수정 전 회귀(60초 고착)를 사실로 남기려면 그만큼 기다릴 수 있어야 한다.
  test.setTimeout(240_000);

  /**
   * 앱을 마블로 모드로 세우고 → 부팅만 하고 아직 말은 안 한 오케 PTY 를 붙이고 →
   * 비기너로 전환한 뒤 게이트 상태를 100ms 마다 표본한다.
   *
   * @param ptyAgeMs sid 에 실을 스폰 나이. 0 이면 "갓 뜬 PTY"(진짜 부팅 중).
   * @param watchMs  게이트가 열릴 때까지 기다릴 상한.
   */
  async function switchAndProbe(
    page: import("@playwright/test").Page,
    sid: string,
    watchMs: number,
  ): Promise<SwitchProbe> {
    // ── ① 마블로 모드에서 오케가 부팅하고 **일을 시작한다**(아직 발화 없음).
    await page.evaluate(
      async ({ id, cwd, boot }) => {
        const harness = (
          window as unknown as { __marbloTest?: Record<string, unknown> }
        ).__marbloTest;
        if (!harness) throw new Error("missing Playwright test hatch");
        const stores = harness.stores as {
          beginnerMode: { setState: (v: { state: string }) => void };
          project: { setState: (v: Record<string, unknown>) => void };
          orchestrator: { setState: (v: Record<string, unknown>) => void };
        };
        stores.beginnerMode.setState({ state: "advanced" });

        const project = {
          id: "bootgate-switch-project",
          name: "전환 더미 프로젝트",
          ownerId: "test-user",
          members: ["test-user"],
          folderPath: cwd,
        };
        stores.project.setState({
          currentProject: project,
          projects: [project],
        });

        await window.electronAPI.pty.create({
          id,
          name: "OrchSwitch",
          command: "sh",
          args: [],
          cwd: undefined,
        });
        await new Promise((r) => setTimeout(r, 1200));

        const emit = async (line: string) => {
          window.electronAPI.pty.write(id, `printf '%s\\n' '${line}'\r`);
          await new Promise((r) => setTimeout(r, 180));
        };
        for (const line of boot) await emit(line);

        // 마블로 모드에서 이미 이 세션이 화면에 붙어 있는 상태를 만든다 —
        // 거기엔 게이트가 없으므로 부트를 **본 게이트가 하나도 없다**.
        stores.orchestrator.setState({
          sessionId: "bootgate-switch-session",
          ptySessionId: id,
          status: "running",
          isCollapsed: false,
          runningModel: "codex",
        });

        // ★일하는 TUI. 상태줄을 0.5초마다 다시 그린다 — 실제 codex/claude 가
        //   스피너를 돌리는 자리다. 이게 quiet-after-echo(2.5초)를 매번 되감아
        //   `armed` 를 푸는 길 하나를 지운다.
        window.electronAPI.pty.write(
          id,
          "while true; do printf '%s\\n' '  Working (esc to interrupt)'; sleep 0.5; done\r",
        );
        // ★루프가 실제로 돌기 시작했는지 링 크기로 확인한다. `sh` 에 쓴 줄이
        //   프롬프트보다 먼저 도착하면 그냥 흘러가고, 그러면 스트림이 조용해져
        //   quiet-after-echo 가 대신 게이트를 열어 측정이 무의미해진다.
        const ringChars = async () =>
          (await window.electronAPI.pty.replay(id)).join("").length;
        for (let attempt = 0; attempt < 5; attempt++) {
          const before = await ringChars();
          await new Promise((r) => setTimeout(r, 900));
          if ((await ringChars()) > before) return;
          window.electronAPI.pty.write(
            id,
            "while true; do printf '%s\\n' '  Working (esc to interrupt)'; sleep 0.5; done\r",
          );
        }
        throw new Error("더미 PTY 의 busy 스트림이 끝내 시작되지 않았다");
      },
      { id: sid, cwd: switchUserDataDir, boot: BOOT_LINES },
    );
    await page.waitForTimeout(1200);

    // ── ② 전환. 여기서 게이트가 **처음** 만들어진다.
    await page.evaluate(() => {
      const w = window as unknown as {
        __gateProbe?: { states: { at: number; state: string | null }[] };
      };
      w.__gateProbe = { states: [] };
      const started = Date.now();
      const timer = window.setInterval(() => {
        const el = document.querySelector(
          '[data-testid="orchestrator-boot-gate"]',
        );
        w.__gateProbe!.states.push({
          at: Date.now() - started,
          state: el ? el.getAttribute("data-gate-state") : null,
        });
        if (Date.now() - started > 180_000) window.clearInterval(timer);
      }, 100);

      // App.tsx 가 BeginnerShell 과 WorkspaceShell 을 형제 분기로 그리므로
      // 서브트리째 언마운트되고 비기너 셸이 새로 마운트된다.
      (
        window as unknown as {
          __marbloTest: {
            stores: {
              beginnerMode: { setState: (v: { state: string }) => void };
            };
          };
        }
      ).__marbloTest.stores.beginnerMode.setState({ state: "beginner" });
    });

    // 전환 직후 자동기동이 스토어의 sid 를 자기 것으로 바꿔 버리면 우리가
    // 재현하려는 세션이 화면에서 밀려난다. 되돌려 붙인다(위 스펙과 같은 처리).
    await page.waitForTimeout(2500);
    await page.evaluate((id) => {
      const orch = (
        window as unknown as {
          __marbloTest: {
            stores: {
              orchestrator: {
                getState: () => Record<string, unknown>;
                setState: (v: Record<string, unknown>) => void;
              };
            };
          };
        }
      ).__marbloTest.stores.orchestrator;
      const seen = orch.getState().ptySessionId as string | null;
      if (seen && seen !== id) {
        window.electronAPI.pty.kill(seen);
        orch.setState({
          sessionId: "bootgate-switch-session",
          ptySessionId: id,
          status: "running",
          isCollapsed: false,
        });
      }
    }, sid);

    // ── ③ 계측.
    const t0 = Date.now();
    let openedAfterMs: number | null = null;
    while (Date.now() - t0 < watchMs) {
      if ((await page.locator(GATE).count()) === 0) {
        openedAfterMs = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(100);
    }

    const first = await page.evaluate(() => {
      const w = window as unknown as {
        __gateProbe: { states: { at: number; state: string | null }[] };
      };
      const acc: Record<string, number> = {};
      for (const s of w.__gateProbe.states) {
        const key = s.state ?? "(open/absent)";
        if (!(key in acc)) acc[key] = s.at;
      }
      return acc;
    });
    const bodyText = await page.evaluate(() => document.body.innerText);
    // 관측이 끝난 지금도 스트림이 살아 있어야 위 결과가 이 버그의 증거가 된다.
    const stayedBusy = await page.evaluate(async (id) => {
      const ringChars = async () =>
        (await window.electronAPI.pty.replay(id)).join("").length;
      const before = await ringChars();
      await new Promise((r) => setTimeout(r, 1500));
      return (await ringChars()) > before;
    }, sid);
    return { first, openedAfterMs, bodyText, stayedBusy };
  }

  /** 갓 만든 프로필의 언어 선택·온보딩 안내를 걷어낸다. */
  async function settleFirstRun(
    page: import("@playwright/test").Page,
  ): Promise<void> {
    const languageDialog = page.getByRole("dialog", {
      name: "언어를 선택하세요",
    });
    try {
      await languageDialog.waitFor({ state: "visible", timeout: 8000 });
      await languageDialog.getByRole("button", { name: /한국어/ }).click();
      await languageDialog.getByRole("button", { name: "계속" }).click();
      await languageDialog.waitFor({ state: "hidden" });
    } catch {
      /* 이미 로케일이 굳은 프로필에는 안 뜬다. */
    }
    await page.waitForTimeout(1200);
    for (let i = 0; i < 4; i++) {
      const skip = page.getByRole("button", { name: "건너뛰기" });
      if (!(await skip.count())) break;
      await skip.first().click();
      await page.waitForTimeout(300);
    }
  }

  test("@unit 몇 분째 일하고 있는 오케로 전환하면 대화창이 60초 갇히지 않는다", async ({
    marblo,
  }) => {
    const { page } = marblo;
    await settleFirstRun(page);

    // 5분 전에 뜬 PTY — 프로덕션 sid 가 스폰 시각을 싣는 것과 같은 형식.
    const sid = `orch-switch-old-${Date.now() - 5 * 60_000}`;
    const probe = await switchAndProbe(page, sid, 90_000);

    console.log(
      `[probe:old] 상태 최초 등장(ms)=${JSON.stringify(probe.first)} 열린 시각=${probe.openedAfterMs}ms`,
    );
    await page.screenshot({
      path: join(SHOT_DIR, "3-switch-old-pty-opens.png"),
    });

    // 전제 — 이 단언이 깨지면 아래 결과는 이 버그의 증거가 아니다.
    expect(
      probe.stayedBusy,
      "관측 내내 PTY 가 계속 뱉고 있어야 한다(그래야 quiet-after-echo 가 아니라 예산이 판정한다)",
    ).toBe(true);
    expect(
      probe.openedAfterMs,
      `마블로→비기너 전환 후 게이트가 90초 동안 안 열렸다. 상태=${JSON.stringify(probe.first)}`,
    ).not.toBeNull();
    // 수정 전에는 여기가 60_200ms 였다(실측). 이제 유예(2.5초)만 쓴다.
    expect(
      probe.openedAfterMs!,
      `게이트가 ${probe.openedAfterMs}ms 만에 열렸다 — maxArmedMs(60초)를 다시 센 것이다`,
    ).toBeLessThan(15_000);

    // ★역방향 회귀 금지 — 열렸다고 지나간 부트가 새면 안 된다.
    for (const s of FORBIDDEN) expect(probe.bodyText).not.toContain(s);
    // 터미널은 실제로 화면에 있다(골격이 덮고 있지 않다).
    await expect(page.locator(".xterm").first()).toBeVisible();

    await page.evaluate((id) => window.electronAPI.pty.kill(id), sid);
  });

  test("@unit 갓 뜬 오케가 부팅 중이면 문은 그대로 닫혀 있다 — 배너가 새지 않는다", async ({
    marblo,
  }) => {
    const { page } = marblo;
    await settleFirstRun(page);

    // 방금 뜬 PTY = 진짜 부팅 중. 예산이 통째로 남아 있어야 한다.
    const sid = `orch-switch-fresh-${Date.now()}`;
    const probe = await switchAndProbe(page, sid, 12_000);

    console.log(
      `[probe:fresh] 상태 최초 등장(ms)=${JSON.stringify(probe.first)} 열린 시각=${probe.openedAfterMs}`,
    );
    await page.screenshot({
      path: join(SHOT_DIR, "4-switch-fresh-pty-still-gated.png"),
    });

    expect(
      probe.stayedBusy,
      "관측 내내 PTY 가 계속 뱉고 있어야 한다(그래야 quiet-after-echo 가 아니라 예산이 판정한다)",
    ).toBe(true);
    expect(
      probe.openedAfterMs,
      "갓 뜬 PTY 의 부팅 중인데 게이트가 열렸다 — 배너가 샐 수 있다",
    ).toBeNull();
    await expect(page.locator(GATE)).toHaveAttribute(
      "data-gate-state",
      "armed",
    );
    for (const s of FORBIDDEN) expect(probe.bodyText).not.toContain(s);

    await page.evaluate((id) => window.electronAPI.pty.kill(id), sid);
  });

  /**
   * ── 리마운트가 CLI 를 중복 기동하는가 (티켓 완료 기준 ⑤) ────────────────
   *
   * 모드를 전환하면 `useOrchestratorAutoLaunch` 가 통째로 다시 마운트되고
   * `autoConnectRef` 가 새로 나서 auto-connect 가 **다시 돈다** — 실측으로
   * 확인했다(전환 뒤 스토어의 ptySessionId 가 자동기동이 잡은 것으로 바뀐다).
   * 그래서 남는 질문은 하나다: 그 두 번째 `launch` 가 **새 PTY 를 띄우는가**.
   *
   * 답은 `orchestrator-manager.launch` 의 idempotent 분기다 — 같은
   * project/root/model 이고 PTY 가 살아 있으면 `findAttachableSession` 이 잡아
   * `reused: true` 로 **같은 ptySessionId** 를 돌려준다. 이 테스트는 그 계약을
   * 렌더러 경계에서 직접 잰다: 두 번 부르고 sid 가 같은지 본다.
   */
  test("@unit 같은 프로젝트로 다시 launch 하면 살아 있는 PTY 에 붙는다 — 중복 기동 없음", async ({
    marblo,
  }) => {
    const { page } = marblo;
    await settleFirstRun(page);

    const result = await page.evaluate(async (cwd) => {
      const stores = (
        window as unknown as {
          __marbloTest: {
            stores: {
              project: { setState: (v: Record<string, unknown>) => void };
            };
          };
        }
      ).__marbloTest.stores;
      const project = {
        id: "dup-launch-project",
        name: "중복기동 더미 프로젝트",
        ownerId: "test-user",
        members: ["test-user"],
        folderPath: cwd,
      };
      stores.project.setState({ currentProject: project, projects: [project] });

      const first = await window.electronAPI.orchestratorSession.launch(
        project.id,
        cwd,
        "new",
      );
      // 리마운트가 하는 것과 같은 두 번째 호출.
      const second = await window.electronAPI.orchestratorSession.launch(
        project.id,
        cwd,
        "new",
      );
      const sids = [first?.ptySessionId ?? null, second?.ptySessionId ?? null];
      await window.electronAPI.orchestratorSession.stop().catch(() => {});
      return {
        sids,
        needsAuth: !!(first as { needsAuth?: unknown } | null)?.needsAuth,
      };
    }, switchUserDataDir);

    console.log(
      `[probe:dup] launch 두 번의 ptySessionId = ${JSON.stringify(result.sids)} needsAuth=${result.needsAuth}`,
    );

    // CLI 미인증 환경(CI)에서는 스폰 자체가 안 된다 — 그때는 잴 것이 없다.
    test.skip(
      result.needsAuth || !result.sids[0],
      "CLI 미인증/스폰 불가 — 중복 기동은 이 환경에서 측정 불가",
    );
    expect(
      result.sids[1],
      "두 번째 launch 가 새 PTY 를 띄웠다 — 리마운트마다 CLI 가 중복 기동된다",
    ).toBe(result.sids[0]);
  });
});
