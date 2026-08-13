/**
 * @vitest-environment jsdom
 *
 * 비기너 원클릭(설치 + 자동 사인인) — 순수 국면 규칙 + 모달 화면 계약.
 * 티켓 1F0D8hH5.
 *
 * 여기서 지키는 것은 두 가지다:
 *  1. **국면 판정**(`oneClickPhase`) — 설치 중에 로그인 터미널을 띄우지 않는가,
 *     터미널을 띄운 뒤에 같은 로그인을 또 띄우지 않는가, 설치가 전부 실패하면
 *     조용히 끝나지 않고 수동 경로로 넘어가는가.
 *  2. **모달이 공용 로직을 부르는가** — 이 화면은 자기 설치·로그인 규칙을 갖지
 *     않는다(#870 이 뽑은 `runInstallAll` / `oneClickSignIn` 을 그대로 쓴다).
 *     사본이 생기면 시작하기 탭과 비기너가 서로 다른 CLI 를 설치하게 된다.
 *
 * (.ts + createElement — vitest include 가 `tests/** /*.test.ts` 라 .tsx 는
 *  수집되지 않는다. 기존 one-click-panels-render.test.ts 와 같은 관례.)
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
    onLaunched?.("login-session-1");
    return "claude" as const;
  }),
  launchLogin: vi.fn(async () => "login-session-1"),
  // ★구독 선택(티켓 LLHMclpKaIAJbsiHzGoG) 이후 모달·연결 게이트가 실제로 부르는
  // 로그인 경로다. `launchLogin` 과 달리 안 깔린 CLI 를 먼저 설치한다.
  installAndLogin: vi.fn(async () => "login-session-1"),
  setDefaultOrchestrator: vi.fn(async () => true),
  connectFolder: vi.fn(),
}));
vi.mock("../../src/services/cliSetupActions", () => actions);

// 텔레메트리는 모듈 최상단에서 firebase auth 를 초기화한다 — jsdom 유닛에서는
// 붙일 것도, 볼 것도 없다.
vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: vi.fn(), loginPrompt: vi.fn() },
}));

// xterm 은 jsdom 에서 캔버스를 요구한다 — 이 테스트가 보는 것은 "그 세션을
// 임베드했는가" 이지 터미널 렌더 자체가 아니다.
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
  canLaunchSignIn,
  oneClickInstallRows,
  oneClickPhase,
  type BulkInstallProgress,
  type OneClickFlowState,
} from "../../src/lib/oneClickSetup";
import telemetry from "../../src/services/telemetryService";
import { BeginnerOneClickModal } from "../../src/components/beginner/BeginnerOneClickModal";
import { BeginnerConnectStep } from "../../src/components/beginner/BeginnerConnectStep";
import { ROWS, useCliSetupStore } from "../../src/stores/cliSetupStore";

const flow = (over: Partial<OneClickFlowState> = {}): OneClickFlowState => ({
  started: true,
  ready: false,
  bulk: null,
  signInTargets: 0,
  loginLaunched: false,
  // 이 describe 의 관심사는 설치↔로그인 국면이라, 구독 질문은 이미 지난 것으로
  // 둔다. 그 칸 자체는 아래 별도 describe 가 본다.
  subscriptionPicked: true,
  ...over,
});

describe("oneClickPhase — 한 흐름으로 이어 붙일 때의 국면", () => {
  it("시작 전에는 idle 이다", () => {
    expect(oneClickPhase(flow({ started: false }))).toBe("idle");
  });

  it("설치가 도는 동안은 installing — 사인인 대상이 이미 있어도 마찬가지다", () => {
    // 설치 중에 로그인 터미널을 띄우면 아직 없는 바이너리에 명령을 타이핑한다.
    const s = flow({
      bulk: { running: true, total: 2, done: 1, failedIds: [] },
      signInTargets: 1,
    });
    expect(oneClickPhase(s)).toBe("installing");
    expect(canLaunchSignIn(s)).toBe(false);
  });

  it("클릭 직후(진행 기록 전)에도 빈 '막힘' 을 스치지 않는다", () => {
    expect(oneClickPhase(flow({ bulk: null }))).toBe("installing");
  });

  it("설치가 끝나고 대상이 있으면 sign_in — 이때 자동 사인인이 허용된다", () => {
    const s = flow({
      bulk: { running: false, total: 2, done: 2, failedIds: [] },
      signInTargets: 2,
    });
    expect(oneClickPhase(s)).toBe("sign_in");
    expect(canLaunchSignIn(s)).toBe(true);
  });

  it("★터미널을 띄운 뒤에는 awaiting_auth — 화면은 '승인 기다리는 중' 이다", () => {
    // 브라우저 승인이 끝날 때까지 대상 행은 계속 '미인증' 이다.
    const s = flow({
      bulk: { running: false, total: 1, done: 1, failedIds: [] },
      signInTargets: 1,
      loginLaunched: true,
    });
    expect(oneClickPhase(s)).toBe("awaiting_auth");
    // ★같은 로그인을 두 번 띄우지 않는 책임은 이제 국면이 아니라 **대상 선정**에
    // 있다(구독 선택으로 로그인이 큐가 됐다 — 티켓 LLHMclpKaIAJbsiHzGoG).
    // awaiting_auth 는 "더 띄울 게 없다" 가 아니라 "지금 하나가 진행 중" 이므로,
    // 다음 대상이 올라오면 이 국면에서도 띄울 수 있어야 한다.
    expect(canLaunchSignIn(s)).toBe(true);
  });

  it("설치가 전부 실패해 사인인 대상이 없으면 blocked(수동 경로)", () => {
    expect(
      oneClickPhase(
        flow({
          bulk: { running: false, total: 2, done: 2, failedIds: ["a", "b"] },
          signInTargets: 0,
        }),
      ),
    ).toBe("blocked");
  });

  it("부분 실패라도 살아남은 대상이 있으면 흐름은 계속된다", () => {
    expect(
      oneClickPhase(
        flow({
          bulk: { running: false, total: 2, done: 2, failedIds: ["a"] },
          signInTargets: 1,
        }),
      ),
    ).toBe("sign_in");
  });

  it("★인증이 끝났다면 무엇보다 먼저 done — 다른 창에서 먼저 로그인한 경우 포함", () => {
    expect(
      oneClickPhase(
        flow({
          ready: true,
          started: false,
          bulk: { running: true, total: 2, done: 0, failedIds: [] },
        }),
      ),
    ).toBe("done");
  });
});

describe("★구독 선택 칸 — 설치와 로그인 사이 (티켓 LLHMclpKaIAJbsiHzGoG)", () => {
  it("설치가 끝나면 로그인 전에 '어떤 구독?' 을 묻는다", () => {
    // 종전에는 여기서 곧장 오케 후보 하나의 로그인이 떴고, 그게 그 사용자가 가진
    // 구독이 아니면 승인할 것이 없어 신규 유저가 그대로 멈췄다.
    const s = flow({
      bulk: { running: false, total: 2, done: 2, failedIds: [] },
      signInTargets: 2,
      subscriptionPicked: false,
    });
    expect(oneClickPhase(s)).toBe("choose_subscription");
    // 묻는 동안에는 로그인 터미널을 띄우지 않는다 — 무엇을 띄울지 아직 모른다.
    expect(canLaunchSignIn(s)).toBe(false);
  });

  it("설치 중에는 묻지 않는다 — 아직 없는 CLI 를 고르게 된다", () => {
    expect(
      oneClickPhase(
        flow({
          bulk: { running: true, total: 2, done: 1, failedIds: [] },
          signInTargets: 1,
          subscriptionPicked: false,
        }),
      ),
    ).toBe("installing");
  });

  it("설치가 전부 실패했으면 묻지 않고 blocked — 물어도 띄울 터미널이 없다", () => {
    expect(
      oneClickPhase(
        flow({
          bulk: { running: false, total: 2, done: 2, failedIds: ["a", "b"] },
          signInTargets: 0,
          subscriptionPicked: false,
        }),
      ),
    ).toBe("blocked");
  });

  it("★남은 로그인이 있으면 ready 여도 done 이 아니다 — 두 번째 로그인을 지우지 않는다", () => {
    // `ready` 는 오케 후보 **하나**가 인증되면 선다(#579). 구독을 둘 고른 사람은
    // 그 순간 두 번째 로그인이 아직 진행 중인데, 종전 판정으로는 모달이 곧바로
    // "연결됐어요" 를 띄우고 1.6초 뒤 닫혀 그 터미널을 통째로 잃었다.
    const s = flow({
      ready: true,
      signInTargets: 1,
      loginLaunched: true,
      pendingLogins: 1,
    });
    expect(oneClickPhase(s)).toBe("awaiting_auth");
    expect(oneClickPhase({ ...s, pendingLogins: 0 })).toBe("done");
  });

  it("이 칸을 모르는 호출부(생략)에는 종전 동작 그대로다", () => {
    // `subscriptionPicked` 를 안 주면 질문 국면이 아예 생기지 않는다 — 비기너
    // 전용 단계를 다른 표면에 강제로 밀어 넣지 않는다.
    const { subscriptionPicked: _ignored, ...rest } = flow({
      bulk: { running: false, total: 2, done: 2, failedIds: [] },
      signInTargets: 2,
    });
    expect(oneClickPhase(rest as OneClickFlowState)).toBe("sign_in");
  });
});

describe("oneClickInstallRows — '모두 설치' 의 대상 집합", () => {
  it("오케 후보만 든다 — 고르지도 않은 벤더 인스톨러를 실행하지 않는다", () => {
    const ids = oneClickInstallRows(ROWS).map((r) => r.id);
    expect(ids).toContain("cli-claude-code");
    expect(ids).toContain("cli-codex");
    expect(ids).not.toContain("cli-grok");
    expect(ids).not.toContain("cli-antigravity");
  });
});

// ── 모달 화면 계약 ──────────────────────────────────────────────────────────

const probe = (installed: boolean, authenticated: boolean) => ({
  installed,
  authenticated,
});

/**
 * 구독 선택 화면을 지나간다 — 설치와 로그인 사이의 질문(티켓 LLHMclpKaIAJbsiHzGoG).
 * 종전에는 설치가 끝나면 로그인이 자동으로 떴지만, 이제 무엇에 로그인할지는
 * 사용자가 고른다.
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

/** 모달의 `data-phase` — 국면 판정이 화면까지 도달했는지 읽는 유일한 창구. */
function phaseAttr(): string | null {
  return screen
    .getByTestId("beginner-oneclick-modal")
    .getAttribute("data-phase");
}

