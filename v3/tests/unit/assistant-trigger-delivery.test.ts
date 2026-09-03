/**
 * 티켓 lcR4OMWCriWIpwbVDwVt — "오케가 준비 안 되면 트리거가 조용히 죽는다".
 *
 * 고정하는 것은 **동작**이다: 전달이 실패한 각 갈래가 화면으로 나가는 통지에
 * 어떤 사유로 도착하는지, 반복이 어떻게 억제되는지, 성공하면 어떻게 걷히는지.
 * 소스 문자열을 grep 하는 가드는 쓰지 않는다 — 그런 가드는 다음 리팩터에 깨지고,
 * 깨질 때 실제 결함이 아니라 문자열만 알려 준다.
 *
 * ★가장 중요한 회귀 가드는 마지막 describe 다: `injectMessage` 는 여전히
 * **boolean** 을 돌려줘야 한다. 텔레그램 폴러·슬랙 폴러·보드 재동기화가
 * `if (!delivered)` 로 "보류하고 재배달" 을 고르기 때문에, 반환 타입이 객체로
 * 넓어지는 순간 그 분기가 통째로 죽고 텔레그램 메시지가 사라진다.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANNOUNCE_INTERVAL_MS,
  AssistantTriggerDeliveryLog,
  failureReasonFromInject,
  type AssistantTriggerDeliveryFailure,
  type AssistantTriggerFailureReason,
  type InjectRefusal,
  type InjectOutcome,
} from "../../electron/assistant-trigger-delivery";
import {
  AssistantTriggerManager,
  type AssistantTriggerManagerOptions,
  type AssistantTriggerResolution,
} from "../../electron/assistant-triggers";
import { verdictFor } from "../../electron/composer-gate";
import {
  OrchestratorManager,
  type OrchestratorSession,
} from "../../electron/orchestrator-manager";
import type { PtyManager } from "../../electron/pty-manager";
import type { AgentConfigGenerator } from "../../electron/agent-config";

// ── 매니저 하네스 ───────────────────────────────────────────────────────────
// 트리거 엔진을 진짜로 돌린다. 발화를 만드는 가장 결정적인 경로는 "cron 이 잘못
// 됐다" 알림 — startRuntime 이 타이머 없이 즉시 inject 를 부른다.

interface Harness {
  manager: AssistantTriggerManager;
  failures: AssistantTriggerDeliveryFailure[];
  recovered: string[];
  clock: { now: number };
}

function makeHarness(
  resolve: () => AssistantTriggerResolution,
  over: Partial<AssistantTriggerManagerOptions> = {},
): Harness {
  const failures: AssistantTriggerDeliveryFailure[] = [];
  const recovered: string[] = [];
  const clock = { now: Date.UTC(2026, 8, 2, 0, 0, 0) };
  const options: AssistantTriggerManagerOptions = {
    listProjects: async () => [
      {
        id: "assistant-1",
        name: "비서",
        kind: "assistant",
        folderPath: "/tmp/assistant-1",
        assistantTriggers: {
          enabled: true,
          outputs: ["slack"],
          // ★일부러 깨진 cron. startSchedule 이 즉시 "cron 이 잘못됐다" 알림을
          //   inject 하므로 타이머 없이 전달 경로를 한 번 태울 수 있다.
          schedule: { enabled: true, cron: "not-a-cron" },
        },
      },
    ],
    workspace: {
      gmailSearch: async () => ({ ok: false, error: "unused" }),
      gmailFetch: async () => ({ ok: false, error: "unused" }),
      calendarList: async () => ({ ok: false, error: "unused" }),
      listWebhookEvents: async () => ({ ok: false, error: "unused" }),
      sheetsValues: async () => ({ ok: false, error: "unused" }),
    } as unknown as AssistantTriggerManagerOptions["workspace"],
    resolveOrchestrator: async () => resolve(),
    onDeliveryFailure: (failure) => failures.push(failure),
    onDeliveryRecovered: (projectId) => recovered.push(projectId),
    now: () => new Date(clock.now),
    setTimer: (() => 0 as unknown as NodeJS.Timeout) as never,
    clearTimer: () => undefined,
    ...over,
  };
  return {
    manager: new AssistantTriggerManager(options),
    failures,
    recovered,
    clock,
  };
}

/** 엔진을 한 번 돌려 발화 1건을 태운다(전부 마이크로태스크). */
async function fire(manager: AssistantTriggerManager): Promise<void> {
  manager.start();
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  manager.stop();
}

function liveOrchestrator(outcome: InjectOutcome) {
  return {
    isRunning: () => true,
    injectMessage: async () => outcome.ok,
    injectMessageDetailed: async () => outcome,
  };
}

