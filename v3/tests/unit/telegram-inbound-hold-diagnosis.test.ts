/**
 * 티켓 c1R9C8v5MrBycZYSdTeB — "자리를 비우면 텔레그램이 안 들어오다가, 돌아오면
 * 몰려 들어온다".
 *
 * 이 파일이 지키는 것은 두 가지다.
 *
 * 1. ★보류 의미(false = 재배달)는 그대로다. 주입이 거부되는 동안 offset 은
 *    전진하지 않고, 막힘이 풀리면 밀린 게 **하나도 잃지 않고 전부** 도착한다.
 *    관측을 붙이면서 이 규율을 깨면 관측이 유실의 새 원인이 된다.
 * 2. 그리고 이제 "왜 조용한지" 를 사후에 말할 수 있다 — 루프가 멈춘 것인지,
 *    루프는 도는데 주입이 거부되는 것인지. 사용자에겐 똑같이 보이지만 원인이
 *    정반대인 두 상태다.
 *
 * ★소스 문자열 grep 가드가 아니라 동작으로 확인한다. 컴포저 막힘은 실제
 * `ComposerTracker` 에 실측 리페인트 바이트를 먹여 만들고(스텁 불리언이 아니라),
 * 배달은 실제 폴러 루프를 돌려 확인한다.
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
  OrchestratorManager,
  type OrchestratorSession,
} from "../../electron/orchestrator-manager";
import type { AgentConfigGenerator } from "../../electron/agent-config";
import type { PtyManager } from "../../electron/pty-manager";
import { ComposerTracker } from "../../electron/composer-gate";
import { classifyRoute } from "../../electron/telegram-route-journal";

const TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const PROJECT = "proj1";
const CHAT = "-1001234567890";
const PTY = "pty-1";

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

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface InjectManagerInternals {
  session: OrchestratorSession | null;
  bootGate: Promise<void>;
  resolveBootGate: () => void;
  injectChain: Promise<boolean>;
  currentMissionId: string | null;
}

/**
 * 살아 있는 오케 + **진짜** 컴포저 판정기를 붙인 주입 대상.
 *
 * `writeAndSubmit` 을 스텁 불리언으로 두지 않고 실제 `ComposerTracker` 판정에
 * 걸어 두는 것이 요점이다 — 그래야 "초안이 물려 있으면 안 쓴다 / 사람이 제출하면
 * 다시 쓴다" 가 실측 바이트로 재현되고, 소스 문자열이 아니라 동작이 검증된다.
 */
function makeLiveOrchestrator(): {
  target: InboundTarget;
  writes: string[];
  /** 화면이 그린 컴포저 프레임 한 장을 먹인다(실측 리페인트 형태). */
  paint: (frame: string) => void;
} {
  const tracker = new ComposerTracker();
  const writes: string[] = [];
  const fakePty = {
    onDanger: () => {},
    composerVerdict: (id: string) => tracker.verdict(id),
    writeAndSubmit: async (id: string, text: string): Promise<boolean> => {
      // 실제 PtyManager.writeAndSubmit 과 같은 규율: 판정이 '못 쓴다'면 쓰지
      // 않고 false. 쓰면 본문과 제출 CR 이 입력측 증거로 들어간다.
      if (!tracker.verdict(id).writable) return false;
      tracker.noteInput(id, text);
      tracker.noteInput(id, "\r");
      writes.push(text);
      return true;
    },
  } as unknown as PtyManager;

  const manager = new OrchestratorManager(
    fakePty,
    {} as unknown as AgentConfigGenerator,
    undefined,
    "board",
  );
  const internals = manager as unknown as InjectManagerInternals;
  internals.bootGate = Promise.resolve();
  internals.resolveBootGate = () => {};
  internals.injectChain = Promise.resolve(true);
  internals.currentMissionId = null;
  internals.session = {
    sessionId: `session-${PTY}`,
    ptySessionId: PTY,
    status: "running",
    projectId: PROJECT,
    rootPath: os.tmpdir(),
  } as OrchestratorSession;

  return {
    target: {
      injectMessage: (text) => manager.injectMessage(text),
      isRunning: () => manager.isRunning(),
      describe: () => ({
        kind: "board",
        ptySessionId: PTY,
        status: manager.getStatus(),
      }),
      describeInjectFailure: () => {
        const outcome = manager.getLastInjectOutcome();
        if (!outcome || outcome.ok || !outcome.refusal) return null;
        return {
          refusal: outcome.refusal,
          composer: outcome.composer,
          detail: outcome.detail,
        };
      },
    },
    writes,
    paint: (frame: string) => tracker.observe(PTY, frame),
  };
}