/**
 * `runInstallAll` 을 실제 스토어와 **같은 관측 가능한 흔적**으로 흉내 낸다:
 * 부르는 즉시 `bulkInstall` 을 남긴다. 이게 없으면 모달은 영원히 "설치 중" 으로
 * 보이고, 그건 테스트가 아니라 mock 이 만든 상태다.
 */
function seed(
  results: Record<string, { installed: boolean; authenticated: boolean }>,
  opts: {
    bulkOnInstall?: BulkInstallProgress | null;
    bulkInstall?: BulkInstallProgress | null;
    installErrors?: Record<string, string>;
    ready?: boolean;
  } = {},
) {
  const bulkOnInstall =
    opts.bulkOnInstall === undefined
      ? { running: true, total: 2, done: 0, failedIds: [] }
      : opts.bulkOnInstall;
  useCliSetupStore.setState({
    results,
    states: Object.fromEntries(
      Object.entries(results).map(([id, r]) => [id, { ...r, checking: false }]),
    ),
    bulkInstall: opts.bulkInstall ?? null,
    installErrors: opts.installErrors ?? {},
    ready: opts.ready ?? false,
    runInstallAll: vi.fn(async () => {
      if (bulkOnInstall)
        useCliSetupStore.setState({ bulkInstall: bulkOnInstall });
    }),
  });
}

