/**
 * @vitest-environment jsdom
 *
 * ★온보딩 프리뷰(개발/시연용 fresh-user 시뮬) — 티켓 MA5PnltkHBFbgcRvjo0r.
 *
 * 여기서 지키는 것은 세 가지다:
 *  1. **국면 규칙**(`lib/onboardingPreview`) — 어느 국면에서 무엇이 설치·인증된
 *     것으로 보이는가, 그리고 `done` 이 실제 상태로 되돌아가는가.
 *  2. **안전성** — 프리뷰가 켜진 동안 실 설치 IPC(`runInstallAll`)도 실 PTY
 *     로그인(`oneClickSignIn`)도 **한 번도** 불리지 않는다. 이게 이 기능의 절반이다:
 *     프리뷰는 이미 인증된 사장님 기계에서 도는데, 여기서 진짜 인스톨러나 진짜
 *     `claude login` 이 돌면 시연이 아니라 사고다.
 *  3. **게이트 가로채기** — 실제로 `ready` 인 유저(개발 맥)에게도 연결 게이트가
 *     뜨는가. 이게 안 되면 이 티켓의 목적 자체가 없다.
 *
 * (.ts + createElement — vitest include 가 `tests/** /*.test.ts` 라 .tsx 는
 *  수집되지 않는다. 기존 beginner-one-click.test.ts 와 같은 관례.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const actions = vi.hoisted(() => ({
  oneClickSignIn: vi.fn((onLaunched?: (id: string) => void) => {
    onLaunched?.("real-login-session");
    return "claude" as const;
  }),
  launchLogin: vi.fn(async () => "real-login-session"),
  installAndLogin: vi.fn(async () => "real-login-session"),
  setDefaultOrchestrator: vi.fn(async () => true),
  connectFolder: vi.fn(),
}));
vi.mock("../../src/services/cliSetupActions", () => actions);

vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: vi.fn(), loginPrompt: vi.fn() },
}));

/**
 * 구독 선택 화면(설치 → 로그인 사이의 질문)을 지나간다. 종전에는 설치가 끝나면
 * 로그인이 **자동으로** 떴지만, 이제 무엇에 로그인할지는 사용자가 고른다
 * (티켓 LLHMclpKaIAJbsiHzGoG).
 */
async function pickSubscription(...models: string[]) {
  for (const model of models) {
    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId(`beginner-subscription-${model}`)
          .querySelector("input")!,
      );
    });
  }
  await act(async () => {
    fireEvent.click(screen.getByTestId("beginner-subscription-confirm"));
  });
}

// xterm 은 jsdom 에서 캔버스를 요구한다. 여기서 보려는 것은 "실 터미널이 아예
// 안 떠야 한다" 이므로 스텁으로 존재만 관측한다.
vi.mock("../../src/components/terminal/TerminalView", () => ({
  default: ({ sessionId }: { sessionId: string }) =>
    createElement("div", {
      "data-testid": "stub-terminal",
      "data-session": sessionId,
    }),
}));

// L0 분해 카드는 실제 보드(Firestore)에 티켓을 쓰는 무거운 자식이다 — 이
// 테스트가 보는 것은 연결 게이트의 국면이지 그 카드가 아니다. 파리티(양쪽 셸에
// 실제로 달려 있는가)는 tests/unit/onramp-mode-parity.test.ts 가 지킨다.
vi.mock("../../src/components/onboarding/OnrampDecomposeCard", () => ({
  OnrampDecomposeCard: ({ surface }: { surface: string }) =>
    createElement("div", {
      "data-testid": "stub-onramp-decompose",
      "data-surface": surface,
    }),
}));

import {
  nextPreviewStage,
  previewCliReady,
  previewLoginTranscript,
  previewOverridesGate,
  previewResults,
  previewSampleStatus,
  previewSignInModel,
  type PreviewStage,
} from "../../src/lib/onboardingPreview";
import {
  PREVIEW_AUTH_MS,
  PREVIEW_INSTALL_STEP_MS,
  PREVIEW_SAMPLE_MS,
  resetOnboardingPreviewForTest,
  useOnboardingPreviewStore,
} from "../../src/stores/onboardingPreviewStore";
import { useOnboardingSetup } from "../../src/hooks/useOnboardingSetup";
import { BeginnerOneClickModal } from "../../src/components/beginner/BeginnerOneClickModal";
import { BeginnerConnectStep } from "../../src/components/beginner/BeginnerConnectStep";
import { OnboardingPreviewBanner } from "../../src/components/beginner/OnboardingPreviewBanner";
import { ROWS, useCliSetupStore } from "../../src/stores/cliSetupStore";

