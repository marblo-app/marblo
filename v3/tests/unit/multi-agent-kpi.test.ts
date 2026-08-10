/**
 * ★제로마찰 핵심 KPI 계측 계약 (티켓 pWSnJeQN).
 *
 * 사장님 최중요 KPI 는 **"10분 안에 첫 multi-agent 성공 경험"** 인데, 그 KPI 를
 * 이루는 '멀티에이전트 동시실행' 이 BigQuery 에 한 건도 없었다(grep 0). #895 가
 * 여정 골격(first_run→…→first_merge + 상관키)을 심었으므로 이 티켓은 그 위에
 * 빠진 조각만 얹는다.
 *
 * 이 테스트가 못박는 것:
 *   1) 동시2+ 관측이 **상시** 발신되고 설치당 첫 건에만 firstForInstall=true,
 *   2) 성공 관측이 **상시** + 설치당 1회의 짝 이벤트(first_multi_agent_success)를
 *      내고, 그 짝이 durationMs(= first_run→성공)와 10분 판정을 싣고,
 *   3) 시계 시작점 스탬프가 없으면 소요시간을 **지어내지 않는다**(clockAvailable=false),
 *   4) DONE 전이만 성공이다(REVIEW/FAILED/BLOCKED 는 아니다),
 *   5) 동시성이 1이면 성공 이벤트가 나가지 않는다,
 *   6) 비식별 — 에이전트 id·이름·모델·티켓 제목이 실리지 않는다.
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

/**
 * 노드 환경엔 localStorage 가 없다. 이 계측의 핵심 계약(설치당 1회 마커 + 시계
 * 스탬프)이 정확히 그 저장소 위에 있으므로, 인메모리 구현을 심어 계약을 실측한다.
 */
function installMemoryLocalStorage(): Storage {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as unknown as Storage;
  vi.stubGlobal("localStorage", mock);
  return mock;
}

async function drain(): Promise<Row[]> {
  const { telemetry } = await import("../../src/services/telemetryService");
  await telemetry.flush();
  return callableSpy.mock.calls.flatMap(
    (c) => (c[0] as { events: Row[] }).events,
  );
}

function meta(row: Row | undefined): Record<string, unknown> {
  return (row?.metadata ?? {}) as Record<string, unknown>;
}

