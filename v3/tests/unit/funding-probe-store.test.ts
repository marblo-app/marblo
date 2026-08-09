/**
 * @vitest-environment jsdom
 *
 * `cliSetupStore.runFundingProbe` 의 분기 — 언제 실제 턴을 태우고, 언제 태우지
 * 않으며, 결과를 어떻게 남기는가(티켓 sVdwTsiGq6qZVAmSkwZB).
 *
 * 프로브는 **실제 모델 턴을 하나 태운다**. 그래서 "안 돌리는 조건" 이 기능만큼
 * 중요하다: 대상이 없으면 한 번도 부르지 않고, 이미 돌고 있으면 겹쳐 돌지 않는다.
 * 그리고 판단 불가(`inconclusive`)는 결과를 **지운다** — 낡은 `unfunded` 가 남아
 * 있으면 방금 결제를 마친 사용자가 계속 막힌다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FundingProbeOutcome } from "../../src/lib/fundingProbe";

const probeFunding = vi.fn<(model: string) => Promise<FundingProbeOutcome>>();

vi.mock("../../src/services/fundingProbeService", () => ({
  probeFunding: (model: string) => probeFunding(model),
}));

const outcome = (over: Partial<FundingProbeOutcome>): FundingProbeOutcome => ({
  verdict: "ok",
  model: "claude",
  detail: "",
  ...over,
});

/** 프로브가 볼 상태를 만든다: claude 만 설치+인증(=오케가 실제로 돌 CLI). */
async function seedAuthed(authenticated = true) {
  const { useCliSetupStore } = await import("../../src/stores/cliSetupStore");
  useCliSetupStore.setState({
    results: {
      "cli-claude-code": { installed: true, authenticated },
      "cli-codex": { installed: false, authenticated: false },
    },
    ready: authenticated,
    fundingChecking: false,
    fundingOutcome: null,
    fundingGuideDismissed: false,
  });
  return useCliSetupStore;
}

describe("runFundingProbe", () => {
  beforeEach(() => {
    probeFunding.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("인증된 오케 후보로 딱 한 번 돌리고 판정을 남긴다", async () => {
    const store = await seedAuthed();
    probeFunding.mockResolvedValue(
      outcome({ verdict: "unfunded", detail: "credit balance is too low" }),
    );

    const result = await store.getState().runFundingProbe();

    expect(probeFunding).toHaveBeenCalledTimes(1);
    expect(probeFunding).toHaveBeenCalledWith("claude");
    expect(result?.verdict).toBe("unfunded");
    expect(store.getState().fundingOutcome?.verdict).toBe("unfunded");
    expect(store.getState().fundingChecking).toBe(false);
  });

  it("★인증된 대상이 없으면 한 번도 부르지 않는다 (모델 턴을 태우지 않는다)", async () => {
    const store = await seedAuthed(false);

    expect(await store.getState().runFundingProbe()).toBeNull();
    expect(probeFunding).not.toHaveBeenCalled();
  });

  it("판단 불가는 결과를 지운다 — 낡은 'unfunded' 가 사용자를 계속 막지 않게", async () => {
    const store = await seedAuthed();
    store.setState({
      fundingOutcome: outcome({ verdict: "unfunded", detail: "old" }),
    });
    probeFunding.mockResolvedValue(outcome({ verdict: "inconclusive" }));

    await store.getState().runFundingProbe();

    expect(store.getState().fundingOutcome).toBeNull();
  });

  it("프로브가 던져도 사용자를 막지 않는다(결과 없음 + checking 해제)", async () => {
    const store = await seedAuthed();
    probeFunding.mockRejectedValue(new Error("boom"));

    await store.getState().runFundingProbe();

    expect(store.getState().fundingOutcome).toBeNull();
    expect(store.getState().fundingChecking).toBe(false);
  });

  it("돌고 있는 동안의 재요청은 겹쳐 돌지 않는다", async () => {
    const store = await seedAuthed();
    let release: (v: FundingProbeOutcome) => void = () => {};
    probeFunding.mockImplementation(
      () =>
        new Promise<FundingProbeOutcome>((resolve) => {
          release = resolve;
        }),
    );

    const first = store.getState().runFundingProbe();
    expect(store.getState().fundingChecking).toBe(true);
    await store.getState().runFundingProbe(); // "다시 확인" 연타
    expect(probeFunding).toHaveBeenCalledTimes(1);

    release(outcome({ verdict: "ok" }));
    await first;
    expect(store.getState().fundingChecking).toBe(false);
  });

  it("dismissFundingGuide 는 이 세션에서 모달을 다시 띄우지 않게 한다", async () => {
    const store = await seedAuthed();
    store.getState().dismissFundingGuide();
    expect(store.getState().fundingGuideDismissed).toBe(true);
  });
});
