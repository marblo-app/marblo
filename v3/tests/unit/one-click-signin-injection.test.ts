/**
 * @vitest-environment jsdom
 *
 * ★원클릭 사인인의 실제 배선(티켓 afW5wNdX 사장님 핵심 ②).
 *
 * "사인인 버튼을 누르면 우리 터미널 탭이 자동으로 생기고 로그인 명령이 자동으로
 * 들어가서, 유저는 브라우저에서 승인만 한다" — 이 문장이 코드에서 실제로 성립하는지
 * 검사한다. 즉 **터미널 생성 → 노출 → 그 세션 id 로 `pty.writeAndSubmit`** 라는
 * 세 단계가 전부 일어나고, 타이핑되는 문자열이 그 CLI 의 **로그인** 명령인지.
 *
 * 회귀 지점 둘:
 *  - 미설치 CLI 의 probe `action` 은 설치 명령(`curl … | bash`)이다. 그걸 그대로
 *    타이핑하면 브라우저 로그인 대신 인스톨러가 돈다.
 *  - `action` 이 비면(probe 실패) 예전 코드는 아무것도 안 하고 조용히 리턴했다 —
 *    버튼을 눌렀는데 아무 일도 안 일어나는 상태.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createSession = vi.fn(async () => "pty-1");
const openTerminalForSession = vi.fn();

vi.mock("../../src/stores/terminalStore", () => ({
  useTerminalStore: {
    getState: () => ({ createSession, openTerminalForSession }),
  },
}));
// 첫 티켓/PRD 경로가 끌어오는 무거운 의존(파이어스토어·오케 라우팅)은 이 테스트의
// 관심사가 아니다 — 사인인 경로만 남긴다.
vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: { getState: () => ({ currentProject: null }) },
}));
vi.mock("../../src/stores/editorStore", () => ({
  useEditorStore: { getState: () => ({ setRootPath: vi.fn() }) },
}));
vi.mock("../../src/services/orchestratorInstructionService", () => ({
  routeInstructionToOrchestrator: vi.fn(async () => "failed"),
}));
vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: vi.fn() },
}));

const writeAndSubmit = vi.fn(async () => undefined);

describe("launchLogin — 터미널 자동생성 + 로그인 명령 자동주입", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createSession.mockClear();
    openTerminalForSession.mockClear();
    writeAndSubmit.mockClear();
    (
      globalThis as unknown as { window: Record<string, unknown> }
    ).window.electronAPI = {
      pty: { writeAndSubmit },
      harness: {
        cliAuthCheck: vi.fn(async () => ({
          installed: true,
          authenticated: false,
        })),
        versions: vi.fn(async () => ({})),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("세션을 만들고 노출한 뒤 그 세션에 로그인 명령을 제출한다", async () => {
    const { launchLogin } = await import("../../src/services/cliSetupActions");
    await launchLogin("codex", "codex login");

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(openTerminalForSession).toHaveBeenCalledWith("pty-1", "Codex (GPT)");
    // 셸 프롬프트가 뜰 시간을 준 뒤 타이핑한다.
    expect(writeAndSubmit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(writeAndSubmit).toHaveBeenCalledWith("pty-1", "codex login");
  });

  it("★설치 명령이 넘어와도 인스톨러를 타이핑하지 않고 로그인 명령으로 바꾼다", async () => {
    const { launchLogin } = await import("../../src/services/cliSetupActions");
    await launchLogin(
      "claude",
      "curl -fsSL https://claude.ai/install.sh | bash",
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(writeAndSubmit).toHaveBeenCalledWith("pty-1", "claude login");
  });

  it("명령이 없어도(probe 실패) 모델별 매핑으로 사인인이 진행된다", async () => {
    const { launchLogin } = await import("../../src/services/cliSetupActions");
    await launchLogin("grok");
    await vi.advanceTimersByTimeAsync(1000);
    expect(writeAndSubmit).toHaveBeenCalledWith("pty-1", "grok login");
  });

  it("사인인은 로그인 감시(loginRunning)와 원클릭 표식을 켠다", async () => {
    const { launchLogin } = await import("../../src/services/cliSetupActions");
    const { useCliSetupStore } = await import("../../src/stores/cliSetupStore");
    await launchLogin("claude", "claude login");
    // 엔진의 auto-recheck 폴이 이 플래그로 돌기 때문에 사용자는 '다시 확인'을
    // 누를 필요가 없다.
    expect(useCliSetupStore.getState().loginRunning).toBe(true);
    // 인증이 끝나면 오케를 열어도 되는 세션이라는 표식.
    expect(useCliSetupStore.getState().setupInitiated).toBe(true);
  });
});

describe("oneClickSignIn — 오케를 여는 CLI 를 골라 하나만 연다", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createSession.mockClear();
    writeAndSubmit.mockClear();
    (
      globalThis as unknown as { window: Record<string, unknown> }
    ).window.electronAPI = {
      pty: { writeAndSubmit },
      harness: {
        cliAuthCheck: vi.fn(async () => ({
          installed: true,
          authenticated: false,
        })),
        versions: vi.fn(async () => ({})),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("설치·미인증 상태에서 Claude 를 골라 터미널 하나만 띄운다", async () => {
    const { oneClickSignIn } =
      await import("../../src/services/cliSetupActions");
    const { useCliSetupStore } = await import("../../src/stores/cliSetupStore");
    await useCliSetupStore.getState().probeAll();

    expect(oneClickSignIn()).toBe("claude");
    // ★브라우저 device-code 창을 여러 개 띄우지 않는다 — 터미널은 정확히 하나.
    expect(createSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writeAndSubmit).toHaveBeenCalledWith("pty-1", "claude login");
  });

  it("사인인할 대상이 없으면 null 을 돌려주고 터미널을 만들지 않는다", async () => {
    const { oneClickSignIn } =
      await import("../../src/services/cliSetupActions");
    const { useCliSetupStore } = await import("../../src/stores/cliSetupStore");
    (
      globalThis as unknown as {
        window: { electronAPI: { harness: { cliAuthCheck: unknown } } };
      }
    ).window.electronAPI.harness.cliAuthCheck = vi.fn(async () => ({
      installed: true,
      authenticated: true,
    }));
    await useCliSetupStore.getState().probeAll();

    expect(oneClickSignIn()).toBeNull();
    expect(createSession).not.toHaveBeenCalled();
  });
});
