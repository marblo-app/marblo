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
  type OrchestratorStatus,
} from "../../electron/orchestrator-manager";
import type { AgentConfigGenerator } from "../../electron/agent-config";
import type { PtyManager } from "../../electron/pty-manager";

const TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const PROJECT = "proj1";
const CHAT = "-1001234567890";

/** Silent logger so test output stays clean. */
const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };

interface RecordedCall {
  method: string;
  body: Record<string, unknown> | null;
}

/**
 * Build a fetch stub that dispatches on the Telegram API method (last URL
 * segment) and records every call. `updatesFor(offset)` decides what
 * getUpdates returns for the requested offset — so a test can serve a batch
 * once and then go empty to avoid infinite redelivery.
 */
function makeFetch(opts: {
  updatesFor?: (offset: number | undefined) => unknown[];
  onSend?: (body: Record<string, unknown>) => {
    ok: boolean;
    description?: string;
  };
  webhookUrl?: string;
}): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    // Resolve on a macrotask like real network I/O — a synchronous
    // (microtask-only) resolution would let a fast empty long-poll starve the
    // event loop, which only happens with the unrealistic longPollSeconds:0
    // test config, never with a real 25s server-side long poll.
    await new Promise((r) => setTimeout(r, 0));
    const method = url.split("/").pop() ?? "";
    const body =
      init?.body != null
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : null;
    calls.push({ method, body });

    let payload: unknown;
    if (method === "getWebhookInfo") {
      payload = {
        ok: true,
        result: { url: opts.webhookUrl ?? "", pending_update_count: 0 },
      };
    } else if (method === "deleteWebhook") {
      payload = { ok: true, result: true };
    } else if (method === "getUpdates") {
      const offset =
        body && typeof body.offset === "number"
          ? (body.offset as number)
          : undefined;
      payload = { ok: true, result: opts.updatesFor?.(offset) ?? [] };
    } else if (method === "sendMessage") {
      payload = opts.onSend?.(body ?? {}) ?? { ok: true, result: {} };
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

/** A message update as Telegram would deliver it. */
function messageUpdate(updateId: number, text: string, username = "alice") {
  return {
    update_id: updateId,
    message: {
      chat: { id: CHAT },
      from: { username, first_name: "Alice" },
      text,
    },
  };
}

/** Poll until `pred()` is true or the deadline passes (loop is async). */
async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

let tmpDir: string;
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

interface InjectManagerInternals {
  session: OrchestratorSession | null;
  bootGate: Promise<void>;
  resolveBootGate: () => void;
  injectChain: Promise<boolean>;
  currentMissionId: string | null;
}

interface WriteRecord {
  id: string;
  text: string;
  afterReplacementBootGate: boolean;
}

function asInjectInternals(
  manager: OrchestratorManager,
): InjectManagerInternals {
  return manager as unknown as InjectManagerInternals;
}

function makeInjectManagerHarness(kind: "board" | "mission" = "board"): {
  target: InboundTarget;
  writes: WriteRecord[];
  launchSession: (
    ptySessionId: string,
    status?: OrchestratorStatus,
    ownerMissionId?: string | null,
  ) => void;
  stopSession: () => void;
  markRunningAndReleaseBootGate: () => void;
  setReplacementBootGateReleased: () => void;
} {
  const writes: WriteRecord[] = [];
  let replacementBootGateReleased = false;
  const fakePty = {
    onDanger: () => {},
    writeAndSubmit: async (id: string, text: string): Promise<boolean> => {
      writes.push({
        id,
        text,
        afterReplacementBootGate: replacementBootGateReleased,
      });
      return true;
    },
  } as unknown as PtyManager;
  const manager = new OrchestratorManager(
    fakePty,
    {} as unknown as AgentConfigGenerator,
    undefined,
    kind,
  );
  const internals = asInjectInternals(manager);

  const launchSession = (
    ptySessionId: string,
    status: OrchestratorStatus = "starting",
    ownerMissionId: string | null = null,
  ): void => {
    let resolveBootGate = (): void => {};
    internals.bootGate = new Promise<void>((resolve) => {
      resolveBootGate = resolve;
    });
    internals.resolveBootGate = resolveBootGate;
    internals.injectChain = Promise.resolve(true);
    internals.currentMissionId = ownerMissionId;
    internals.session = {
      sessionId: `session-${ptySessionId}`,
      ptySessionId,
      status,
      projectId: PROJECT,
      rootPath: tmpDir,
    };
  };

  const stopSession = (): void => {
    internals.session = null;
    internals.resolveBootGate();
  };

  return {
    target: {
      injectMessage: (text) => manager.injectMessage(text),
      isRunning: () => manager.isRunning(),
      describe: () => {
        const session = manager.getSession();
        return {
          kind,
          ptySessionId: session?.ptySessionId ?? null,
          status: manager.getStatus(),
        };
      },
    },
    writes,
    launchSession,
    stopSession,
    markRunningAndReleaseBootGate: () => {
      if (internals.session) internals.session.status = "running";
      internals.resolveBootGate();
    },
    setReplacementBootGateReleased: () => {
      replacementBootGateReleased = true;
    },
  };
}

/** Base deps every test overrides selectively. */
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
    // 기본값이 실제 ~/.claude/channels/telegram 을 건드리지 않도록 tmp 로 격리.
    pluginStateDir: path.join(tmpDir, "plugin"),
    neutralizePluginConfig: () => ({ tokenRemoved: false }),
    // 기본값이 실제 ~/.marblo 채널 스토어를 읽지 않도록 격리(공유 없음 = 접두 없음).
    listChatIdSharers: () => [],
    getProjectLabel: () => null,
    ...over,
  };
}