describe("멀티에이전트 KPI 계측", () => {
  beforeEach(() => {
    callableSpy.mockClear();
    vi.resetModules();
    installMemoryLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("동시2+ 관측은 상시 발신되고, 설치당 첫 건만 firstForInstall", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.multiAgentActiveObserved({ concurrent: 2, working: 1 });
    telemetry.multiAgentActiveObserved({ concurrent: 3, working: 3 });

    const rows = (await drain()).filter(
      (e) => e.event === "onboarding:multi_agent_active",
    );
    expect(rows).toHaveLength(2);
    expect(meta(rows[0]).firstForInstall).toBe(true);
    expect(meta(rows[0]).concurrent).toBe(2);
    expect(meta(rows[1]).firstForInstall).toBe(false);
    expect(meta(rows[1]).concurrent).toBe(3);
  });

  it("첫 성공만 짝 이벤트를 내고 durationMs·10분 판정을 싣는다", async () => {
    const { telemetry, stampFirstRunAt, MULTI_AGENT_TARGET_WINDOW_MS } =
      await import("../../src/services/telemetryService");

    // 최초 실행 시각을 5분 전으로 심는다 → 10분 창 안이다.
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    localStorage.setItem("marblo.telemetry.firstRunAt", String(fiveMinutesAgo));
    stampFirstRunAt(); // 이미 있으면 보존해야 한다(덮어쓰면 시계가 0 이 된다)

    telemetry.multiAgentSuccessObserved({
      trigger: "task_completed",
      concurrent: 2,
      working: 2,
    });
    telemetry.multiAgentSuccessObserved({
      trigger: "merge",
      concurrent: 3,
      working: 1,
    });

    const rows = await drain();
    const successes = rows.filter(
      (e) => e.event === "onboarding:multi_agent_success",
    );
    const firsts = rows.filter(
      (e) => e.event === "onboarding:first_multi_agent_success",
    );
    expect(successes).toHaveLength(2); // 상시
    expect(firsts).toHaveLength(1); // 설치당 1회

    const first = firsts[0];
    expect(typeof first.durationMs).toBe("number");
    expect(first.durationMs as number).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect(meta(first).withinTargetWindow).toBe(true);
    expect(meta(first).clockAvailable).toBe(true);
    expect(meta(first).targetWindowMs).toBe(MULTI_AGENT_TARGET_WINDOW_MS);
  });

  it("10분을 넘기면 withinTargetWindow=false (판정을 후하게 주지 않는다)", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");
    localStorage.setItem(
      "marblo.telemetry.firstRunAt",
      String(Date.now() - 42 * 60 * 1000),
    );

    telemetry.multiAgentSuccessObserved({ trigger: "merge", concurrent: 2 });

    const first = (await drain()).find(
      (e) => e.event === "onboarding:first_multi_agent_success",
    );
    expect(meta(first).withinTargetWindow).toBe(false);
    expect(meta(first).clockAvailable).toBe(true);
  });

  it("시계 스탬프가 없으면 소요시간을 지어내지 않는다", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.multiAgentSuccessObserved({ trigger: "merge", concurrent: 2 });

    const first = (await drain()).find(
      (e) => e.event === "onboarding:first_multi_agent_success",
    );
    expect(first).toBeDefined();
    expect(first?.durationMs).toBeUndefined();
    expect(meta(first).clockAvailable).toBe(false);
    expect(meta(first).withinTargetWindow).toBeUndefined();
  });

  it("모델 연결 시계는 CLI 인증 성공·funding ok 에서 찍힌다(먼저 온 쪽)", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");
    localStorage.setItem("marblo.telemetry.firstRunAt", String(Date.now()));

    telemetry.cliSetupStep("auth", "success");
    telemetry.fundingProbe("ok", "claude", "auto");
    telemetry.multiAgentSuccessObserved({ trigger: "merge", concurrent: 2 });

    const first = (await drain()).find(
      (e) => e.event === "onboarding:first_multi_agent_success",
    );
    expect(typeof meta(first).msFromModelConnect).toBe("number");
    expect(meta(first).withinTargetWindowFromConnect).toBe(true);
    // ★헤드라인 앵커가 무엇인지 행 자체가 말한다(티켓 Tw6m14gR).
    expect(meta(first).anchor).toBe("model_connect");
    expect(meta(first).connectClockAvailable).toBe(true);
  });

  // ── ★10분 시계의 앵커 (티켓 Tw6m14gR) ───────────────────────────────────
  //
  // 사장님 결정으로 시계가 first_run→모델 연결로 바뀌었다. 서버 집계의 **분모**가
  // 이 앵커 이벤트이므로, 앵커 3지점이 모두 같은 이벤트를 내고 설치당 1회로
  // 접히는 것이 KPI 의 정확도 그 자체다.

  it("앵커는 스폰게이트·CLI인증·펀딩ok 어디서든 나오고 설치당 1회다", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");

    telemetry.modelConnectedObserved("spawn_gate", { surface: "agent_launch" });
    telemetry.cliSetupStep("auth", "success");
    telemetry.fundingProbe("ok", "claude", "auto");

    const rows = (await drain()).filter(
      (e) => e.event === "onboarding:model_connected",
    );
    expect(rows).toHaveLength(1); // 설치당 1회 — 매 스폰마다 나가면 안 된다
    expect(meta(rows[0]).trigger).toBe("spawn_gate");
    expect(meta(rows[0]).surface).toBe("agent_launch");
  });

  it("연결 앵커가 없으면 연결 시계를 지어내지 않는다(first_run 만 있어도)", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");
    localStorage.setItem(
      "marblo.telemetry.firstRunAt",
      String(Date.now() - 60_000),
    );

    telemetry.multiAgentSuccessObserved({ trigger: "merge", concurrent: 2 });

    const first = (await drain()).find(
      (e) => e.event === "onboarding:first_multi_agent_success",
    );
    // 앞단 시계는 있지만 연결 시계는 없다 — 서로 다른 사실이고, 없는 쪽을 0 으로
    // 지어내면 "연결 0초 만에 성공" 이라는 없는 사실이 KPI 분자에 들어간다.
    expect(meta(first).clockAvailable).toBe(true);
    expect(meta(first).connectClockAvailable).toBe(false);
    expect(meta(first).msFromModelConnect).toBeUndefined();
    expect(meta(first).withinTargetWindowFromConnect).toBeUndefined();
  });

  it("연결이 10분을 넘기면 연결 기준 판정도 false 다", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");
    localStorage.setItem(
      "marblo.telemetry.modelConnectedAt",
      String(Date.now() - 11 * 60 * 1000),
    );

    telemetry.multiAgentSuccessObserved({ trigger: "merge", concurrent: 2 });

    const first = (await drain()).find(
      (e) => e.event === "onboarding:first_multi_agent_success",
    );
    expect(meta(first).withinTargetWindowFromConnect).toBe(false);
    expect(meta(first).connectClockAvailable).toBe(true);
  });

  it("무료→유료는 설치당 1회, 플랜 이름만 싣는다", async () => {
    const { telemetry } = await import("../../src/services/telemetryService");
    localStorage.setItem(
      "marblo.telemetry.firstRunAt",
      String(Date.now() - 3 * 24 * 60 * 60 * 1000),
    );

    telemetry.subscriptionActiveObserved("pro");
    telemetry.subscriptionActiveObserved("pro");

    const rows = (await drain()).filter(
      (e) => e.event === "billing:subscription_active",
    );
    expect(rows).toHaveLength(1);
    expect(meta(rows[0]).plan).toBe("pro");
    expect(rows[0].durationMs as number).toBeGreaterThan(0);
    // 금액·주문번호·결제수단은 이 축에 없다.
    expect(Object.keys(meta(rows[0])).sort()).toEqual([
      "clockAvailable",
      "msFromFirstRun",
      "plan",
    ]);
  });

  it("텔레메트리를 끄면 한 건도 안 나간다", async () => {
    const { telemetry, setTelemetryEnabled } =
      await import("../../src/services/telemetryService");
    setTelemetryEnabled(false);

    telemetry.multiAgentActiveObserved({ concurrent: 2 });
    telemetry.multiAgentSuccessObserved({ trigger: "merge", concurrent: 2 });
    telemetry.subscriptionActiveObserved("pro");

    expect(await drain()).toHaveLength(0);
    setTelemetryEnabled(true);
  });
});

