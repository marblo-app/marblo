/**
 * telegram-single-consumer — 한 봇에 getUpdates 소비자는 언제나 하나다.
 *
 * ★티켓 3asM22VKCCXgAlfnNXTJ. 실측 배경.
 *
 * `~/.marblo/telegram-route-health.jsonl` 에서 한 프로젝트만
 * `consecutivePollErrors` 가 3→105 로 오르며 `pollError` 가 계속 `http-409` 였다.
 * 409 는 같은 봇 토큰으로 getUpdates 가 둘 겹칠 때만 난다. 그런데 저널을 아무리
 * 봐도 **루프가 하나인지 둘인지 알 수 없었다** — 모든 계수기가 projectId 로만
 * 묶여 있어서 두 루프가 같은 칸에 겹쳐 쓰기 때문이다. 그래서 세 번의 조사가
 * 전부 실측이 아니라 추론으로 끝났다.
 *
 * 이 파일이 고정하는 것은 셋이다.
 *
 *  1. **중복 소비자가 생기지 않는다.** 예전 `stopLoop()` 은 `loops.delete()` 를
 *     먼저 하고 루프 종료를 나중에 기다렸다. 그런데 25초 롱폴에 물린 루프는
 *     맵에서 지워진 뒤에도 텔레그램의 단일 소비자 슬롯을 계속 잡고 있다. 중복
 *     방지 가드가 `loops.has()` 뿐이었으므로 그 창 안에서 `syncActiveChannels()`
 *     (헬스 스윕·전원 복귀·채널 IPC)가 돌면 **두 번째 루프**가 첫 루프의 롱폴
 *     한가운데로 들어갔다. 여기 첫 번째 테스트가 정확히 그 창을 재현한다.
 *
 *  2. **판정이 이 상태를 정상이라 부르지 않는다.** 105건 연속 실패 내내 verdict
 *     가 `idle-ok` 였다. 판정 함수가 오류 누적을 아예 안 봤기 때문이다.
 *
 *  3. **배달한 주체와 저널에 찍히는 주체가 같은 인스턴스다.** 조사 초기의 유력
 *     가설이 "배달하는 놈과 저널 쓰는 놈이 다르다" 였는데, 그걸 데이터로
 *     확인하거나 기각할 방법이 그때는 없었다. 이제 loopId 로 확인된다.
 *
 * 토큰·chatId·본문은 어느 단언에도 등장하지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  TelegramPoller,
  type InboundTarget,
  type TelegramPollerDeps,
} from "../../electron/telegram-poller";
import {
  TelegramRouteJournal,
  classifyRoute,
  type RouteSample,
} from "../../electron/telegram-route-journal";

const TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const PROJECT = "proj1";
const CHAT = "-1001234567890";

const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };

let tmpDir: string;
let prevOwnerInboundPath: string | undefined;

beforeEach(() => {
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tgs-")),
  );
  // handleUpdate() 는 배달 성공 직후 owner-inbound 저널에 쓴다. 격리하지 않으면
  // 개발자/CI 의 실제 ~/.marblo/owner-inbound.json 을 건드린다.
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

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start >= ms) {
      throw new Error(
        `waitFor timed out after ${ms}ms waiting for: ${pred.toString()}`,
      );
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
}

function abortError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

/**
 * getUpdates 가 **끝나지 않는** fetch 스텁 — 실제 25초 롱폴이 하는 일을 그대로
 * 흉내낸다. 소비자 슬롯을 쥐고 있는 시간을 테스트가 통제할 수 있어야 중복
 * 소비자 창을 재현할 수 있다.
 *
 * `maxConcurrent` 가 이 스위트의 핵심 관측치다: 동시에 열려 있던 getUpdates 의
 * 최대 개수. 텔레그램에서 이 값이 2가 되는 순간이 곧 HTTP 409 다.
 */