beforeEach(() => {
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tgp-")),
  );
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("TelegramPoller inbound routing", () => {
  it("does NOT advance the offset when no orchestrator is live", async () => {
    const { fetchImpl, calls } = makeFetch({
      updatesFor: () => [messageUpdate(500, "hi")],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => null }),
    );
    poller.start();

    // Let the loop spin a few times against a dead orchestrator.
    await waitFor(
      () => calls.filter((c) => c.method === "getUpdates").length >= 2,
    );
    await poller.stopAll();

    // Offset never persisted → next boot redelivers (at-least-once).
    expect(readOffsets()[PROJECT]).toBeUndefined();
    // And every getUpdates kept re-requesting WITHOUT an advanced offset.
    const polls = calls.filter((c) => c.method === "getUpdates");
    expect(polls.every((c) => c.body?.offset === undefined)).toBe(true);
  });

  it("injects inbound text into the live orchestrator and advances offset once", async () => {
    const injected: string[] = [];
    const target: InboundTarget = {
      injectMessage: async (t) => {
        injected.push(t);
        return true;
      },
    };
    // Serve the batch only while offset is unacked (< 501); empty afterward.
    const { fetchImpl } = makeFetch({
      updatesFor: (offset) =>
        offset === undefined || offset < 501
          ? [messageUpdate(500, "deploy please")]
          : [],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => target }),
    );
    poller.start();

    await waitFor(() => injected.length >= 1);
    await poller.stopAll();

    expect(injected).toHaveLength(1);
    expect(injected[0]).toContain(
      "[Telegram inbound from @alice]: deploy please",
    );
    expect(injected[0]).toContain("send_telegram_message");
    expect(readOffsets()[PROJECT]).toBe(501);
    expect(poller.getLastChatId(PROJECT)).toBe(CHAT);
  });

  it("routes the next inbound to the newly resolved orchestrator after a switch and preserves last chat", async () => {
    const oldInjects: string[] = [];
    const newInjects: string[] = [];
    let active: "old" | "new" = "old";
    let afterSwitchUpdateAvailable = false;
    const oldTarget: InboundTarget = {
      injectMessage: async (t) => {
        oldInjects.push(t);
        return true;
      },
      isRunning: () => active === "old",
      describe: () => ({
        kind: "board",
        ptySessionId: "pty-old",
        status: active === "old" ? "running" : "stopped",
      }),
    };
    const newTarget: InboundTarget = {
      injectMessage: async (t) => {
        newInjects.push(t);
        return true;
      },
      isRunning: () => active === "new",
      describe: () => ({
        kind: "board",
        ptySessionId: "pty-new",
        status: active === "new" ? "running" : "stopped",
      }),
    };
    const { fetchImpl } = makeFetch({
      updatesFor: (offset) => {
        if (offset === undefined || offset < 1101) {
          return [messageUpdate(1100, "before switch")];
        }
        if (afterSwitchUpdateAvailable && offset < 1102) {
          return [messageUpdate(1101, "after switch")];
        }
        return [];
      },
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => (active === "old" ? oldTarget : newTarget),
      }),
    );
    poller.start();

    await waitFor(() => oldInjects.length === 1);
    expect(poller.getRouteHealth(PROJECT)).toMatchObject({
      loopRunning: true,
      lastChatIdKnown: true,
      lastDeliveredUpdateId: 1100,
      lastDeliveredTarget: {
        kind: "board",
        ptySessionId: "pty-old",
        status: "running",
      },
    });

    active = "new";
    afterSwitchUpdateAvailable = true;
    await waitFor(() => newInjects.length === 1);
    await poller.stopAll();

    expect(oldInjects).toHaveLength(1);
    expect(newInjects).toHaveLength(1);
    expect(newInjects[0]).toContain("after switch");
    expect(poller.getLastChatId(PROJECT)).toBe(CHAT);
    expect(poller.getRouteHealth(PROJECT)).toMatchObject({
      loopRunning: false,
      lastChatIdKnown: true,
      lastDeliveredUpdateId: 1101,
      lastDeliveredTarget: {
        kind: "board",
        ptySessionId: "pty-new",
        status: "running",
      },
    });
    expect(readOffsets()[PROJECT]).toBe(1102);
  });

  it("holds the offset when injectMessage reports that no PTY write happened", async () => {
    // Orchestrator resolves as live, but injectMessage reports that no PTY write
    // happened. The poller must NOT advance the offset (at-least-once).
    const target: InboundTarget = {
      injectMessage: async () => false,
      isRunning: () => false,
    };
    const { fetchImpl, calls } = makeFetch({
      updatesFor: () => [messageUpdate(800, "hi")],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => target }),
    );
    poller.start();

    await waitFor(
      () => calls.filter((c) => c.method === "getUpdates").length >= 2,
    );
    await poller.stopAll();

    expect(readOffsets()[PROJECT]).toBeUndefined(); // never advanced
    expect(poller.getLastChatId(PROJECT)).toBeUndefined(); // never recorded
  });

  it("delivers board switch-window inbound to the replacement PTY after its boot gate and preserves the routing gate", async () => {
    const harness = makeInjectManagerHarness("board");
    harness.launchSession("pty-old");
    let injectAttempts = 0;
    const target: InboundTarget = {
      injectMessage: (text) => {
        injectAttempts += 1;
        return harness.target.injectMessage(text);
      },
      isRunning: harness.target.isRunning,
      describe: harness.target.describe,
    };
    let served = false;
    const { fetchImpl, calls } = makeFetch({
      updatesFor: (offset) => {
        if (!served && offset === undefined) {
          served = true;
          return [messageUpdate(3000, "during switch")];
        }
        return [];
      },
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => target }),
    );
    poller.start();

    await waitFor(() => injectAttempts === 1);
    harness.stopSession();
    harness.launchSession("pty-new");
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.writes).toHaveLength(0);

    harness.setReplacementBootGateReleased();
    harness.markRunningAndReleaseBootGate();
    await waitFor(() => harness.writes.length === 1, 5000);
    await waitFor(() => readOffsets()[PROJECT] === 3001, 5000);
    await poller.stopAll();

    expect(injectAttempts).toBe(1);
    expect(calls.some((c) => c.body?.offset === 3001)).toBe(true);
    expect(harness.writes).toEqual([
      expect.objectContaining({
        id: "pty-new",
        afterReplacementBootGate: true,
      }),
    ]);
    expect(harness.writes[0]?.text).toMatch(
      /^\[Marblo routing gate\]\nRouting gate for every user turn:/,
    );
    expect(harness.writes[0]?.text).toContain("during switch");
    expect(poller.getLastChatId(PROJECT)).toBe(CHAT);
    expect(poller.getRouteHealth(PROJECT)).toMatchObject({
      lastDeliveredUpdateId: 3000,
      lastDeliveredTarget: {
        kind: "board",
        ptySessionId: "pty-new",
        status: "running",
      },
      lastChatIdKnown: true,
    });
  });

  it("does not leak a queued mission grant into a different owner mission after manager reuse", async () => {
    const harness = makeInjectManagerHarness("mission");
    harness.launchSession("pty-A", "starting", "mission-A");

    const delivered = harness.target.injectMessage("grant for mission A");
    harness.stopSession();
    harness.launchSession("pty-B", "starting", "mission-B");
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.writes).toHaveLength(0);

    harness.setReplacementBootGateReleased();
    harness.markRunningAndReleaseBootGate();
    await expect(delivered).resolves.toBe(false);

    expect(harness.writes).toHaveLength(0);
  });

  it("does not write to a same-id replacement PTY until the replacement boot gate resolves", async () => {
    const harness = makeInjectManagerHarness();
    harness.launchSession("pty-reused");
    let injectAttempts = 0;
    const target: InboundTarget = {
      injectMessage: (text) => {
        injectAttempts += 1;
        return harness.target.injectMessage(text);
      },
      isRunning: harness.target.isRunning,
      describe: harness.target.describe,
    };
    const { fetchImpl } = makeFetch({
      updatesFor: (offset) =>
        offset === undefined || offset < 3003
          ? [messageUpdate(3002, "same pty replacement")]
          : [],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => target }),
    );
    poller.start();

    await waitFor(() => injectAttempts === 1);
    harness.stopSession();
    harness.launchSession("pty-reused");
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.writes).toHaveLength(0);

    harness.setReplacementBootGateReleased();
    harness.markRunningAndReleaseBootGate();
    await waitFor(() => harness.writes.length === 1, 5000);
    await waitFor(() => readOffsets()[PROJECT] === 3003, 5000);
    await poller.stopAll();

    expect(injectAttempts).toBe(1);
    expect(harness.writes).toEqual([
      expect.objectContaining({
        id: "pty-reused",
        afterReplacementBootGate: true,
      }),
    ]);
  });

  it("holds the offset when a queued injectMessage resumes after the session dies without replacement", async () => {
    const harness = makeInjectManagerHarness();
    harness.launchSession("pty-old");
    let injectAttempts = 0;
    const target: InboundTarget = {
      injectMessage: (text) => {
        injectAttempts += 1;
        return harness.target.injectMessage(text);
      },
      isRunning: harness.target.isRunning,
      describe: harness.target.describe,
    };
    const { fetchImpl, calls } = makeFetch({
      updatesFor: () => [messageUpdate(3002, "lost session")],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { resolveOrchestrator: () => target }),
    );
    poller.start();

    await waitFor(() => injectAttempts === 1);
    harness.stopSession();
    await waitFor(
      () => calls.filter((c) => c.method === "getUpdates").length >= 2,
      5000,
    );
    await poller.stopAll();

    expect(harness.writes).toHaveLength(0);
    expect(readOffsets()[PROJECT]).toBeUndefined();
    expect(poller.getLastChatId(PROJECT)).toBeUndefined();
    expect(poller.getRouteHealth(PROJECT)).toMatchObject({
      lastDeliveredUpdateId: null,
      lastDeliveredTarget: null,
      lastChatIdKnown: false,
    });
  });

  it("drops inbound from a chat not on a non-empty allowlist (advances offset)", async () => {
    const injected: string[] = [];
    const target: InboundTarget = {
      injectMessage: async (t) => {
        injected.push(t);
        return true;
      },
    };
    const { fetchImpl } = makeFetch({
      updatesFor: (offset) =>
        offset === undefined || offset < 701 ? [messageUpdate(700, "hi")] : [],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => target,
        getAllowedChatIds: () => ["999999"], // CHAT not allowed
      }),
    );
    poller.start();

    await waitFor(() => readOffsets()[PROJECT] === 701);
    await poller.stopAll();

    expect(injected).toHaveLength(0); // never injected
    expect(readOffsets()[PROJECT]).toBe(701); // but consumed (advanced)
  });
});