describe("모델 연결 앵커: 메인 → 렌더러 채널 계약", () => {
  it("메인이 보내는 이벤트 이름이 렌더러가 접는 이름과 같다", async () => {
    // 프로세스 경계라 문자열이 복제돼 있다 — 어긋나면 앵커가 조용히 유실되고
    // 10분 KPI 의 분모가 통째로 비므로 여기서 못박는다.
    const { mainTelemetry } = await import("../../electron/telemetry");
    const sent: Array<{ channel: string; payload: Record<string, unknown> }> =
      [];
    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: Record<string, unknown>) =>
          void sent.push({ channel, payload }),
      },
    } as unknown as Parameters<typeof mainTelemetry.modelConnected>[0];

    mainTelemetry.modelConnected(fakeWin, {
      surface: "agent_launch",
      model: "claude",
      vendor: "glm",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe("telemetry:event");
    expect(sent[0].payload.event).toBe("onboarding:model_connected");
    const md = sent[0].payload.metadata as Record<string, unknown>;
    expect(md.trigger).toBe("spawn_gate");
    expect(md.vendor).toBe("glm");
    // 비식별: 계정·경로·키 축은 이 이벤트에 없다.
    expect(Object.keys(md).sort()).toEqual(["surface", "trigger", "vendor"]);
  });
});

