/**
 * "첫 10분" 활성화 퍼널 계측 계약 (ONBOARDING-FIRST10-INSTRUMENT, ticket ixQUBdhx).
 *
 * 근본원인 분석(docs/beta-churn-root-cause-analysis-2026-07-21.md)이 최대 이탈 =
 * 앱실행→첫스폰 22→6(−73%) 인데 그 구간이 미계측이라 "왜 죽는지" 모른다고 판정.
 * 이 테스트는 신규 퍼널 이벤트가:
 *   1) 실제로 발생하고(각 헬퍼가 이벤트를 큐잉),
 *   2) 기존 텔레메트리 경로(logTelemetryBatch)로 그대로 나가며(새 파이프라인 없음),
 *   3) 비식별(익명 clientId, uid/email/경로 미포함) 상태로 전송되고,
 *   4) 실패 사유(로그인 코드 / cli_auth / 크래시 분류)를 실어 나르는지
 * 를 실측한다. 배포 전이라 실사용자 데이터 수집은 릴리스 후행이지만, 계측 경로
 * 자체는 여기서 발화가 검증된다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const callableSpy = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock("firebase/functions", () => ({
  httpsCallable: () => callableSpy,
}));

// auth.currentUser present → flush is NOT auth-gated here; the ONLY gate under
// test is event correctness. (Live caveat: real login-failure-before-any-success
// never flushes — documented in telemetryService onboarding helpers.)
vi.mock("../../src/lib/firebase", () => ({
  functions: {},
  auth: { currentUser: { uid: "test-uid" } },
  db: {},
}));

async function drain() {
  const { telemetry } = await import("../../src/services/telemetryService");
  await telemetry.flush();
  const events = callableSpy.mock.calls.flatMap(
    (c) => (c[0] as { events: Array<Record<string, unknown>> }).events,
  );
  return events;
}

describe("onboarding funnel telemetry", () => {
  beforeEach(() => {
    callableSpy.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits every funnel stage with its canonical event name", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.appFirstRun("MacIntel");
    telemetry.loginAttempt("google");
    telemetry.loginSuccess("google");
    telemetry.folderConnected("new", true);
    telemetry.orchestratorOpened(false);

    const names = (await drain()).map((e) => e.event);
    expect(names).toEqual([
      "app:first_run",
      "auth:login_attempt",
      "auth:login_success",
      "onboarding:folder_connected",
      "onboarding:orchestrator_opened",
    ]);
  });

  it("carries failure reasons for the 22→6 first-spawn drop", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.loginFailed("google", "auth/network-request-failed");
    telemetry.orchestratorBlocked("cli_auth");
    telemetry.folderConnectFailed("write_error");

    const events = await drain();
    const byName = Object.fromEntries(events.map((e) => [e.event, e]));

    // Login failure reason rides errorCategory (the Firebase CODE, never the
    // message — §5-2 blind spot, de-identified).
    expect(byName["auth:login_failed"].errorCategory).toBe(
      "auth/network-request-failed",
    );
    expect(byName["auth:login_failed"].success).toBe(false);

    // "시도했으나 CLI 미설치/미인증" — distinguishes tried-and-failed from
    // never-tried. This is the single most important signal for 22→6.
    expect(byName["onboarding:orchestrator_blocked"].errorCategory).toBe(
      "cli_auth",
    );
    expect(byName["onboarding:folder_connect_failed"].errorCategory).toBe(
      "write_error",
    );
  });

  it("carries the main-process crash classification (§5-4 gap)", async () => {
    const { logTelemetry } =
      await import("../../src/services/telemetryService");

    // Simulate the agent:crashed event as the main→renderer IPC bridge delivers
    // it (App.tsx logTelemetry(data)). fast_fail_config = missing binary / bad
    // config — the CLI-not-installed / model-misconfig class of first spawn.
    logTelemetry({
      event: "agent:crashed",
      agentId: "ag1",
      exitCode: 1,
      success: false,
      errorCategory: "fast_fail_config",
      errorMessage: "fast-fail x4 (exit 1, command=claude)",
    });

    const events = await drain();
    const crash = events.find((e) => e.event === "agent:crashed");
    expect(crash?.errorCategory).toBe("fast_fail_config");
    expect(crash?.errorMessage).toContain("fast-fail");
  });

  it("stays de-identified — a user home path in a crash message is scrubbed", async () => {
    const { logTelemetry } =
      await import("../../src/services/telemetryService");

    // Defense-in-depth: even though the manager ships a curated short message,
    // any path/email that slips in must be masked by the scrub choke point
    // before leaving the machine.
    logTelemetry({
      event: "agent:crashed",
      agentId: "ag2",
      exitCode: 1,
      errorCategory: "runtime_crash",
      errorMessage: "boom at /Users/secretperson/project failed",
    });

    const events = await drain();
    const crash = events.find((e) => e.event === "agent:crashed");
    expect(crash?.errorMessage).not.toContain("secretperson");
    expect(String(crash?.errorMessage)).toContain("<USER_HOME>");
    // No account identifiers ever ride these rows.
    expect(crash?.uid).toBeUndefined();
    expect(crash?.email).toBeUndefined();
  });
});
