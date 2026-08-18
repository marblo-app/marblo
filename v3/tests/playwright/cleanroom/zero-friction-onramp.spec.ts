import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  dismissFundingGuide,
  dismissOnrampBlock,
  injectProject,
  launchCleanRoom,
  passFirstRunModals,
  readRootPath,
  readSplitWorkspace,
  waitForAppShell,
  type CleanRoom,
} from "./helpers/cleanroom";

/**
 * 제로마찰 온램프 E2E — 시작하기 → 원클릭 모두설치 → 자동 사인인 → 샘플 폴더
 * 자동연결 → 오케 노출 → 첫 티켓의 **엣지케이스·회귀가드**.
 *
 * 이 파일은 해피패스 커버리지가 아니다. 해피패스는 이미 두 곳에 있다:
 *   - first-run.spec.ts  (A/B/C/D — 배너 재노출, 설치 실패 폴백, 첫 티켓 라우팅)
 *   - beginner-first-run.spec.ts (G1~G8 — 비기너 셸 첫실행 통합 흐름)
 * 여기서 묻는 것은 "정상 경로가 도는가" 가 아니라 **정상 경로에서 벗어났을 때
 * 사용자가 죽은 화면에 갇히지 않는가**, 그리고 **원클릭이 사용자의 것을 건드리지
 * 않는가** 다. 사장님 직접 시연·런칭 직전이라 엣지에서의 파손이 치명적이다.
 *
 * 시나리오
 *   Z1  원클릭 모두설치는 **미설치 행만** 건드린다 + 설치≠준비(오케 안 열림)
 *   Z2  일부만 설치 성공 — 실패 행은 수동 명령·공식문서 폴백을 그대로 유지
 *   Z3  인증이 아직 안 끝났다 → 화면을 뺏지 않고 폴이 계속 돈다 → 끝나면 오케 노출
 *   Z4  ★원클릭 사인인이 타이핑하는 실제 명령 — 인스톨러를 치면 안 된다
 *   Z5  ★샘플 폴더가 이미 있으면 한 바이트도 안 쓴다(clobber 금지) + 진짜
 *       ~/Documents 는 건드리지 않는다(하네스 격리 실효성)
 *   Z6  ★기존 흔적 유저(이전 세션 폴더 복원) → 샘플을 만들지 않고 자기 폴더
 *   Z7  시드는 기기당 1회 — 재시작해도 되살아나지 않는다
 *   Z8  ★콜드스타트 ready 엣지가 사용자의 탭·터미널 배치를 뺏지 않는다
 *   Z9  첫 티켓 전송 중 중복 클릭 가드 + 전달된 뒤엔 재전송 CTA 를 띄우지 않는다
 *
 * 실행: npm run test:e2e:pw -- tests/playwright/cleanroom/zero-friction-onramp.spec.ts
 * 전제: npm run build (dist-electron/main.js + dist/)
 *
 * ※ 이 맥에서 진짜 probe 는 클린룸이 될 수 없다(하드코딩 PATH + 키체인). 설치/
 *   인증 축은 전부 main process IPC 스텁으로 구동한다 — 렌더러 → preload → IPC
 *   경로는 진짜 그대로다.
 */

const START_HERE = "시작하기";
const STEP_ID: Record<string, "install" | "auth" | "prd" | "firstTicket"> = {
  설치: "install",
  인증: "auth",
  "첫 티켓": "firstTicket",
};

async function settle(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms);
}

/** 조건이 참이 될 때까지 폴링. 폴이 도는 비동기 전환(재프로브 등)용. */
async function waitUntil(
  page: Page,
  predicate: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

/** 시작하기 탭을 열고 지정한 스텝 헤더를 편다. */
async function openStep(page: Page, label: string): Promise<void> {
  await waitForAppShell(page);
  await dismissAdvancedTour(page);
  await dismissOnrampBlock(page);
  await dismissFundingGuide(page);
  const tab = page.getByRole("tab", { name: START_HERE, exact: true }).first();
  if ((await tab.getAttribute("aria-selected").catch(() => null)) !== "true") {
    await tab.click();
  }
  const step = STEP_ID[label];
  if (!step) throw new Error(`알 수 없는 시작하기 스텝: ${label}`);
  const button = page
    .getByTestId(`start-here-step-${step}`)
    .locator("button")
    .first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await button.click({ timeout: 2500 });
      break;
    } catch (err) {
      if (attempt === 3) throw err;
      await dismissOnrampBlock(page);
      await dismissFundingGuide(page);
    }
  }
  await page.waitForTimeout(600);
}

