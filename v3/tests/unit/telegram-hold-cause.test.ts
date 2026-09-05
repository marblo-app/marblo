/**
 * 티켓 nMpBzIMJmkSFqrrZfSKz — "오케가 일하는 동안 인바운드가 밀리고, 안내문이
 * 원인을 사장님 초안 탓으로 잘못 지목한다".
 *
 * ── 무엇이 틀렸었나 (실측, 2026-09-05 `~/.marblo/telegram-route-health.jsonl`) ──
 *   09:03:06 verdict=held-inject-refused hold={refusal:"pty-refused",
 *            composer:"occupied"} heldMs=29725  attempts=10
 *   09:06:06 heldMs=209728 attempts=65
 *   09:07:06 delivered=96862763        ← 아무도 아무것도 안 했는데 전달됨
 * 이 구간 내내 사람은 키보드 앞에 없었고 오케가 턴을 돌고 있었다. 그런데 60초
 * 지점에서 나간 안내문은 "터미널 입력창에 제출되지 않은 글이 남아 있습니다 …
 * 그 줄을 제출하거나 지우면 풀립니다" 였다. 사장님은 **존재하지 않는 초안**을
 * 찾으셨다.
 *
 * ── 이 파일이 지키는 것 ─────────────────────────────────────────────────
 *   1. 점유 사유 (a)사람 초안 / (b)오케 바쁨 이 실제로 갈린다. 못 가르면
 *      `unknown` 이고, 그때 사람 탓으로 단정하지 않는다.
 *   2. (b)에서는 60초에 사람 탓 문구가 나가지 않는다.
 *   3. 점유가 풀리면 보류분이 **순서대로 전부** 전달된다(유실 0). 사유를 나누는
 *      일이 유실의 새 원인이 되지 않는다.
 *   4. ★자기교착 경로 — 우리가 남긴 미제출 글이 컴포저를 영구 점유하는 길이
 *      실재하고, 그 길을 우리가 막는다(남의 초안엔 손대지 않은 채로).
 *
 * ★GUI 를 띄우지 않는다. 순수 함수·순수 클래스·가짜 PTY·가짜 fetch 만 돈다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ComposerTracker,
  classifyOccupancy,
  type OccupancyCause,
  type OccupancyEvidence,
} from "../../electron/composer-gate";
import {
  TelegramPoller,
  holdOwnerNotice,
  type InboundTarget,
  type InjectFailureDescriptor,
  type TelegramPollerDeps,
} from "../../electron/telegram-poller";

// ── 순수 판정 ─────────────────────────────────────────────────────────────

function evidence(over: Partial<OccupancyEvidence> = {}): OccupancyEvidence {
  return {
    state: "occupied",
    msSinceBusySignal: null,
    humanDraftSince: null,
    selfWriteAt: null,
    selfWriteOutcome: null,
    humanInputSinceSelfWrite: false,
    now: 1_000_000,
    ...over,
  };
}

describe("점유 사유를 가른다 — 근거가 있는 만큼만", () => {
  it("(a) 사람이 친 미제출 키 입력이 있으면 human-draft", () => {
    expect(
      classifyOccupancy(evidence({ humanDraftSince: 999_000 })),
    ).toBe<OccupancyCause>("human-draft");
  });

  it("(b) 사람 입력은 없고 오케가 방금까지 busy 였으면 orchestrator-busy", () => {
    expect(
      classifyOccupancy(evidence({ msSinceBusySignal: 1_500 })),
    ).toBe<OccupancyCause>("orchestrator-busy");
  });

  it("★오케가 busy 면 우리 글이 남아 있어도 자기교착이 아니라 정상 대기다", () => {
    // 큐에 든 메시지를 '치우면' 그건 유실이다. busy 가 self-injected 를 이긴다.
    expect(
      classifyOccupancy(
        evidence({
          msSinceBusySignal: 1_000,
          selfWriteAt: 999_000,
          selfWriteOutcome: "unconfirmed",
        }),
      ),
    ).toBe<OccupancyCause>("orchestrator-busy");
  });

  it("오케는 조용한데 우리 write 가 unconfirmed 로 끝났으면 self-injected", () => {
    expect(
      classifyOccupancy(
        evidence({
          msSinceBusySignal: 60_000,
          selfWriteAt: 999_000,
          selfWriteOutcome: "unconfirmed",
        }),
      ),
    ).toBe<OccupancyCause>("self-injected");
  });

  it("★그 뒤 사람이 손을 댔으면 더는 '우리 글' 이 아니다", () => {
    expect(
      classifyOccupancy(
        evidence({
          selfWriteAt: 999_000,
          selfWriteOutcome: "unconfirmed",
          humanInputSinceSelfWrite: true,
        }),
      ),
    ).toBe<OccupancyCause>("unknown");
  });

  it("우리 write 가 confirmed/indeterminate 면 자기교착의 근거가 못 된다", () => {
    for (const outcome of ["confirmed", "indeterminate"] as const) {
      expect(
        classifyOccupancy(
          evidence({ selfWriteAt: 999_000, selfWriteOutcome: outcome }),
        ),
      ).toBe<OccupancyCause>("unknown");
    }
  });

  it("귀속 시한이 지난 우리 write 는 근거가 못 된다(남의 초안 보호)", () => {
    expect(
      classifyOccupancy(
        evidence({
          now: 1_000_000,
          selfWriteAt: 1_000_000 - 16 * 60_000,
          selfWriteOutcome: "unconfirmed",
        }),
      ),
    ).toBe<OccupancyCause>("unknown");
  });

  it("★아무 근거도 없으면 unknown — 사람 탓으로 단정하지 않는다", () => {
    expect(classifyOccupancy(evidence())).toBe<OccupancyCause>("unknown");
  });

  it("막히지 않았으면 사유 자체가 없다", () => {
    expect(classifyOccupancy(evidence({ state: "empty" }))).toBeNull();
    expect(classifyOccupancy(evidence({ state: "indeterminate" }))).toBeNull();
  });
});

describe("ComposerTracker 가 출처를 기억한다", () => {
  it("사람이 친 글은 human-draft, 우리가 쓴 글은 아니다", () => {
    const t = new ComposerTracker();
    t.noteInput("s", "사장님이 쓰다 만 초안", "human");
    expect(t.occupancy("s", { msSinceBusySignal: null })).toBe<OccupancyCause>(
      "human-draft",
    );

    const u = new ComposerTracker();
    u.noteInput("s", "우리가 넣은 본문", "injected");
    expect(u.occupancy("s", { msSinceBusySignal: null })).not.toBe(
      "human-draft",
    );
  });

  it("출처를 안 주면 사람 것으로 본다 — 틀렸을 때 안전한 쪽이다", () => {
    const t = new ComposerTracker();
    t.noteInput("s", "글");
    expect(t.occupancy("s", { msSinceBusySignal: null })).toBe<OccupancyCause>(
      "human-draft",
    );
  });

  it("화면이 그 입력 뒤에 빈 컴포저를 그리면 초안은 없다(사람이 지웠다)", () => {
    let clock = 1_000;
    const t = new ComposerTracker({ now: () => clock });
    t.noteInput("s", "쓰다가", "human");
    clock += 50;
    t.observe("s", "\r\x1b[2K❯ "); // Ctrl-U 로 지운 뒤의 리페인트
    expect(t.occupancy("s", { msSinceBusySignal: null })).not.toBe(
      "human-draft",
    );
  });

  it("우리 글 뒤에 사람이 한 글자라도 넣으면 우리 글 판정이 풀린다", () => {
    const t = new ComposerTracker();
    t.noteInput("s", "우리 본문", "injected");
    t.noteInput("s", "\r", "injected");
    t.noteSelfWriteOutcome("s", "unconfirmed");
    t.observe("s", "\r\x1b[2K❯ 우리 본문");
    expect(t.occupancy("s", { msSinceBusySignal: null })).toBe<OccupancyCause>(
      "self-injected",
    );

    t.noteInput("s", "사", "human");
    expect(t.occupancy("s", { msSinceBusySignal: null })).toBe<OccupancyCause>(
      "human-draft",
    );
  });
});

// ── 안내 문구 ─────────────────────────────────────────────────────────────

function refusal(occupancy: OccupancyCause | null): InjectFailureDescriptor {
  return {
    refusal: "pty-refused",
    composer: occupancy === "awaiting-choice" ? "awaiting-choice" : "occupied",
    occupancy,
    detail: "PTY 가 쓰기를 거절했다",
  };
}

describe("안내문이 사유마다 다르다 — 없는 책임을 지우지 않는다", () => {
  it("★(a)와 (b)의 문구가 서로 다르다", () => {
    const human = holdOwnerNotice("inject-refused", refusal("human-draft"));
    const busy = holdOwnerNotice(
      "inject-refused",
      refusal("orchestrator-busy"),
    );
    expect(human.reason).not.toBe(busy.reason);
  });

  it("(a) 사람 초안이면 그 줄을 치우라고 말한다 — 그때는 그게 사실이다", () => {
    const n = holdOwnerNotice("inject-refused", refusal("human-draft"));
    expect(n.actionable).toBe(true);
    expect(n.reason).toContain("제출하거나 지우면");
  });

  it("★(b) 오케가 바쁘면 차례를 기다리는 중이라고 말하고, 할 일을 주지 않는다", () => {
    const n = holdOwnerNotice("inject-refused", refusal("orchestrator-busy"));
    expect(n.actionable).toBe(false);
    expect(n.reason).toContain("차례를 기다리는");
    expect(n.reason).toContain("하실 일은 없");
    // 실측에서 사장님을 헛수고시킨 바로 그 문장이 나가면 안 된다.
    expect(n.reason).not.toContain("제출하거나 지우면");
    expect(n.reason).not.toContain("제출되지 않은 글이 남아");
  });

  it("우리가 남긴 글이면 우리가 치운다고 말한다", () => {
    const n = holdOwnerNotice("inject-refused", refusal("self-injected"));
    expect(n.actionable).toBe(false);
    expect(n.reason).toContain("저희");
    expect(n.reason).not.toContain("제출하거나 지우면");
  });

  it("★사유 불명이면 보시라고 청하되, 초안을 남기셨다고 단정하지 않는다", () => {
    const n = holdOwnerNotice("inject-refused", refusal(null));
    expect(n.reason).toContain("특정하지 못했습니다");
    expect(n.reason).not.toContain("제출하거나 지우면");
    // 그래도 조용히 묻지는 않는다 — 모른다는 것은 할 일이 없다는 뜻이 아니다.
    expect(n.actionable).toBe(true);
  });

  it("오케가 아예 안 떠 있으면 종전대로 켜 달라고 말한다", () => {
    const n = holdOwnerNotice("no-orchestrator", null);
    expect(n.actionable).toBe(true);
    expect(n.reason).toContain("오케");
  });
});

// ── 폴러: 임계값과 유실 0 ─────────────────────────────────────────────────

const TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const PROJECT = "proj1";
const CHAT = "-1001234567890";
const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };

interface RecordedCall {
  method: string;
  body: Record<string, unknown> | null;
}

function makeFetch(opts: {
  updatesFor?: (offset: number | undefined) => unknown[];
}): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 0));
    const method = url.split("/").pop() ?? "";
    const body =
      init?.body != null
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : null;
    calls.push({ method, body });
    let payload: unknown;
    if (method === "getWebhookInfo") {
      payload = { ok: true, result: { url: "", pending_update_count: 0 } };
    } else if (method === "deleteWebhook") {
      payload = { ok: true, result: true };
    } else if (method === "getUpdates") {
      const offset =
        body && typeof body.offset === "number"
          ? (body.offset as number)
          : undefined;
      payload = { ok: true, result: opts.updatesFor?.(offset) ?? [] };
    } else if (method === "sendMessage") {
      payload = { ok: true, result: {} };
    } else {
      payload = { ok: false, description: `no stub for ${method}` };
    }
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function messageUpdate(updateId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      chat: { id: CHAT },
      from: { username: "boss", first_name: "Boss" },
      text,
    },
  };
}

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * 사유를 골라 거절하는 주입 대상. `blocked` 를 내리면 그때부터 받아들인다 —
 * "점유가 풀리면 밀린 게 전부 순서대로 온다" 를 실제 루프로 확인하기 위해서다.
 */
