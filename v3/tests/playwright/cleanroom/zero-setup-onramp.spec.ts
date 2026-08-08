import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
  beginnerShellVisible,
  dismissBeginnerTour,
  injectProject,
  launchCleanRoom,
  passFirstRunModals,
  readRootPath,
  waitForAppShell,
  type CleanRoom,
} from "./helpers/cleanroom";

/**
 * ★제로셋업 온램프 **풀 플로우** E2E — 첫실행부터 첫 티켓까지 (티켓 1F0D8hH5).
 *
 * 기존 spec 들은 이 길을 **토막으로** 지킨다: first-run.spec 은 어드밴스드
 * 온보딩 표면을, beginner-first-run.spec 은 이미 인증된 프로필의 비기너 화면을
 * 본다. 아무도 "아무것도 없는 맥에서 앱을 켠 사람이 첫 티켓까지 도달하는가" 를
 * 한 줄로 재지 않았다 — 그런데 그게 사장님이 시연할 바로 그 한 줄이다.
 *
 * 통과해야 하는 관문(각각이 실제 이탈 지점이었다):
 *   ① 첫실행 모달(언어·동의) → 비기너 셸
 *   ② 원클릭 모달: 미설치 CLI 일괄 설치 (#870 공용 runInstallAll)
 *   ③ 설치가 끝나면 **스스로** 로그인 터미널을 띄운다 (자동 사인인)
 *   ④ 브라우저 승인이 끝나면 자동 재확인 폴이 감지 → 연결 게이트 통과
 *   ⑤ 샘플 폴더 자동 연결 (#872 sample:ensure — 진짜 핸들러, 임시 HOME 안)
 *   ⑥ 오케 챗 국면 → 첫 요청 전달 → 라이브 스트립
 *
 * 실행: npm run test:e2e:pw -- tests/playwright/cleanroom/zero-setup-onramp.spec.ts
 * 전제: npm run build (dist-electron/main.js + dist/)
 *
 * ※ 이 맥에서 진짜 probe 는 클린룸이 될 수 없다(하드코딩 PATH + 키체인). 설치/
 *   인증 축은 main process IPC 스텁으로 구동한다 — 렌더러→preload→IPC 경로는
 *   진짜 그대로다. 하네스 주석 참조.
 */

const AUTO_INSTALL_KEY = "marblo.cliAutoInstallDone";

async function settle(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms);
}

/** 원클릭 모달의 현재 국면(`data-phase`). 모달이 없으면 null. */
async function oneClickPhase(page: Page): Promise<string | null> {
  const modal = page.getByTestId("beginner-oneclick-modal").first();
  if (!(await modal.isVisible().catch(() => false))) return null;
  return modal.getAttribute("data-phase");
}

/** 국면이 `want` 가 될 때까지 기다린다(그 사이 관측된 국면들을 돌려준다). */
async function waitForPhase(
  page: Page,
  want: string,
  timeoutMs = 30_000,
): Promise<string[]> {
  const seen: string[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const phase = await oneClickPhase(page);
    if (phase && seen[seen.length - 1] !== phase) seen.push(phase);
    if (phase === want) return seen;
    await page.waitForTimeout(200);
  }
  return seen;
}

/**
 * 백그라운드 자동설치가 이미 돌았지만 **아무것도 남기지 못한** 프로필로 재부팅.
 *
 * 왜 필요한가: `useCliSetupEngine` 은 마운트하자마자 미설치 CLI 를 조용히 깔아
 * 버린다. 그대로 두면 사용자가 원클릭을 누를 때쯤엔 설치할 게 없어서 ②관문이
 * vacuous 해진다(실제로 처음 이 spec 을 돌렸을 때 harness:install 호출이 0 이었다).
 *
 * 그래서 두 가지를 한 번에 만든다:
 *   - `AUTO_INSTALL_KEY` — 엔진의 자동설치 패스를 "이미 했다" 로 막는다.
 *   - CLI 상태를 다시 missing 으로 — 자동설치가 실패했거나(네트워크·권한) 사용자가
 *     지웠던 상태. 이게 곧 **버튼이 실제로 중요해지는 상황**이다.
 * 둘 다 재부팅 **전에** 세운다: 부팅 직후의 첫 프로브가 진실의 기준점이라서다.
 * 비기너 진입판정 마커는 아니므로 셸은 그대로 비기너로 뜬다.
 */