describe("TelegramPoller outbound sendMessage", () => {
  it("never leaks the bot token in an error string", async () => {
    const { fetchImpl } = makeFetch({});
    // Force sendMessage to throw with the token embedded in the message.
    const throwingFetch = (async (url: string) => {
      if (url.endsWith("/sendMessage")) {
        throw new Error(
          `ECONNRESET https://api.telegram.org/bot${TOKEN}/sendMessage`,
        );
      }
      return fetchImpl(url);
    }) as unknown as typeof fetch;

    const poller = new TelegramPoller(
      baseDeps(throwingFetch, { listActiveProjectIds: () => [] }),
    );
    const res = await poller.sendMessage(PROJECT, "hello", CHAT);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.error).not.toContain(TOKEN);
  });

  it("falls back to the configured chatId and reports the target", async () => {
    const sent: Record<string, unknown>[] = [];
    const { fetchImpl } = makeFetch({
      onSend: (body) => {
        sent.push(body);
        return { ok: true };
      },
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { listActiveProjectIds: () => [] }),
    );
    const res = await poller.sendMessage(PROJECT, "hi there");
    expect(res.ok).toBe(true);
    expect(res.chatId).toBe(CHAT);
    expect(sent[0]).toMatchObject({ chat_id: CHAT, text: "hi there" });
  });

  it("chatId 공유 시 발신에 [프로젝트명] 접두를 붙인다 (응답 구분)", async () => {
    const sent: Record<string, unknown>[] = [];
    const { fetchImpl } = makeFetch({
      onSend: (body) => {
        sent.push(body);
        return { ok: true };
      },
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => [],
        listChatIdSharers: () => ["otherProj"],
        getProjectLabel: () => "Marblo",
      }),
    );
    const res = await poller.sendMessage(PROJECT, "done!", CHAT);
    expect(res.ok).toBe(true);
    expect(sent[0]).toMatchObject({ chat_id: CHAT, text: "[Marblo] done!" });
  });

  it("chatId 공유인데 프로젝트명이 없으면 projectId 앞 8자로 폴백한다", async () => {
    const sent: Record<string, unknown>[] = [];
    const { fetchImpl } = makeFetch({
      onSend: (body) => {
        sent.push(body);
        return { ok: true };
      },
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => [],
        listChatIdSharers: () => ["otherProj"],
        getProjectLabel: () => null,
      }),
    );
    await poller.sendMessage(PROJECT, "hi", CHAT);
    expect(sent[0]).toMatchObject({
      chat_id: CHAT,
      text: `[${PROJECT.slice(0, 8)}] hi`,
    });
  });

  it("chatId 를 공유하지 않으면 접두 없이 원문 그대로 보낸다 (무회귀)", async () => {
    const sent: Record<string, unknown>[] = [];
    const { fetchImpl } = makeFetch({
      onSend: (body) => {
        sent.push(body);
        return { ok: true };
      },
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => [],
        listChatIdSharers: () => [],
        getProjectLabel: () => "Marblo",
      }),
    );
    await poller.sendMessage(PROJECT, "plain", CHAT);
    expect(sent[0]).toMatchObject({ chat_id: CHAT, text: "plain" });
  });

  it("fails clearly when there is no token for the project", async () => {
    const { fetchImpl } = makeFetch({});
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => [],
        getToken: () => null,
      }),
    );
    const res = await poller.sendMessage(PROJECT, "hi", CHAT);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no active Telegram channel");
  });
});

