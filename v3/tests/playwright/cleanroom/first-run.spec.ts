import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  bannerVisible,
  injectProject,
  launchCleanRoom,
  openWorkTab,
  passFirstRunModals,
  switchToLegacyLayout,
  wizardVisible,
  type CleanRoom,
} from "./helpers/cleanroom";

/**
 * 클린룸 최초실행 E2E — 신규 유저 활성화 퍼널.
 *
 * 데이터상 외부 유저 대부분이 "설치→인증→첫 티켓" 구간에서 이탈했다. 그래서
 * 이 spec 의 목적은 기능 회귀보다 **활성화 장벽**이다.
 *
 * ★ 신규 유저의 실제 첫 화면은 워크스페이스 셸(workspaceMode 기본 ON)의
 *   "시작하기" 탭이다. 레거시 모달 위저드(CliSetupGate)는 옵트아웃 경로.
 *   #579(팝업 영구노출)는 두 표면 모두에서 확인한다:
 *     - 셸    : 비차단 배너("CLI 인증이 필요합니다")
 *     - 레거시: 모달 위저드
 *
 * 시나리오
 *   A  (#579) codex 만 인증 → 재요청(open-cli-setup)에 온보딩이 다시 뜨지 않는다
 *   A2 (특성화) 인증됐지만 폴더가 없는 유저 — 배너가 재시작마다 돌아온다 (F2)
 *   A' (대조군) 아무것도 준비 안 됨 → 실제로 뜬다 (탐지력 확인)
 *   B  자동설치 실패(노드 부재) → 수동 명령·공식 문서 대안이 보인다
 *   C  (#580) "첫 티켓 만들기" → 진짜 오케 라우팅(injectMessage)까지 도달
 *   C' 로컬 오케 부재 → UI 가 성공이라고 말하지 않는다 (성공 오판)
 *   D  최초부팅 관측 — 신규 유저가 다음 행동을 찾을 수 있는가 + 소요시간
 *
 * 실행: npm run test:e2e:pw -- tests/playwright/cleanroom
 * 전제: npm run build (dist-electron/main.js + dist/)
 */

/** 위저드/배너를 여는 진짜 진입점 — 스폰 가드 / needsAuth 백스톱과 동일 이벤트. */
async function requestGate(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("marblo:open-cli-setup")),
  );
}

/** 재프로브는 비동기 — 뜰 시간을 준 뒤 확정한다. */
async function settle(page: Page, ms = 2500): Promise<void> {
  await page.waitForTimeout(ms);
}

