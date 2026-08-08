import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  beginnerShellVisible,
  beginnerTourVisible,
  dismissBeginnerTour,
  injectAgents,
  injectProject,
  injectTasks,
  launchCleanRoom,
  openBoardTab,
  passFirstRunModals,
  readBeginnerRecord,
  reseedBeginnerDecision,
  waitForAppShell,
  type PriorInstallMarkerName,
} from "./helpers/cleanroom";

/**
 * 클린룸 비기너 모드 E2E — 첫실행 통합 흐름 회귀가드 (#854 셸 · #857 코치마크 ·
 * #856 미니보드/미니에이전트).
 *
 * 세 PR 이 남긴 것은 전부 **유닛테스트**다: 순수 규칙(`lib/beginnerMode`,
 * `lib/coachmark`)은 촘촘히 못박혀 있지만, 그 규칙이 `App.tsx` 의 셸 분기와 실제
 * 스토어·localStorage 에 물렸을 때 무엇이 그려지는지는 아무도 안 재고 있었다.
 * 이 spec 이 그 구간이다.
 *
 * ★가장 큰 리스크는 기능이 아니라 **진입판정**이다. 잘못된 방향의 오탐(신규를
 * 어드밴스드로)은 종전과 같은 화면일 뿐이지만, 반대(기존 유저를 비기너로)는
 * 쓰던 사람의 보드가 사라지는 사고다. G2 가 그 표를 화면 층위에서 재현한다 —
 * 유닛테스트는 순수함수에 마커 조합을 넣어 보지만, 여기서 묻는 것은 "그 키가
 * 실제로 깔린 프로필로 앱을 켜면 보드가 그대로 있는가" 다.
 *
 * 시나리오
 *   G1  깨끗한 신규 설치 → 비기너 셸 (+ 어드밴스드 표면 부재)
 *   G2  ★회귀가드: 이전-사용 마커 4종 각각 → 어드밴스드 + 보드 실재. 대조군 포함
 *   G3  인증 택1(claude 만) → 폴더 게이트 → 풀스크린 오케챗
 *   G4  첫 요청 전달 → 라이브 스트립(국면·미니보드·미니에이전트) + 중복전송 가드
 *   G5  (대조군) 전달 실패면 폼이 잠기지 않고 스트립도 안 뜬다
 *   G6  코치마크 투어 4스텝 완주 → 재노출 없음 → 상단 개발모드 전환
 *   G7  승격 모달(완료 3건) — '지금은 그대로' 는 다시 안 뜬다
 *   G8  승격 수락 → 어드밴스드 셸 + 보드에 티켓이 그대로 있다
 *
 * 실행: npm run test:e2e:pw -- tests/playwright/cleanroom/beginner-first-run.spec.ts
 * 전제: npm run build (dist-electron/main.js + dist/)
 *
 * ※ 이 맥에서 진짜 probe 는 클린룸이 될 수 없다(하드코딩 PATH + 키체인, 하네스
 *   주석 참조). 설치/인증 축은 전부 main process IPC 스텁으로 구동한다.
 */

async function settle(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms);
}

/** 비기너 셸이 연결·폴더 게이트를 지나 챗 국면에 도달했는지. */
async function chatReady(page: Page): Promise<void> {
  await page
    .getByTestId("beginner-first-ask")
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
}

/** 라이브 스트립의 현재 국면(`data-phase`). 스트립이 없으면 null. */
async function livePhase(page: Page): Promise<string | null> {
  const strip = page.getByTestId("beginner-live-strip").first();
  if (!(await strip.isVisible().catch(() => false))) return null;
  return strip.getAttribute("data-phase");
}