describe("TelegramPoller lifecycle", () => {
  it("runs exactly one loop per project and stops it on deactivation", async () => {
    let active: string[] = [PROJECT];
    const { fetchImpl } = makeFetch({ updatesFor: () => [] });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { listActiveProjectIds: () => active }),
    );
    poller.start();
    await waitFor(() => poller.hasLoop(PROJECT));
    expect(poller.hasLoop(PROJECT)).toBe(true);

    // Duplicate sync must not spawn a second loop.
    poller.syncActiveChannels();
    expect(poller.hasLoop(PROJECT)).toBe(true);

    // Channel goes inactive → loop reconciled away.
    active = [];
    poller.syncActiveChannels();
    await waitFor(() => !poller.hasLoop(PROJECT));
    expect(poller.hasLoop(PROJECT)).toBe(false);
    await poller.stopAll();
  });
});

/** Build a fetch stub for the outbound path with a programmable /sendMessage. */
function makeSendFetch(
  onSend: (call: number) => { status: number; body: unknown },
): { fetchImpl: typeof fetch; sendCalls: () => number } {
  let sendCalls = 0;
  const fetchImpl = (async (url: string) => {
    await new Promise((r) => setTimeout(r, 0));
    if (url.endsWith("/sendMessage")) {
      sendCalls += 1;
      const { status, body } = onSend(sendCalls);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: {} }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, sendCalls: () => sendCalls };
}

describe("TelegramPoller outbound retry (spec B) + reliability counters (spec C)", () => {
  it("honors 429 retry_after and eventually succeeds", async () => {
    const waits: number[] = [];
    const { fetchImpl, sendCalls } = makeSendFetch((call) =>
      call === 1
        ? {
            status: 429,
            body: {
              ok: false,
              description: "Too Many Requests",
              parameters: { retry_after: 2 },
            },
          }
        : { status: 200, body: { ok: true, result: {} } },
    );
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => [],
        sleepImpl: async (ms) => {
          waits.push(ms);
        },
      }),
    );
    const res = await poller.sendMessage(PROJECT, "hi", CHAT);
    expect(res.ok).toBe(true);
    expect(sendCalls()).toBe(2);
    expect(waits).toEqual([2000]); // retry_after=2s honored (not base backoff)
    expect(poller.getReliabilityStats(PROJECT).sendFailures).toBe(0);
  });

  it("retries 5xx with exponential backoff, then returns an explicit scrubbed error + counts the failure", async () => {
    const waits: number[] = [];
    const { fetchImpl, sendCalls } = makeSendFetch(() => ({
      status: 500,
      body: { ok: false, description: "Internal Server Error" },
    }));
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => [],
        sendMaxRetries: 2,
        sendBackoffMs: 500,
        sleepImpl: async (ms) => {
          waits.push(ms);
        },
      }),
    );
    const res = await poller.sendMessage(PROJECT, "hi", CHAT);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.error).not.toContain(TOKEN);
    expect(sendCalls()).toBe(3); // 1 + 2 retries
    expect(waits).toEqual([500, 1000]); // exponential backoff
    expect(poller.getReliabilityStats(PROJECT).sendFailures).toBe(1);
  });

  it("does NOT retry a permanent 4xx (e.g. 400) — one attempt, counted", async () => {
    const waits: number[] = [];
    const { fetchImpl, sendCalls } = makeSendFetch(() => ({
      status: 400,
      body: { ok: false, description: "chat not found" },
    }));
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => [],
        sleepImpl: async (ms) => {
          waits.push(ms);
        },
      }),
    );
    const res = await poller.sendMessage(PROJECT, "hi", CHAT);
    expect(res.ok).toBe(false);
    expect(sendCalls()).toBe(1); // 400 is permanent → no retry
    expect(waits).toEqual([]);
    expect(poller.getReliabilityStats(PROJECT).sendFailures).toBe(1);
  });

  it("reliability stats default to zeros", () => {
    const { fetchImpl } = makeFetch({});
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { listActiveProjectIds: () => [] }),
    );
    expect(poller.getReliabilityStats("unknown")).toEqual({
      unanswered: 0,
      sendFailures: 0,
    });
  });
});

