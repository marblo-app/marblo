import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  TelegramPoller,
  type InboundTarget,
  type TelegramPollerDeps,
} from "../../electron/telegram-poller";

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

  it("holds the offset when injectMessage silently skipped (orchestrator no longer running)", async () => {
    // Orchestrator resolves as live, injectMessage resolves without error, but
    // the session was stopped mid-boot so isRunning() is now false → the write
    // was skipped. The poller must NOT advance the offset (at-least-once).
    const target: InboundTarget = {
      injectMessage: async () => {},
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

  it("drops inbound from a chat not on a non-empty allowlist (advances offset)", async () => {
    const injected: string[] = [];
    const target: InboundTarget = {
      injectMessage: async (t) => {
        injected.push(t);
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
