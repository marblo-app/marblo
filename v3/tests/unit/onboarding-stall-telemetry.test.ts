/**
 * 온보딩 스톨 계측 계약 (ticket 9dXgBdkGn1LyJokShh1g).
 *
 * 온램프 스파이크 두 건(#883 API 요금제 재판매 / #885 자체 SLM 무료 티어)의 공통
 * 결론은 "원가가 아니라 **증거**가 블로커" 였다: 무료→유료 티어에 투자하기 전에
 * "구독/크레딧/인증이 없어 **최초에 멈추는** 유저" 가 몇 명인지 알아야 하는데,
 * 그 순간의 이벤트가 BigQuery `events` 에 0건이라 문제 크기를 셀 수 없었다.
 *
 * 이 테스트가 못박는 것:
 *   1) 스톨 이벤트가 실제로 발화하고,
 *   2) 기존 파이프라인(logTelemetryBatch → BigQuery events)으로 **그대로** 나가며,
 *   3) ★정상 판정(`ok`)도 실려 비율의 **분모**가 생기고,
 *   4) 비식별이다 — 프로브가 읽은 벤더 원문(detail)·uid·이메일·경로가 안 나간다,
 *   5) 사용자가 텔레메트리를 끄면 한 건도 안 나간다.
 *
 * 스키마·쿼리 문서: docs/onboarding-stall-telemetry.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const callableSpy = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock("firebase/functions", () => ({
  httpsCallable: () => callableSpy,
}));

vi.mock("../../src/lib/firebase", () => ({
  functions: {},
  auth: { currentUser: { uid: "test-uid" } },
  db: {},
}));

type Row = Record<string, unknown>;

async function drain(): Promise<Row[]> {
  const { telemetry } = await import("../../src/services/telemetryService");
  await telemetry.flush();
  return callableSpy.mock.calls.flatMap(
    (c) => (c[0] as { events: Row[] }).events,
  );
}

describe("온보딩 스톨 텔레메트리", () => {
  beforeEach(() => {
    callableSpy.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("★정상 판정(ok)도 싣는다 — 없으면 '몇 %가 막히나' 의 분모가 없다", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.fundingProbe("ok", "claude", "auto");
    telemetry.fundingProbe("unfunded", "claude", "auto");

    const rows = await drain();
    expect(rows.map((r) => r.event)).toEqual([
      "onboarding:funding_probe",
      "onboarding:funding_probe",
    ]);
    expect(rows[0].success).toBe(true);
    expect(rows[1].success).toBe(false);
    expect(rows[1].errorCategory).toBe("unfunded");
  });

  it("blocked 는 하위 사유까지 싣는다 — rate_limit(=요금제 있음)을 스톨로 세지 않게", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.fundingProbe("blocked", "claude", "auto", "rate_limit");

    const [row] = await drain();
    expect(row.errorCategory).toBe("blocked:rate_limit");
    expect((row.metadata as Row).blockedReason).toBe("rate_limit");
  });

  it("자동/재확인을 구분한다 — 구독을 붙이고 실제로 풀렸는지 보려면 필요하다", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.fundingProbe("unfunded", "codex", "auto");
    telemetry.fundingProbe("ok", "codex", "recheck");

    const rows = await drain();
    expect(rows.map((r) => (r.metadata as Row).trigger)).toEqual([
      "auto",
      "recheck",
    ]);
    expect(rows.map((r) => r.model)).toEqual(["codex", "codex"]);
  });

  it("가이드 모달 노출은 별도 이벤트다 — '판정' 과 '본 사람' 은 갈린다", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.fundingGuideShown("authedButUnfunded", "claude");

    const [row] = await drain();
    expect(row.event).toBe("onboarding:funding_guide_shown");
    expect(row.errorCategory).toBe("authedButUnfunded");
    expect(row.model).toBe("claude");
  });

  it("main 프로세스 스톨(스폰차단/needsAuth/철회)이 같은 배치로 나간다", async () => {
    // main 은 IPC 브리지(App.tsx)로 payload 를 그대로 보내고, 렌더러의 이 choke
    // point 가 받는다 — 새 파이프라인 없음. 여기서는 그 브리지를 흉내낸다.
    const { logTelemetry } =
      await import("../../src/services/telemetryService");

    logTelemetry({
      event: "onboarding:spawn_blocked",
      model: "claude",
      success: false,
      errorCategory: "not-authenticated",
      metadata: { surface: "agent_launch", installed: true },
    });
    logTelemetry({
      event: "onboarding:agent_needs_auth",
      agentId: "agent-1",
      model: "grok",
      success: false,
      errorCategory: "grace-expired",
    });
    logTelemetry({
      event: "onboarding:agent_auth_resolved",
      agentId: "agent-1",
      model: "grok",
      success: true,
    });

    const rows = await drain();
    expect(rows.map((r) => r.event)).toEqual([
      "onboarding:spawn_blocked",
      "onboarding:agent_needs_auth",
      "onboarding:agent_auth_resolved",
    ]);
    // 철회는 같은 agentId 로 짝지어야 오탐을 뺄 수 있다.
    expect(rows[1].agentId).toBe(rows[2].agentId);
    // 익명 install id 로만 나간다(uid 아님).
    expect(rows.every((r) => typeof r.clientId === "string")).toBe(true);
  });

  it("★비식별: 프로브 원문·uid·이메일·홈경로가 실려도 나가지 않는다", async () => {
    const { logTelemetry } =
      await import("../../src/services/telemetryService");

    logTelemetry({
      event: "onboarding:funding_probe",
      model: "claude",
      metadata: {
        verdict: "unfunded",
        // 실수로 실렸다고 가정한 것들 — choke point 가 전부 처리해야 한다.
        uid: "firebase-uid-1",
        email: "someone@example.com",
        detail: "/Users/dongwon/project 에서 credit balance is too low",
      },
    });

    const [row] = await drain();
    const meta = row.metadata as Row;
    expect(meta.uid).toBeUndefined();
    expect(meta.email).toBeUndefined();
    expect(String(meta.detail)).not.toContain("/Users/dongwon");
    expect(String(meta.detail)).toContain("<USER_HOME>");
    expect(JSON.stringify(row)).not.toContain("firebase-uid-1");
    expect(JSON.stringify(row)).not.toContain("someone@example.com");
  });

  it("사용자가 텔레메트리를 끄면 스톨 이벤트도 한 건도 안 나간다", async () => {
    const { telemetry, setTelemetryEnabled } =
      await import("../../src/services/telemetryService");

    setTelemetryEnabled(false, { persist: false });
    telemetry.fundingProbe("unfunded", "claude", "auto");
    telemetry.fundingGuideShown("authedButUnfunded", "claude");

    expect(await drain()).toEqual([]);
    setTelemetryEnabled(true, { persist: false });
  });
});