describe("TelegramPoller un-replied nudge (spec A)", () => {
  const NUDGE_PHRASE = "아직 답하지 않았습니다";

  it("does NOT nudge when the orchestrator replied (send_telegram_message called)", async () => {
    const injects: string[] = [];
    const target: InboundTarget = {
      injectMessage: async (t) => {
        injects.push(t);
        return true;
      },
      isRunning: () => true,
    };
    const { fetchImpl } = makeFetch({
      updatesFor: (offset) =>
        offset === undefined || offset < 1001
          ? [messageUpdate(1000, "hi")]
          : [],
      onSend: () => ({ ok: true }),
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => target,
        nudgeIdleDebounceMs: 10,
        nudgeMaxGraceMs: 100000,
      }),
    );
    poller.start();
    await waitFor(() => poller.hasPendingReply(PROJECT));

    // Orchestrator replies → clears the pending nudge.
    const res = await poller.sendMessage(PROJECT, "done", CHAT);
    expect(res.ok).toBe(true);
    expect(poller.hasPendingReply(PROJECT)).toBe(false);

    // Even after an idle transition, no reminder is injected.
    poller.markOrchestratorActivity(PROJECT);
    await new Promise((r) => setTimeout(r, 50));
    await poller.stopAll();

    expect(injects.filter((t) => t.includes(NUDGE_PHRASE))).toHaveLength(0);
    expect(poller.getReliabilityStats(PROJECT).unanswered).toBe(0);
  });

  it("nudges exactly once, then counts the inbound as unanswered", async () => {
    const injects: string[] = [];
    const target: InboundTarget = {
      injectMessage: async (t) => {
        injects.push(t);
        return true;
      },
      isRunning: () => true,
    };
    const { fetchImpl } = makeFetch({
      updatesFor: (offset) =>
        offset === undefined || offset < 901 ? [messageUpdate(900, "hi")] : [],
    });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        resolveOrchestrator: () => target,
        nudgeIdleDebounceMs: 10,
        nudgeMaxGraceMs: 100000,
      }),
    );
    poller.start();
    await waitFor(() => injects.length >= 1 && poller.hasPendingReply(PROJECT));

    // First idle transition → one reminder injected.
    poller.markOrchestratorActivity(PROJECT);
    await waitFor(
      () => injects.filter((t) => t.includes(NUDGE_PHRASE)).length >= 1,
    );
    expect(injects.filter((t) => t.includes(NUDGE_PHRASE))).toHaveLength(1);

    // Second idle transition, still no reply → counted, NO second nudge.
    poller.markOrchestratorActivity(PROJECT);
    await waitFor(() => poller.getReliabilityStats(PROJECT).unanswered >= 1);
    await poller.stopAll();

    expect(injects.filter((t) => t.includes(NUDGE_PHRASE))).toHaveLength(1);
    expect(poller.getReliabilityStats(PROJECT).unanswered).toBe(1);
    expect(poller.hasPendingReply(PROJECT)).toBe(false);
  });
});