async function disableBackgroundAutoInstall(cr: CleanRoom): Promise<void> {
  await cr.page.evaluate(
    (key) => localStorage.setItem(key, "1"),
    AUTO_INSTALL_KEY,
  );
  await cr.setCli("claude", "missing");
  await cr.setCli("codex", "missing");
  await cr.page.reload();
  await cr.page.waitForLoadState("domcontentloaded");
  await passFirstRunModals(cr.page);
  await waitForAppShell(cr.page);
}

test.describe("@cleanroom 제로셋업 온램프 풀 플로우", () => {
  test("Z1 첫실행 → 원클릭 설치 → 자동 사인인 → 오케 챗 → 첫 티켓", async () => {
    const cr = await launchCleanRoom({
      // 아무것도 없는 맥.
      claude: "missing",
      codex: "missing",
      // 설치는 되지만 인증은 아직 — 실제 CLI 설치의 결과와 같다.
      installSucceeds: true,
      installResultsIn: "installed",
      orchestratorRunning: true,
      beginnerShell: true,
    });
    try {
      // ── ① 첫실행 모달 → 비기너 셸 ──────────────────────────────────────
      const passed = await passFirstRunModals(cr.page);
      console.log("[cleanroom][Z1] 첫실행 모달:", passed);
      await waitForAppShell(cr.page);
      await settle(cr.page);
      expect(await beginnerShellVisible(cr.page)).toBe(true);

      await disableBackgroundAutoInstall(cr);
      await settle(cr.page);

      // 아무 CLI 도 없으니 첫 화면은 연결 게이트다.
      await expect(cr.page.getByTestId("beginner-connect")).toBeVisible();
      const beforeInstalls = (await cr.installCalls()).length;

      // ── ② 원클릭: 한 번 눌러 미설치 CLI 를 일괄 설치 ──────────────────
      await expect(cr.page.getByTestId("beginner-oneclick-cta")).toBeVisible();
      await cr.page.getByTestId("beginner-oneclick-cta").click();
      await expect(
        cr.page.getByTestId("beginner-oneclick-modal"),
      ).toBeVisible();
      await cr.shot("Z1-oneclick-installing");

      // ── ③ 설치가 끝나면 사인인이 **스스로** 시작된다 ──────────────────
      const phases = await waitForPhase(cr.page, "awaiting_auth");
      console.log("[cleanroom][Z1] 원클릭 국면 전이:", phases);
      expect(
        phases[phases.length - 1],
        `원클릭이 자동 사인인까지 못 갔다 (관측된 국면: ${phases.join(" → ")})`,
      ).toBe("awaiting_auth");
      // 설치는 우리 버튼이 시킨 것이다 — 두 오케 후보만(그록·안티그래비티 아님).
      const installed = (await cr.installCalls()).slice(beforeInstalls);
      console.log("[cleanroom][Z1] harness:install 호출:", installed);
      expect(installed).toContain("cli-claude-code");
      expect(installed).toContain("cli-codex");
      expect(installed).not.toContain("cli-grok");
      expect(installed).not.toContain("cli-antigravity");
      // ★로그인 터미널이 모달 **안**에 임베드됐는가. 비기너 셸에는 터미널 열이
      //   없어서, 이게 없으면 CLI 가 인쇄한 인증 URL 을 유저가 아예 못 본다.
      await expect(
        cr.page.getByTestId("beginner-oneclick-terminal"),
      ).toBeVisible();
      await settle(cr.page, 1200);
      // ★터미널이 모달 **안에** 머무는가. TerminalView 는 `absolute inset-0` 이라
      //   positioned 조상이 없으면 박스를 뚫고 나가 창 전체를 덮는다(실제로
      //   그랬다: 로그인 터미널이 뜨는 순간 앱이 통째로 사라져 보였다). 화면
      //   요소가 "보인다" 는 단언으로는 절대 안 잡히는 회귀라 좌표로 못박는다.
      const termBox = await cr.page
        .getByTestId("beginner-oneclick-terminal")
        .boundingBox();
      const painted = await cr.page.evaluate(() => {
        const el = document.querySelector(".xterm");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      console.log(
        "[cleanroom][Z1] 터미널 박스:",
        termBox,
        "실제 그려진 xterm:",
        painted,
      );
      expect(painted, "xterm 이 렌더되지 않았다").toBeTruthy();
      expect(
        painted!.width,
        "로그인 터미널이 모달 밖으로 새어 나왔다(positioned 조상 없음)",
      ).toBeLessThanOrEqual(termBox!.width + 4);
      expect(painted!.height).toBeLessThanOrEqual(termBox!.height + 4);
      await cr.shot("Z1-oneclick-awaiting-auth");

      // ── ④ 브라우저 승인 완료 → 자동 재확인 폴이 감지한다 ──────────────
      // 유저가 브라우저에서 승인한 순간에 해당한다. 여기서 "다시 확인" 을 누르지
      // 않는다는 것이 요점이다 — 폴(useCliSetupEngine)이 스스로 잡아야 한다.
      await cr.setCli("claude", "ready");
      const done = await waitForPhase(cr.page, "done", 20_000);
      console.log("[cleanroom][Z1] 인증 후 국면:", done);
      expect(
        done[done.length - 1],
        "자동 재확인 폴이 인증을 못 잡았다(수동 '다시 확인' 이 필요한 상태)",
      ).toBe("done");
      // 모달은 성공을 한 박자 보여준 뒤 스스로 닫힌다.
      await expect(cr.page.getByTestId("beginner-oneclick-modal")).toBeHidden({
        timeout: 10_000,
      });
      // 그리고 연결 게이트를 지났다.
      expect(await cr.page.getByTestId("beginner-connect").count()).toBe(0);
      await cr.shot("Z1-connected");

      // ── ⑤ 샘플 폴더 자동 연결(#872) ────────────────────────────────────
      const sample = await waitForSampleSeed(cr);
      console.log("[cleanroom][Z1] sample:ensure 결과:", sample);
      expect(sample, "첫 실행 자동 폴더 연결이 요청되지 않았다").toBeTruthy();
      expect(sample!.ok, `샘플 시드 실패: ${sample!.error ?? ""}`).toBe(true);
      const samplePath = sample!.path!;
      // ★격리 가드: 시드는 클린룸 안에서 끝나야 한다. 이 단언이 없으면 하네스가
      //   개발자의 진짜 ~/Documents 에 폴더를 만들어도 테스트는 초록이다(실제로
      //   그랬다 — helpers/cleanroom 의 app.setPath("documents") 주석 참조).
      expect(samplePath.startsWith(cr.root)).toBe(true);
      // 진짜 핸들러가 돌았으므로 디스크에 실물이 있어야 한다 — "열린 화면" 이
      // 아니라 "예제 칩이 먹히는 폴더" 가 이 기능의 정의다(#872: README 를 읽고,
      // 테스트 없는 src/format.js 에 테스트를 붙이는 칩이 실제로 먹혀야 한다).
      expect(fs.existsSync(path.join(samplePath, "README.md"))).toBe(true);
      expect(fs.existsSync(path.join(samplePath, "src", "format.js"))).toBe(
        true,
      );
      // 자동 연결이 수동 폴더 픽과 **같은 경로**를 탔는가(rootPath 는 프로젝트
      // 등록 전에 세워지므로 여기까지가 클린룸에서 실측 가능한 구간이다).
      expect(await readRootPath(cr.page)).toBe(samplePath);

      // ★여기서 프로젝트 **등록**은 클린룸이 대신한다. `connectFolderPath` 는
      //   rootPath 를 세운 뒤 Firestore 에 프로젝트를 쓰는데, 이 하네스는
      //   MARBLO_TEST_BYPASS_AUTH 의 mock 유저라 그 쓰기가 거절된다(하네스의
      //   injectProject 주석과 같은 이유). 위에서 rootPath 까지를 실측했고,
      //   그 다음 칸부터는 프로젝트가 있다는 전제 위의 화면이다.
      await injectProject(cr.page, cr.projectDir);

      // ── ⑥ 오케 챗 → 첫 요청 → 라이브 스트립 ───────────────────────────
      await cr.page
        .getByTestId("beginner-first-ask")
        .first()
        .waitFor({ state: "visible", timeout: 25_000 });
      await dismissBeginnerTour(cr.page);
      await expect(
        cr.page.locator('[data-coach="beginner-chat"]').first(),
      ).toBeVisible();
      await cr.shot("Z1-chat");

      const message = "README 를 읽고 시작 가이드를 정리해 줘";
      await cr.page.getByTestId("beginner-first-ask-input").fill(message);
      await cr.page.getByTestId("beginner-first-ask-send").click();
      await settle(cr.page, 2500);

      const injected = await cr.injected();
      console.log("[cleanroom][Z1] orchestrator injectMessage:", injected);
      expect(injected.length).toBe(1);
      expect(injected[0].message).toContain("README");
      await expect(
        cr.page.getByTestId("beginner-first-ask-result"),
      ).toHaveAttribute("data-delivery", "delivered");
      await expect(cr.page.getByTestId("beginner-live-strip")).toHaveAttribute(
        "data-phase",
        "thinking",
      );
      await cr.shot("Z1-first-ticket-delivered");
    } finally {
      await cr.close();
    }
  });

  test("Z2(대조군) 자동 설치가 막히면 조용히 끝나지 않고 수동 경로를 준다", async () => {
    // node/npm 이 없는 맥. 예전에는 이런 프로필이 비기너 연결 게이트에서
    // 아무 안내 없이 멈췄다(연결 버튼의 catch 가 실패를 삼켰다).
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "missing",
      installSucceeds: false,
      beginnerShell: true,
    });
    try {
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);
      await disableBackgroundAutoInstall(cr);
      await settle(cr.page);

      await cr.page.getByTestId("beginner-oneclick-cta").click();
      const phases = await waitForPhase(cr.page, "blocked");
      console.log("[cleanroom][Z2] 국면 전이:", phases);
      expect(phases[phases.length - 1]).toBe("blocked");

      // 막혔다면 수동 명령과 공식 문서가 그 자리에 있어야 한다.
      const blocked = cr.page.getByTestId("beginner-oneclick-blocked");
      await expect(blocked).toBeVisible();
      await expect(blocked.locator("code").first()).toContainText("claude.ai");
      await expect(
        cr.page.getByTestId("beginner-oneclick-retry"),
      ).toBeVisible();
      await cr.shot("Z2-blocked-manual-fallback");

      // 그리고 빠져나갈 길("직접 고를게요")은 항상 열려 있다.
      await cr.page.getByTestId("beginner-oneclick-manual").click();
      await settle(cr.page, 600);
      expect(await cr.page.getByTestId("beginner-oneclick-modal").count()).toBe(
        0,
      );
      await expect(cr.page.getByTestId("beginner-connect")).toBeVisible();
    } finally {
      await cr.close();
    }
  });
});

/** 첫 실행 샘플 시드가 요청될 때까지 기다린다(안 오면 null). */
async function waitForSampleSeed(cr: CleanRoom, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const calls = await cr.sampleEnsureCalls();
    if (calls.length > 0) return calls[0];
    await cr.page.waitForTimeout(300);
  }
  return null;
}
