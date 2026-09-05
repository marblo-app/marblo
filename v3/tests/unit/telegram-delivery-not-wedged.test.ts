/**
 * 티켓 nMpBzIMJmkSFqrrZfSKz — **"턴이 밀려 있어도 메시지는 들어간다. 앱을 켜야만
 * 들어오는 게 아니라."**
 *
 * ── 무엇이 틀렸었나 (실측, `~/.marblo/telegram-route-health.jsonl`, 2026-09-05) ──
 *
 *   11:58        오케 마지막 턴 종료 → 이후 PTY 출력 없음
 *   12:03:05  HELD upd=96862774 attempts=16   composer=occupied  idleSec=303
 *   12:15:05  HELD upd=96862774 attempts=237  composer=occupied  idleSec=1023
 *   12:28:05  HELD upd=96862774 attempts=476  composer=occupied  idleSec=1803
 *   12:29:05  HELD upd=96862774 attempts=494  composer=occupied  idleSec=0  ← 오케가 깨어남
 *   12:30:05  delivered=96862775
 *
 * 한 건이 27분 동안 494회 시도해 **한 번도** 배달되지 않았다. 그 구간의 사실 셋:
 *
 *   - `idleSec` 이 303→1803 으로 **단조 증가**했다 = 오케는 내내 완전히 조용했다.
 *     "오케가 바빠서 밀렸다" 가 아니다.
 *   - 같은 구간 `submit.unconfirmed = 0` = 우리가 남긴 미제출 글도 없었다.
 *   - 사장님은 초안을 찾지 못하셨다. 그런데도 494회가 전부 `composer-occupied`.
 *   - 출력이 다시 흐른 **바로 그 표본**에서 풀렸다.
 *
 * 원인: `composer-gate` 의 관측 유효기간이 **흘러간 PTY 출력 문자 수**로만
 * 계량된다. 오케가 조용하면 그 계량기가 안 돌아 낡은 관측이 영원히 "지금 화면"
 * 으로 남는다. 그리고 그 래치를 풀 유일한 사건(새 출력)은 막힌 그 메시지가
 * 배달돼야 생긴다 — 지연이 아니라 **자기잠금**이다. 사장님이 보신 "마블로를
 * 키니까 들어오네" 가 이 잠금의 증상이다(창을 켜면 TUI 가 다시 그리고, 그
 * 출력이 관측을 갱신한다).
 *
 * ── 이 파일이 고정하는 인수 조건 ────────────────────────────────────────
 *   1. ★조용한 세션에서 점유 판정이 굳지 않는다 — **출력이 한 바이트도 없어도**
 *      시간만으로 풀린다. 이것이 "앱을 켜야만 들어오는" 의존을 끊는 지점이다.
 *   2. 화면이 빈 프롬프트를 그리면 그 반증은 **그 순간 소비**된다(나중에 관측이
 *      낡아도 되살아나지 않는다).
 *   3. 남의 초안은 여전히 만료되지 않는다. 다이얼로그도 만료되지 않는다.
 *   4. 한 건이 막혀 있는 동안에도 **폴링은 계속되고**, 뒤에 쌓인 건수가 관측된다.
 *   5. 풀리면 보류분이 **순서대로 전부** 전달된다(유실 0).
 *   6. N회 실패하면 정책이 발동하고, 발동 후에도 침묵으로 돌아가지 않는다.
 *   7. 배달은 **일어난 순간** 건별로 관측에 남는다(774 가 배달됐는지 데이터로
 *      말할 수 없던 그 구멍을 막는다).
 *
 * ★GUI 를 띄우지 않는다. 순수 클래스 · 가짜 시계 · 가짜 fetch 만 돈다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ComposerTracker } from "../../electron/composer-gate";
import {
  TelegramPoller,
  type InboundTarget,
  type TelegramPollerDeps,
} from "../../electron/telegram-poller";

// ── 1) 점유 판정은 조용한 세션에서 굳지 않는다 ────────────────────────────

/** 실측 프레임 모양. 클로드/코덱스의 컴포저 프롬프트는 `❯`. */
const COMPOSER_WITH_TEXT = "❯ 쓰다 만 글\n";
const COMPOSER_EMPTY = "❯\n";
const DIALOG = "❯ 1. Yes, proceed\n";