let tmpDir: string;
let prevOwnerInboundPath: string | undefined;

function offsetFile(): string {
  return path.join(tmpDir, "offsets.json");
}
function readOffsets(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(offsetFile(), "utf-8"));
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
    longPollSeconds: 0,
    idleBackoffMs: 5,
    errorBackoffMs: 5,
    logger: quietLogger,
    pluginStateDir: path.join(tmpDir, "plugin"),
    neutralizePluginConfig: () => ({ tokenRemoved: false }),
    listChatIdSharers: () => [],
    getProjectLabel: () => null,
    // 보류 통지는 각 테스트가 필요할 때만 켠다(기본은 끔).
    holdNotifyAfterMs: 0,
    ...over,
  };
}

beforeEach(() => {
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tg-hold-")),
  );
  // 사장님의 실제 인바운드 저널(~/.marblo/owner-inbound.json)을 절대 건드리지
  // 않는다 — 전달 성공 시 폴러가 거기에 적기 때문이다.
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

describe("컴포저가 막힌 동안의 보류 — 유실 없음이 먼저다", () => {
  it("초안이 물려 있으면 보류하고, 사람이 제출하면 밀린 전부가 순서대로 도착한다", async () => {
    const orch = makeLiveOrchestrator();
    // 사장님이 터미널 탭에 쓰다 만 초안이 화면에 있다 → 쓰면 안 되는 상태.
    orch.paint("\r\x1b[2K❯ 쓰다 만 초안");

    const { fetchImpl } = makeFetch({
      updatesFor: (offset) =>
        [messageUpdate(100, "첫 번째"), messageUpdate(101, "두 번째")].filter(
          (u) => offset === undefined || u.update_id >= offset,
        ),
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => orch.target }),
    );
    poller.start();

    // 보류가 걸릴 때까지 기다린다(재시도가 여러 번 돌아야 attempts 가 쌓인다).
    await waitFor(
      () => (poller.getRouteHealth(PROJECT).hold?.attempts ?? 0) >= 2,
    );

    const held = poller.getRouteHealth(PROJECT);
    expect(held.hold).not.toBeNull();
    // ★핵심 판별: 루프는 돌고 있는데 주입이 거부되는 중이다.
    expect(held.loopRunning).toBe(true);
    expect(held.hold?.reason).toBe("inject-refused");
    expect(held.hold?.updateId).toBe(100);
    expect(held.hold?.detail?.refusal).toBe("pty-refused");
    expect(held.hold?.detail?.composer).toBe("occupied");
    expect(classifyRoute(held, Date.now())).toBe("held-inject-refused");
    // 아무것도 안 썼고, offset 도 안 올라갔다 — 메시지는 살아 있다.
    expect(orch.writes).toHaveLength(0);
    expect(readOffsets()[PROJECT]).toBeUndefined();

    // 사람이 돌아와 자기 초안을 제출했다 → 컴포저가 비었다.
    orch.paint("\r\x1b[2K❯ ");

    await waitFor(() => orch.writes.length >= 2, 5000);
    await poller.stopAll();

    // ★유실 0 · 중복 0 · 순서 유지.
    expect(orch.writes).toHaveLength(2);
    expect(orch.writes[0]).toContain("첫 번째");
    expect(orch.writes[1]).toContain("두 번째");
    expect(readOffsets()[PROJECT]).toBe(102);
    // 보류는 풀렸다.
    expect(poller.getRouteHealth(PROJECT).hold).toBeNull();
  }, 15000);

  it("확인 다이얼로그 앞이면 사유가 awaiting-choice 로 남는다", async () => {
    const orch = makeLiveOrchestrator();
    orch.paint("Do you want to proceed?\n");

    const { fetchImpl } = makeFetch({
      updatesFor: () => [messageUpdate(200, "지금 배포해")],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => orch.target }),
    );
    poller.start();
    await waitFor(() => poller.getRouteHealth(PROJECT).hold !== null);
    const health = poller.getRouteHealth(PROJECT);
    await poller.stopAll();

    expect(health.hold?.reason).toBe("inject-refused");
    expect(health.hold?.detail?.composer).toBe("awaiting-choice");
    expect(orch.writes).toHaveLength(0);
  });

  it("오케가 아예 없으면 사유가 no-orchestrator 로 갈린다 — 같은 침묵, 다른 원인", async () => {
    const { fetchImpl } = makeFetch({
      updatesFor: () => [messageUpdate(300, "거기 있나")],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => null }),
    );
    poller.start();
    await waitFor(() => poller.getRouteHealth(PROJECT).hold !== null);
    const health = poller.getRouteHealth(PROJECT);
    await poller.stopAll();

    expect(health.hold?.reason).toBe("no-orchestrator");
    expect(health.hold?.detail).toBeNull();
    expect(classifyRoute(health, Date.now())).toBe("held-no-orchestrator");
    expect(readOffsets()[PROJECT]).toBeUndefined();
  });

  it("루프가 돌았다는 사실이 시각으로 남는다 — loopRunning 만으로는 못 가른다", async () => {
    const { fetchImpl } = makeFetch({ updatesFor: () => [] });
    const poller = new TelegramPoller(baseDeps(fetchImpl));
    poller.start();
    await waitFor(
      () => poller.getRouteHealth(PROJECT).lastPollCompletedAt !== null,
    );
    const health = poller.getRouteHealth(PROJECT);
    await poller.stopAll();

    expect(health.lastPollStartedAt).not.toBeNull();
    expect(health.lastPollCompletedAt).not.toBeNull();
    expect(health.consecutivePollErrors).toBe(0);
    expect(classifyRoute(health, Date.now())).toBe("idle-ok");
    // 같은 표본을 한참 뒤에 읽으면 "루프가 멈춘 것"으로 갈린다.
    expect(classifyRoute(health, Date.now() + 600_000)).toBe("loop-stalled");
  });
});