function makeHangingFetch(): {
  fetchImpl: typeof fetch;
  getUpdatesStarted: () => number;
  inFlight: () => number;
  maxConcurrent: () => number;
  releaseAll: () => void;
} {
  let started = 0;
  let current = 0;
  let peak = 0;
  const releases: Array<() => void> = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = String(url).split("/").pop() ?? "";
    if (method === "getWebhookInfo") {
      return jsonResponse({
        ok: true,
        result: { url: "", pending_update_count: 0 },
      });
    }
    if (method === "deleteWebhook")
      return jsonResponse({ ok: true, result: true });
    if (method !== "getUpdates") {
      return jsonResponse({ ok: false, description: `no stub for ${method}` });
    }

    started += 1;
    current += 1;
    peak = Math.max(peak, current);
    try {
      await new Promise<void>((resolve, reject) => {
        releases.push(resolve);
        const signal = init?.signal;
        if (!signal) return;
        // 루프가 은퇴하면서 요청을 끊는 경로. 실제 undici 처럼 abort 는
        // 즉시 거절로 나타나고, 그 순간 소비자 슬롯이 반납된다.
        if (signal.aborted) reject(abortError());
        else
          signal.addEventListener("abort", () => reject(abortError()), {
            once: true,
          });
      });
    } finally {
      current -= 1;
    }
    return jsonResponse({ ok: true, result: [] });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    getUpdatesStarted: () => started,
    inFlight: () => current,
    maxConcurrent: () => peak,
    releaseAll: () => {
      while (releases.length > 0) releases.pop()?.();
    },
  };
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
    offsetFilePath: path.join(tmpDir, "offsets.json"),
    longPollSeconds: 0,
    idleBackoffMs: 5,
    errorBackoffMs: 5,
    logger: quietLogger,
    pluginStateDir: path.join(tmpDir, "plugin"),
    neutralizePluginConfig: () => ({ tokenRemoved: false }),
    listChatIdSharers: () => [],
    getProjectLabel: () => null,
    ...over,
  };
}

