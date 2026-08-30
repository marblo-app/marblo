/**
 * "켜고 저장은 되는데 영원히 안 도는" 계열 회귀 테스트 — 티켓 EzCYDCeMETcEyecPUfMI.
 *
 * #1298 은 Gmail·Calendar 가 권한 회수를 감지 못해 저장만 되던 결함이었다. 같은
 * 계열이 두 군데 더 있었다:
 *  1) 스케줄 timezone — 잘못된 IANA 이름을 저장하면 엔진의 setInterval tick 이
 *     매 분 RangeError 를 던져 스케줄이 영원히 안 돌았다(main 프로세스
 *     uncaughtException 까지 겹친다).
 *  2) 웹훅 조건 — URL 발급(webhookId) 없이 켜고 저장할 수 있었다. 엔진이 읽는
 *     이벤트 큐는 발급된 URL 로만 채워지므로 이벤트가 영원히 오지 않는다.
 *
 * 화면(저장 차단)과 엔진(이유를 말하고 멈춤) 양쪽을 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantTriggerManager,
  isValidTimeZone as engineIsValidTimeZone,
  type AssistantTriggerManagerOptions,
  type AssistantTriggerOrchestrator,
  type AssistantTriggerProject,
} from "../../electron/assistant-triggers";
import {
  isValidTimeZone,
  validateAssistantTriggerSettings,
  type AssistantTriggerConnectorState,
  type AssistantTriggerSettings,
} from "../../src/lib/assistantTriggerSettings";

const connectorsReady: AssistantTriggerConnectorState = {
  slackReady: true,
  telegramReady: true,
  calendarConnected: true,
  gmailConnected: true,
  sheetsConnected: true,
};

const base: AssistantTriggerSettings = {
  enabled: true,
  outputs: ["slack"],
  schedule: { enabled: false, cron: "0 9 * * 1-5", timezone: "Asia/Seoul" },
  calendar: { enabled: false, upcomingMinutes: 15, pollMinutes: 5 },
  gmail: { enabled: false, query: "", pollMinutes: 5 },
  webhook: { enabled: false, pollMinutes: 1 },
  sheets: { enabled: false, spreadsheetId: "", range: "A:Z", pollMinutes: 5 },
};

describe("isValidTimeZone — 화면과 엔진이 같은 판정을 한다", () => {
  it.each(["Asia/Seoul", "UTC", "America/New_York", "", undefined])(
    "%s 는 유효하다",
    (tz) => {
      expect(isValidTimeZone(tz)).toBe(true);
      expect(engineIsValidTimeZone(tz)).toBe(true);
    },
  );

  it.each(["Seoul", "KST", "Asia/Seoul ", "Not/AZone", "GMT+9"])(
    "%s 는 거부한다",
    (tz) => {
      // 화면은 trim 후 판정하므로 후행 공백만 있는 이름은 통과시킨다 — 엔진은
      // parse 단계(stringField)에서 이미 trim 한 값을 받는다.
      const expected = tz.trim() === "Asia/Seoul";
      expect(isValidTimeZone(tz)).toBe(expected);
      expect(engineIsValidTimeZone(tz.trim())).toBe(expected);
    },
  );
});

describe("화면 검증 — 저장 단계에서 막는다", () => {
  it("스케줄 timezone 이 잘못되면 저장을 막는다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...base,
        schedule: { enabled: true, cron: "0 9 * * 1-5", timezone: "Seoul" },
      },
      connectorsReady,
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(["invalid_timezone"]);
  });

  it("timezone 을 비우면 로컬 시간으로 통과한다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...base,
        schedule: { enabled: true, cron: "0 9 * * 1-5", timezone: "" },
      },
      connectorsReady,
    );
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("스케줄이 꺼져 있으면 timezone 값은 검사하지 않는다 — 사용자 데이터를 잠그지 않는다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...base,
        schedule: { enabled: false, cron: "0 9 * * 1-5", timezone: "Seoul" },
        webhook: { enabled: true, webhookId: "awh_1", pollMinutes: 1 },
      },
      connectorsReady,
    );
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("웹훅 조건은 URL 발급(webhookId) 없이 켠 채 저장할 수 없다", () => {
    const result = validateAssistantTriggerSettings(
      { ...base, webhook: { enabled: true, pollMinutes: 1 } },
      connectorsReady,
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(["webhook_not_issued"]);
  });

  it("webhookId 가 공백뿐이어도 발급으로 치지 않는다", () => {
    const result = validateAssistantTriggerSettings(
      { ...base, webhook: { enabled: true, webhookId: "   ", pollMinutes: 1 } },
      connectorsReady,
    );
    expect(result.issues).toContain("webhook_not_issued");
  });

  it("발급된 웹훅은 그대로 통과한다 — 기존 동작 유지", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...base,
        webhook: { enabled: true, webhookId: "awh_1", pollMinutes: 1 },
      },
      connectorsReady,
    );
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("웹훅이 꺼져 있으면 발급 여부를 묻지 않는다", () => {
    const result = validateAssistantTriggerSettings(
      {
        ...base,
        schedule: { enabled: true, cron: "0 9 * * 1-5", timezone: "UTC" },
        webhook: { enabled: false, pollMinutes: 1 },
      },
      connectorsReady,
    );
    expect(result).toEqual({ ok: true, issues: [] });
  });
});

interface Harness {
  manager: AssistantTriggerManager;
  injected: string[];
  warnings: string[];
  webhookListCalls: number;
}

function makeHarness(
  triggers: Record<string, unknown>,
  overrides: Partial<AssistantTriggerManagerOptions> = {},
  workspaceOverrides: Partial<AssistantTriggerManagerOptions["workspace"]> = {},
): Harness {
  const injected: string[] = [];
  const warnings: string[] = [];
  const state = { webhookListCalls: 0 };
  const orchestrator: AssistantTriggerOrchestrator = {
    isRunning: () => true,
    injectMessage: async (message) => {
      injected.push(message);
      return true;
    },
  };
  const project: AssistantTriggerProject = {
    id: "assistant-1",
    name: "비서",
    kind: "assistant",
    assistantTriggers: triggers,
  };
  const options: AssistantTriggerManagerOptions = {
    listProjects: async () => [project],
    workspace: {
      gmailSearch: async () => ({ ok: false, error: "unused" }),
      gmailFetch: async () => ({ ok: false, error: "unused" }),
      calendarList: async () => ({ ok: false, error: "unused" }),
      listWebhookEvents: async () => {
        state.webhookListCalls += 1;
        return { ok: true, events: [] };
      },
      claimWebhookEvent: async () => ({ ok: true, claimed: false }),
      sheetsValues: async () => ({ ok: false, error: "unused" }),
      ...workspaceOverrides,
    },
    resolveOrchestrator: async () => orchestrator,
    warn: (message) => warnings.push(message),
    ...overrides,
  };
  const manager = new AssistantTriggerManager(options);
  return {
    manager,
    injected,
    warnings,
    get webhookListCalls() {
      return state.webhookListCalls;
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("엔진 — 스케줄 timezone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:30Z")); // 월요일 09:00:30 KST
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("잘못된 timezone 이면 타이머를 걸지 않고, 왜 안 도는지 한 번 말한다", async () => {
    const h = makeHarness({
      enabled: true,
      outputs: ["slack"],
      schedule: { enabled: true, cron: "* * * * *", timezone: "Seoul" },
    });
    h.manager.start();
    await flush();

    expect(h.warnings.some((w) => w.includes("invalid timezone"))).toBe(true);
    expect(h.injected).toHaveLength(1);
    expect(h.injected[0]).toContain("timezone");
    expect(h.injected[0]).toContain("Seoul");

    // 분이 넘어가도 브리핑이 발화하지 않고, 예외도 나지 않는다.
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await flush();
    expect(h.injected).toHaveLength(1);
    h.manager.stop();
  });

  it("잘못된 cron 도 조용히 죽지 않고 이유를 말한다", async () => {
    const h = makeHarness({
      enabled: true,
      outputs: ["slack"],
      schedule: { enabled: true, cron: "99 * * * *" },
    });
    h.manager.start();
    await flush();
    expect(h.injected).toHaveLength(1);
    expect(h.injected[0]).toContain("cron");
    h.manager.stop();
  });

  it("유효한 timezone 이면 다음 분 경계에서 브리핑을 발화한다", async () => {
    const h = makeHarness({
      enabled: true,
      outputs: ["slack"],
      schedule: { enabled: true, cron: "1 9 * * 1", timezone: "Asia/Seoul" },
    });
    h.manager.start();
    await flush();
    expect(h.injected).toHaveLength(0);

    // 00:00:30Z → 00:01:00Z(09:01 KST 월요일)에 첫 tick.
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(h.injected).toHaveLength(1);
    expect(h.injected[0]).toContain("[Assistant scheduled briefing");

    // 09:02 에는 매칭되지 않는다.
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(h.injected).toHaveLength(1);
    h.manager.stop();
  });

  it("tick 중 예외는 setInterval 밖으로 새지 않고 warn 으로 남는다", async () => {
    const h = makeHarness(
      {
        enabled: true,
        outputs: ["slack"],
        schedule: { enabled: true, cron: "* * * * *" },
      },
      {
        now: () => {
          throw new Error("clock broke");
        },
      },
    );
    // start 시 nextMinuteDelay(this.now()) 도 now 를 부른다 — 그 예외는
    // refreshProjects 의 catch 로 간다. 여기서는 예외가 프로세스 밖으로
    // 안 새는 것만 본다.
    expect(() => h.manager.start()).not.toThrow();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(h.warnings.length).toBeGreaterThan(0);
    h.manager.stop();
  });
});

describe("엔진 — 웹훅 폴링", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("이벤트 조회가 거절되면 조용히 삼키지 않고 warn 한다", async () => {
    const h = makeHarness(
      {
        enabled: true,
        outputs: ["slack"],
        webhook: { enabled: true, webhookId: "awh_1", pollMinutes: 1 },
      },
      {},
      {
        listWebhookEvents: async () => ({
          ok: false,
          error: "permission-denied",
        }),
      },
    );
    h.manager.start();
    await flush();
    expect(
      h.warnings.some(
        (w) =>
          w.includes("webhook poll rejected") &&
          w.includes("permission-denied"),
      ),
    ).toBe(true);
    expect(h.injected).toHaveLength(0);
    h.manager.stop();
  });

  it("빈 큐면 발화하지 않고 주기마다 다시 본다", async () => {
    const h = makeHarness({
      enabled: true,
      outputs: ["slack"],
      webhook: { enabled: true, webhookId: "awh_1", pollMinutes: 1 },
    });
    h.manager.start();
    await flush();
    expect(h.webhookListCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(h.webhookListCalls).toBe(2);
    expect(h.injected).toHaveLength(0);
    h.manager.stop();
  });

  it("claim 에 성공한 이벤트만 발화하고, 같은 이벤트는 두 번 발화하지 않는다", async () => {
    const events = [
      { id: "e1", event: "row.added", payload: { a: 1 } },
      { id: "e2", event: "row.added", payload: { a: 2 } },
    ];
    const h = makeHarness(
      {
        enabled: true,
        outputs: ["telegram"],
        webhook: { enabled: true, webhookId: "awh_1", pollMinutes: 1 },
      },
      {},
      {
        listWebhookEvents: async () => ({ ok: true, events }),
        claimWebhookEvent: async (_p, id) => ({
          ok: true,
          claimed: id === "e1",
        }),
      },
    );
    h.manager.start();
    await flush();
    expect(h.injected).toHaveLength(1);
    expect(h.injected[0]).toContain("[Assistant webhook trigger");
    expect(h.injected[0]).toContain("send_telegram_message");

    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    // e1 은 seen, e2 는 여전히 claim 실패 → 추가 발화 없음.
    expect(h.injected).toHaveLength(1);
    h.manager.stop();
  });

  it("오케스트레이터가 없으면 발화를 버리고 warn 한다 — 켜 뒀는데 안 오는 원인이 로그에 남는다", async () => {
    const h = makeHarness(
      {
        enabled: true,
        outputs: ["slack"],
        webhook: { enabled: true, webhookId: "awh_1", pollMinutes: 1 },
      },
      { resolveOrchestrator: async () => null },
      {
        listWebhookEvents: async () => ({
          ok: true,
          events: [{ id: "e1", event: "ping", payload: {} }],
        }),
        claimWebhookEvent: async () => ({ ok: true, claimed: true }),
      },
    );
    h.manager.start();
    await flush();
    expect(h.injected).toHaveLength(0);
    expect(h.warnings.some((w) => w.includes("orchestrator unavailable"))).toBe(
      true,
    );
    h.manager.stop();
  });
});

describe("엔진 — 트리거 켜기/끄기 전이", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("설정이 꺼지면 다음 갱신에서 타이머가 멈추고, 다시 켜면 되살아난다", async () => {
    let triggers: Record<string, unknown> = {
      enabled: true,
      outputs: ["slack"],
      webhook: { enabled: true, webhookId: "awh_1", pollMinutes: 1 },
    };
    const h = makeHarness(
      {},
      {
        listProjects: async () => [
          {
            id: "assistant-1",
            name: "비서",
            kind: "assistant",
            assistantTriggers: triggers,
          },
        ],
        projectRefreshMs: 1_000,
      },
    );
    h.manager.start();
    await flush();
    expect(h.webhookListCalls).toBe(1);

    triggers = { ...triggers, enabled: false };
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    const afterOff = h.webhookListCalls;
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await flush();
    expect(h.webhookListCalls).toBe(afterOff);

    triggers = { ...triggers, enabled: true };
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(h.webhookListCalls).toBe(afterOff + 1);
    h.manager.stop();
  });

  it("assistant 가 아닌 프로젝트는 켜 둬도 돌지 않는다(엔진 fail-closed)", async () => {
    const h = makeHarness(
      {},
      {
        listProjects: async () => [
          {
            id: "dev-1",
            name: "개발",
            kind: "dev",
            assistantTriggers: {
              enabled: true,
              outputs: ["slack"],
              webhook: { enabled: true, webhookId: "awh_1", pollMinutes: 1 },
            },
          },
        ],
      },
    );
    h.manager.start();
    await flush();
    expect(h.webhookListCalls).toBe(0);
    h.manager.stop();
  });
});