const ROW_IDS = ROWS.map((r) => r.id);
const ONE_CLICK_IDS = ["cli-claude-code", "cli-codex"];

// ── ① 국면 규칙 ────────────────────────────────────────────────────────────

describe("previewOverridesGate — done 은 실제 상태로 되돌아간다", () => {
  it("꺼져 있으면 어느 국면이든 가로채지 않는다", () => {
    for (const stage of ["connect", "installing", "sample"] as PreviewStage[]) {
      expect(previewOverridesGate(false, stage)).toBe(false);
    }
  });

  it("켜져 있어도 done 이면 패스스루 — 토글을 끄는 걸 잊어도 갇히지 않는다", () => {
    expect(previewOverridesGate(true, "connect")).toBe(true);
    expect(previewOverridesGate(true, "sample")).toBe(true);
    expect(previewOverridesGate(true, "done")).toBe(false);
  });
});

describe("previewResults — 시뮬 프로브 결과", () => {
  it("첫 화면에서는 아무것도 안 깔려 있다(fresh 유저)", () => {
    const r = previewResults(ROW_IDS, ONE_CLICK_IDS, "connect");
    expect(
      Object.values(r).every((x) => !x.installed && !x.authenticated),
    ).toBe(true);
  });

  it("설치가 끝나면 오케 후보만 설치됨·미인증 — 사인인 대상이 생긴다", () => {
    const r = previewResults(ROW_IDS, ONE_CLICK_IDS, "sign_in");
    expect(r["cli-claude-code"]).toEqual({
      installed: true,
      authenticated: false,
    });
    expect(r["cli-codex"]).toEqual({ installed: true, authenticated: false });
    // ★고르지도 않은 벤더를 설치하지 않는다는 규칙이 시연에서도 그대로 보여야 한다.
    expect(r["cli-grok"].installed).toBe(false);
    expect(r["cli-antigravity"].installed).toBe(false);
  });

  it("인증 국면에서는 오케 후보가 설치+인증 — 게이트 통과", () => {
    const r = previewResults(ROW_IDS, ONE_CLICK_IDS, "sample");
    expect(r["cli-claude-code"].authenticated).toBe(true);
    expect(previewCliReady("sample")).toBe(true);
    expect(previewCliReady("awaiting_auth")).toBe(false);
  });

  it("사인인 대상은 오케 후보를 먼저 고른다(실 흐름과 같은 CLI)", () => {
    const r = previewResults(ROW_IDS, ONE_CLICK_IDS, "sign_in");
    expect(previewSignInModel(ROWS, r)).toBe("claude");
    // 아직 아무것도 안 깔린 국면에는 사인인할 대상이 없다.
    expect(
      previewSignInModel(
        ROWS,
        previewResults(ROW_IDS, ONE_CLICK_IDS, "connect"),
      ),
    ).toBeNull();
  });
});

describe("previewSampleStatus / nextPreviewStage", () => {
  it("인증 직후에는 샘플 폴더가 '준비 중' 으로 그려진다(#872 재생)", () => {
    expect(previewSampleStatus("sample")).toBe("preparing");
    expect(previewSampleStatus("connect")).toBe("idle");
    expect(previewSampleStatus("done")).toBe("connected");
  });

  it("'다음 단계' 는 done 에서 멈춘다", () => {
    expect(nextPreviewStage("connect")).toBe("installing");
    expect(nextPreviewStage("sample")).toBe("done");
    expect(nextPreviewStage("done")).toBe("done");
  });
});