function makeTarget(occupancy: OccupancyCause | null): {
  target: InboundTarget;
  delivered: string[];
  release: () => void;
} {
  const delivered: string[] = [];
  let blocked = true;
  return {
    delivered,
    release: () => {
      blocked = false;
    },
    target: {
      injectMessage: async (text: string) => {
        if (blocked) return false;
        delivered.push(text);
        return true;
      },
      isRunning: () => true,
      describe: () => ({
        kind: "board",
        ptySessionId: "pty-1",
        status: "running",
      }),
      describeInjectFailure: () => (blocked ? refusal(occupancy) : null),
    },
  };
}

let tmpDir: string;
let prevOwnerInboundPath: string | undefined;

function offsetFile(): string {
  return path.join(tmpDir, "offsets.json");
}
function readOffsets(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(offsetFile(), "utf-8")) as Record<
      string,
      number
    >;
  } catch {
    return {};
  }
}

function baseDeps(
  fetchImpl: typeof fetch,
  over: Partial<TelegramPollerDeps> = {},
): TelegramPollerDeps {
  return {
    resolveOrchestrator: () => null,
    listActiveProjectIds: () => [PROJECT],
    getToken: () => TOKEN,
    getDefaultChatId: () => CHAT,
    getAllowedChatIds: () => [],
    fetchImpl,
    offsetFilePath: offsetFile(),
    // ★임시 디렉터리로 격리한다. 안 주면 실제 홈(~/.marblo)에 쓴다.
    inboundQueuePath: path.join(tmpDir, "inbound-queue.json"),
    longPollSeconds: 0,
    idleBackoffMs: 5,
    errorBackoffMs: 5,
    logger: quietLogger,
    pluginStateDir: path.join(tmpDir, "plugin"),
    neutralizePluginConfig: () => ({ tokenRemoved: false }),
    listChatIdSharers: () => [],
    getProjectLabel: () => null,
    holdNotifyAfterMs: 0,
    ...over,
  };
}

