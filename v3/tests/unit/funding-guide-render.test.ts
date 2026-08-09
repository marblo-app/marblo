/**
 * @vitest-environment jsdom
 *
 * "구독이 필요해요" 가이드 모달의 화면 계약(티켓 sVdwTsiGq6qZVAmSkwZB).
 *
 * 이 화면의 존재 이유는 **조용히 막히지 않게** 하는 것이고, 존재의 위험은
 * **정상 유저를 막는** 것이다. 그래서 여기서 검사하는 것도 그 둘이다:
 *  1. 판정이 없거나 정상이면 아무것도 그리지 않는다.
 *  2. 구독 단정은 `unfunded` 일 때만 — 모호한 실패는 중립 문구로만 말한다.
 *  3. 구독 링크는 벤더 페이지로 가고, "다시 확인" 은 실제로 재프로브를 부른다.
 *
 * (.ts + createElement — vitest include 가 `tests/** /*.test.ts` 라 .tsx 는
 *  수집되지 않는다. 기존 beginner-one-click.test.ts 와 같은 관례.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { FundingProbeOutcome } from "../../src/lib/fundingProbe";

const probeFunding = vi.hoisted(() => vi.fn());
vi.mock("../../src/services/fundingProbeService", () => ({ probeFunding }));

// 텔레메트리는 모듈 최상단에서 firebase auth 를 초기화한다 — jsdom 유닛에서는
// 붙일 것도, 볼 것도 없다.
vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: vi.fn() },
}));

// 뷰모델(useOnboardingSetup)이 끌고 오는 설치·로그인 액션은 오케 라우팅을 거쳐
// firestore 까지 딸려 온다. 이 화면이 부르는 것은 재프로브 하나뿐이다.
vi.mock("../../src/services/cliSetupActions", () => ({
  oneClickSignIn: vi.fn(() => null),
  launchLogin: vi.fn(async () => null),
  connectFolder: vi.fn(),
}));

import { FundingGuideHost } from "../../src/components/onboarding/FundingGuideHost";
import {
  SUBSCRIPTION_URL,
  useCliSetupStore,
} from "../../src/stores/cliSetupStore";

const outcome = (over: Partial<FundingProbeOutcome>): FundingProbeOutcome => ({
  verdict: "ok",
  model: "claude",
  detail: "",
  ...over,
});

/** 설치+인증까지 끝난 사용자(= `ready`) 를 세운 뒤 프로브 판정만 갈아 끼운다. */
function seed(fundingOutcome: FundingProbeOutcome | null) {
  useCliSetupStore.setState({
    ready: true,
    results: {
      "cli-claude-code": { installed: true, authenticated: true },
    },
    fundingChecking: false,
    fundingOutcome,
    fundingGuideDismissed: false,
  });
}

describe("FundingGuideHost — 정상 유저를 막지 않는다", () => {
  beforeEach(() => {
    probeFunding.mockReset();
    probeFunding.mockResolvedValue(outcome({ verdict: "ok" }));
  });
  afterEach(cleanup);

  it("프로브를 아직 안 돌렸으면 아무것도 그리지 않는다", () => {
    seed(null);
    render(createElement(FundingGuideHost));
    expect(screen.queryByTestId("beginner-funding-modal")).toBeNull();
  });

  it("한 턴이 실제로 돌았으면(ok) 아무것도 그리지 않는다", () => {
    seed(outcome({ verdict: "ok" }));
    render(createElement(FundingGuideHost));
    expect(screen.queryByTestId("beginner-funding-modal")).toBeNull();
  });

  it("인증 자체가 아직이면(ready=false) 이 화면은 관여하지 않는다", () => {
    seed(outcome({ verdict: "unfunded" }));
    useCliSetupStore.setState({ ready: false });
    render(createElement(FundingGuideHost));
    expect(screen.queryByTestId("beginner-funding-modal")).toBeNull();
  });
});

describe("FundingGuideHost — 구독 없음", () => {
  beforeEach(() => {
    probeFunding.mockReset();
    probeFunding.mockResolvedValue(outcome({ verdict: "ok" }));
    seed(outcome({ verdict: "unfunded", detail: "credit balance is too low" }));
  });
  afterEach(cleanup);

  it("구독 안내 + 1-2-3 단계 + 벤더 요금제 링크를 띄운다", () => {
    render(createElement(FundingGuideHost));

    const modal = screen.getByTestId("beginner-funding-modal");
    expect(modal.getAttribute("data-state")).toBe("authedButUnfunded");
    expect(screen.getByTestId("beginner-funding-steps").children).toHaveLength(
      3,
    );
    expect(
      screen.getByTestId("beginner-funding-subscribe").getAttribute("href"),
    ).toBe(SUBSCRIPTION_URL.claude);
    // 무슨 일이 있었는지 감추지 않는다.
    expect(screen.getByTestId("beginner-funding-detail").textContent).toContain(
      "credit balance is too low",
    );
  });

  it("'API 요금제 간단 결제' 는 자리만 잡아 둔다 — 누를 수 있는 버튼이 아니다", () => {
    // 결제 배선은 별도 스파이크(OF2wawHo)라, 여기 버튼을 두면 아무 일도 안
    // 일어나는 버튼이 된다.
    render(createElement(FundingGuideHost));
    const placeholder = screen.getByTestId("beginner-funding-api-placeholder");
    expect(placeholder.querySelector("button")).toBeNull();
    expect(placeholder.querySelector("a")).toBeNull();
  });

  it("'다시 확인' 은 재프로브를 부른다", () => {
    render(createElement(FundingGuideHost));
    fireEvent.click(screen.getByTestId("beginner-funding-recheck"));
    expect(probeFunding).toHaveBeenCalledWith("claude");
  });

  it("닫으면 사라지고 이 세션에 다시 뜨지 않는다", () => {
    const { rerender } = render(createElement(FundingGuideHost));
    fireEvent.click(screen.getByTestId("beginner-funding-later"));
    rerender(createElement(FundingGuideHost));
    expect(screen.queryByTestId("beginner-funding-modal")).toBeNull();
    expect(useCliSetupStore.getState().fundingGuideDismissed).toBe(true);
  });
});

describe("FundingGuideHost — 원인이 모호하면 중립", () => {
  afterEach(cleanup);

  it("blocked 에서는 구독을 단정하지 않는다(1-2-3 단계 없음)", () => {
    seed(
      outcome({
        verdict: "blocked",
        blockedReason: "rate_limit",
        detail: "usage limit reached",
      }),
    );
    render(createElement(FundingGuideHost));

    expect(
      screen.getByTestId("beginner-funding-modal").getAttribute("data-state"),
    ).toBe("authedButBlocked");
    expect(screen.queryByTestId("beginner-funding-steps")).toBeNull();
    // 중립 안내라도 빠져나갈 길(재확인)은 그대로 있다.
    expect(screen.getByTestId("beginner-funding-recheck")).toBeTruthy();
  });
});