describe("previewLoginTranscript — 대본에 시뮬 표식이 박혀 있다", () => {
  it("스크린샷만 보고 '진짜 로그인됐다' 로 읽히지 않게 한다", () => {
    const lines = previewLoginTranscript("claude");
    expect(lines[0]).toBe("$ claude login");
    expect(lines.join("\n")).toContain("[preview]");
    // agy 는 login 서브커맨드가 없다 — 실 흐름(LOGIN_CMD)과 같은 규칙.
    expect(previewLoginTranscript("antigravity")[0]).toBe("$ agy");
  });
});

// ── ② 스토어(타이머) ──────────────────────────────────────────────────────

describe("onboardingPreviewStore — 국면을 스스로 굴린다", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetOnboardingPreviewForTest();
  });
  afterEach(() => vi.useRealTimers());

  const stage = () => useOnboardingPreviewStore.getState().stage;

  it("끄면 플래그와 국면이 함께 정리된다", () => {
    // (persist 자체는 여기서 못 본다 — 이 jsdom 환경에는 localStorage 가 없어
    //  스토어가 인메모리로 degrade 한다. 그 degrade 가 조용한지도 함께 본다.)
    useOnboardingPreviewStore.getState().setEnabled(true);
    expect(useOnboardingPreviewStore.getState().enabled).toBe(true);
    useOnboardingPreviewStore.getState().setStage("sample");
    useOnboardingPreviewStore.getState().setEnabled(false);
    expect(useOnboardingPreviewStore.getState().enabled).toBe(false);
    // 다시 켰을 때 "지난번 끝난 자리" 에서 시작하면 그건 프리뷰가 아니라 찌꺼기다.
    expect(stage()).toBe("connect");
  });

  it("모두 설치 → 진행률이 오르고 끝나면 사인인으로 이어진다", () => {
    const store = useOnboardingPreviewStore.getState();
    store.setEnabled(true);
    store.startInstallAll(2);
    expect(stage()).toBe("installing");
    expect(useOnboardingPreviewStore.getState().bulk).toMatchObject({
      running: true,
      total: 2,
      done: 0,
    });

    act(() => void vi.advanceTimersByTime(PREVIEW_INSTALL_STEP_MS));
    expect(useOnboardingPreviewStore.getState().bulk?.done).toBe(1);
    expect(stage()).toBe("installing");

    act(() => void vi.advanceTimersByTime(PREVIEW_INSTALL_STEP_MS));
    expect(stage()).toBe("sign_in");
    expect(useOnboardingPreviewStore.getState().bulk).toMatchObject({
      running: false,
      done: 2,
      failedIds: [],
    });
  });

  it("사인인 → 승인 대기 → 인증 → 샘플 → 종료(패스스루)까지 스스로 간다", () => {
    const store = useOnboardingPreviewStore.getState();
    store.setEnabled(true);
    store.startSignIn("claude");
    expect(stage()).toBe("awaiting_auth");
    expect(useOnboardingPreviewStore.getState().loginModel).toBe("claude");

    act(() => void vi.advanceTimersByTime(PREVIEW_AUTH_MS));
    expect(stage()).toBe("sample");
    act(() => void vi.advanceTimersByTime(PREVIEW_SAMPLE_MS));
    expect(stage()).toBe("done");
  });

  it("★끄면 남은 전이가 전부 취소된다 — 꺼 둔 프리뷰가 되살아나지 않는다", () => {
    const store = useOnboardingPreviewStore.getState();
    store.setEnabled(true);
    store.startSignIn("claude");
    useOnboardingPreviewStore.getState().setEnabled(false);
    act(() => void vi.advanceTimersByTime(PREVIEW_AUTH_MS + PREVIEW_SAMPLE_MS));
    expect(stage()).toBe("connect");
    expect(useOnboardingPreviewStore.getState().enabled).toBe(false);
  });

  it("같은 로그인을 두 번 띄우지 않는다", () => {
    const store = useOnboardingPreviewStore.getState();
    store.setEnabled(true);
    store.startSignIn("claude");
    useOnboardingPreviewStore.getState().startSignIn("codex");
    expect(useOnboardingPreviewStore.getState().loginModel).toBe("claude");
  });
});

// ── ③ 화면 계약 ────────────────────────────────────────────────────────────

