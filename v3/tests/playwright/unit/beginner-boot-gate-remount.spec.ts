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