describe("샘플러의 대상 집합 — 멈춘 루프도 보여야 한다", () => {
  it("루프가 죽은(또는 못 뜬) 활성 프로젝트도 대상에 남는다", async () => {
    const { fetchImpl } = makeFetch({ updatesFor: () => [] });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        // 채널은 활성인데 토큰이 없어 루프가 뜨지 못하는 상태.
        listActiveProjectIds: () => [PROJECT],
        getToken: () => null,
      }),
    );
    poller.start();
    await new Promise((r) => setTimeout(r, 20));
    // ★루프 집합만 훑었다면 여기서 빈 배열이 되어 "멈춤"이 시계열에서 사라진다.
    expect(poller.activeProjectIds()).toContain(PROJECT);
    const health = poller.getRouteHealth(PROJECT);
    expect(health.loopRunning).toBe(false);
    expect(classifyRoute(health, Date.now())).toBe("loop-stopped");
    await poller.stopAll();
  });
});

describe("보류가 길어지면 사장님께 알린다 — 보류 의미는 그대로", () => {
  it("한 보류 에피소드에 통지는 정확히 한 번, 그리고 배달은 여전히 보류된다", async () => {
    const orch = makeLiveOrchestrator();
    orch.paint("\r\x1b[2K❯ 쓰다 만 초안");

    const { fetchImpl, calls } = makeFetch({
      updatesFor: () => [messageUpdate(400, "왜 조용해")],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => orch.target,
        // 즉시 통지(테스트가 실시간을 기다리지 않게).
        holdNotifyAfterMs: 1,
      }),
    );
    poller.start();

    await waitFor(
      () => calls.filter((c) => c.method === "sendMessage").length >= 1,
    );
    // 재시도가 여러 번 더 돌아도 통지는 늘지 않는다.
    await waitFor(
      () => (poller.getRouteHealth(PROJECT).hold?.attempts ?? 0) >= 5,
    );
    const health = poller.getRouteHealth(PROJECT);
    await poller.stopAll();

    const notices = calls.filter((c) => c.method === "sendMessage");
    expect(notices).toHaveLength(1);
    const text = String(notices[0].body?.text ?? "");
    expect(text).toContain("유실되지 않았습니다");
    expect(text).toContain("입력창");
    expect(text).not.toContain(TOKEN);
    // 통지는 진단이지 오케의 답이 아니다 — 신뢰도 카운터를 건드리지 않는다.
    expect(health.reliability.sendFailures).toBe(0);
    // 그리고 보류는 그대로다.
    expect(orch.writes).toHaveLength(0);
    expect(readOffsets()[PROJECT]).toBeUndefined();
  }, 15000);
});