describe("발화가 오케에 닿지 못하면 사유가 화면으로 나간다", () => {
  it("오케를 아예 못 깨웠을 때(null) — 오케가 안 떴다로 보고한다", async () => {
    const h = makeHarness(() => null);
    await fire(h.manager);

    expect(h.failures).toHaveLength(1);
    expect(h.failures[0].reason).toBe("orchestrator-offline");
    expect(h.failures[0].projectId).toBe("assistant-1");
    expect(h.failures[0].trigger).toBe("notice");
  });

  it("오케 객체는 있는데 안 돌고 있을 때도 오케가 안 떴다로 보고한다", async () => {
    const h = makeHarness(() => ({
      isRunning: () => false,
      injectMessage: async () => true,
    }));
    await fire(h.manager);

    expect(h.failures.map((f) => f.reason)).toEqual(["orchestrator-offline"]);
  });

  // ★관문마다 다른 사유가 나와야 한다. 뭉치면 사용자가 무엇을 고쳐야 할지 모른다.
  const gateCases: AssistantTriggerFailureReason[] = [
    "orchestrator-folder-missing",
    "orchestrator-auth-blocked",
    "orchestrator-mcp-blocked",
    "orchestrator-vendor-blocked",
  ];
  for (const unavailableReason of gateCases) {
    it(`기동 관문 사유를 그대로 나른다 — ${unavailableReason}`, async () => {
      const h = makeHarness(() => ({ unavailableReason }));
      await fire(h.manager);

      expect(h.failures.map((f) => f.reason)).toEqual([unavailableReason]);
    });
  }

  const injectCases: Array<
    [InjectRefusal, "empty" | "occupied" | "awaiting-choice" | null, AssistantTriggerFailureReason]
  > = [
    ["boot-gate-unstable", null, "orchestrator-offline"],
    ["session-gone", null, "orchestrator-offline"],
    ["pty-refused", "occupied", "composer-busy"],
    ["pty-refused", "awaiting-choice", "composer-busy"],
    ["mission-changed", null, "delivery-failed"],
    ["pty-refused", "empty", "delivery-failed"],
  ];
  for (const [injectReason, composer, expected] of injectCases) {
    it(`주입 실패 사유를 사용자 사유로 접는다 — ${injectReason} → ${expected}`, async () => {
      const h = makeHarness(() =>
        liveOrchestrator({ ok: false, refusal: injectReason, composer, detail: "test", at: 0 }),
      );
      await fire(h.manager);

      expect(h.failures.map((f) => f.reason)).toEqual([expected]);
    });
  }

  it("사유를 못 주는 옛 오케(injectMessage 만 있는)도 조용히 죽지 않는다", async () => {
    const h = makeHarness(() => ({
      isRunning: () => true,
      injectMessage: async () => false,
    }));
    await fire(h.manager);

    // 모르는 것을 아는 척하지 않는다 — "그 외 실패" 로 떨어지되 화면에는 뜬다.
    expect(h.failures.map((f) => f.reason)).toEqual(["delivery-failed"]);
  });

  it("전달에 성공하면 아무것도 보고하지 않는다", async () => {
    const h = makeHarness(() =>
      liveOrchestrator({ ok: true, refusal: null, composer: null, detail: "test", at: 0 }),
    );
    await fire(h.manager);

    expect(h.failures).toHaveLength(0);
    expect(h.recovered).toHaveLength(0);
    expect(h.manager.deliveryFailures()).toHaveLength(0);
  });

  it("실패는 매니저가 계속 들고 있다 — 창을 나중에 열어도 읽힌다", async () => {
    const h = makeHarness(() => null);
    await fire(h.manager);

    expect(h.manager.deliveryFailures()).toHaveLength(1);
    expect(h.manager.deliveryFailures()[0].reason).toBe("orchestrator-offline");
  });

  it("발화 종류를 함께 나른다 — 스케줄 발화가 죽으면 schedule 로 보고된다", async () => {
    // 정상 cron + 즉시 실행되는 가짜 타이머로 스케줄 tick 을 한 번 태운다.
    const h = makeHarness(() => null, {
      listProjects: async () => [
        {
          id: "assistant-1",
          name: "비서",
          kind: "assistant",
          folderPath: "/tmp/assistant-1",
          assistantTriggers: {
            enabled: true,
            outputs: ["slack"],
            schedule: { enabled: true, cron: "* * * * *" },
          },
        },
      ],
      setTimer: ((fn: () => void) => {
        fn();
        return 0 as unknown as NodeJS.Timeout;
      }) as never,
      clearTimer: ((timer: NodeJS.Timeout) => {
        clearInterval(timer);
      }) as never,
    });
    await fire(h.manager);

    expect(h.failures.map((f) => f.trigger)).toContain("schedule");
  });
});