/** 이미 설치·인증이 끝난 개발 맥의 상태 — 프리뷰가 넘어야 할 벽. */
function seedFullySetUpMachine() {
  const results = Object.fromEntries(
    ROW_IDS.map((id) => [id, { installed: true, authenticated: true }]),
  );
  useCliSetupStore.setState({
    ready: true,
    results,
    states: Object.fromEntries(
      Object.entries(results).map(([id, r]) => [id, { ...r, checking: false }]),
    ),
    bulkInstall: null,
    installErrors: {},
    installing: null,
    runInstallAll: vi.fn(async () => {}),
    runInstall: vi.fn(async () => {}),
    probeAll: vi.fn(async () => ({ results, requiredReady: true })),
  });
}

function realInstallAllMock() {
  return useCliSetupStore.getState().runInstallAll as unknown as {
    mock: { calls: unknown[] };
  };
}

/**
 * 셸의 게이트 분기만 떼어낸 하네스. `BeginnerShell` 을 통째로 마운트하지 않는
 * 이유는 그것이 오케 PTY·라이프사이클 훅을 끌고 오기 때문이다 — 여기서 볼 것은
 * "무엇이 게이트를 통과시키는가" 하나다(beginner-shell-wiring 과 같은 관례).
 */
function GateHarness() {
  const setup = useOnboardingSetup();
  return setup.ready
    ? createElement("div", { "data-testid": "harness-workspace" })
    : createElement("div", { "data-testid": "harness-connect-gate" });
}

describe("게이트 가로채기 — 이미 인증된 유저에게도 첫 연결 화면을 보여준다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOnboardingPreviewForTest();
    seedFullySetUpMachine();
  });
  afterEach(cleanup);

  it("프리뷰가 꺼져 있으면 예전 그대로 — 게이트를 건너뛴다", () => {
    render(createElement(GateHarness));
    expect(screen.getByTestId("harness-workspace")).toBeTruthy();
  });

  it("★프리뷰를 켜면 실 ready=true 인데도 연결 게이트가 선다", () => {
    render(createElement(GateHarness));
    act(() => useOnboardingPreviewStore.getState().setEnabled(true));
    expect(screen.getByTestId("harness-connect-gate")).toBeTruthy();
    // 실제 스토어는 손대지 않았다 — 오케 자동기동·스폰 게이트가 읽는 값 그대로.
    expect(useCliSetupStore.getState().ready).toBe(true);
  });

  it("시뮬이 끝나면(done) 다시 실제 상태로 흘러간다", () => {
    render(createElement(GateHarness));
    act(() => useOnboardingPreviewStore.getState().setEnabled(true));
    act(() => useOnboardingPreviewStore.getState().setStage("done"));
    expect(screen.getByTestId("harness-workspace")).toBeTruthy();
  });
});