async function dismissAdvancedTour(page: Page): Promise<void> {
  const never = page.getByTestId("advanced-tour-never").first();
  if (await never.isVisible().catch(() => false)) {
    await never.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

/** 진짜 사용자 Documents 의 샘플 폴더 상태 — 하네스가 건드렸는지 대조용. */
function realSampleFolderState(): { exists: boolean; mtimeMs: number } {
  const p = path.join(os.homedir(), "Documents", "Marblo Sample");
  try {
    return { exists: true, mtimeMs: fs.statSync(p).mtimeMs };
  } catch {
    return { exists: false, mtimeMs: 0 };
  }
}

test.describe("@cleanroom 제로마찰 온램프 엣지케이스", () => {
  test("Z1 '모두 설치'는 미설치 행만 설치한다 — 그리고 설치만으로 오케가 열리지는 않는다", async () => {
    // codex 는 이미 설치돼 있고(인증만 남음) claude 만 없다. 원클릭이 이 구분을
    // 못 하면 멀쩡한 CLI 위로 셸 인스톨러(`curl … | bash`)가 다시 돈다.
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "installed",
      installPlan: { claude: "installed", grok: "installed" },
    });
    try {
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);

      // ★엔진의 **백그라운드 자동설치**를 먼저 끈다. 켜 두면 첫 부팅에서 이미
      //   claude 를 깔아버려 버튼이 "✓ 전부 설치됨" 으로 접히고(실측), 사용자가
      //   원클릭을 누르는 상황 자체가 재현되지 않는다. 자동설치 완료 플래그는
      //   앱이 쓰는 그 키 그대로다 — 두 번째 실행부터의 실제 상태이기도 하다.
      await cr.page.evaluate(() =>
        localStorage.setItem("marblo.cliAutoInstallDone", "1"),
      );
      await cr.setCli("claude", "missing"); // 자동설치 결과 되돌리기
      await cr.page.reload();
      await cr.page.waitForLoadState("domcontentloaded");
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await openStep(cr.page, "설치");

      // 여기부터가 "사용자가 누른 것" — 기준선을 잡고 클릭이 유발한 설치만 센다.
      const before = await cr.installCalls();
      const button = cr.page.getByTestId("cli-install-all-button");
      await button.waitFor({ state: "visible", timeout: 15_000 });
      await expect(button).toBeEnabled();
      await button.click();

      // 패스가 끝나면 패널은 "✓ 전부 설치됨" 한 줄로 접힌다(누를 게 없는 버튼을
      // 남기지 않는다) — 그게 곧 완료 신호다.
      const collapsed = await waitUntil(
        cr.page,
        async () =>
          (await cr.page.getByTestId("cli-install-all-button").count()) === 0,
        25_000,
      );
      const after = await cr.installCalls();
      const byClick = after.slice(before.length);
      console.log("[cleanroom][Z1] 클릭이 유발한 설치:", byClick);
      await cr.shot("Z1-install-all-done");

      expect(collapsed).toBe(true);
      // ★회귀가드: 이미 설치된 codex 행은 설치 대상이 아니다.
      expect(byClick).not.toContain("cli-codex");
      expect(byClick).toContain("cli-claude-code");
      // ★grok 은 기본 함대다(k22rGEgv) — 미설치이므로 이 패스가 같이 깐다.
      // 시나리오가 grok 을 안 줬으면 기본값이 "missing" 이라 대상이 된다.
      expect(byClick).toContain("cli-grok");
      // Antigravity 는 여전히 옵트인 — 모두 설치의 대상(autoInstall|required)이
      // 아니라서, 사용자가 고르지 않은 벤더 인스톨러는 돌지 않는다.
      expect(byClick).not.toContain("cli-antigravity");

      // ★설치 ≠ 준비. 둘 다 아직 미인증이므로 오케를 열어선 안 된다 — 여기서
      //   화면이 보드로 튀면 사용자는 "다 됐다" 로 읽고 인증을 건너뛴다.
      const view = await readSplitWorkspace(cr.page);
      console.log("[cleanroom][Z1] 설치 후 화면:", view);
      expect(view.activeTab).toBe("startHere");
    } finally {
      await cr.close();
    }
  });

  test("Z2 한 CLI 만 실패해도 나머지는 설치되고, 실패 행은 수동 명령·공식문서를 유지한다", async () => {
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "missing",
      // claude 만 실패(EACCES/네트워크), codex/grok 은 성공.
      installPlan: { claude: "fail", codex: "installed", grok: "installed" },
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await openStep(cr.page, "설치");

      const button = cr.page.getByTestId("cli-install-all-button");
      await button.waitFor({ state: "visible", timeout: 15_000 });
      await button.click();

      // 실패 행이 남았으므로 패널은 접히지 않고 결과 줄을 띄운다.
      const result = cr.page.getByTestId("cli-install-all-result");
      await result.waitFor({ state: "visible", timeout: 25_000 });
      const resultText = (await result.textContent())?.trim() ?? "";
      console.log("[cleanroom][Z2] 결과 줄:", resultText);
      await cr.shot("Z2-partial-install");

      // ★부분 실패는 전부 실패와 다른 메시지다 — "1개 실패" 가 사실대로 보여야
      //   사용자가 남은 한 행만 다시 시도한다.
      expect(resultText).toContain("1");
      // 실패했다고 패스가 중단되지 않았다 — codex/grok 도 실제로 시도됐다.
      const calls = await cr.installCalls();
      expect(calls).toContain("cli-claude-code");
      expect(calls).toContain("cli-codex");
      expect(calls).toContain("cli-grok");

      // 실패 행의 폴백(수동 명령 + 공식문서)이 화면에 그대로 있다.
      const body = cr.page.locator("body");
      await expect(body).toContainText(
        "curl -fsSL https://claude.ai/install.sh | bash",
      );
      await expect(
        cr.page.locator('a[href="https://code.claude.com/docs/en/setup"]'),
      ).toHaveCount(1);
    } finally {
      await cr.close();
    }
  });

  test("Z3 사인인이 아직 안 끝났으면 화면을 뺏지 않고 계속 지켜본다 — 끝나면 그때 오케를 연다", async () => {
    // claude 는 설치됐고 로그인만 남은 상태. 원클릭 사인인을 누른 뒤 사용자가
    // 브라우저 승인을 아직 안 한(=미인증) 구간이 이 테스트의 본체다.
    const cr = await launchCleanRoom({ claude: "installed", codex: "missing" });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await openStep(cr.page, "인증");

      const signIn = cr.page.getByTestId("cli-signin-oneclick-button");
      await signIn.waitFor({ state: "visible", timeout: 15_000 });
      await signIn.click();
      await settle(cr.page, 1500);

      // 터미널이 만들어지고 명령이 들어갔다는 안내가 뜬다.
      await expect(
        cr.page.getByTestId("cli-signin-oneclick-note"),
      ).toBeVisible();

      // ── 아직 인증 전 ────────────────────────────────────────────────────
      // 화면은 시작하기 그대로여야 한다. 여기서 보드로 튀면 사용자는 로그인을
      // 마치지 않은 채 "다 됐다" 로 읽는다.
      const mid = await readSplitWorkspace(cr.page);
      console.log("[cleanroom][Z3] 인증 대기 중 화면:", mid);
      expect(mid.activeTab).toBe("startHere");
      // 그리고 재시도 경로가 살아 있다 — 승인을 놓쳤으면 다시 누를 수 있어야 한다.
      await expect(signIn).toBeVisible();

      // 자동 재확인 폴이 실제로 돌고 있는가(수동 '다시 확인' 없이 끝나는 근거).
      const probesBefore = await cr.probeCalls();
      const polled = await waitUntil(
        cr.page,
        async () => (await cr.probeCalls()) > probesBefore,
        15_000,
      );
      console.log(
        `[cleanroom][Z3] 폴 재프로브: ${probesBefore} → ${await cr.probeCalls()}`,
      );
      expect(polled).toBe(true);

      // ── 사용자가 브라우저에서 승인을 마쳤다 ──────────────────────────────
      await cr.setCli("claude", "ready");

      // 폴이 스스로 알아채고(수동 클릭 없음) 오케를 화면에 올린다:
      // 터미널 열이 펴지고 작업 뷰가 보드로 옮겨간다.
      const revealed = await waitUntil(
        cr.page,
        async () => {
          const v = await readSplitWorkspace(cr.page);
          return v.activeTab === "board" && v.terminalCollapsed === false;
        },
        30_000,
      );
      const after = await readSplitWorkspace(cr.page);
      console.log("[cleanroom][Z3] 인증 완료 후 화면:", after);
      if (!revealed) await cr.shot("Z3-fail-no-reveal");
      else await cr.shot("Z3-orchestrator-revealed");
      expect(revealed).toBe(true);
    } finally {
      await cr.close();
    }
  });

  test("Z4(★명령주입) 원클릭 사인인은 로그인 명령을 친다 — 인스톨러를 치지 않는다", async () => {
    // ★이 시나리오의 입력이 실제 버그의 모양이다: probe 는 **미설치** CLI 의
    //   `action` 에 설치 명령(`curl … | bash`)을 담는다. 그 값을 인증 단계에서
    //   그대로 타이핑하면 로그인 대신 인스톨러가 사용자 터미널에서 돌았다.
    //   하네스의 "installed" 상태가 바로 그 action 을 들고 있으므로 입력은 진짜다.
    const cr = await launchCleanRoom({ claude: "installed", codex: "missing" });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await openStep(cr.page, "인증");

      const signIn = cr.page.getByTestId("cli-signin-oneclick-button");
      await signIn.waitFor({ state: "visible", timeout: 15_000 });
      await signIn.click();

      // launchLogin 은 셸 프롬프트를 기다렸다가(700ms) 타이핑한다.
      const typed = await waitUntil(
        cr.page,
        async () => (await cr.typedCommands()).length > 0,
        15_000,
      );
      const commands = await cr.typedCommands();
      console.log("[cleanroom][Z4] 터미널에 자동 입력된 명령:", commands);
      await cr.shot("Z4-signin-command");

      expect(typed).toBe(true);
      expect(commands).toHaveLength(1);
      expect(commands[0].data).toBe("claude login");
      // 회귀가드를 문자열 한 개에 걸지 않는다 — 어떤 형태의 인스톨러도 금지다.
      expect(commands[0].data).not.toContain("curl");
      expect(commands[0].data).not.toContain("install.sh");
      // 우리 터미널 세션에 들어갔다(빈 id 로 새어나간 게 아니라).
      expect(commands[0].sessionId.length).toBeGreaterThan(0);
    } finally {
      await cr.close();
    }
  });

  test("Z5(★clobber 금지) 샘플 폴더가 이미 쓰이고 있으면 한 바이트도 쓰지 않는다", async () => {
    // 사용자가 같은 이름의 폴더를 이미 자기 작업에 쓰고 있는 상황. 자동 시드가
    // 여기에 파일을 얹으면 그건 데이터 사고다.
    const realBefore = realSampleFolderState();
    const cr = await launchCleanRoom({ claude: "ready", codex: "missing" });
    const userFile = path.join(cr.sampleDir, "my-work.txt");
    const USER_CONTENT = "사용자가 쓰던 파일 — 건드리면 안 된다\n";
    fs.mkdirSync(cr.sampleDir, { recursive: true });
    fs.writeFileSync(userFile, USER_CONTENT);
    try {
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);

      // 자동 시드는 프로젝트 스냅샷이 정착한 뒤에 판단한다(콜드스타트 빈 스냅샷
      // 오독 방지) — 호출이 올라올 때까지 기다린다.
      const called = await waitUntil(
        cr.page,
        async () => (await cr.sampleCalls()).length > 0,
        30_000,
      );
      await settle(cr.page, 2000);
      const entries = fs.readdirSync(cr.sampleDir).sort();
      console.log("[cleanroom][Z5] 시드 호출:", await cr.sampleCalls());
      console.log("[cleanroom][Z5] 폴더 내용:", entries);
      await cr.shot("Z5-existing-sample-folder");

      // 자동 시드는 실제로 시도됐다(=이 단언들이 vacuous 하지 않다).
      expect(called).toBe(true);
      // ★한 바이트도 쓰지 않았다: 사용자 파일 그대로, 샘플 파일은 하나도 없다.
      expect(fs.readFileSync(userFile, "utf8")).toBe(USER_CONTENT);
      expect(entries).toEqual(["my-work.txt"]);
      expect(fs.existsSync(path.join(cr.sampleDir, "README.md"))).toBe(false);
      expect(fs.existsSync(path.join(cr.sampleDir, "src"))).toBe(false);

      // 그리고 그 폴더는 그대로 연결된다 — 재사용은 실패가 아니다.
      const root = await readRootPath(cr.page);
      console.log("[cleanroom][Z5] 연결된 폴더:", root);
      expect(root).toBe(cr.sampleDir);

      // ★하네스 격리 실효성: macOS 의 app.getPath("documents") 는 $HOME 을 따르지
      //   않는다(실측). 스텁이 빠지면 이 테스트가 개발자의 진짜 Documents 에
      //   폴더를 만든다 — 그 회귀를 여기서 잡는다.
      const realAfter = realSampleFolderState();
      expect(realAfter.exists).toBe(realBefore.exists);
      expect(realAfter.mtimeMs).toBe(realBefore.mtimeMs);
    } finally {
      await cr.close();
    }
  });

  test("Z6(★비기너 오판 방지) 이미 자기 폴더를 쓰던 유저에게는 샘플을 만들지 않는다", async () => {
    // 이전 세션의 폴더가 복원되는 유저(useSessionRestore → appState.load).
    // 자동 시드가 여기서 한 번이라도 돌면 복귀 유저의 창이 샘플로 갈아탄다.
    // 사용자가 원래 쓰던 저장소(클린룸 밖에 미리 만들어 둔다 — 복원 경로는
    // 하네스가 폴더를 만들기 전에 정해져야 하므로).
    const ownFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), "marblo-own-repo-"),
    );
    fs.writeFileSync(path.join(ownFolder, "README.md"), "# 내 저장소\n");

    const cr = await launchCleanRoom({
      claude: "ready",
      codex: "missing",
      priorRootPath: ownFolder,
    });
    try {
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);
      // 시드가 돌 만큼 충분히 기다린다(스냅샷 정착 + 콜드스타트 백오프 이후).
      await settle(cr.page, 8000);

      const calls = await cr.sampleCalls();
      const root = await readRootPath(cr.page);
      console.log(
        `[cleanroom][Z6] 시드 호출=${calls.length} · 열린 폴더=${root}`,
      );
      await cr.shot("Z6-returning-user-no-sample");

      // ★샘플을 만들지 않는다 — 호출조차 없다(판단이 렌더러에서 끝난다).
      expect(calls).toHaveLength(0);
      expect(fs.existsSync(path.join(cr.sampleDir, "README.md"))).toBe(false);
      // 그리고 사용자가 보던 자기 폴더를 그대로 연다.
      expect(root).toBe(ownFolder);
    } finally {
      await cr.close();
      fs.rmSync(ownFolder, { recursive: true, force: true });
    }
  });

  /**
   * ★실측 발견 (이 spec 을 쓰다 밟은 것, 회귀가드가 아니라 **알려진 제품 동작**):
   * 연결돼 있던 폴더를 앱이 꺼진 사이에 **지우고** 다시 켜면, main 의
   * `restoreWindowSession` 이 살릴 루트를 못 찾아 `notifyRootPathMissing` 을
   * 부르고, 그것이 **부모 창 없는 네이티브 경고 다이얼로그**를 띄운다
   * (`dialog.showMessageBox`). macOS 에서 부모 없는 알림은 앱 모달이라 그 시점엔
   * 창이 아직 하나도 없고, 자동화에서는 누를 사람이 없어 `firstWindow` 가 영원히
   * 안 온다(실측: 30s 타임아웃, 메인 로그
   * `[Window] Saved window root no longer exists and has no fallback`).
   *
   * 사람에게는 "알림 → 확인 → 빈 창" 이라 죽지는 않지만, 자동 생성된 샘플 폴더를
   * 사용자가 정리한 흔한 경우에 **첫 화면이 네이티브 경고**가 된다. 제로마찰
   * 관점의 리스크라 티켓에 보고했고, 여기서는 재현 불가 구간이라 폴더를 지우지
   * 않고 "마커가 재시드를 막는가" 만 검증한다.
   */
  test("Z7 샘플 시드는 기기당 1회 — 재시작해도 다시 만들지 않는다", async () => {
    let cr: CleanRoom = await launchCleanRoom({
      claude: "ready",
      codex: "missing",
    });
    const root = cr.root;
    const sampleDir = cr.sampleDir;
    try {
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);
      const seeded = await waitUntil(
        cr.page,
        async () => (await cr.sampleCalls()).length > 0,
        30_000,
      );
      await settle(cr.page, 2000);
      const firstBoot = {
        calls: await cr.sampleCalls(),
        readme: fs.existsSync(path.join(sampleDir, "README.md")),
        format: fs.existsSync(path.join(sampleDir, "src", "format.js")),
        git: fs.existsSync(path.join(sampleDir, ".git")),
        marker: await cr.page.evaluate(() =>
          localStorage.getItem("marblo:firstRunSampleSeeded"),
        ),
        root: await readRootPath(cr.page),
      };
      console.log("[cleanroom][Z7] 첫 부팅:", firstBoot);
      await cr.shot("Z7-first-boot-seeded");

      // ── 대조군: 첫 부팅에서는 실제로 시드된다 ────────────────────────────
      expect(seeded).toBe(true);
      expect(firstBoot.readme).toBe(true);
      // 예제 칩("테스트가 없는 함수에 테스트를 붙여 줘")이 겨눌 대상이 실재한다.
      expect(firstBoot.format).toBe(true);
      // Marblo 의 워크트리는 git 을 요구한다 — 시드 폴더는 저장소여야 한다.
      expect(firstBoot.git).toBe(true);
      expect(firstBoot.marker).toBe(sampleDir);
      expect(firstBoot.root).toBe(sampleDir);

      // ── 앱을 다시 켠다 (같은 userData/HOME = 같은 기기) ──────────────────
      // 사용자가 샘플 안에서 계속 작업한 흔적도 만들어 둔다 — 재시드가 일어나면
      // 이 파일이 시드 파일들과 섞이거나(최악) 폴더가 초기화된 것처럼 보인다.
      await cr.close();
      const userFile = path.join(sampleDir, "내-메모.txt");
      fs.writeFileSync(userFile, "샘플에서 이어서 작업한 내용\n");
      cr = await launchCleanRoom({
        claude: "ready",
        codex: "missing",
        reuseRoot: root,
      });
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);
      await settle(cr.page, 8000);

      const secondCalls = await cr.sampleCalls();
      console.log("[cleanroom][Z7] 재시작 시드 호출:", secondCalls);
      await cr.shot("Z7-restart-no-reseed");
      // ★기기 마커가 남아 있으므로 시드를 아예 다시 시도하지 않는다.
      expect(secondCalls).toHaveLength(0);
      expect(fs.readFileSync(userFile, "utf8")).toContain("이어서 작업한 내용");
    } finally {
      await cr.close();
    }
  });

  test("Z8(★회귀가드) 이미 인증된 유저의 콜드스타트는 탭·터미널 배치를 뺏지 않는다", async () => {
    // `marblo:cli-auth-ready` 는 **이미 인증된 사용자의 콜드 스타트에서도** 뜬다
    // (probe 가 false 에서 시작해 true 로 뒤집히는 같은 엣지 — bRABKQX7/nB4eenxP).
    // 그 엣지에 화면 이동을 걸면 매 재시작마다 사용자의 탭/접힘 상태가 되돌아간다.
    const cr = await launchCleanRoom({ claude: "ready", codex: "missing" });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await waitForAppShell(cr.page);

      // 사용자가 스스로 고른 배치: 코드 탭 + 터미널 접음.
      await cr.page.evaluate(() => {
        const hatch = (
          window as unknown as {
            __marbloTest: {
              stores: {
                splitWorkspace: {
                  getState: () => {
                    setActiveTab: (t: string) => void;
                    setTerminalCollapsed: (c: boolean) => void;
                  };
                };
              };
            };
          }
        ).__marbloTest;
        hatch.stores.splitWorkspace.getState().setActiveTab("code");
        hatch.stores.splitWorkspace.getState().setTerminalCollapsed(true);
      });
      await settle(cr.page, 500);

      // 그 상태에서 준비완료 엣지가 다시 발생한다(재프로브 → ready).
      await cr.page.evaluate(() =>
        window.dispatchEvent(new CustomEvent("marblo:cli-auth-ready")),
      );
      await settle(cr.page, 2000);

      const view = await readSplitWorkspace(cr.page);
      console.log("[cleanroom][Z8] ready 엣지 후 화면:", view);
      await cr.shot("Z8-cold-start-layout-kept");

      // ★원클릭을 누른 적이 없으므로(setupInitiated=false) 아무것도 움직이지
      //   않는다. 여기서 board/펴짐으로 바뀌면 재시작마다 배치가 리셋된다.
      expect(view.activeTab).toBe("code");
      expect(view.terminalCollapsed).toBe(true);
    } finally {
      await cr.close();
    }
  });

  test("Z9 첫 티켓 — 전송 중 중복 클릭이 두 번 보내지 않고, 전달된 뒤엔 재전송을 권하지 않는다", async () => {
    // 8/4 유저는 이미 전달된 첫 요청을 14초 간격으로 세 번 더 눌렀다. 시작하기
    // 탭(어드밴스드 표면)의 같은 구간을 여기서 못박는다 — 비기너 셸 쪽은
    // beginner-first-run G4 가 본다.
    const cr = await launchCleanRoom({
      claude: "ready",
      codex: "missing",
      orchestratorRunning: true,
      // 응답을 늦춰 "전송 중" 구간을 실제로 만든다(즉답이면 잴 것이 없다).
      injectDelayMs: 2500,
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await openStep(cr.page, "첫 티켓");

      const create = cr.page
        .locator('button:has-text("이 PRD로 첫 티켓 만들기")')
        .first();
      await create.waitFor({ state: "visible", timeout: 15_000 });
      await expect(create).toBeEnabled();
      await create.click();

      // ── 전송 중 ─────────────────────────────────────────────────────────
      // 라벨이 "전달하는 중…" 으로 바뀌고 버튼이 잠긴다. 잠기지 않으면 조급한
      // 사용자가 같은 요청을 여러 번 밀어넣고 오케는 중복 티켓을 만든다.
      const busy = cr.page
        .locator('button:has-text("오케스트레이터에게 전달하는 중")')
        .first();
      await busy.waitFor({ state: "visible", timeout: 8000 });
      await expect(busy).toBeDisabled();
      // 그래도 한 번 더 눌러 본다(잠김이 진짜인지 — force 로 액션성 검사를 건너뛴다).
      await busy.click({ force: true, timeout: 2000 }).catch(() => {});
      await settle(cr.page, 500);
      expect((await cr.injected()).length).toBe(1);

      // ── 전달 완료 ───────────────────────────────────────────────────────
      const delivered = await waitUntil(
        cr.page,
        async () =>
          (await cr.page.locator("body").innerText()).includes("전달했어요"),
        20_000,
      );
      const injected = await cr.injected();
      console.log("[cleanroom][Z9] 전달된 요청:", injected);
      await cr.shot("Z9-first-ticket-delivered");

      expect(delivered).toBe(true);
      expect(injected).toHaveLength(1);
      // ★전달된 요청에는 재전송 CTA 를 띄우지 않는다 — 그 버튼이 곧 중복 티켓의
      //   초대장이다(막힌 경우에만 '다시 시도' 가 붙는다).
      expect(
        await cr.page.getByRole("button", { name: "다시 시도" }).count(),
      ).toBe(0);
    } finally {
      await cr.close();
    }
  });
});