describe("반복 억제 — 같은 사유를 매 분 띄우지 않는다", () => {
  const base = {
    projectId: "p1",
    projectName: "비서",
    reason: "composer-busy" as AssistantTriggerFailureReason,
    trigger: "schedule" as const,
  };

  it("같은 사유가 이어지면 알림은 한 번, 사실은 계속 센다", () => {
    const log = new AssistantTriggerDeliveryLog();
    const first = log.record({ ...base, at: 1_000 });
    const second = log.record({ ...base, at: 61_000 });
    const third = log.record({ ...base, at: 121_000 });

    expect(first.announce).toBe(true);
    expect(second.announce).toBe(false);
    expect(third.announce).toBe(false);
    // 억제해도 횟수·마지막 시각은 잃지 않는다.
    expect(third.failure.count).toBe(3);
    expect(third.failure.firstAt).toBe(1_000);
    expect(third.failure.lastAt).toBe(121_000);
  });

  it("억제 간격이 지나면 다시 알린다", () => {
    const log = new AssistantTriggerDeliveryLog();
    log.record({ ...base, at: 0 });
    const quiet = log.record({ ...base, at: ANNOUNCE_INTERVAL_MS - 1 });
    const again = log.record({ ...base, at: ANNOUNCE_INTERVAL_MS });

    expect(quiet.announce).toBe(false);
    expect(again.announce).toBe(true);
    expect(again.failure.count).toBe(3);
  });

  it("사유가 바뀌면 억제하지 않는다 — 사용자가 할 행동이 바뀌었다", () => {
    const log = new AssistantTriggerDeliveryLog();
    log.record({ ...base, at: 0 });
    const changed = log.record({
      ...base,
      reason: "orchestrator-auth-blocked",
      at: 1_000,
    });

    expect(changed.announce).toBe(true);
    // 이전 사유의 카운터를 이어받지 않는다.
    expect(changed.failure.count).toBe(1);
    expect(changed.failure.firstAt).toBe(1_000);
  });

  it("성공하면 걷히고, 그 다음 실패는 처음처럼 알린다", () => {
    const log = new AssistantTriggerDeliveryLog();
    log.record({ ...base, at: 0 });
    expect(log.clear("p1")).toBe(true);
    // 걷을 것이 없으면 false — 잘 도는 프로젝트가 매 발화마다 IPC 를 때리지 않는다.
    expect(log.clear("p1")).toBe(false);
    expect(log.get("p1")).toBeNull();

    expect(log.record({ ...base, at: 1_000 }).announce).toBe(true);
  });

  it("엔진 경로에서도 억제가 걸린다 — 두 번 발화해도 통지는 한 번", async () => {
    const h = makeHarness(() => null);
    await fire(h.manager);
    // 같은 매니저를 1분 뒤 다시 돌린다(폴링 트리거가 반복 발화하는 모양).
    h.clock.now += 60_000;
    await fire(h.manager);

    expect(h.failures).toHaveLength(1);
    expect(h.manager.deliveryFailures()[0].count).toBe(2);
  });

  it("엔진 경로에서 복구되면 회복을 알린다", async () => {
    let live = false;
    const h = makeHarness(() =>
      live
        ? liveOrchestrator({
            ok: true,
            refusal: null,
            composer: null,
            detail: "test",
            at: 0,
          })
        : null,
    );
    await fire(h.manager);
    expect(h.failures).toHaveLength(1);

    live = true;
    await fire(h.manager);

    expect(h.recovered).toEqual(["assistant-1"]);
    expect(h.manager.deliveryFailures()).toHaveLength(0);
  });
});

describe("사유 접기 — 모든 주입 실패가 갈 곳이 있다", () => {
  it("알려진 주입 실패 사유가 전부 사용자 사유로 접힌다", () => {
    const all: InjectRefusal[] = [
      "boot-gate-unstable",
      "session-gone",
      "mission-changed",
      "pty-refused",
    ];
    for (const reason of all) {
      expect(failureReasonFromInject({ refusal: reason, composer: null })).toBeTruthy();
    }
    // ★사용자가 할 행동이 다른 셋은 실제로 갈라져야 한다.
    expect(failureReasonFromInject({ refusal: "session-gone", composer: null })).toBe(
      "orchestrator-offline",
    );
    expect(failureReasonFromInject({ refusal: "pty-refused", composer: "occupied" })).toBe("composer-busy");
    expect(failureReasonFromInject({ refusal: "pty-refused", composer: "empty" })).toBe("delivery-failed");
  });
});

// ── OrchestratorManager 쪽 계약 ────────────────────────────────────────────

interface InjectInternals {
  session: OrchestratorSession | null;
  bootGate: Promise<void>;
  resolveBootGate: () => void;
  currentMissionId: string | null;
}