describe("★안전성 — 프리뷰는 실 설치/로그인을 부르지 않는다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOnboardingPreviewForTest();
    seedFullySetUpMachine();
    useOnboardingPreviewStore.getState().setEnabled(true);
  });
  afterEach(cleanup);

  it("원클릭 모달: 실 runInstallAll 도, 실 oneClickSignIn 도 부르지 않는다", () => {
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));
    expect(
      screen.getByTestId("beginner-oneclick-modal").getAttribute("data-phase"),
    ).toBe("installing");
    expect(realInstallAllMock().mock.calls.length).toBe(0);
    expect(actions.oneClickSignIn).not.toHaveBeenCalled();
    // 시뮬 진행률은 우리 스토어가 든다(실 스토어의 bulkInstall 은 그대로 null).
    expect(useOnboardingPreviewStore.getState().stage).toBe("installing");
    expect(useCliSetupStore.getState().bulkInstall).toBeNull();
  });

  it("사인인 국면에서 뜨는 것은 실 PTY 가 아니라 대본 터미널이다", async () => {
    // 설치가 이미 끝난 자리에서 모달이 열린 경우(실 흐름의 '깔 게 없다' 와 같다)
    // — 국면이 되감기지 않고 구독 선택 → 로그인으로 이어져야 한다.
    act(() => useOnboardingPreviewStore.getState().setStage("sign_in"));
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));

    // ★시연도 신규 유저가 보는 그 화면을 그대로 지난다(티켓 LLHMclpKaIAJbsiHzGoG).
    // 프리뷰용 UI 분기를 두지 않는다는 이 화면의 규칙이 여기에도 적용된다.
    await pickSubscription("claude");

    expect(actions.oneClickSignIn).not.toHaveBeenCalled();
    expect(actions.installAndLogin).not.toHaveBeenCalled();
    expect(screen.queryByTestId("stub-terminal")).toBeNull();
    const term = screen.getByTestId("beginner-preview-terminal");
    expect(term.getAttribute("data-preview-model")).toBe("claude");
    expect(term.textContent).toContain("claude login");
    // 그리고 국면은 실 흐름과 같은 이름으로 이어진다.
    expect(useOnboardingPreviewStore.getState().stage).toBe("awaiting_auth");
  });

  it("대본이 흐르면 '시뮬레이션' 표식이 화면에 남는다", async () => {
    vi.useFakeTimers();
    try {
      act(() => useOnboardingPreviewStore.getState().setStage("sign_in"));
      render(createElement(BeginnerOneClickModal, { onClose: () => {} }));
      // ★대본을 보려면 먼저 구독을 골라야 한다(티켓 LLHMclpKaIAJbsiHzGoG) —
      // 시연도 신규 유저가 지나는 그 화면을 그대로 지난다.
      await pickSubscription("claude");
      // 대본은 한 줄씩 흐른다(각 줄이 다음 줄의 타이머를 건다) — 몇 틱 굴린다.
      for (let i = 0; i < 4; i++) {
        act(() => void vi.advanceTimersByTime(500));
      }
      expect(
        screen.getByTestId("beginner-preview-terminal").textContent,
      ).toContain("[preview]");
    } finally {
      vi.useRealTimers();
    }
  });

  it("택1 카드(직접 고르기)도 실 설치·실 로그인으로 새지 않는다", async () => {
    render(
      createElement(BeginnerConnectStep, {
        onWatchDemo: () => {},
        onOneClick: () => {},
      }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("beginner-connect-claude").querySelector("button")!,
      );
    });
    expect(actions.launchLogin).not.toHaveBeenCalled();
    expect(
      (
        useCliSetupStore.getState().runInstall as unknown as {
          mock: { calls: unknown[] };
        }
      ).mock.calls.length,
    ).toBe(0);
    expect(screen.getByTestId("beginner-preview-terminal")).toBeTruthy();
  });

  it("'다시 확인' 은 프리뷰에서 실 프로브를 돌리지 않는다", () => {
    render(
      createElement(BeginnerConnectStep, {
        onWatchDemo: () => {},
        onOneClick: () => {},
      }),
    );
    fireEvent.click(screen.getByTestId("beginner-connect-recheck"));
    expect(
      (
        useCliSetupStore.getState().probeAll as unknown as {
          mock: { calls: unknown[] };
        }
      ).mock.calls.length,
    ).toBe(0);
  });
});

describe("프리뷰 배너 — 켜 둔 사실을 숨길 수 없고, 그 자리에 탈출구가 있다", () => {
  beforeEach(() => resetOnboardingPreviewForTest());
  afterEach(cleanup);

  it("꺼져 있으면 아무것도 그리지 않는다", () => {
    render(createElement(OnboardingPreviewBanner));
    expect(screen.queryByTestId("onboarding-preview-banner")).toBeNull();
  });

  it("켜져 있으면 현재 국면을 드러내고, 종료 버튼이 프리뷰를 끈다", () => {
    act(() => useOnboardingPreviewStore.getState().setEnabled(true));
    render(createElement(OnboardingPreviewBanner));
    expect(screen.getByTestId("onboarding-preview-stage").textContent).toBe(
      "connect",
    );

    fireEvent.click(screen.getByTestId("onboarding-preview-advance"));
    expect(useOnboardingPreviewStore.getState().stage).toBe("installing");

    fireEvent.click(screen.getByTestId("onboarding-preview-restart"));
    expect(useOnboardingPreviewStore.getState().stage).toBe("connect");

    fireEvent.click(screen.getByTestId("onboarding-preview-exit"));
    expect(useOnboardingPreviewStore.getState().enabled).toBe(false);
  });
});