describe("한 봇 = 한 소비자 — 은퇴 중인 루프의 롱폴 위로 두 번째 루프가 겹치지 않는다", () => {
  it("채널이 껐다 켜져도 getUpdates 가 동시에 둘 열리지 않는다 (409 의 원인 제거)", async () => {
    const tg = makeHangingFetch();
    // 채널 활성 여부를 테스트가 직접 흔든다 — 헬스 스윕이 비활성→활성을 연속으로
    // 관측하는 실제 상황과 같다.
    let channelActive = true;
    const poller = new TelegramPoller(
      baseDeps(tg.fetchImpl, {
        listActiveProjectIds: () => (channelActive ? [PROJECT] : []),
        getToken: () => (channelActive ? TOKEN : null),
      }),
    );

    poller.start();
    // 첫 루프가 롱폴에 물릴 때까지 기다린다 — 여기가 소비자 슬롯을 쥔 상태다.
    await waitFor(() => tg.inFlight() === 1);
    const firstLoopId = poller.getRouteHealth(PROJECT).loopId;
    expect(firstLoopId).not.toBeNull();

    // ★버그 재현 구간. 채널이 잠깐 비활성으로 보였다가 곧바로 다시 활성으로
    // 보인다. 예전 코드에서는 stopLoop 이 맵에서 먼저 지웠기 때문에 바로 다음
    // sync 의 중복 방지 가드가 통과해 버렸고, 첫 루프의 롱폴이 아직 살아 있는
    // 채로 두 번째 루프가 getUpdates 를 열었다.
    channelActive = false;
    poller.syncActiveChannels(); // stopLoop (fire-and-forget)
    channelActive = true;
    poller.syncActiveChannels(); // 예전 코드라면 여기서 두 번째 루프가 떴다

    // ★결함을 이름 그대로 잡는 단언. 두 번째 루프가 떴다면 웹훅 probe 한두 틱
    // 뒤에 자기 getUpdates 를 연다 — 그 순간 슬롯이 둘이 되고, 텔레그램에서는
    // 그게 곧 409 다. 뒤쪽 단언까지 밀어두면 실패가 "루프가 안 죽는다"로 보여
    // 진짜 사유(소비자가 둘이 됐다)를 가린다.
    await new Promise((r) => setTimeout(r, 100));
    expect(tg.maxConcurrent()).toBe(1);

    // 은퇴가 끝나 등록이 비워질 때까지 기다린다. abort 덕분에 밀리초 단위다.
    await waitFor(() => !poller.hasLoop(PROJECT));

    // 그리고 채널이 여전히 활성이므로 다음 스윕이 새 루프를 정상적으로 세운다.
    poller.syncActiveChannels();
    await waitFor(() => tg.inFlight() === 1);

    // ★핵심 단언: 어느 순간에도 getUpdates 는 하나뿐이었다.
    expect(tg.maxConcurrent()).toBe(1);

    const health = poller.getRouteHealth(PROJECT);
    expect(health.concurrentLoops).toBe(1);
    // 새 루프는 새 세대다 — 은퇴한 루프가 되살아난 게 아니라 교체된 것.
    expect(health.loopId).not.toBe(firstLoopId);
    expect(health.loopStarts).toBe(2);

    tg.releaseAll();
    await poller.stopAll();
  });

  it("이미 살아 있는 루프가 있으면 startLoop 은 두 번째를 거부한다", async () => {
    const tg = makeHangingFetch();
    const warns: string[] = [];
    const poller = new TelegramPoller(
      baseDeps(tg.fetchImpl, {
        logger: {
          log: () => {},
          warn: (m: string) => warns.push(String(m)),
          error: () => {},
        },
      }),
    );

    poller.start();
    await waitFor(() => tg.inFlight() === 1);

    // 같은 프로젝트를 몇 번을 더 조정해도 소비자는 늘지 않는다. syncActiveChannels
    // 는 멱등이라고 주석에 적혀 있었지만, 그 멱등성이 실제로 지켜지는지는 이제껏
    // 아무 테스트도 확인하지 않았다.
    poller.syncActiveChannels();
    poller.syncActiveChannels();
    poller.syncActiveChannels();
    await new Promise((r) => setTimeout(r, 30));

    expect(tg.maxConcurrent()).toBe(1);
    expect(poller.getRouteHealth(PROJECT).concurrentLoops).toBe(1);
    // 루프를 한 번만 세웠으므로 세대도 하나뿐이다.
    expect(poller.getRouteHealth(PROJECT).loopStarts).toBe(1);

    tg.releaseAll();
    await poller.stopAll();
  });

  it("stopAll 은 진행 중인 getUpdates 를 끊어 소비자 슬롯을 즉시 반납한다", async () => {
    const tg = makeHangingFetch();
    const poller = new TelegramPoller(baseDeps(tg.fetchImpl));

    poller.start();
    await waitFor(() => tg.inFlight() === 1);

    // releaseAll 을 부르지 않는다 — 즉 서버는 아직 응답하지 않았다. 그럼에도
    // stopAll 이 돌아온다는 것 자체가 요청이 끊겼다는 증거다. 예전에는 롱폴이
    // 자연히 끝날 때까지(최대 25초) 슬롯을 계속 쥐고 있었다.
    await poller.stopAll();

    expect(tg.inFlight()).toBe(0);
    expect(poller.hasLoop(PROJECT)).toBe(false);
    expect(poller.getRouteHealth(PROJECT).concurrentLoops).toBe(0);
  });

  it("은퇴하며 우리가 끊은 요청은 폴링 오류로 세지 않는다", async () => {
    const tg = makeHangingFetch();
    const poller = new TelegramPoller(baseDeps(tg.fetchImpl));

    poller.start();
    await waitFor(() => tg.inFlight() === 1);
    await poller.stopAll();

    // ★우리가 스스로 취소한 요청을 실패로 적으면, 이번에 새로 신뢰하게 된
    // 오류 누적 판정(poll-failing)이 정지할 때마다 거짓 경보를 낸다.
    expect(poller.getRouteHealth(PROJECT).consecutivePollErrors).toBe(0);
    expect(poller.getRouteHealth(PROJECT).lastPollErrorKind).toBeNull();
  });
});