/** 시계를 손으로 돌린다 — 실제 시간을 기다리지 않는다. */
function trackerWithClock(): {
  tracker: ComposerTracker;
  advance: (ms: number) => void;
} {
  let now = 1_000_000;
  const tracker = new ComposerTracker({ now: () => now });
  return {
    tracker,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("점유 판정 — 관측이 낡는 계량기가 관측 대상에 매여 있으면 안 된다", () => {
  it("★출력이 한 바이트도 없어도 시간만으로 점유가 풀린다 (27분 494회 교착의 직접 재현)", () => {
    const { tracker, advance } = trackerWithClock();
    tracker.observe("orch", COMPOSER_WITH_TEXT);
    expect(tracker.state("orch")).toBe("occupied");

    // 실측 구간: 오케가 조용해 PTY 출력이 0. 옛 코드는 `charsSinceObs` 로만
    // 늙기 때문에 여기서 **영원히** occupied 였다.
    advance(30_000);
    expect(tracker.state("orch")).toBe("occupied"); // 아직 유효기간 안

    advance(30_000); // 합 60초 > OCCUPANCY_CLAIM_STALE_MS(45초)
    expect(tracker.state("orch")).toBe("indeterminate");
    expect(tracker.verdict("orch").writable).toBe(true);
  });

  it("★27분을 통째로 흘려도, 출력 없이 풀린다 — 앱을 켜 줄 필요가 없다", () => {
    const { tracker, advance } = trackerWithClock();
    tracker.observe("orch", COMPOSER_WITH_TEXT);
    advance(27 * 60_000);
    expect(tracker.verdict("orch").writable).toBe(true);
  });

  it("유효기간 안에는 그대로 막는다 — 완화가 초안 보호를 통째로 없애지 않는다", () => {
    const { tracker, advance } = trackerWithClock();
    tracker.observe("orch", COMPOSER_WITH_TEXT);
    advance(44_000);
    expect(tracker.verdict("orch").writable).toBe(false);
  });

  it("화면이 계속 초안을 그리면(=오케가 살아 있고 초안도 살아 있음) 안 풀린다", () => {
    const { tracker, advance } = trackerWithClock();
    for (let i = 0; i < 10; i += 1) {
      advance(10_000);
      tracker.observe("orch", COMPOSER_WITH_TEXT); // 매 프레임 갱신
    }
    expect(tracker.state("orch")).toBe("occupied");
  });

  it("★확인 다이얼로그는 시계로 만료되지 않는다 — 틀리면 선택이 소비되고 되돌릴 수 없다", () => {
    const { tracker, advance } = trackerWithClock();
    tracker.observe("orch", DIALOG);
    expect(tracker.state("orch")).toBe("awaiting-choice");
    advance(27 * 60_000);
    expect(tracker.state("orch")).toBe("awaiting-choice");
    expect(tracker.verdict("orch").writable).toBe(false);
  });

  it("★남의 초안(사람이 친 미제출 키)은 시계로 만료되지 않는다", () => {
    const { tracker, advance } = trackerWithClock();
    tracker.noteInput("orch", "쓰다 만", "human");
    expect(tracker.state("orch")).toBe("occupied");
    advance(27 * 60_000);
    expect(tracker.state("orch")).toBe("occupied");
  });

  it("★우리가 넣은 표시는 만료된다 — 우리 글이 우리 전달을 영구히 막을 수 없다", () => {
    const { tracker, advance } = trackerWithClock();
    tracker.noteInput("orch", "우리가 넣은 본문", "injected");
    expect(tracker.state("orch")).toBe("occupied");
    advance(60_000);
    expect(tracker.verdict("orch").writable).toBe(true);
  });

  it("★빈 프롬프트를 본 순간 초안 표시를 소비한다 — 나중에 관측이 낡아도 되살아나지 않는다", () => {
    const { tracker, advance } = trackerWithClock();
    tracker.noteInput("orch", "abc", "human");
    expect(tracker.state("orch")).toBe("occupied");

    // 사람이 Esc/Ctrl-U 로 지웠다 → 화면이 빈 프롬프트를 그린다.
    advance(1_000);
    tracker.observe("orch", COMPOSER_EMPTY);
    expect(tracker.state("orch")).toBe("empty");

    // 그 뒤 4K 넘는 출력이 흘러 화면 관측이 낡는다. 반증을 비교로만 두면
    // 여기서 `obsKind === null` 이 되어 죽은 초안 표시가 되살아난다.
    tracker.observe("orch", "x".repeat(5_000));
    expect(tracker.verdict("orch").writable).toBe(true);
  });
});

// ── 2) 폴러: head-of-line · 유실 0 · 정책 발동 · 배달 관측 ─────────────────

const TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const PROJECT = "proj1";
const CHAT = "-1001234567890";
const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };

function makeFetch(opts: {
  updatesFor: (offset: number | undefined) => unknown[];
  onSend?: (text: string) => void;
}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 0));
    const method = url.split("/").pop() ?? "";
    const body =
      init?.body != null
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : null;
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
      payload = { ok: true, result: opts.updatesFor(offset) };
    } else if (method === "sendMessage") {
      opts.onSend?.(String(body?.text ?? ""));
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
}

function offsets(): Record<string, number> {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(tmpDir, "offsets.json"), "utf-8"),
    ) as Record<string, number>;
  } catch {
    return {};
  }
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

