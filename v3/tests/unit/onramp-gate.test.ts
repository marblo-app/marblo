/**
 * M1(실행 차단 안내)의 판정 규칙 (ticket VzR1izqW6hzwF0YRfkgL · 설계 #886 §5-A).
 *
 * 이 모달이 잘못 뜨는 두 가지 방식이 각각 실제 사고와 짝이 있다:
 *  - 이미 연결된 사람에게 뜨면 → "연결하세요" 와 "구독하세요"(M2)가 동시에 뜬다.
 *  - MCP 축 차단(#639 grok 폴더신뢰)에 뜨면 → 로그인으로 안 풀리는 문제에
 *    로그인을 시킨다. `orchestratorLaunchBlock` 이 이미 겪은 종류의 사고다.
 */
import { describe, it, expect } from "vitest";
import {
  ONRAMP_BLOCK_SESSION_LIMIT,
  onrampBlockCtaKey,
  planOnrampBlockUi,
} from "../../src/lib/onrampGate";
import { ORCHESTRATOR_BLOCK_REASON_MCP } from "../../src/lib/orchestratorLaunchBlock";

const AUTH_BLOCK = {
  model: "claude",
  action: "claude login",
  installed: true,
};

describe("onramp gate — 언제 뜨는가", () => {
  it("연결 안 된 유저가 실행을 시도하면 뜬다", () => {
    const plan = planOnrampBlockUi(AUTH_BLOCK, "demo_ticket_run", {
      ready: false,
      shownThisSession: 0,
    });
    expect(plan.show).toBe(true);
    expect(plan.model).toBe("claude");
    expect(plan.installed).toBe(true);
    expect(plan.trigger).toBe("demo_ticket_run");
  });

  it("★이미 ready 면 절대 안 뜬다 — 그 국면은 M2(자금 안내)의 몫이다", () => {
    const plan = planOnrampBlockUi(AUTH_BLOCK, "spawn_needs_auth", {
      ready: true,
      shownThisSession: 0,
    });
    expect(plan.show).toBe(false);
    expect(plan.suppressedReason).toBe("already_ready");
  });

  it("★MCP 축 차단에는 안 뜬다 — 로그인으로 안 풀리는 문제다", () => {
    const plan = planOnrampBlockUi(
      { ...AUTH_BLOCK, reason: ORCHESTRATOR_BLOCK_REASON_MCP },
      "spawn_needs_auth",
      { ready: false, shownThisSession: 0 },
    );
    expect(plan.show).toBe(false);
    expect(plan.suppressedReason).toBe("mcp_axis");
  });

  it("세션당 2회까지 — 1회는 놓치기 쉽고 3회는 조르는 것이다", () => {
    expect(ONRAMP_BLOCK_SESSION_LIMIT).toBe(2);
    const ctx = (shown: number) => ({ ready: false, shownThisSession: shown });
    expect(planOnrampBlockUi(AUTH_BLOCK, "demo_ticket_run", ctx(1)).show).toBe(
      true,
    );
    const capped = planOnrampBlockUi(AUTH_BLOCK, "demo_ticket_run", ctx(2));
    expect(capped.show).toBe(false);
    expect(capped.suppressedReason).toBe("session_limit");
  });

  it("억제돼도 model·installed·trigger 는 그대로 실린다(계측이 읽는다)", () => {
    const plan = planOnrampBlockUi(
      { ...AUTH_BLOCK, model: "codex", installed: false },
      "decompose_limit",
      { ready: true, shownThisSession: 0 },
    );
    expect(plan.model).toBe("codex");
    expect(plan.installed).toBe(false);
    expect(plan.trigger).toBe("decompose_limit");
  });

  it("미설치면 CTA 가 '설치하고 연결' 로 바뀐다 — 없는 로그인 화면을 찾게 두지 않는다", () => {
    expect(onrampBlockCtaKey(true)).toBe("onramp.block.cta.connect");
    expect(onrampBlockCtaKey(false)).toBe("onramp.block.cta.install");
  });
});