// ── 409 잔존원인 회귀 (티켓 kYC4pGM7S4k6967qs8uO) ────────────────────────

/** warn 을 캡처하는 로거. */
function warnCapture(): {
  logger: Pick<Console, "log" | "warn" | "error">;
  warns: string[];
} {
  const warns: string[] = [];
  return {
    warns,
    logger: {
      log: () => {},
      warn: (m: unknown) => warns.push(String(m)),
      error: () => {},
    },
  };
}

const TOKEN_B = "987654321:BBHfakeOtherBotTokenForTests_ijklMNOP";

describe("토큰 기준 루프 dedup — 같은 봇을 두 프로젝트가 폴링하지 않는다", () => {
  it("★같은 토큰의 두 프로젝트 중 결정적 승자 1개만 폴 루프를 얻는다", async () => {
    const { fetchImpl } = makeFetch({ updatesFor: () => [] });
    const { logger, warns } = warnCapture();
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => ["pB", "pA"],
        getToken: () => TOKEN,
        logger,
      }),
    );
    poller.start();
    await waitFor(() => poller.hasLoop("pA"));
    expect(poller.hasLoop("pA")).toBe(true); // 사전순 첫 프로젝트가 승자
    expect(poller.hasLoop("pB")).toBe(false);
    const conflictWarn = warns.find((w) => w.includes("share ONE bot token"));
    expect(conflictWarn).toBeDefined();
    expect(conflictWarn).toContain("pA");
    expect(conflictWarn).toContain("pB");
    expect(conflictWarn).toContain("single-consumer");
    expect(conflictWarn).not.toContain(TOKEN); // 토큰 원문 비노출
    await poller.stopAll();
  });

  it("이미 돌고 있는 루프가 있으면 그 프로젝트가 승자로 유지된다(churn 방지)", async () => {
    const { fetchImpl } = makeFetch({ updatesFor: () => [] });
    let ids = ["pB"];
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => ids,
        getToken: () => TOKEN,
      }),
    );
    poller.start();
    await waitFor(() => poller.hasLoop("pB"));
    // 사전순으로 앞서는 pA 가 나중에 활성화돼도 기존 루프 pB 를 뺏지 않는다.
    ids = ["pA", "pB"];
    poller.syncActiveChannels();
    expect(poller.hasLoop("pB")).toBe(true);
    expect(poller.hasLoop("pA")).toBe(false);
    await poller.stopAll();
  });

  it("서로 다른 토큰이면 두 프로젝트 모두 폴 루프를 얻는다", async () => {
    const { fetchImpl } = makeFetch({ updatesFor: () => [] });
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => ["pA", "pB"],
        getToken: (p) => (p === "pA" ? TOKEN : TOKEN_B),
      }),
    );
    poller.start();
    await waitFor(() => poller.hasLoop("pA") && poller.hasLoop("pB"));
    expect(poller.hasLoop("pA")).toBe(true);
    expect(poller.hasLoop("pB")).toBe(true);
    await poller.stopAll();
  });
});

