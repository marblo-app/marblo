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
  connectFolder: vi.fn(),
}));
vi.mock("../../src/services/cliSetupActions", () => actions);

// 텔레메트리는 모듈 최상단에서 firebase auth 를 초기화한다 — jsdom 유닛에서는
// 붙일 것도, 볼 것도 없다.
vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: vi.fn() },
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

import {
  oneClickInstallRows,
  oneClickPhase,
  shouldAutoSignIn,
  type BulkInstallProgress,
  type OneClickFlowState,
} from "../../src/lib/oneClickSetup";
import { BeginnerOneClickModal } from "../../src/components/beginner/BeginnerOneClickModal";
import { BeginnerConnectStep } from "../../src/components/beginner/BeginnerConnectStep";
import { ROWS, useCliSetupStore } from "../../src/stores/cliSetupStore";

const flow = (over: Partial<OneClickFlowState> = {}): OneClickFlowState => ({
  started: true,
  ready: false,
  bulk: null,
  signInTargets: 0,
  loginLaunched: false,
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
    expect(shouldAutoSignIn(s)).toBe(false);
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
    expect(shouldAutoSignIn(s)).toBe(true);
  });

  it("★터미널을 띄운 뒤에는 awaiting_auth — 대상이 남아 있어도 다시 띄우지 않는다", () => {
    // 브라우저 승인이 끝날 때까지 대상 행은 계속 '미인증' 이다. 이 우선순위가
    // 없으면 폴 주기마다 같은 로그인이 새 터미널로 다시 뜬다.
    const s = flow({
      bulk: { running: false, total: 1, done: 1, failedIds: [] },
      signInTargets: 1,
      loginLaunched: true,
    });
    expect(oneClickPhase(s)).toBe("awaiting_auth");
    expect(shouldAutoSignIn(s)).toBe(false);
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

  it("★설치할 게 없으면 사인인이 스스로 시작되고 그 터미널이 모달 안에 뜬다", () => {
    // 백그라운드 자동설치(useCliSetupEngine)가 이미 끝낸 흔한 경우 —
    // 설치됨·미인증이면 원클릭은 곧장 사인인으로 이어져야 한다.
    seed(
      {
        "cli-claude-code": probe(true, false),
        "cli-codex": probe(true, false),
      },
      { bulkOnInstall: { running: false, total: 0, done: 0, failedIds: [] } },
    );
    render(createElement(BeginnerOneClickModal, { onClose: () => {} }));

    expect(actions.oneClickSignIn).toHaveBeenCalledTimes(1);
    // 임베드된 터미널이 **방금 띄운 그 세션**인가 — activeSessionId 를 훔쳐보던
    // 예전 방식은 다른 탭이 하나만 끼어도 엉뚱한 터미널을 그렸다.
    expect(
      screen.getByTestId("stub-terminal").getAttribute("data-session"),
    ).toBe("login-session-1");
    expect(phaseAttr()).toBe("awaiting_auth");
  });

  it("자동 사인인은 한 번만 — 폴이 결과를 갱신해도 로그인을 또 띄우지 않는다", () => {
    seed(
      { "cli-claude-code": probe(true, false) },
      { bulkOnInstall: { running: false, total: 0, done: 0, failedIds: [] } },
    );
    const { rerender } = render(
      createElement(BeginnerOneClickModal, { onClose: () => {} }),
    );
    rerender(createElement(BeginnerOneClickModal, { onClose: () => {} }));
    act(() => {
      // 자동 재확인 폴이 도는 동안 대상 행은 계속 '설치됨·미인증' 이다.
      useCliSetupStore.setState({
        results: { "cli-claude-code": probe(true, false) },
      });
    });
    expect(actions.oneClickSignIn).toHaveBeenCalledTimes(1);
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
    expect(actions.launchLogin).toHaveBeenCalledTimes(1);
    expect(actions.launchLogin.mock.calls[0].slice(0, 2)).toEqual([
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