function makeOrchestrator(opts: {
  writeOk: boolean;
  composer?: "empty" | "occupied" | "awaiting-choice";
}): { manager: OrchestratorManager; internals: InjectInternals } {
  const fakePty = {
    onDanger: () => {},
    writeAndSubmit: async () => opts.writeOk,
    composerVerdict: () => verdictFor(opts.composer ?? "empty"),
  } as unknown as PtyManager;
  const manager = new OrchestratorManager(
    fakePty,
    {} as unknown as AgentConfigGenerator,
    undefined,
    "board",
  );
  return {
    manager,
    internals: manager as unknown as InjectInternals,
  };
}

function attach(
  internals: InjectInternals,
  ptySessionId = "pty-1",
  missionId: string | null = null,
): void {
  internals.bootGate = Promise.resolve();
  internals.resolveBootGate = () => {};
  internals.currentMissionId = missionId;
  internals.session = {
    sessionId: `session-${ptySessionId}`,
    ptySessionId,
    status: "running",
    projectId: "p1",
    rootPath: tmpDir,
  } as OrchestratorSession;
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-delivery-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("OrchestratorManager — 사유는 붙이되 boolean 계약은 그대로", () => {
  it("★injectMessage 는 여전히 boolean 이다 (텔레그램 '보류 후 재배달' 보호)", async () => {
    const { manager, internals } = makeOrchestrator({ writeOk: false });
    attach(internals);

    const result = await manager.injectMessage("hello");

    // 객체를 돌려주면 호출부의 `if (!delivered)` 가 통째로 죽는다 —
    // 실패가 조용한 성공이 되어 메시지가 사라진다. 타입까지 못박는다.
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
    expect(!result).toBe(true);
  });

  it("성공 경로도 boolean true 다", async () => {
    const { manager, internals } = makeOrchestrator({ writeOk: true });
    attach(internals);

    const result = await manager.injectMessage("hello");
    expect(result).toBe(true);
  });

  it("세션이 없으면 session-gone 을 사유로 돌려준다", async () => {
    const { manager } = makeOrchestrator({ writeOk: true });

    await expect(manager.injectMessageDetailed("hello")).resolves.toMatchObject({ ok: false, refusal: "session-gone" });
  });

  it("미션이 바뀌었으면 mission-changed 다", async () => {
    const { manager, internals } = makeOrchestrator({ writeOk: true });
    attach(internals, "pty-1", "mission-A");
    const pending = manager.injectMessageDetailed("grant");
    internals.currentMissionId = "mission-B";

    await expect(pending).resolves.toMatchObject({ ok: false, refusal: "mission-changed" });
  });

  it("컴포저에 초안이 물려 있으면 composer-occupied 로 갈린다", async () => {
    const { manager, internals } = makeOrchestrator({
      writeOk: false,
      composer: "occupied",
    });
    attach(internals);

    await expect(manager.injectMessageDetailed("hello")).resolves.toMatchObject({ ok: false, refusal: "pty-refused", composer: "occupied" });
  });

  it("확인 다이얼로그 앞이면 awaiting-choice 로 갈린다", async () => {
    const { manager, internals } = makeOrchestrator({
      writeOk: false,
      composer: "awaiting-choice",
    });
    attach(internals);

    await expect(manager.injectMessageDetailed("hello")).resolves.toMatchObject({ ok: false, refusal: "pty-refused", composer: "awaiting-choice" });
  });

  it("컴포저는 멀쩡한데 제출이 안 됐으면 write-failed 다 — 남의 초안 탓으로 돌리지 않는다", async () => {
    const { manager, internals } = makeOrchestrator({
      writeOk: false,
      composer: "empty",
    });
    attach(internals);

    await expect(manager.injectMessageDetailed("hello")).resolves.toMatchObject({ ok: false, refusal: "pty-refused", composer: "empty" });
  });

  it("컴포저 판정기가 없는 PtyManager 라도 예외가 아니라 false 로 끝난다", async () => {
    // ★사유를 보여주려다 유실을 만들지 않는다. 분류가 실패하면 분류만 포기한다 —
    // 종전에 false 로 끝나던 경로가 rejection 이 되면 호출부의 보류/재배달이 깨진다.
    const fakePty = {
      onDanger: () => {},
      writeAndSubmit: async () => false,
    } as unknown as PtyManager;
    const manager = new OrchestratorManager(
      fakePty,
      {} as unknown as AgentConfigGenerator,
      undefined,
      "board",
    );
    attach(manager as unknown as InjectInternals);

    await expect(manager.injectMessage("hello")).resolves.toBe(false);
    await expect(manager.injectMessageDetailed("hello")).resolves.toMatchObject({ ok: false, refusal: "pty-refused", composer: null });
  });

  it("성공하면 사유가 없다", async () => {
    const { manager, internals } = makeOrchestrator({ writeOk: true });
    attach(internals);

    await expect(manager.injectMessageDetailed("hello")).resolves.toMatchObject({ ok: true, refusal: null });
  });
});