describe("기동 시 플러그인 토큰 정리 (외부 폴러 부팅 차단)", () => {
  it("start() 가 neutralizePluginConfig 를 호출하고, 토큰을 지웠으면 경고를 남긴다", async () => {
    const { fetchImpl } = makeFetch({ updatesFor: () => [] });
    const { logger, warns } = warnCapture();
    let calls = 0;
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        listActiveProjectIds: () => [],
        neutralizePluginConfig: () => {
          calls++;
          return { tokenRemoved: true };
        },
        logger,
      }),
    );
    poller.start();
    expect(calls).toBe(1);
    expect(warns.some((w) => w.includes("stale bot token"))).toBe(true);
    await poller.stopAll();
  });

  it("지울 토큰이 없으면 조용히 지나간다", async () => {
    const { fetchImpl } = makeFetch({ updatesFor: () => [] });
    const { logger, warns } = warnCapture();
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { listActiveProjectIds: () => [], logger }),
    );
    poller.start();
    expect(warns).toHaveLength(0);
    await poller.stopAll();
  });
});

describe("getUpdates 409 진단 — 누가 토큰을 잡고 있는지 지목한다", () => {
  /** getUpdates 가 항상 HTTP 409 를 돌려주는 fetch 스텁. */
  function make409Fetch(): {
    fetchImpl: typeof fetch;
    getUpdatesCalls: () => number;
  } {
    let n = 0;
    const fetchImpl = (async (url: string) => {
      await new Promise((r) => setTimeout(r, 0));
      const method = url.split("/").pop() ?? "";
      if (method === "getUpdates") {
        n++;
        return {
          ok: false,
          status: 409,
          json: async () => ({
            ok: false,
            error_code: 409,
            description: "Conflict: terminated by other getUpdates request",
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { url: "", pending_update_count: 0 },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, getUpdatesCalls: () => n };
  }

  it("★플러그인 .env 토큰 일치 + 살아있는 pid + 토큰공유 프로젝트를 모두 지목하고, 토큰 원문은 없다", async () => {
    // 외부 플러그인 폴러가 우리 토큰으로 부팅해 둔 상태를 재현.
    const pluginDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, ".env"),
      `TELEGRAM_BOT_TOKEN=${TOKEN}\n`,
    );
    fs.writeFileSync(path.join(pluginDir, "bot.pid"), String(process.pid));

    const { fetchImpl, getUpdatesCalls } = make409Fetch();
    const { logger, warns } = warnCapture();
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, {
        // "zz-copy" 는 사전순으로 뒤라 dedup 승자는 PROJECT — 하지만 진단은
        // 토큰을 공유하는 다른 프로젝트로 zz-copy 를 지목해야 한다.
        listActiveProjectIds: () => [PROJECT, "zz-copy"],
        getToken: () => TOKEN,
        pluginStateDir: pluginDir,
        logger,
      }),
    );
    poller.start();
    await waitFor(() => getUpdatesCalls() >= 3);
    await poller.stopAll();

    // 일반 에러 라인은 매번, 상세 진단은 스로틀로 1회만.
    expect(
      warns.some((w) => w.includes("getUpdates error: HTTP 409")),
    ).toBe(true);
    const diags = warns.filter((w) => w.includes("409 diagnosis"));
    expect(diags).toHaveLength(1);
    const diag = diags[0];
    expect(diag).toContain("ONE getUpdates consumer per bot");
    expect(diag).toContain("zz-copy"); // 토큰 공유 프로젝트 지목
    expect(diag).toContain("holds THIS bot's token"); // 플러그인 .env 일치
    expect(diag).toContain(`pid=${process.pid} (ALIVE)`); // 점유 프로세스 생존
    expect(diag).not.toContain(TOKEN); // 토큰 원문 비노출
    await poller.stopAll();
  });

  it("플러그인 .env 가 다른 토큰이면 일치로 지목하지 않는다", async () => {
    const pluginDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, ".env"),
      `TELEGRAM_BOT_TOKEN=${TOKEN_B}\n`,
    );
    const { fetchImpl, getUpdatesCalls } = make409Fetch();
    const { logger, warns } = warnCapture();
    const poller = new TelegramPoller(
      baseDeps(fetchImpl, { pluginStateDir: pluginDir, logger }),
    );
    poller.start();
    await waitFor(() => getUpdatesCalls() >= 2);
    await poller.stopAll();

    const diag = warns.find((w) => w.includes("409 diagnosis"));
    expect(diag).toBeDefined();
    expect(diag).toContain("does not hold this token");
    expect(diag).toContain("no other Marblo project uses this token");
    expect(diag).not.toContain(TOKEN);
    expect(diag).not.toContain(TOKEN_B);
  });
});