beforeEach(() => {
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tg-cause-")),
  );
  prevOwnerInboundPath = process.env.MARBLO_OWNER_INBOUND_PATH;
  process.env.MARBLO_OWNER_INBOUND_PATH = path.join(
    tmpDir,
    "owner-inbound.json",
  );
});
afterEach(() => {
  if (prevOwnerInboundPath === undefined) {
    delete process.env.MARBLO_OWNER_INBOUND_PATH;
  } else {
    process.env.MARBLO_OWNER_INBOUND_PATH = prevOwnerInboundPath;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("보류 안내 임계값 — 사유가 고른다", () => {
  it("★오케가 바쁘기만 하면 60초 지점에서 사람 탓 문구가 나가지 않는다", async () => {
    const { fetchImpl, calls } = makeFetch({
      updatesFor: () => [messageUpdate(500, "왜 조용해")],
    });
    const { target } = makeTarget("orchestrator-busy");
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => target,
        // 사람이 할 일이 있는 보류의 임계값은 지났다(1ms).
        holdNotifyAfterMs: 1,
        // 조용한 보류의 임계값은 아직 한참 남았다(실사용 기본 10분과 같은 축).
        quietHoldNotifyAfterMs: 600_000,
      }),
    );
    poller.start();
    await waitFor(
      () => (poller.getRouteHealth(PROJECT).hold?.attempts ?? 0) >= 5,
    );
    const health = poller.getRouteHealth(PROJECT);
    await poller.stopAll();

    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
    expect(health.hold?.occupancy).toBe("orchestrator-busy");
    expect(health.hold?.actionable).toBe(false);
    expect(health.hold?.ownerReason).toContain("차례를 기다리는");
    // ★보류는 보류지만 **오프셋은 전진한다**(티켓 nMpBzIMJmkSFqrrZfSKz).
    //   보류의 자리가 텔레그램 오프셋에서 내구 큐로 옮겨 갔다 — 스트림은 안
    //   막히고, 못 넣은 그 글은 큐에 그대로 있다.
    expect(readOffsets()[PROJECT]).toBeDefined();
    expect(health.inboundQueue.depth).toBe(1);
  }, 15000);

  it("사람 초안이면 같은 시점에 안내가 나가고, 그 문구는 치우라고 말한다", async () => {
    const { fetchImpl, calls } = makeFetch({
      updatesFor: () => [messageUpdate(501, "왜 조용해")],
    });
    const { target } = makeTarget("human-draft");
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => target,
        holdNotifyAfterMs: 1,
        quietHoldNotifyAfterMs: 600_000,
      }),
    );
    poller.start();
    await waitFor(
      () => calls.filter((c) => c.method === "sendMessage").length >= 1,
    );
    await waitFor(
      () => (poller.getRouteHealth(PROJECT).hold?.attempts ?? 0) >= 5,
    );
    await poller.stopAll();

    const notices = calls.filter((c) => c.method === "sendMessage");
    // 한 에피소드에 한 번이라는 기존 규율은 그대로다.
    expect(notices).toHaveLength(1);
    const text = String(notices[0].body?.text ?? "");
    expect(text).toContain("제출하거나 지우면");
    expect(text).toContain("유실되지 않았습니다");
    expect(text).not.toContain(TOKEN);
  }, 15000);

  it("보류 안내는 몇 건이 얼마나 기다리는지 말한다", async () => {
    const { fetchImpl, calls } = makeFetch({
      updatesFor: (offset) =>
        [
          messageUpdate(600, "하나"),
          messageUpdate(601, "둘"),
          messageUpdate(602, "셋"),
        ].filter((u) => offset === undefined || u.update_id >= offset),
    });
    const { target } = makeTarget("human-draft");
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => target,
        holdNotifyAfterMs: 1,
      }),
    );
    poller.start();
    await waitFor(
      () => calls.filter((c) => c.method === "sendMessage").length >= 1,
    );
    const health = poller.getRouteHealth(PROJECT);
    await poller.stopAll();

    expect(health.hold?.pendingUpdates).toBe(3);
    expect(
      String(calls.find((c) => c.method === "sendMessage")?.body?.text),
    ).toContain("3건이");
  }, 15000);
});