describe("판정이 연속 실패를 정상이라고 부르지 않는다", () => {
  /** classifyRoute 에 먹일 최소 health. 루프는 돌고, 보류는 없고, 왕복도 최신. */
  function failingHealth(consecutivePollErrors: number) {
    return {
      projectId: PROJECT,
      loopRunning: true,
      loopId: "p1:proj1#1",
      concurrentLoops: 1,
      loopStarts: 1,
      lastPollLoopId: "p1:proj1#1",
      lastDeliveredLoopId: null,
      lastChatIdKnown: true,
      pendingReply: false,
      lastInboundAt: null,
      lastDeliveredUpdateId: null,
      lastDeliveredTarget: null,
      reliability: { unanswered: 0, sendFailures: 0 },
      lastPollStartedAt: 10_000,
      lastPollCompletedAt: 10_000,
      consecutivePollErrors,
      lastPollErrorAt: 10_000,
      lastPollErrorKind: "http" as const,
      lastPollErrorStatus: 409,
      lastPollDurationMs: 120,
      suspendedPollRecoveries: 0,
      hold: null,
    };
  }

  it("★실측 재현: 409 가 105건 연속인데 idle-ok 로 판정되던 것", () => {
    // 저널 15:10:23 샘플의 모양 그대로다.
    const verdict = classifyRoute(failingHealth(105), 10_500);
    expect(verdict).not.toBe("idle-ok");
    expect(verdict).toBe("poll-failing");
  });

  it("깜빡임(임계 미만)은 여전히 idle-ok — 경보를 남발하지 않는다", () => {
    expect(classifyRoute(failingHealth(0), 10_500)).toBe("idle-ok");
    expect(classifyRoute(failingHealth(2), 10_500)).toBe("idle-ok");
    expect(classifyRoute(failingHealth(3), 10_500)).toBe("poll-failing");
  });

  it("보류·정지가 걸린 상태면 그쪽 사유가 이긴다 — 판정 우선순위는 그대로다", () => {
    const held = {
      ...failingHealth(105),
      hold: {
        reason: "no-orchestrator" as const,
        updateId: 1,
        heldMs: 1_000,
        attempts: 3,
        detail: null,
      },
    };
    expect(classifyRoute(held, 10_500)).toBe("held-no-orchestrator");

    const stopped = { ...failingHealth(105), loopRunning: false };
    expect(classifyRoute(stopped, 10_500)).toBe("loop-stopped");

    // 왕복이 롱폴 예산을 한참 넘겨 멈춘 쪽이면 그게 더 구체적인 사유다.
    const stalled = failingHealth(105);
    expect(classifyRoute(stalled, 10_000 + 200_000)).toBe("loop-stalled");
  });
});

describe("배달한 주체와 저널에 찍히는 주체가 같은 인스턴스다", () => {
  it("배달 loopId = 폴링 loopId = 등록 loopId 이고, 저널 한 줄이 그걸 그대로 싣는다", async () => {
    const delivered: string[] = [];
    const target: InboundTarget = {
      injectMessage: async (text: string) => {
        delivered.push(text);
        return true;
      },
      isRunning: () => true,
      describe: () => ({
        kind: "board",
        ptySessionId: "pty-1",
        status: "running",
      }),
    };

    let served = false;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const method = String(url).split("/").pop() ?? "";
      if (method === "getWebhookInfo") {
        return jsonResponse({
          ok: true,
          result: { url: "", pending_update_count: 0 },
        });
      }
      if (method === "getUpdates") {
        await new Promise((r) => setTimeout(r, 0));
        if (served) return jsonResponse({ ok: true, result: [] });
        served = true;
        return jsonResponse({
          ok: true,
          result: [
            {
              update_id: 4242,
              message: {
                chat: { id: CHAT },
                from: { username: "owner" },
                text: "테스트",
              },
            },
          ],
        });
      }
      void init;
      return jsonResponse({ ok: true, result: {} });
    }) as unknown as typeof fetch;

    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => target }),
    );
    poller.start();
    await waitFor(() => delivered.length === 1);
    await waitFor(
      () => poller.getRouteHealth(PROJECT).lastDeliveredUpdateId === 4242,
    );

    const health = poller.getRouteHealth(PROJECT);
    // ★"배달하는 놈과 저널 쓰는 놈이 다르다" 가설을 데이터로 기각할 수 있게 하는
    // 단언. 세 값이 같으면 배달·폴링·등록이 전부 한 루프다.
    expect(health.lastDeliveredLoopId).toBe(health.loopId);
    expect(health.lastPollLoopId).toBe(health.loopId);
    expect(health.concurrentLoops).toBe(1);

    // 그리고 저널이 실제로 그 값을 파일에 싣는다 — 다음 침묵 때 한 줄만 보고
    // 판정할 수 있어야 하므로, 메모리에만 있으면 의미가 없다.
    const journalFile = path.join(tmpDir, "route.jsonl");
    const journal = new TelegramRouteJournal({
      listProjects: () => poller.activeProjectIds(),
      getRouteHealth: (projectId) => poller.getRouteHealth(projectId),
      filePath: journalFile,
      logger: quietLogger,
    });
    journal.sample("test");

    const lines = fs
      .readFileSync(journalFile, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as RouteSample);
    const line = lines.find((l) => l.projectId === PROJECT);
    expect(line).toBeDefined();
    expect(line?.loopId).toBe(health.loopId);
    expect(line?.lastDeliveredLoopId).toBe(health.loopId);
    expect(line?.lastPollLoopId).toBe(health.loopId);
    expect(line?.concurrentLoops).toBe(1);
    // 토큰이 저널 한 줄에 섞여 들어가지 않는다.
    expect(JSON.stringify(line)).not.toContain(TOKEN);

    await poller.stopAll();
  });
});