test.describe("@cleanroom 비기너 모드 첫실행", () => {
  test("G1 깨끗한 신규 설치는 비기너 셸로 들어간다 — 탭·보드는 그리지 않는다", async () => {
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "missing",
      beginnerShell: true,
    });
    try {
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);
      await settle(cr.page);

      expect(await beginnerShellVisible(cr.page)).toBe(true);

      // 판정이 화면뿐 아니라 영속 레코드에도 굳었는가 — 이게 굳지 않으면
      // 다음 부팅에 다시 판정하게 되고, 그때 마커 하나가 생겨 있으면 유저가
      // 이유 없이 화면을 뺏긴다.
      const record = await readBeginnerRecord(cr.page);
      expect(record.state).toBe("beginner");
      expect(record.enteredAt).toBeGreaterThan(0);

      // 아무 CLI 도 없으므로 첫 화면은 연결 게이트(택1)다.
      await expect(cr.page.getByTestId("beginner-connect")).toBeVisible();
      await expect(
        cr.page.getByTestId("beginner-connect-claude"),
      ).toBeVisible();
      await expect(cr.page.getByTestId("beginner-connect-codex")).toBeVisible();

      // ★셸의 정의: 사이드바·탭·보드를 **그리지 않는다**. 하나라도 보이면
      //   "탭을 줄인 워크스페이스" 로 퇴화한 것이다.
      // ※ 낱말이 아니라 **탭 버튼**으로 잡는다: "시작하기" 는 투어 마지막 스텝의
      //   버튼 문구이기도 해서(beginner.tour.done) 본문 검색으로는 두 개가 섞인다.
      for (const tab of ["시작하기", "보드", "Board", "워크트리"]) {
        expect(
          await cr.page.locator(`button:has-text("${tab}")`).count(),
          `비기너 셸에 '${tab}' 탭이 그려졌다`,
        ).toBe(0);
      }
      expect(await cr.page.getByTestId("cli-setup-banner").count()).toBe(0);
      expect(await cr.page.getByTestId("beginner-mini-board").count()).toBe(0);
      // 연결 전에는 챗도 첫 요청칸도 없다 — 인증 없이 오케를 태울 수 없어서다.
      expect(await cr.page.getByTestId("beginner-first-ask").count()).toBe(0);

      await cr.shot("G1-beginner-connect-gate");
    } finally {
      await cr.close();
    }
  });

  test("G2(★회귀가드) 이전 사용 흔적이 하나라도 있으면 어드밴스드 — 보드가 사라지지 않는다", async () => {
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "ready",
      beginnerShell: true,
    });
    try {
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);

      // ── 대조군 먼저: 마커가 하나도 없으면 실제로 비기너다 ────────────────
      // 이게 없으면 아래 네 줄은 "무슨 짓을 해도 어드밴스드" 와 구분되지 않는다.
      await reseedBeginnerDecision(cr.page, []);
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);
      await settle(cr.page);
      expect(await beginnerShellVisible(cr.page)).toBe(true);
      expect((await readBeginnerRecord(cr.page)).state).toBe("beginner");

      // ── 마커 4종 각각 → 어드밴스드 ─────────────────────────────────────
      const markers: PriorInstallMarkerName[] = [
        "onboardingProgress",
        "workspaceTab",
        "workspaceModeFlag",
        "legacyGateDismissed",
      ];
      const verdicts: Record<string, string | null> = {};
      for (const marker of markers) {
        await reseedBeginnerDecision(cr.page, [marker]);
        await passFirstRunModals(cr.page);
        await waitForAppShell(cr.page);
        await settle(cr.page);
        const beginner = await beginnerShellVisible(cr.page);
        verdicts[marker] = (await readBeginnerRecord(cr.page)).state;
        if (beginner) await cr.shot(`G2-fail-${marker}-became-beginner`);
        expect(
          beginner,
          `${marker} 마커가 있는 프로필이 비기너로 떨어졌다 — 기존 유저의 보드가 사라진다`,
        ).toBe(false);
      }
      console.log("[cleanroom][G2] 마커별 판정:", verdicts);
      for (const marker of markers) expect(verdicts[marker]).toBe("advanced");

      // ── 그리고 어드밴스드가 껍데기가 아니라 **진짜 보드**인가 ────────────
      // 마지막 반복은 legacyGateDismissed(=워크스페이스 셸 경로)로 서 있다.
      await injectProject(cr.page, cr.projectDir);
      await openBoardTab(cr.page);
      await injectTasks(cr.page, [
        { id: "g2-task", title: "기존 유저의 티켓", status: "TODO" },
      ]);
      await expect(
        cr.page.getByText("기존 유저의 티켓", { exact: true }).first(),
      ).toBeVisible();
      await cr.shot("G2-advanced-board-intact");
    } finally {
      await cr.close();
    }
  });

  test("G3 하나만 인증하면 통과한다(택1) → 폴더 게이트 → 풀스크린 오케챗", async () => {
    // codex 는 없고 claude 만 준비된 프로필. G4 는 반대 조합(codex 만)을 쓴다 —
    // 둘을 합치면 #579 의 `.some` 규칙이 비기너 진입에도 그대로 사는지가 두 방향
    // 모두에서 확인된다.
    const cr = await launchCleanRoom({
      claude: "ready",
      codex: "missing",
      beginnerShell: true,
    });
    try {
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);

      // 연결 게이트는 통과하고(하나면 충분) 폴더 게이트에 선다.
      await cr.page
        .getByTestId("beginner-folder-gate")
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
      expect(await cr.page.getByTestId("beginner-connect").count()).toBe(0);
      await cr.shot("G3-folder-gate");

      // 폴더가 붙으면 풀스크린 오케챗 국면.
      await injectProject(cr.page, cr.projectDir);
      await chatReady(cr.page);
      await expect(
        cr.page.locator('[data-coach="beginner-chat"]').first(),
      ).toBeVisible();
      expect(await cr.page.getByTestId("beginner-folder-gate").count()).toBe(0);

      // ★아직 아무것도 안 보냈다 — 스트립은 그리지 않는다(idle). 빈 진행줄을
      //   미리 띄우면 "아무 일도 안 일어난다" 는 인상을 오히려 강화한다.
      expect(await livePhase(cr.page)).toBeNull();
      await cr.shot("G3-fullscreen-chat");
    } finally {
      await cr.close();
    }
  });

  test("G4(★S4) 첫 요청이 전달되면 라이브 스트립이 뜨고 대화가 이어진다 — 미니보드·에이전트 패널 포함", async () => {
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "ready",
      beginnerShell: true,
      orchestratorRunning: true,
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await chatReady(cr.page);
      // 투어 카드가 보내기 버튼을 가릴 수 있다 — 투어 자체는 G6 이 본다.
      await dismissBeginnerTour(cr.page);

      const message = "README 를 읽고 시작 가이드를 정리해 줘";
      await cr.page.getByTestId("beginner-first-ask-input").fill(message);
      await cr.page.getByTestId("beginner-first-ask-send").click();
      await settle(cr.page, 2500);

      // ── 진짜 오케 라우팅까지 갔는가 ────────────────────────────────────
      const injected = await cr.injected();
      console.log("[cleanroom][G4] orchestrator injectMessage:", injected);
      expect(injected.length).toBe(1);
      expect(injected[0].projectId).toBe("cleanroom-project");
      expect(injected[0].message).toContain("README");

      await expect(
        cr.page.getByTestId("beginner-first-ask-result"),
      ).toHaveAttribute("data-delivery", "delivered");

      // ── ★지속 대화창 — 전달돼도 입력칸이 살아 있다 ─────────────────────
      // 종전 계약은 정반대였다(전달되면 입력칸·버튼째 사라짐). 그 잠금이 첫 질문
      // 뒤에 오케와 이어서 말할 곳을 없애서, 상단을 지속 대화창으로 바꿨다.
      await expect(
        cr.page.getByTestId("beginner-first-ask-input"),
      ).toBeVisible();
      await expect(
        cr.page.getByTestId("beginner-first-ask-send"),
      ).toBeVisible();
      // 보낸 문장은 칸에 남지 않는다 — 남으면 그게 연타의 미끼다.
      await expect(cr.page.getByTestId("beginner-first-ask-input")).toHaveValue(
        "",
      );

      // ── ★중복 전송 가드(진단 §7 P1-2 ①)는 형태만 바뀌어 살아 있다 ──────
      // 8/4 유저는 delivered 된 요청을 14초 간격으로 3번 더 눌렀다. 이제 잠기는
      // 것은 폼이 아니라 **같은 문장**이다: 그대로 다시 보내도 주입되지 않는다.
      await cr.page.getByTestId("beginner-first-ask-input").fill(message);
      await cr.page.getByTestId("beginner-first-ask-send").click();
      await settle(cr.page, 1500);
      expect((await cr.injected()).length).toBe(1);
      await expect(cr.page.getByTestId("beginner-ask-duplicate")).toBeVisible();

      // 다른 문장은 통과한다 — 막으려던 건 대화가 아니라 반복 주입이었다.
      await cr.page
        .getByTestId("beginner-first-ask-input")
        .fill("거기에 예시도 넣어 줘");
      await cr.page.getByTestId("beginner-first-ask-send").click();
      await settle(cr.page, 1500);
      const after = await cr.injected();
      expect(after.length).toBe(2);
      expect(after[1].message).toContain("예시");

      // ── ★S4: 챗 안 인라인 진행 ────────────────────────────────────────
      expect(await livePhase(cr.page)).toBe("thinking");
      // 티켓이 0개인 동안은 빈 3칸을 띄우지 않는다.
      expect(await cr.page.getByTestId("beginner-mini-board").count()).toBe(0);
      await cr.shot("G4-strip-thinking");

      // 티켓이 생기면 → planned + 미니 보드.
      await injectTasks(cr.page, [
        { id: "t1", title: "README 읽기", status: "TODO" },
        { id: "t2", title: "가이드 초안", status: "IN_PROGRESS" },
        // BLOCKED 는 별도 컬럼이 아니라 "진행 중" 으로 접힌다 — 막힌 티켓이
        // 화면에서 사라지는 것이야말로 이 화면이 고치려는 dead-end 다.
        { id: "t3", title: "막힌 티켓", status: "BLOCKED" },
      ]);
      expect(await livePhase(cr.page)).toBe("planned");
      await expect(cr.page.getByTestId("beginner-mini-board")).toBeVisible();
      const columns = cr.page.getByTestId("beginner-mini-column");
      await expect(columns).toHaveCount(3);
      await expect(
        columns.filter({ has: cr.page.getByText("막힌 티켓") }),
      ).toHaveAttribute("data-column-status", "IN_PROGRESS");
      await cr.shot("G4-strip-planned-miniboard");

      // ── ★미니 보드는 눌린다 — 상세는 비기너 판(워크트리·diff·PR 없음) ──
      await cr.page
        .getByTestId("beginner-mini-task")
        .filter({ hasText: "막힌 티켓" })
        .click();
      const detail = cr.page.getByTestId("beginner-task-modal");
      await expect(detail).toBeVisible();
      await expect(detail).toHaveAttribute("data-task-status", "BLOCKED");
      expect(await detail.textContent()).not.toContain("marblo/");
      await cr.shot("G4-task-detail");
      await cr.page.getByTestId("beginner-task-modal-close").click();
      await expect(detail).toHaveCount(0);

      // 에이전트가 붙으면 → working + 에이전트 패널(하단 2분할 오른쪽).
      await injectAgents(cr.page, [
        { id: "a1", name: "test-1", status: "working" },
      ]);
      expect(await livePhase(cr.page)).toBe("working");
      await expect(cr.page.getByTestId("beginner-agents-pane")).toBeVisible();
      await expect(cr.page.getByTestId("beginner-mini-agents")).toBeVisible();
      await expect(cr.page.getByTestId("beginner-agent-row")).toHaveCount(1);
      await cr.shot("G4-strip-working");

      // 완료가 생기고 일하는 에이전트가 없으면 → completed.
      await injectAgents(cr.page, [
        { id: "a1", name: "test-1", status: "idle" },
      ]);
      await injectTasks(cr.page, [
        { id: "t1", title: "README 읽기", status: "DONE" },
        { id: "t2", title: "가이드 초안", status: "IN_PROGRESS" },
        { id: "t3", title: "막힌 티켓", status: "BLOCKED" },
      ]);
      expect(await livePhase(cr.page)).toBe("completed");
      await expect(cr.page.getByTestId("beginner-live-counts")).toContainText(
        "1/3",
      );
      await cr.shot("G4-strip-completed");
    } finally {
      await cr.close();
    }
  });

  test("G5(대조군) 오케가 없어 전달이 실패하면 폼이 잠기지 않고 스트립도 안 뜬다", async () => {
    // G4 의 잠금이 "항상 잠긴다" 가 아니라 **전달됐을 때만** 잠기는지 확인한다.
    // 전달되지 않은 요청에 스트립을 띄우면 90초 뒤 "막혔어요" 가 뜨는데, 정작
    // 막힌 건 전송이 아니라 오케 부재다.
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "ready",
      beginnerShell: true,
      orchestratorRunning: false,
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await chatReady(cr.page);
      await dismissBeginnerTour(cr.page);

      await cr.page
        .getByTestId("beginner-first-ask-input")
        .fill("이 프로젝트 구조를 설명해 줘");
      await cr.page.getByTestId("beginner-first-ask-send").click();
      await settle(cr.page, 3000);

      // 라우팅 시도는 실제로 했다.
      expect((await cr.injected()).length).toBeGreaterThan(0);

      const delivery = await cr.page
        .getByTestId("beginner-first-ask-result")
        .getAttribute("data-delivery");
      console.log("[cleanroom][G5] 전달 결과:", delivery);
      expect(delivery).not.toBe("delivered");
      // 잠기지 않았으므로 유저는 다시 시도할 수 있다.
      await expect(
        cr.page.getByTestId("beginner-first-ask-send"),
      ).toBeVisible();
      // 그리고 진행 스트립은 뜨지 않는다(기준시각이 서지 않았다).
      expect(await livePhase(cr.page)).toBeNull();
      await cr.shot("G5-not-locked-no-strip");
    } finally {
      await cr.close();
    }
  });

  test("G6 코치마크 투어 4스텝 완주 → 재노출 없음, 그리고 상단 개발모드 전환", async () => {
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "ready",
      beginnerShell: true,
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await chatReady(cr.page);

      const overlay = cr.page.getByTestId("beginner-tour").first();
      await overlay.waitFor({ state: "visible", timeout: 15_000 });
      await cr.shot("G6-tour-step1");

      // 앵커는 셸이 붙인 data-coach 속성이 유일한 계약이다. 순서가 바뀌거나
      // 앵커가 사라지면(=스텝이 걸러지면) 여기서 깨진다.
      const seen: string[] = [];
      for (let i = 0; i < 4; i++) {
        const step = await overlay.getAttribute("data-step");
        if (step) seen.push(step);
        await cr.page.getByTestId("beginner-tour-next").click();
        await settle(cr.page, 500);
      }
      console.log("[cleanroom][G6] 투어 스텝:", seen);
      expect(seen).toEqual(["chat", "ask", "live", "advanced"]);
      expect(await beginnerTourVisible(cr.page)).toBe(false);

      // 완주는 영속된다 — 재부팅해도 다시 권하지 않는다.
      await cr.page.reload();
      await cr.page.waitForLoadState("domcontentloaded");
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await chatReady(cr.page);
      await settle(cr.page, 2500);
      if (await beginnerTourVisible(cr.page))
        await cr.shot("G6-fail-tour-reopened");
      expect(await beginnerTourVisible(cr.page)).toBe(false);

      // ── ★상시 개발모드 전환(#857) ──────────────────────────────────────
      // 승격 모달(완료 3건)을 기다리지 않고 언제든 넘어갈 수 있어야 한다.
      expect(await beginnerShellVisible(cr.page)).toBe(true);
      await cr.page.getByTestId("beginner-go-advanced").click();
      await settle(cr.page, 1500);
      expect(await beginnerShellVisible(cr.page)).toBe(false);
      expect((await readBeginnerRecord(cr.page)).state).toBe("advanced");
      await cr.shot("G6-switched-to-advanced");

      // 그리고 그 선택은 재부팅을 넘어간다 — 매번 비기너로 돌아가면 전환이
      // 아니라 일회성 미리보기다.
      await cr.page.reload();
      await cr.page.waitForLoadState("domcontentloaded");
      await passFirstRunModals(cr.page);
      await waitForAppShell(cr.page);
      await settle(cr.page);
      expect(await beginnerShellVisible(cr.page)).toBe(false);
    } finally {
      await cr.close();
    }
  });

  test("G7 완료 3건이면 승격을 제안하고, '지금은 그대로' 는 다시 조르지 않는다", async () => {
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "ready",
      beginnerShell: true,
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await chatReady(cr.page);
      await dismissBeginnerTour(cr.page);

      // 완료 2건까지는 아직 아니다 — 임계가 실제로 3인지 확인한다.
      await injectTasks(cr.page, [
        { id: "d1", title: "완료 1", status: "DONE" },
        { id: "d2", title: "완료 2", status: "DONE" },
      ]);
      await settle(cr.page, 800);
      expect(
        await cr.page.getByTestId("beginner-promotion-modal").count(),
      ).toBe(0);

      await injectTasks(cr.page, [
        { id: "d1", title: "완료 1", status: "DONE" },
        { id: "d2", title: "완료 2", status: "DONE" },
        { id: "d3", title: "완료 3", status: "DONE" },
      ]);
      const modal = cr.page.getByTestId("beginner-promotion-modal").first();
      await modal.waitFor({ state: "visible", timeout: 10_000 });
      await expect(modal).toHaveAttribute("data-trigger", "completed");
      await cr.shot("G7-promotion-modal");

      await cr.page.getByTestId("beginner-promotion-later").click();
      await settle(cr.page, 800);
      expect(
        await cr.page.getByTestId("beginner-promotion-modal").count(),
      ).toBe(0);
      // 거절해도 비기너 그대로다.
      expect(await beginnerShellVisible(cr.page)).toBe(true);
      // 그리고 다시는 안 뜬다 — 기록이 남았고, 완료가 더 늘어도 조용하다.
      expect(
        (await readBeginnerRecord(cr.page)).promotionShownAt,
      ).toBeGreaterThan(0);
      await injectTasks(cr.page, [
        { id: "d1", title: "완료 1", status: "DONE" },
        { id: "d2", title: "완료 2", status: "DONE" },
        { id: "d3", title: "완료 3", status: "DONE" },
        { id: "d4", title: "완료 4", status: "DONE" },
      ]);
      await settle(cr.page, 1500);
      if ((await cr.page.getByTestId("beginner-promotion-modal").count()) > 0)
        await cr.shot("G7-fail-promotion-renagged");
      expect(
        await cr.page.getByTestId("beginner-promotion-modal").count(),
      ).toBe(0);
    } finally {
      await cr.close();
    }
  });

  test("G8 승격을 받아들이면 어드밴스드 셸이 뜨고 보드에 티켓이 그대로 있다", async () => {
    const cr = await launchCleanRoom({
      claude: "missing",
      codex: "ready",
      beginnerShell: true,
    });
    try {
      await passFirstRunModals(cr.page);
      await injectProject(cr.page, cr.projectDir);
      await chatReady(cr.page);
      await dismissBeginnerTour(cr.page);

      const seeded = [
        { id: "p1", title: "승격 티켓 1", status: "DONE" },
        { id: "p2", title: "승격 티켓 2", status: "DONE" },
        { id: "p3", title: "승격 티켓 3", status: "DONE" },
      ];
      await injectTasks(cr.page, seeded);
      await cr.page
        .getByTestId("beginner-promotion-modal")
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
      await cr.page.getByTestId("beginner-promotion-accept").click();
      await settle(cr.page, 2000);

      expect(await beginnerShellVisible(cr.page)).toBe(false);
      expect((await readBeginnerRecord(cr.page)).state).toBe("advanced");

      // ★승격은 셸을 고치는 게 아니라 층을 벗는 것이다 — 워크스페이스 셸이
      //   자기 persist 값 그대로 복원되고, 그 안에 티켓이 그대로 있어야 한다.
      await openBoardTab(cr.page);
      await injectTasks(cr.page, seeded);
      await expect(
        cr.page.getByText("승격 티켓 1", { exact: true }).first(),
      ).toBeVisible();
      await cr.shot("G8-promoted-board");
    } finally {
      await cr.close();
    }
  });
});
