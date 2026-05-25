import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Marblo PTY 터미널 Page Object Model.
 *
 * 오케스트레이터 (OrchestratorTerminal.tsx) 와 에이전트 (TerminalView.tsx) 가
 * 거의 동일한 xterm.js 구조라 같은 POM 으로 다룬다. kind 만 다름 — 셀렉터를
 * 분기.
 *
 * 주의: xterm 의 viewport 는 .xterm-viewport (스크롤 컨테이너). 출력 영역은
 * .xterm-screen 안에 row 들이 absolute 로 깔린다.
 */
export class TerminalPage {
  readonly page: Page;
  readonly kind: "orchestrator" | "agent";
  readonly root: Locator;

  constructor(page: Page, kind: "orchestrator" | "agent") {
    this.page = page;
    this.kind = kind;
    // OrchestratorTerminal / TerminalView 둘 다 xterm.js 가 mount 시 자동으로
    // 부여하는 `.xterm` 클래스의 wrapper 를 가진다. data-testid 가 없어서
    // 가장 견고한 셀렉터는 `.xterm` 자체. 한 화면에 여러 PTY 가 떠 있는
    // 시나리오 (Agents 탭의 여러 에이전트) 는 nth() 로 인덱싱.
    //
    // 현재 v3 의 단일 패널 mount 순서:
    //   - 0번 .xterm = OrchestratorTerminal (OrchestratorPanel)
    //   - 1번 이후  = AgentListPanel 의 각 TerminalView (있을 경우)
    // kind 가 늘어나면 인덱스 또는 더 정확한 부모 셀렉터로 분기.
    this.root = page.locator(".xterm").first();
  }

  /** xterm-viewport (스크롤 컨테이너) Locator. */
  viewport(): Locator {
    // 둘 다 .xterm-viewport. root 안에서 first.
    return this.root.locator(".xterm-viewport").first();
  }

  /** 현재 viewportY (xterm 내부 좌표, 사용자가 보고 있는 첫 줄). */
  async getViewportY(): Promise<number> {
    return this.root.evaluate((rootEl) => {
      const wrapper = rootEl as HTMLElement;
      // xterm 인스턴스를 DOM 에서 직접 잡을 수 없으니 viewport 의 scrollTop 로
      // 근사. rowHeight 와 함께 계산하면 정확한 viewportY 가 나옴.
      const vp = wrapper.querySelector<HTMLElement>(".xterm-viewport");
      if (!vp) return -1;
      return vp.scrollTop;
    });
  }

  /**
   * wheel 이벤트로 위로 스크롤. capture phase 핸들러까지 트리거.
   * xterm 의 `.xterm-screen` overlay 가 `.xterm-viewport` hover 를 가로채므로
   * boundingBox 좌표 기반 mouse.move + wheel 로 우회.
   */
  async wheelUp(deltaY = 200): Promise<void> {
    await this.moveMouseOverViewport();
    await this.page.mouse.wheel(0, -Math.abs(deltaY));
  }

  /** wheel 이벤트로 아래로 스크롤. */
  async wheelDown(deltaY = 200): Promise<void> {
    await this.moveMouseOverViewport();
    await this.page.mouse.wheel(0, Math.abs(deltaY));
  }

  private async moveMouseOverViewport(): Promise<void> {
    const box = await this.viewport().boundingBox();
    if (!box) throw new Error(".xterm-viewport boundingBox 를 얻지 못함");
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }

  /** PageUp 키 입력. wrapper 에 focus 필요. */
  async pageUp(): Promise<void> {
    await this.viewport().focus();
    await this.page.keyboard.press("PageUp");
  }

  /**
   * 가짜 PTY 출력 주입 (mock 모드 전용). main 프로세스의 ptyManager 가
   * stub 되어 있을 때 의도한 sessionId 로 데이터 강제 dispatch.
   *
   * TODO(mock-tier-2): main process IPC channel 정의 후 구현. 지금은 stub.
   */
  async injectOutput(_text: string): Promise<void> {
    // Tier 2 mocked 셋업에서 채움. 현재는 의도적으로 미구현 — Tier 1 (스크롤
    // 회귀) 은 실제 PTY 가 살아 있는 production build 환경에서도 검증 가능.
    throw new Error(
      "injectOutput 은 Tier 2 mock fixture 가 활성화된 환경에서만 호출 가능합니다.",
    );
  }

  /** 잠시 대기. PTY chunk drain·xterm rAF 완료 보장용. */
  async waitMs(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** viewport 가 maxScrollTop 에 매우 가까우면 (= 바닥) true. */
  async isAtBottom(): Promise<boolean> {
    return this.root.evaluate((rootEl) => {
      const vp = rootEl.querySelector<HTMLElement>(".xterm-viewport");
      if (!vp) return false;
      return vp.scrollHeight - vp.scrollTop - vp.clientHeight < 4;
    });
  }

  /** 터미널이 mount 되어 xterm DOM 이 그려질 때까지 대기. */
  async waitReady(): Promise<void> {
    await expect(this.viewport()).toBeVisible({ timeout: 15_000 });
  }
}