function installAllMock() {
  return useCliSetupStore.getState().runInstallAll as unknown as {
    mock: { calls: Array<[Array<{ id: string }>]> };
  };
}

describe("BeginnerOneClickModal", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("열리자마자 공용 일괄 설치를 부른다 — 안에서 같은 결정을 다시 묻지 않는다", () => {
    seed({
      "cli-claude-code": probe(false, false),
      "cli-codex": probe(false, false),
    });
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));

    expect(installAllMock().mock.calls.length).toBe(1);
    // 대상은 오케 후보 두 줄이다(그록·안티그래비티 아님).
    expect(installAllMock().mock.calls[0][0].map((r) => r.id)).toEqual([
      "cli-claude-code",
      "cli-codex",
    ]);
    expect(phaseAttr()).toBe("installing");
    // 설치 중에는 로그인 터미널을 띄우지 않는다.
    expect(actions.oneClickSignIn).not.toHaveBeenCalled();
  });

  it("★설치가 끝나면 로그인 전에 '어떤 구독?' 을 먼저 묻는다", async () => {
    // 백그라운드 자동설치(useCliSetupEngine)가 이미 끝낸 흔한 경우. 종전에는
    // 여기서 곧장 claude 로그인 창이 떴는데, ChatGPT 구독만 가진 사람에게는
    // 승인할 것이 하나도 없었다 — 콜드테스트가 지목한 이탈 지점이다.
    seed(
      {
        "cli-claude-code": probe(true, false),
        "cli-codex": probe(true, false),
      },
      { bulkOnInstall: { running: false, total: 0, done: 0, failedIds: [] } },
    );
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));

    expect(phaseAttr()).toBe("choose_subscription");
    expect(screen.getByTestId("beginner-subscription-pick")).toBeTruthy();
    // 묻는 동안에는 아무 로그인도 띄우지 않는다.
    expect(actions.installAndLogin).not.toHaveBeenCalled();

    // 고른 것으로만 로그인한다 — claude 는 안 골랐으니 안 뜬다.
    await pickSubscription("codex");
    expect(actions.installAndLogin).toHaveBeenCalledTimes(1);
    expect(actions.installAndLogin.mock.calls[0][0]).toBe("codex");
    // 임베드된 터미널이 **방금 띄운 그 세션**인가 — activeSessionId 를 훔쳐보던
    // 예전 방식은 다른 탭이 하나만 끼어도 엉뚱한 터미널을 그렸다.
    expect(
      screen.getByTestId("stub-terminal").getAttribute("data-session"),
    ).toBe("login-session-1");
    expect(phaseAttr()).toBe("awaiting_auth");
    // ★그리고 고른 것이 기본 오케가 된다(요구 (3)).
    expect(actions.setDefaultOrchestrator).toHaveBeenCalledWith("codex");
  });

  it("★고른 CLI 마다 로그인 터미널 — 다만 한 번에 하나씩(순차)", async () => {
    seed(
      {
        "cli-claude-code": probe(true, false),
        "cli-codex": probe(true, false),
      },
      { bulkOnInstall: { running: false, total: 0, done: 0, failedIds: [] } },
    );
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));
    await pickSubscription("claude", "codex");

    // 둘을 동시에 띄우지 않는다 — 브라우저 승인 탭이 둘 열리면 어느 터미널이
    // 무엇을 기다리는지 알 수 없다.
    expect(actions.installAndLogin).toHaveBeenCalledTimes(1);
    expect(actions.installAndLogin.mock.calls[0][0]).toBe("claude");
    expect(screen.getByTestId("beginner-login-queue-title")).toBeTruthy();

    // 앞의 것이 인증되면 다음이 스스로 올라온다.
    await act(async () => {
      useCliSetupStore.setState({
        results: {
          "cli-claude-code": probe(true, true),
          "cli-codex": probe(true, false),
        },
      });
    });
    expect(actions.installAndLogin).toHaveBeenCalledTimes(2);
    expect(actions.installAndLogin.mock.calls[1][0]).toBe("codex");
  });

  it("★이미 로그인된 CLI 는 큐에서 빠진다 — 다시 로그인시키지 않는다", async () => {
    // 사장님 케이스의 부분판: grok 은 이미 인증돼 있고 codex 만 남았다.
    seed(
      {
        "cli-claude-code": probe(true, false),
        "cli-codex": probe(true, false),
        "cli-grok": probe(true, true),
      },
      { bulkOnInstall: { running: false, total: 0, done: 0, failedIds: [] } },
    );
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));

    // 이미 로그인된 줄은 체크된 채로 잠겨 있고, 자동 건너뛰기를 화면이 말한다.
    const grok = screen.getByTestId("beginner-subscription-grok");
    expect(grok.getAttribute("data-signed-in")).toBe("true");
    expect(grok.querySelector("input")!.disabled).toBe(true);
    expect(screen.getByTestId("beginner-subscription-autoskip")).toBeTruthy();

    await pickSubscription("codex");

    // grok 은 고른 것에 들어 있지만(이미 로그인됨) 터미널은 codex 것만 뜬다.
    expect(actions.installAndLogin).toHaveBeenCalledTimes(1);
    expect(actions.installAndLogin.mock.calls[0][0]).toBe("codex");
    // 기본 오케는 **지금 당장 돌 수 있는** 것 — 이미 인증된 grok 이다.
    expect(actions.setDefaultOrchestrator).toHaveBeenCalledWith("grok");
  });

  it("로그인은 대상당 한 번만 — 폴이 결과를 갱신해도 또 띄우지 않는다", async () => {
    seed(
      { "cli-claude-code": probe(true, false) },
      { bulkOnInstall: { running: false, total: 0, done: 0, failedIds: [] } },
    );
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));
    await pickSubscription("claude");
    await act(async () => {
      // 자동 재확인 폴이 도는 동안 대상 행은 계속 '설치됨·미인증' 이다.
      useCliSetupStore.setState({
        results: { "cli-claude-code": probe(true, false) },
      });
    });
    expect(actions.installAndLogin).toHaveBeenCalledTimes(1);
  });

  it("설치가 전부 실패하면 수동 명령 + 공식 문서 + 다시 시도를 띄운다", () => {
    seed(
      {
        "cli-claude-code": probe(false, false),
        "cli-codex": probe(false, false),
      },
      {
        bulkOnInstall: {
          running: false,
          total: 2,
          done: 2,
          failedIds: ["cli-claude-code", "cli-codex"],
        },
        installErrors: { "cli-claude-code": "npm 을 찾을 수 없습니다" },
      },
    );
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));

    expect(phaseAttr()).toBe("blocked");
    const blocked = screen.getByTestId("beginner-oneclick-blocked");
    expect(blocked.textContent).toContain("npm");
    // 수동 설치 명령이 실제로 복사 가능한 형태로 떠 있다.
    expect(blocked.querySelector("code")?.textContent).toContain("claude.ai");
    expect(screen.getByTestId("beginner-oneclick-retry")).toBeTruthy();
    // 막혔다고 로그인 터미널을 띄우지는 않는다(깔린 게 없다).
    expect(actions.oneClickSignIn).not.toHaveBeenCalled();
  });

  it("인증이 끝나면 완료를 보여주고 스스로 닫힌다", () => {
    vi.useFakeTimers();
    try {
      seed({ "cli-claude-code": probe(true, true) }, { ready: true });
      const onClose = vi.fn();
      const onReady = vi.fn();
      render(createElement(BeginnerOneClickModal, { onClose, onReady }));

      expect(screen.getByTestId("beginner-oneclick-done")).toBeTruthy();
      expect(phaseAttr()).toBe("done");
      // 성공 문구를 한 박자 보여준 뒤에 닫는다 — 즉시 닫으면 무슨 일이
      // 일어났는지 화면에 아무것도 안 남는다.
      expect(onClose).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      // 이미 준비됐으므로 사인인은 부르지 않는다.
      expect(actions.oneClickSignIn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("★로그인 유도 계측 · 이탈 (티켓 LLHMclpKaIAJbsiHzGoG, #932 needs_auth 와 조인)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  const readyToPick = () =>
    seed(
      {
        "cli-claude-code": probe(true, false),
        "cli-codex": probe(true, false),
      },
      { bulkOnInstall: { running: false, total: 0, done: 0, failedIds: [] } },
    );

  const phases = () =>
    (telemetry.loginPrompt as unknown as { mock: { calls: unknown[][] } }).mock
      .calls.map((c) => c[0]);

  it("도달 → 선택 → 띄움 을 순서대로 남긴다", async () => {
    readyToPick();
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));
    expect(phases()).toEqual(["shown"]);
    await pickSubscription("claude");
    expect(phases()).toEqual(["shown", "picked", "launched"]);
  });

  it("★로그인이 남았는데 닫으면 이탈로 남는다 — 이 화면의 실패율이 이 숫자다", async () => {
    readyToPick();
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));
    await pickSubscription("claude");
    fireEvent.click(screen.getByTestId("beginner-oneclick-close"));
    expect(phases()).toContain("dismissed");
  });

  it("끝까지 간 사람은 이탈로 세지 않는다", async () => {
    // `done` 은 성공이다 — 성공을 이탈로 세면 실패율이 100% 로 보인다.
    seed({ "cli-claude-code": probe(true, true) }, { ready: true });
    const onClose = vi.fn();
    render(createElement(BeginnerOneClickModal, { onClose }));
    fireEvent.click(screen.getByTestId("beginner-oneclick-close"));
    expect(phases()).not.toContain("dismissed");
    expect(onClose).toHaveBeenCalled();
  });

  it("건너뛴 로그인은 큐를 멈추지 않는다 — 다음 CLI 가 곧바로 올라온다", async () => {
    readyToPick();
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));
    await pickSubscription("claude", "codex");
    expect(actions.installAndLogin.mock.calls[0][0]).toBe("claude");

    await act(async () => {
      fireEvent.click(screen.getByTestId("beginner-login-skip"));
    });
    expect(actions.installAndLogin).toHaveBeenCalledTimes(2);
    expect(actions.installAndLogin.mock.calls[1][0]).toBe("codex");
  });
});