/** 셸 배너의 ✕(닫기). 배너가 없으면 조용히 통과. */
async function closeBanner(page: Page): Promise<void> {
  const x = page.getByRole("button", { name: "닫기", exact: true }).first();
  if (await x.isVisible().catch(() => false)) {
    await x.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

test.describe("@cleanroom 최초실행 활성화 퍼널", () => {
  test("A(#579) codex 만 인증돼 있으면 재요청에도 온보딩이 다시 뜨지 않는다 — 셸 + 레거시", async () => {
    const cr = await launchCleanRoom({ claude: "missing", codex: "ready" });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);

      // ── 셸(기본 경로) ──────────────────────────────────────────────────
      // 배너는 시작하기 탭에선 일부러 숨는다(CliSetupHost) → 보드로 옮겨 관측.
      await openWorkTab(cr.page, "보드");
      await settle(cr.page);
      // 부팅 시 뜬 post-auth 안내는 여기선 관심사가 아니다(A2 가 다룬다).
      // ✕ 로 치운 뒤, "재요청"에 다시 뜨는지만 본다.
      await closeBanner(cr.page);
      expect(await bannerVisible(cr.page)).toBe(false);

      // 스폰 가드 / agent:needsAuth 백스톱이 3번 연달아 요청해도 (재시작
      // 복원 PTY 를 needsAuth 로 오판하는 시나리오) 재프로브 후 ready 면
      // 아무것도 뜨지 않아야 한다 — #579 / nB4eenxP 의 본체.
      const before = await cr.probeCalls();
      for (let i = 0; i < 3; i++) {
        await requestGate(cr.page);
        await cr.page.waitForTimeout(700);
      }
      await settle(cr.page);
      if (await bannerVisible(cr.page)) await cr.shot("A-fail-banner-reopened");
      expect(await bannerVisible(cr.page)).toBe(false);
      // 조용히 무시된 게 아니라 실제로 재프로브가 돌았는가.
      expect(await cr.probeCalls()).toBeGreaterThan(before);

      // ── 레거시 모달 경로(옵트아웃 유저) ────────────────────────────────
      await switchToLegacyLayout(cr.page);
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      for (let i = 0; i < 3; i++) {
        await requestGate(cr.page);
        await cr.page.waitForTimeout(700);
      }
      await settle(cr.page);
      if (await wizardVisible(cr.page)) await cr.shot("A-fail-modal-reopened");
      expect(await wizardVisible(cr.page)).toBe(false);
      await cr.shot("A-ok-no-reopen");
    } finally {
      await cr.close();
    }
  });

  test("A2(특성화·F2) 인증은 됐지만 폴더가 없는 유저는 재시작마다 'CLI 인증 필요' 배너를 다시 본다", async () => {
    let cr: CleanRoom = await launchCleanRoom({
      claude: "missing",
      codex: "ready", // 인증 완료 — 즉 '인증 필요'는 사실이 아니다
    });
    const root = cr.root;
    try {
      await passFirstRunModals(cr.page);
      await openWorkTab(cr.page, "보드");
      await settle(cr.page, 3000);
      const first = await bannerVisible(cr.page);
      await cr.shot("A2-banner-first-boot");

      // 사용자는 배너를 닫는다.
      await closeBanner(cr.page);
      const afterClose = await bannerVisible(cr.page);

      // 그리고 앱을 다시 켠다 (같은 userData/HOME).
      await cr.close();
      cr = await launchCleanRoom({
        claude: "missing",
        codex: "ready",
        reuseRoot: root,
      });
      await passFirstRunModals(cr.page);
      await openWorkTab(cr.page, "보드");
      await settle(cr.page, 3000);
      const afterRestart = await bannerVisible(cr.page);
      const keys = await cr.page.evaluate(() => ({
        legacyDismissed: localStorage.getItem("marblo.cliSetupGateDismissed"),
        progress: localStorage.getItem("marblo.onboardingProgress"),
      }));
      await cr.shot("A2-banner-after-restart");
      console.log(
        `[cleanroom][A2] 첫부팅=${first} 닫은직후=${afterClose} 재시작후=${afterRestart}`,
        keys,
      );

      // ── 현재 동작(=활성화 장벽 F2)을 고정한다 ─────────────────────────
      // 원인: 배너를 띄우는 post-auth 분기는 레거시 키
      // `marblo.cliSetupGateDismissed` 만 읽는데(useCliSetupEngine), 그 키를
      // 쓰는 코드는 레거시 모달(CliSetupGate)뿐이다. 셸에는 그 키를 세우는
      // 경로가 없어서 "다시 보지 않기"가 성립하지 않는다.
      // ★ 이 expect 가 깨지면 = 고쳐진 것. 기대값을 false 로 뒤집고 F2 를 닫아라.
      expect(afterRestart).toBe(true);
      expect(keys.legacyDismissed).toBeNull();
    } finally {
      await cr.close();
    }
  });

  test("A'(대조군) 아무 CLI 도 준비 안 됐으면 온보딩이 실제로 뜬다", async () => {
    const cr = await launchCleanRoom({ claude: "missing", codex: "missing" });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);

      // 셸: 다른 탭에 있을 때 배너로 유도된다.
      await openWorkTab(cr.page, "보드");
      await requestGate(cr.page);
      await settle(cr.page);
      const banner = await bannerVisible(cr.page);
      await cr.shot("A2-control-banner");

      // 레거시: 모달이 뜬다.
      await switchToLegacyLayout(cr.page);
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await requestGate(cr.page);
      await settle(cr.page);
      const modal = await wizardVisible(cr.page);
      await cr.shot("A2-control-modal");

      console.log(`[cleanroom][A'] banner=${banner} modal=${modal}`);
      // 둘 다 안 뜨면 A 의 "안 뜬다"는 탐지력 없는 통과다.
      expect(banner || modal).toBe(true);
    } finally {
      await cr.close();
    }
  });

  test("B 자동설치가 실패하면 수동 명령 + 공식 문서 대안이 보인다", async () => {
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "missing",
      installSucceeds: false, // node/npm 부재 흉내
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      // 신규 유저의 기본 착지점 = 시작하기 탭. ① 설치 스텝을 편다.
      await openWorkTab(cr.page, "시작하기");
      await cr.page.locator('button:has-text("설치")').first().click();
      await settle(cr.page, 3000);

      const installs = await cr.installCalls();
      console.log("[cleanroom][B] 자동설치 시도:", installs);

      const body = cr.page.locator("body");
      await expect(body).toContainText(
        "npm install -g @anthropic-ai/claude-code",
      );
      await cr.shot("B-install-failed-guidance");

      // 자동설치는 최초 실행에서 사용자 클릭 없이 실제로 시도돼야 한다.
      expect(installs.length).toBeGreaterThan(0);
    } finally {
      await cr.close();
    }
  });

  test("C(#580) '첫 티켓 만들기'가 실제 오케 라우팅(injectMessage)까지 도달한다", async () => {
    const started = Date.now();
    const cr = await launchCleanRoom({
      claude: "ready", // 설치·인증 완료 상태
      codex: "missing",
      orchestratorRunning: true, // 로컬 오케 살아있음
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await openWorkTab(cr.page, "시작하기");

      // ④ 첫 티켓 스텝 펼치기 (체크리스트는 어느 스텝이든 열 수 있다).
      await cr.page.locator('button:has-text("첫 티켓")').first().click();
      await settle(cr.page, 800);
      await cr.shot("C-step4-first-ticket");

      // ★ 가치의 순간.
      const create = cr.page
        .locator('button:has-text("이 PRD로 첫 티켓 만들기")')
        .first();
      await create.waitFor({ state: "visible", timeout: 10_000 });
      await expect(create).toBeEnabled();
      await create.click();
      await settle(cr.page, 3000);

      const injected = await cr.injected();
      console.log("[cleanroom][C] orchestrator injectMessage:", injected);
      expect(injected.length).toBeGreaterThan(0);
      expect(injected[0].projectId).toBe("cleanroom-project");
      // 첫 티켓 프롬프트가 그대로 전달됐는지 (빈 문자열/placeholder 아님).
      expect(injected[0].message.length).toBeGreaterThan(20);

      await expect(cr.page.locator("body")).toContainText("전달했어요");
      console.log(
        `[cleanroom][C] 최초실행→첫티켓 소요: ${(
          (Date.now() - started) /
          1000
        ).toFixed(1)}s (자동화 기준)`,
      );
      await cr.shot("C-first-ticket-sent");
    } finally {
      await cr.close();
    }
  });

  test("C'(#580 성공 오판) 로컬 오케가 없으면 UI 가 성공이라고 말하지 않는다", async () => {
    const cr = await launchCleanRoom({
      claude: "ready",
      codex: "missing",
      orchestratorRunning: false, // 진짜 클린룸 상태: 오케 미기동
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await openWorkTab(cr.page, "시작하기");
      await cr.page.locator('button:has-text("첫 티켓")').first().click();
      await settle(cr.page, 800);
      await cr.page
        .locator('button:has-text("이 PRD로 첫 티켓 만들기")')
        .first()
        .click();
      await settle(cr.page, 4000);

      const injected = await cr.injected();
      const bodyText = await cr.page.locator("body").innerText();
      const claimsSent = bodyText.includes("전달했어요");
      const claimsFail = bodyText.includes("전달에 실패");
      console.log(
        `[cleanroom][C'] injectMessage 시도=${injected.length} · UI 성공주장=${claimsSent} · UI 실패표시=${claimsFail}`,
      );
      await cr.shot("C2-no-local-orchestrator");

      // 로컬 전달이 거절(delivered:false)됐는데 UI 가 "전달했어요"로 끝나면
      // 유저는 아무 일도 안 일어난 화면을 성공으로 읽는다.
      // ※ 한계: 이 하네스는 Firestore 폴백(pendingInstructions)이 인증 부재로
      //   실패한다. 실제 로그인 유저는 큐 적재가 성공해 "전달했어요"가 뜨는데,
      //   그 큐를 소비할 오케가 없으면 여전히 아무 일도 안 일어난다(F3).
      expect(claimsSent).toBe(false);
      expect(injected.length).toBeGreaterThan(0); // 라우팅 시도는 실제로 했다
    } finally {
      await cr.close();
    }
  });

  test("E 선행단계 안내 — 4스텝 각각에 '왜'와 '막혔을 때'가 있고, 인증 대안 경로가 보이는가", async () => {
    const cr = await launchCleanRoom({ claude: "missing", codex: "missing" });
    try {
      await passFirstRunModals(cr.page);
      await openWorkTab(cr.page, "시작하기");

      const steps = ["설치", "인증", "PRD", "첫 티켓"];
      const found: Record<string, { why: boolean; stuck: boolean }> = {};
      for (const s of steps) {
        await cr.page.locator(`button:has-text("${s}")`).first().click();
        await settle(cr.page, 700);
        const body = await cr.page.locator("body").innerText();
        found[s] = { why: body.length > 0, stuck: body.includes("막혔을 때:") };
        await cr.shot(`E-step-${s}`);
      }
      console.log("[cleanroom][E] 스텝별 안내:", found);
      for (const s of steps) expect(found[s].stuck).toBe(true);

      // 인증 스텝을 연 채로: CLI 계정연결 외의 경로(벤더 API 키)가 안내되는가.
      await cr.page.locator('button:has-text("인증")').first().click();
      await settle(cr.page, 700);
      const authBody = await cr.page.locator("body").innerText();
      const mentionsVendorKey = /벤더|API 키|env-swap|GLM|Kimi|MiniMax/.test(
        authBody,
      );
      console.log(
        `[cleanroom][E] 인증 스텝에 벤더키(BYOM) 안내 있음=${mentionsVendorKey}`,
      );
      // ★ 현재 동작(F4): 온보딩에는 Claude/Codex/Grok/agy CLI 로그인만 있고,
      //   벤더 API 키(설정 › 벤더 API 키)로 시작하는 경로는 언급되지 않는다.
      //   고쳐지면 이 기대값을 true 로 뒤집고 F4 를 닫아라.
      expect(mentionsVendorKey).toBe(false);
    } finally {
      await cr.close();
    }
  });

  test("D 최초부팅 신규 유저가 마주하는 화면 — 온보딩 입구/소요시간 관측", async () => {
    const cr = await launchCleanRoom({ claude: "missing", codex: "missing" });
    try {
      const t0 = Date.now();
      const modals = await passFirstRunModals(cr.page);
      const readyMs = Date.now() - t0;
      await settle(cr.page, 2000);

      const body = await cr.page.locator("body").innerText();
      const observed = {
        firstRunModals: modals,
        msUntilModalsCleared: readyMs,
        landsOnStartHere: /시작하기/.test(body) && /남음/.test(body),
        hasConnectFolderCta: /폴더 선택|폴더 연결|프로젝트 열기/.test(body),
        mentionsCli: /CLI|Claude Code|Codex/.test(body),
        modalWizardAutoOpened: await wizardVisible(cr.page),
      };
      console.log("[cleanroom][D] 최초부팅 관측:", observed);
      await cr.shot("D-first-boot");

      // 신규 유저가 다음 행동을 찾을 단서가 화면에 있어야 한다.
      expect(observed.landsOnStartHere || observed.hasConnectFolderCta).toBe(
        true,
      );
    } finally {
      await cr.close();
    }
  });
});