describe("동시성·성공 전이 판정(순수 규칙)", () => {
  it("메인과 렌더러의 동시성 하한이 같아야 한다", async () => {
    const renderer = await import("../../src/lib/telemetry/multiAgent");
    const main = await import("../../electron/agent-manager");
    // 프로세스 경계라 import 로 묶을 수 없어 값이 복제돼 있다 — 드리프트 가드.
    expect(renderer.MULTI_AGENT_MIN_CONCURRENCY).toBe(
      main.MULTI_AGENT_MIN_CONCURRENCY,
    );
    expect(renderer.MULTI_AGENT_MIN_CONCURRENCY).toBe(2);
  });

  it("DONE 전이만 성공이다", async () => {
    const { isMultiAgentSuccessTransition } =
      await import("../../src/lib/telemetry/multiAgent");
    expect(isMultiAgentSuccessTransition("IN_PROGRESS", "DONE")).toBe(true);
    expect(isMultiAgentSuccessTransition("REVIEW", "DONE")).toBe(true);
    // 첫 관측(시딩)은 전이가 아니다 — 콜드부트 백필 홍수 방지.
    expect(isMultiAgentSuccessTransition(undefined, "DONE")).toBe(false);
    expect(isMultiAgentSuccessTransition("DONE", "DONE")).toBe(false);
    // "여러 대를 굴렸더니 다 막혔다" 는 성공이 아니다.
    expect(isMultiAgentSuccessTransition("IN_PROGRESS", "FAILED")).toBe(false);
    expect(isMultiAgentSuccessTransition("IN_PROGRESS", "BLOCKED")).toBe(false);
    expect(isMultiAgentSuccessTransition("IN_PROGRESS", "REVIEW")).toBe(false);
  });

  it("메인: 동시2+ 는 상승 엣지에서만 발신된다", async () => {
    const { shouldEmitMultiAgentActive, isLiveAgentStatus } =
      await import("../../electron/agent-manager");
    expect(shouldEmitMultiAgentActive(1, 2)).toBe(true);
    expect(shouldEmitMultiAgentActive(2, 3)).toBe(true);
    expect(shouldEmitMultiAgentActive(2, 2)).toBe(false);
    expect(shouldEmitMultiAgentActive(3, 2)).toBe(false); // 하강
    expect(shouldEmitMultiAgentActive(0, 1)).toBe(false); // 1대는 멀티가 아니다
    // idle 은 살아 있다 — 죽은 것으로 세면 동시실행이 거의 관측되지 않는다.
    expect(isLiveAgentStatus("idle")).toBe(true);
    expect(isLiveAgentStatus("working")).toBe(true);
    expect(isLiveAgentStatus("stopped")).toBe(false);
    expect(isLiveAgentStatus("error")).toBe(false);
  });
});

describe("티켓 완료 → 멀티에이전트 성공 판정", () => {
  beforeEach(() => {
    callableSpy.mockClear();
    vi.resetModules();
    installMemoryLocalStorage();
  });

  it("동시 2대+ 일 때만 성공 이벤트가 나간다", async () => {
    const { noteTaskCompletionForMultiAgentKpi } =
      await import("../../src/services/multiAgentKpi");

    await noteTaskCompletionForMultiAgentKpi(
      "IN_PROGRESS",
      "DONE",
      async () => ({
        live: 1,
        working: 1,
      }),
    );
    expect(
      (await drain()).filter(
        (e) => e.event === "onboarding:multi_agent_success",
      ),
    ).toHaveLength(0);

    await noteTaskCompletionForMultiAgentKpi(
      "IN_PROGRESS",
      "DONE",
      async () => ({
        live: 3,
        working: 2,
      }),
      "task-abc",
    );
    const rows = (await drain()).filter(
      (e) => e.event === "onboarding:multi_agent_success",
    );
    expect(rows).toHaveLength(1);
    expect(meta(rows[0]).trigger).toBe("task_completed");
    expect(meta(rows[0]).concurrent).toBe(3);
    // 창이 여러 개일 때 집계에서 접을 수 있도록 first-class 컬럼으로 올라간다.
    expect(rows[0].taskId).toBe("task-abc");
  });

  it("동시성을 못 읽으면 판정하지 않는다(0 이나 2 로 지어내지 않음)", async () => {
    const { noteTaskCompletionForMultiAgentKpi } =
      await import("../../src/services/multiAgentKpi");

    await noteTaskCompletionForMultiAgentKpi("IN_PROGRESS", "DONE", null);
    await noteTaskCompletionForMultiAgentKpi("IN_PROGRESS", "DONE", () =>
      Promise.reject(new Error("no ipc")),
    );

    expect(await drain()).toHaveLength(0);
  });
});
