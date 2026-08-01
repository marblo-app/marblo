import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  bannerTitle,
  bannerVisible,
  dismissBanner,
  doneSteps,
  injectProject,
  launchCleanRoom,
  openWorkTab,
  passFirstRunModals,
  passFirstRunModalsTimed,
  switchToLegacyLayout,
  waitForAppShell,
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

/** 셸 배너의 ✕(닫기 = 다시 띄우지 않기). 배너가 없으면 조용히 통과. */
const closeBanner = dismissBanner;

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

  test("A2(F2 회귀가드) 인증은 됐고 폴더만 없는 유저 — 배너 제목이 사실과 맞고, ✕ 는 재시작 뒤에도 유지된다", async () => {
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
      const firstTitle = await bannerTitle(cr.page);
      await cr.shot("A2-banner-first-boot");

      // 배너가 떴다면 제목은 실제 상황(=폴더 미연결)을 말해야 한다. codex 는
      // 이미 로그인돼 있으므로 "CLI 인증이 필요합니다"는 거짓말이다.
      if (first) {
        expect(firstTitle).toBe("작업할 폴더를 연결해 주세요");
      }

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
        progress: localStorage.getItem("marblo.onboarding.progress"),
      }));
      await cr.shot("A2-banner-after-restart");
      console.log(
        `[cleanroom][A2] 첫부팅=${first} 제목="${firstTitle}" 닫은직후=${afterClose} 재시작후=${afterRestart}`,
        keys,
      );

      // ── F2 수정 후의 계약 ───────────────────────────────────────────────
      // 배너 ✕ 는 그 자리에서 사라지고(afterClose), 재시작해도 돌아오지 않는다.
      // 원래 결함: post-auth 분기가 레거시 키 `marblo.cliSetupGateDismissed`
      // 만 읽는데 셸에는 그 키를 세우는 경로가 없어서 "다시 보지 않기"가
      // 성립하지 않았다. 이제 dismissed 는 `onboardingProgress.dismissed`
      // 한 곳이고(레거시 키는 콜드스타트 seed 로 미러링), 배너 ✕ 가 그걸 쓴다.
      expect(afterClose).toBe(false);
      expect(afterRestart).toBe(false);
      // 두 표면이 같은 사실을 말하는지 — 미러링이 살아 있어야 콜드스타트
      // seed(parseProgress)가 같은 답을 낸다.
      expect(keys.legacyDismissed).toBe("1");
      expect(JSON.parse(keys.progress ?? "{}").dismissed).toBe(true);
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
        "curl -fsSL https://claude.ai/install.sh | bash",
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
      // ★F3(#635) 성공 축 — 진짜 전달(delivered)일 때만 단계가 완료로 찍힌다.
      const done = await doneSteps(cr.page);
      console.log("[cleanroom][C] 완료로 찍힌 단계:", done);
      expect(done).toContain("firstTicket");
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
      expect(claimsSent).toBe(false);
      expect(injected.length).toBeGreaterThan(0); // 라우팅 시도는 실제로 했다

      // ★F3(#635) 실패 축 — 전달되지 않았으면 단계도 완료로 찍히지 않는다.
      //   (예전엔 local 과 queued 를 한데 접어 성공으로 끝냈다.)
      const done = await doneSteps(cr.page);
      console.log("[cleanroom][C'] 완료로 찍힌 단계:", done);
      expect(done).not.toContain("firstTicket");

      // ── ★이 하네스가 못 만드는 상태: queued ────────────────────────────
      // 세 결과(delivered / queued / failed) 중 여기서 재현되는 것은 delivered(C)
      // 와 failed(여기)뿐이다. queued 는 "로컬 오케엔 못 넣었지만 Firestore
      // `pendingInstructions` 적재는 성공" 이라는 상태인데, 이 클린룸은
      // MARBLO_TEST_BYPASS_AUTH 라 그 쓰기가 거절돼 failed 로 떨어진다(위 로그의
      // UI 실패표시=true 가 그 증거). 실계정 로그인 없이는 만들 수 없는 상태라
      // 분기 규칙 자체는 유닛테스트(first-ticket-queued-vs-delivered)가 못박고,
      // 라이브 확인은 별 티켓(맥북에어 런북)에서 한다.
      expect(bodyText).not.toContain(
        "오케스트레이터를 띄워야 첫 티켓이 실제로 만들어집니다",
      );
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
      // ★ 페이지 전체(body)가 아니라 **열린 스텝의 본문**만 본다. 탭 하단의
      //   VendorModelsSection("다른 벤더 모델도 붙일 수 있어요", #632)이 항상
      //   렌더되므로 body 전체를 훑으면 "인증 스텝이 BYOM 을 안내한다"가 항상
      //   참으로 나온다 — F4 가 묻는 것과 다른 것을 재는 오탐이다.
      //   "막혔을 때:" 문단은 열린 스텝에만 렌더되므로 그 스텝 섹션이 곧
      //   인증 스텝의 본문이다.
      const authStep = cr.page
        .locator('section:has(p:has-text("막혔을 때:"))')
        .first();
      const authBody = await authStep.innerText();
      const mentionsVendorKey = /벤더|API 키|env-swap|GLM|Kimi|MiniMax/.test(
        authBody,
      );
      console.log(
        `[cleanroom][E] 인증 스텝에 벤더키(BYOM) 안내 있음=${mentionsVendorKey}`,
      );
      // ★F4 닫힘(#636) — 이 기대값은 원래 false 였다(인증 스텝이 Claude/Codex CLI
      //   로그인만 제시하던 시절의 특성화). 이제 ②단계 본문에 BYOM 시작 경로가
      //   있으므로 true 로 뒤집는다. 되돌아가면 여기서 깨진다.
      expect(mentionsVendorKey).toBe(true);
      // 정규식만으로는 "벤더" 라는 낱말이 어딘가 스쳤다"도 참이 된다 — ②단계가
      // 실제로 **시작 경로**를 제시하는지 제목으로 못박는다(ByomStartSection).
      expect(authBody).toContain("벤더 키로 시작하기");
    } finally {
      await cr.close();
    }
  });

  test("D 최초부팅 신규 유저가 마주하는 화면 — 온보딩 입구/소요시간 관측", async () => {
    const cr = await launchCleanRoom({ claude: "missing", codex: "missing" });
    try {
      const t0 = Date.now();
      const pass = await passFirstRunModalsTimed(cr.page);
      // 모달이 부팅보다 먼저 끝나므로 셸이 뜰 때까지 기다려야 한다(F5 수정 후).
      const shellUp = await waitForAppShell(cr.page);
      const msUntilAppUsable = Date.now() - t0;
      await settle(cr.page, 2000);

      const body = await cr.page.locator("body").innerText();
      const observed = {
        firstRunModals: pass.passed,
        msUntilModalsCleared: pass.totalMs,
        msBetweenModals: pass.gapMs,
        msUntilAppUsable,
        shellUp,
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

      // ★F5 닫힘 — 이 기대값은 원래 "그냥 관측"이었다(실측 5012ms, 언어 →
      //   ~5초 뒤 동의). 두 모달이 서로 다른 축(localStorage vs auth+Firestore)
      //   에 걸려 있어서, 그 사이 유저는 조작 가능한 화면을 만졌다가 두 번째
      //   전면 오버레이에 클릭을 뺏겼다. 이제 FirstRunFlow 한 흐름에서
      //   연속으로 뜬다 — 되돌아가면(동의를 다시 로그인 뒤로 미루면) 여기서
      //   깨진다.
      expect(observed.firstRunModals).toEqual(["language", "privacy-consent"]);
      expect(observed.msBetweenModals).not.toBeNull();
      // 연속 렌더면 폴링 오차(100ms) 수준. 1.5s 는 CI 지터까지 감안한 상한이지
      // 목표치가 아니다 — 실측은 수백 ms 다.
      expect(observed.msBetweenModals ?? Infinity).toBeLessThan(1500);
    } finally {
      await cr.close();
    }
  });

  test("D2(F5 계약) 최초실행에서 언어·동의를 둘 다 받고, 재시작 때 다시 묻지 않는다", async () => {
    // F5 수정의 다른 절반: 두 게이트를 앞당겼다고 해서 수집을 건너뛰거나,
    // 반대로 매 부팅 다시 묻게 되면 안 된다.
    let cr = await launchCleanRoom({ claude: "missing", codex: "missing" });
    const root = cr.root;
    try {
      const first = await passFirstRunModalsTimed(cr.page);
      expect(first.passed).toEqual(["language", "privacy-consent"]);
      await waitForAppShell(cr.page);
      await settle(cr.page, 2000);

      // 답이 실제로 어딘가에 적혔는가. 클린룸은 bypassAuth mock 유저라
      // Firestore 쓰기가 뜨지 않으므로 답은 pending 에 남는다(= 다음 부팅에
      // 재시도). 진짜 유저라면 flush 성공 후 accepted 캐시로 옮겨간다. 둘 중
      // 어느 쪽이든 "답이 유실되지 않았다"가 이 단언의 내용이다.
      const stored = await cr.page.evaluate(() => ({
        locale: localStorage.getItem("marblo:locale"),
        pending: localStorage.getItem("marblo:pendingConsent"),
        accepted: Object.keys(localStorage).filter((k) =>
          k.startsWith("marblo:consentAccepted:"),
        ),
        flowInProgress: localStorage.getItem("marblo.firstRun.inProgress"),
      }));
      console.log("[cleanroom][D2] 최초실행 후 저장 상태:", stored);
      expect(stored.locale).toMatch(/^(ko|en)$/); // 언어 수집됨
      expect(stored.pending !== null || stored.accepted.length > 0).toBe(true);
      // 흐름이 끝났으므로 진행중 표시는 지워져 있어야 한다 — 남아 있으면
      // 재시작 때 동의를 또 묻는다.
      expect(stored.flowInProgress).toBeNull();

      // ── 같은 userData 로 재시작 ────────────────────────────────────────
      await cr.close();
      cr = await launchCleanRoom({
        claude: "missing",
        codex: "missing",
        reuseRoot: root,
      });
      const second = await passFirstRunModalsTimed(cr.page);
      await waitForAppShell(cr.page);
      await settle(cr.page, 2000);
      await cr.shot("D2-restart-no-modals");
      console.log("[cleanroom][D2] 재시작 시 뜬 모달:", second.passed);

      // 이미 답한 유저에게 아무것도 다시 묻지 않는다.
      expect(second.passed).toEqual([]);
    } finally {
      await cr.close();
    }
  });
});