describe("BeginnerConnectStep — 원클릭이 주 경로, 택1 이 폴백", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("원클릭 CTA 는 셸에 모달을 요청한다 — 게이트가 직접 들지 않는다", () => {
    // ★소유권이 중요하다: 인증이 성립하는 순간 셸이 이 연결 게이트를 폴더
    // 게이트로 갈아치우므로, 모달을 여기서 들면 "연결됐어요" 가 뜨자마자
    // 통째로 사라진다(시연에서 화면이 뚝 끊기는 자리).
    seed({
      "cli-claude-code": probe(false, false),
      "cli-codex": probe(false, false),
    });
    const onOneClick = vi.fn();
    render(
      createElement(BeginnerConnectStep, { onWatchDemo: () => {}, onOneClick }),
    );

    expect(screen.queryByTestId("beginner-oneclick-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("beginner-oneclick-cta"));
    expect(onOneClick).toHaveBeenCalledTimes(1);
    // 게이트는 설치를 직접 시작하지 않는다 — 그건 모달의 일이다.
    expect(installAllMock().mock.calls.length).toBe(0);
  });

  it("★첫 문장의 `**하나만**` 강조가 별표로 새지 않는다", () => {
    // 신규 유저가 보는 **첫 문장**이다. 프리뷰 테스트에서 여기가
    // "Connect **either** Claude or Codex" 로 보였다 — 문구는 마크다운인데
    // 화면이 텍스트 노드로 그냥 꽂아서다. 이제 <strong> 으로 쪼개 그린다.
    seed({ "cli-claude-code": probe(true, false) });
    render(
      createElement(BeginnerConnectStep, {
        onWatchDemo: () => {},
        onOneClick: () => {},
      }),
    );

    const subtitle = screen.getByTestId("beginner-connect-subtitle");
    expect(subtitle.textContent).not.toContain("*");
    expect(subtitle.querySelector("strong")?.textContent?.trim()).toBeTruthy();
  });

  it("★택1 경로도 로그인 명령을 직접 조립하지 않는다 — 프로브 action 을 그대로 넘긴다", async () => {
    // 예전에는 여기서 `${model} login` 을 손으로 만들었다(codex 예외 포함).
    // 규칙의 두 번째 사본이라, `loginCommandFor` 가 바뀌어도 이 화면만 옛 명령을
    // 타이핑하는 상태가 조용히 생긴다.
    seed({
      "cli-claude-code": { ...probe(true, false), action: "claude login" },
    });
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
    expect(actions.installAndLogin).toHaveBeenCalledTimes(1);
    expect(actions.installAndLogin.mock.calls[0].slice(0, 2)).toEqual([
      "claude",
      "claude login",
    ]);
    // 그리고 그 세션이 카드 안에 임베드된다(비기너 셸에는 터미널 열이 없다).
    expect(
      screen.getByTestId("stub-terminal").getAttribute("data-session"),
    ).toBe("login-session-1");
  });

  it("설치가 실패하면 조용히 삼키지 않고 수동 명령 + 공식 문서를 띄운다", async () => {
    seed({ "cli-claude-code": probe(false, false) });
    useCliSetupStore.setState({
      runInstall: vi.fn(async () => {
        useCliSetupStore.setState({
          installErrors: { "cli-claude-code": "EACCES: permission denied" },
        });
      }),
    });
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
    const err = screen.getByTestId("beginner-connect-install-error");
    expect(err.textContent).toContain("EACCES");
    expect(err.querySelector("code")?.textContent).toContain("claude.ai");
  });
});