/** 실측 배치를 그대로 흉내낸다 — 오프셋이 안 움직이면 같은 꼬리를 다시 준다. */
function tailFrom(all: ReturnType<typeof messageUpdate>[]) {
  return (offset: number | undefined) =>
    all.filter((u) => offset === undefined || u.update_id >= offset);
}

async function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

function blockingTarget(): {
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
      describeInjectFailure: () =>
        blocked
          ? {
              refusal: "pty-refused",
              composer: "occupied",
              occupancy: "unknown" as const,
              detail: "PTY 가 쓰기를 거절했다",
            }
          : null,
    },
  };
}

let tmpDir: string;
let prevOwnerInboundPath: string | undefined;

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
    offsetFilePath: path.join(tmpDir, "offsets.json"),
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
    holdEscalateAfterAttempts: 0,
    ...over,
  };
}

beforeEach(() => {
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tg-wedge-")),
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

describe("head-of-line — 막히는 것은 배달이지 폴링이 아니다", () => {
  it("★앞 건이 막혀 있어도 폴링은 계속되고, 뒤에 쌓인 건수가 관측된다", async () => {
    const all = [
      messageUpdate(96862774, "첫 번째"),
      messageUpdate(96862775, "두 번째"),
      messageUpdate(96862776, "세 번째"),
    ];
    const { target } = blockingTarget();
    let polls = 0;
    const fetchImpl = makeFetch({
      updatesFor: (offset) => {
        polls += 1;
        return tailFrom(all)(offset);
      },
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => target }),
    );
    poller.start();
    await waitFor(() => {
      const h = poller.getRouteHealth(PROJECT).hold;
      return h != null && h.attempts >= 3;
    });
    const health = poller.getRouteHealth(PROJECT);
    const hold = health.hold;
    const queue = health.inboundQueue;
    await poller.stopAll();

    expect(hold?.updateId).toBe(96862774);
    // 막힌 동안에도 getUpdates 가 계속 돌았다 — "다음 메시지 풀링을 안 한다" 가
    // 아니라는 것을 폴 횟수로 못 박는다.
    expect(polls).toBeGreaterThan(2);
    // ★head-of-line 이 풀린 자리다(티켓 nMpBzIMJmkSFqrrZfSKz). 맨 앞 건이 아직
    //   못 들어갔는데도 오프셋은 세 건을 전부 지나 전진했다 — 텔레그램 스트림은
    //   더 이상 한 건에 걸려 서지 않는다.
    expect(offsets()[PROJECT]).toBe(96862777);
    // 그리고 세 건 다 우리 손(내구 큐)에 있다. 유실 0 의 자리가 옮겨졌을 뿐이다.
    expect(queue.depth).toBe(3);
    expect(queue.headUpdateId).toBe(96862774);
    // 뒤에 몇 건이 기다리는지가 **숫자로** 나온다(관측 가능성 인수 조건).
    expect(hold?.pendingUpdates).toBe(3);
  });

  it("★풀리면 보류분이 순서대로 전부 전달된다 — 유실 0, 건너뜀 0", async () => {
    const all = [
      messageUpdate(96862774, "첫 번째"),
      messageUpdate(96862775, "두 번째"),
      messageUpdate(96862776, "세 번째"),
    ];
    const { target, delivered, release } = blockingTarget();
    const seen: number[] = [];
    const poller = new TelegramPoller(
      baseDeps(makeFetch({ updatesFor: tailFrom(all) }), {
        resolveOrchestrator: () => target,
        onDelivered: (_p, updateId) => seen.push(updateId),
      }),
    );
    poller.start();
    await waitFor(
      () => (poller.getRouteHealth(PROJECT).hold?.attempts ?? 0) >= 2,
    );
    release();
    await waitFor(() => delivered.length === 3);
    await poller.stopAll();

    expect(delivered).toHaveLength(3);
    expect(delivered[0]).toContain("첫 번째");
    expect(delivered[1]).toContain("두 번째");
    expect(delivered[2]).toContain("세 번째");
    // ★건별 배달 기록. 실측에서 `lastDeliveredUpdateId` 가 null→775 로 뛰어
    //   774 의 결말을 데이터로 말할 수 없던 그 구멍을 이 배열이 막는다.
    expect(seen).toEqual([96862774, 96862775, 96862776]);
  });

  it("★배달 관측 훅이 던져도 배달은 그대로 진행된다 — 관측이 배달을 깨지 않는다", async () => {
    const all = [messageUpdate(1, "하나")];
    const { target, delivered, release } = blockingTarget();
    release();
    const poller = new TelegramPoller(
      baseDeps(makeFetch({ updatesFor: tailFrom(all) }), {
        resolveOrchestrator: () => target,
        onDelivered: () => {
          throw new Error("journal exploded");
        },
      }),
    );
    poller.start();
    await waitFor(() => delivered.length === 1);
    await poller.stopAll();
    expect(delivered).toHaveLength(1);
  });
});

describe("★유실 0 의 마지막 방어선 — 큐에 못 넣으면 오프셋을 붙잡는다", () => {
  it("디스크 확정에 실패하면 offset 이 전진하지 않는다 (사본이 텔레그램에 남는다)", async () => {
    // 큐 파일 자리에 디렉터리를 놓아 쓰기를 실패시킨다.
    const qPath = path.join(tmpDir, "wedged-queue.json");
    fs.mkdirSync(qPath, { recursive: true });

    const all = [messageUpdate(96862774, "왜 조용해")];
    const { target, delivered, release } = blockingTarget();
    release(); // 오케는 멀쩡하다 — 막는 것은 오직 디스크다
    const poller = new TelegramPoller(
      baseDeps(makeFetch({ updatesFor: tailFrom(all) }), {
        resolveOrchestrator: () => target,
        inboundQueuePath: qPath,
      }),
    );
    poller.start();
    await waitFor(
      () => (poller.getRouteHealth(PROJECT).hold?.attempts ?? 0) >= 2,
    );
    const health = poller.getRouteHealth(PROJECT);
    await poller.stopAll();

    // ★오프셋은 절대 움직이지 않았다 — 그래야 사본이 텔레그램 서버에 남는다.
    //   이 한 줄이 새 설계에서 유실을 막는 마지막 지점이다.
    expect(offsets()[PROJECT]).toBeUndefined();
    // 그리고 배달도 안 됐다(큐에 못 넣었으니 넣을 것도 없다).
    expect(delivered).toHaveLength(0);
    expect(health.hold?.reason).toBe("queue-persist-failed");
    expect(health.inboundQueue.depth).toBe(0);
  }, 15000);
});

describe("무한 재시도를 끝내는 정책", () => {
  it("★N회 실패하면 정책이 발동해 사장님께 알린다 (494회 침묵의 반대)", async () => {
    const all = [messageUpdate(96862774, "왜 조용해")];
    const { target } = blockingTarget();
    const sent: string[] = [];
    const poller = new TelegramPoller(
      baseDeps(
        makeFetch({
          updatesFor: tailFrom(all),
          onSend: (t) => sent.push(t),
        }),
        {
          resolveOrchestrator: () => target,
          holdNotifyAfterMs: 60_000, // 최초 통지는 아직 멀다
          holdEscalateAfterAttempts: 5,
          holdEscalateRepeatMs: 0, // 이 테스트는 1회만 본다
        },
      ),
    );
    poller.start();
    await waitFor(() => sent.length >= 1);
    const hold = poller.getRouteHealth(PROJECT).hold;
    await poller.stopAll();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("재시도");
    // 유실 0 약속을 안내문이 직접 말한다.
    expect(sent[0]).toContain("유실되지 않았습니다");
    expect(hold?.escalated).toBe(true);
    expect(hold?.escalations).toBe(1);
  });

  it("★발동 뒤에도 침묵으로 돌아가지 않는다 — 간격을 두고 다시 말한다", async () => {
    const all = [messageUpdate(96862774, "왜 조용해")];
    const { target } = blockingTarget();
    const sent: string[] = [];
    const poller = new TelegramPoller(
      baseDeps(
        makeFetch({
          updatesFor: tailFrom(all),
          onSend: (t) => sent.push(t),
        }),
        {
          resolveOrchestrator: () => target,
          holdNotifyAfterMs: 60_000,
          holdEscalateAfterAttempts: 3,
          holdEscalateRepeatMs: 20, // 테스트용 짧은 간격
        },
      ),
    );
    poller.start();
    await waitFor(() => sent.length >= 3);
    const hold = poller.getRouteHealth(PROJECT).hold;
    await poller.stopAll();
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(hold?.escalations).toBeGreaterThanOrEqual(3);
  });

  it("holdNotifyAfterMs<=0 은 여전히 전체 차단 스위치다 — 정책도 말하지 않는다", async () => {
    const all = [messageUpdate(96862774, "왜 조용해")];
    const { target } = blockingTarget();
    const sent: string[] = [];
    const poller = new TelegramPoller(
      baseDeps(
        makeFetch({
          updatesFor: tailFrom(all),
          onSend: (t) => sent.push(t),
        }),
        {
          resolveOrchestrator: () => target,
          holdNotifyAfterMs: 0,
          holdEscalateAfterAttempts: 2,
          holdEscalateRepeatMs: 10,
        },
      ),
    );
    poller.start();
    await waitFor(
      () => (poller.getRouteHealth(PROJECT).hold?.attempts ?? 0) >= 8,
    );
    await poller.stopAll();
    expect(sent).toHaveLength(0);
  });
});