describe("사유를 나눠도 유실은 0이다", () => {
  it("★점유가 풀리면 보류된 메시지가 순서대로 전부 전달된다", async () => {
    const { fetchImpl } = makeFetch({
      updatesFor: (offset) =>
        [
          messageUpdate(700, "첫 번째"),
          messageUpdate(701, "두 번째"),
          messageUpdate(702, "세 번째"),
        ].filter((u) => offset === undefined || u.update_id >= offset),
    });
    const { target, delivered, release } = makeTarget("orchestrator-busy");
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => target,
        holdNotifyAfterMs: 1,
        quietHoldNotifyAfterMs: 600_000,
      }),
    );
    poller.start();

    // 막혀 있는 동안엔 한 건도 나가지 않고 offset 도 안 움직인다.
    await waitFor(
      () => (poller.getRouteHealth(PROJECT).hold?.attempts ?? 0) >= 3,
    );
    expect(delivered).toHaveLength(0);
    // ★막힌 동안에도 오프셋은 전진하고(스트림 안 막힘), 세 건 다 큐에 있다
    //   (티켓 nMpBzIMJmkSFqrrZfSKz). 유실 0 의 자리가 큐로 옮겨 갔다.
    expect(readOffsets()[PROJECT]).toBe(703);
    expect(poller.getRouteHealth(PROJECT).inboundQueue.depth).toBe(3);

    // 오케의 턴이 끝났다.
    release();
    await waitFor(() => delivered.length >= 3);
    await poller.stopAll();

    expect(delivered).toHaveLength(3);
    expect(delivered[0]).toContain("첫 번째");
    expect(delivered[1]).toContain("두 번째");
    expect(delivered[2]).toContain("세 번째");
    expect(readOffsets()[PROJECT]).toBe(703);
    expect(poller.getRouteHealth(PROJECT).hold).toBeNull();
  }, 20000);
});

describe("통지 차단 스위치는 사유와 무관하게 전체를 끈다", () => {
  it("holdNotifyAfterMs <= 0 이면 조용한 사유의 통지도 나가지 않는다", async () => {
    const { fetchImpl, calls } = makeFetch({
      updatesFor: () => [messageUpdate(800, "왜 조용해")],
    });
    // ★조용한 사유(오케 바쁨)로 잡는다 — 이 사유의 임계값을 1ms 로 열어 두고도
    //   전체 스위치가 이기는지가 이 테스트의 전부다.
    const { target } = makeTarget("orchestrator-busy");
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => target,
        // 껐다. 사유별 임계값이 이 스위치를 우회하면 안 된다.
        holdNotifyAfterMs: 0,
        quietHoldNotifyAfterMs: 1,
      }),
    );
    poller.start();
    await waitFor(
      () => (poller.getRouteHealth(PROJECT).hold?.attempts ?? 0) >= 5,
    );
    await poller.stopAll();
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
  }, 15000);
});
