import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SlackPoller,
  extractInboundMessage,
  formatInboundInjection,
  isRetriableSendError,
  parseSocketEnvelope,
  retryWaitMs,
  stripBotMention,
  type InboundTarget,
  type SlackPollerDeps,
  type SlackSocket,
} from "../../electron/slack-poller";
import { SlackHttpError } from "../../electron/slack-health";

const PROJECT = "proj1";
const BOT_TOKEN = "xoxb-1111111111-2222222222-abcdefghijklmnop";
const APP_TOKEN = "xapp-1-A01234567-1234567890-abcdefghijklmnopqrstuvwxyz";
const CHANNEL = "C0123ABCDEF";
const BOT_USER = "U0BOTBOT";
const HUMAN = "U0ALICE";
const WSS_URL = "wss://wss-primary.slack.com/link/?ticket=abc";

/** Silent logger so test output stays clean. */
const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };

// ─── pure parsers ─────────────────────────────────────────────────────────

describe("parseSocketEnvelope", () => {
  it("parses a JSON object frame", () => {
    expect(parseSocketEnvelope('{"type":"hello"}')).toEqual({ type: "hello" });
  });

  it("returns null for malformed or non-object frames", () => {
    expect(parseSocketEnvelope("not json")).toBeNull();
    expect(parseSocketEnvelope("[1,2]")).toBeNull();
    expect(parseSocketEnvelope("null")).toBeNull();
  });
});

describe("stripBotMention", () => {
  it("removes our own mention in both plain and aliased form", () => {
    expect(stripBotMention(`<@${BOT_USER}> deploy please`, BOT_USER)).toBe(
      "deploy please",
    );
    expect(stripBotMention(`<@${BOT_USER}|marblo> deploy`, BOT_USER)).toBe(
      "deploy",
    );
  });

  it("leaves other people's mentions alone", () => {
    expect(
      stripBotMention(`<@${BOT_USER}> ask <@${HUMAN}> about it`, BOT_USER),
    ).toBe(`ask <@${HUMAN}> about it`);
  });

  it("is a no-op when the bot user id is unknown", () => {
    expect(stripBotMention("  hello  ", null)).toBe("hello");
  });
});

describe("extractInboundMessage", () => {
  const mention = {
    type: "message",
    user: HUMAN,
    text: `<@${BOT_USER}> status?`,
    channel: CHANNEL,
    channel_type: "channel",
    ts: "1712.0001",
  };

  it("accepts a channel message that mentions the bot", () => {
    const msg = extractInboundMessage(mention, BOT_USER);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("status?");
    expect(msg!.channel).toBe(CHANNEL);
    expect(msg!.user).toBe(HUMAN);
    expect(msg!.isDirectMessage).toBe(false);
  });

  it("ignores un-addressed channel chatter", () => {
    expect(
      extractInboundMessage({ ...mention, text: "lunch?" }, BOT_USER),
    ).toBeNull();
  });

  it("accepts a DM with no mention", () => {
    const msg = extractInboundMessage(
      { ...mention, text: "status?", channel_type: "im" },
      BOT_USER,
    );
    expect(msg).not.toBeNull();
    expect(msg!.isDirectMessage).toBe(true);
  });

  it("gives the `message` and `app_mention` duplicate pair ONE dedup key", () => {
    // Slack emits both for a single channel mention, with different event ids
    // but the same channel+ts. The key is what collapses them.
    const a = extractInboundMessage(mention, BOT_USER);
    const b = extractInboundMessage(
      { ...mention, type: "app_mention" },
      BOT_USER,
    );
    expect(a!.key).toBe(b!.key);
    expect(a!.key).toBe(`${CHANNEL}:1712.0001`);
  });

  it("never acts on a bot's own post (no self-triggered loop)", () => {
    expect(
      extractInboundMessage({ ...mention, user: BOT_USER }, BOT_USER),
    ).toBeNull();
    expect(
      extractInboundMessage({ ...mention, bot_id: "B123" }, BOT_USER),
    ).toBeNull();
  });

  it("ignores edits, deletes and other subtyped messages", () => {
    expect(
      extractInboundMessage(
        { ...mention, subtype: "message_changed" },
        BOT_USER,
      ),
    ).toBeNull();
    expect(
      extractInboundMessage({ ...mention, subtype: "channel_join" }, BOT_USER),
    ).toBeNull();
  });

  it("ignores event types we do not handle", () => {
    expect(
      extractInboundMessage({ ...mention, type: "reaction_added" }, BOT_USER),
    ).toBeNull();
  });

  it("ignores a bare mention with no actual ask", () => {
    expect(
      extractInboundMessage({ ...mention, text: `<@${BOT_USER}>` }, BOT_USER),
    ).toBeNull();
  });

  it("replies into the message's thread, or starts one at the message", () => {
    // Already threaded → answer in that thread.
    expect(
      extractInboundMessage({ ...mention, thread_ts: "1711.0009" }, BOT_USER)!
        .threadTs,
    ).toBe("1711.0009");
    // Top-level → the message itself becomes the thread root.
    expect(extractInboundMessage(mention, BOT_USER)!.threadTs).toBe(
      "1712.0001",
    );
  });

  it("still accepts app_mention when the bot user id could not be resolved", () => {
    // auth.test failing must not make the channel deaf to explicit mentions.
    const msg = extractInboundMessage(
      { ...mention, type: "app_mention" },
      null,
    );
    expect(msg).not.toBeNull();
  });
});

describe("formatInboundInjection", () => {
  it("names the sender, the thread, and that a plain reply is not delivered", () => {
    const injected = formatInboundInjection(PROJECT, {
      channel: CHANNEL,
      threadTs: "1712.0001",
      user: HUMAN,
      text: "status?",
    });
    // Several people share a team channel — who asked has to survive.
    expect(injected).toContain(`<@${HUMAN}>`);
    expect(injected).toContain("1712.0001");
    expect(injected).toContain("send_slack_message");
    expect(injected).toContain(`projectId="${PROJECT}"`);
    expect(injected).toContain("전달되지 않습니다");
  });
});

describe("outbound retry classification", () => {
  it("retries 429 and 5xx but not other 4xx", () => {
    expect(isRetriableSendError(new SlackHttpError(429))).toBe(true);
    expect(isRetriableSendError(new SlackHttpError(503))).toBe(true);
    expect(isRetriableSendError(new SlackHttpError(400))).toBe(false);
    expect(isRetriableSendError(new SlackHttpError(401))).toBe(false);
  });

  it("retries network-level failures", () => {
    expect(isRetriableSendError(new Error("ECONNRESET"))).toBe(true);
  });

  it("honors Retry-After, else backs off exponentially", () => {
    expect(retryWaitMs(new SlackHttpError(429, 7), 500, 0)).toBe(7000);
    expect(retryWaitMs(new Error("boom"), 500, 0)).toBe(500);
    expect(retryWaitMs(new Error("boom"), 500, 2)).toBe(2000);
  });
});

// ─── handoff (inbound → orchestrator, outbound → Slack) ───────────────────

/** A fake Socket Mode WebSocket the test drives frame by frame. */
class FakeSocket implements SlackSocket {
  readonly sent: string[] = [];
  closed = false;
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(listener);
    this.handlers.set(event, list);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
  emit(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }
  /** Envelope ids this socket acked back to Slack. */
  acked(): string[] {
    return this.sent
      .map((s) => JSON.parse(s) as { envelope_id?: string })
      .map((s) => s.envelope_id)
      .filter((id): id is string => typeof id === "string");
  }
}

/** An `events_api` envelope carrying one channel message event. */
function eventEnvelope(
  envelopeId: string,
  event: Record<string, unknown>,
): string {
  return JSON.stringify({
    type: "events_api",
    envelope_id: envelopeId,
    payload: { event },
  });
}

function mentionEvent(ts: string, text = `<@${BOT_USER}> status?`) {
  return {
    type: "message",
    user: HUMAN,
    text,
    channel: CHANNEL,
    channel_type: "channel",
    ts,
  };
}

/** Records every injection an orchestrator target received. */
function recordingTarget(opts?: { write?: boolean }): {
  target: InboundTarget;
  injected: string[];
} {
  const injected: string[] = [];
  return {
    injected,
    target: {
      injectMessage: async (text: string) => {
        injected.push(text);
        return opts?.write ?? true;
      },
      isRunning: () => true,
      describe: () => ({
        kind: "board",
        ptySessionId: "pty-1",
        status: "running",
      }),
    },
  };
}

/** Let queued promise chains and immediate timers settle. */
async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 1));
  }
}

interface Harness {
  poller: SlackPoller;
  sockets: FakeSocket[];
  posts: Record<string, unknown>[];
  /** Open a connection and complete the Socket Mode handshake. */
  connect(): Promise<FakeSocket>;
}

let stateDir: string;

function makeHarness(
  overrides: Partial<SlackPollerDeps> & {
    postResult?: () => { ok: boolean; error?: string };
  } = {},
): Harness {
  const sockets: FakeSocket[] = [];
  const posts: Record<string, unknown>[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 0));
    const method = String(url).split("/").pop() ?? "";
    const body =
      init?.body != null
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
    let payload: unknown;
    if (method === "apps.connections.open") {
      payload = { ok: true, url: WSS_URL };
    } else if (method === "auth.test") {
      payload = { ok: true, user_id: BOT_USER, team_id: "T0TEAM" };
    } else if (method === "chat.postMessage") {
      posts.push(body);
      payload = overrides.postResult?.() ?? { ok: true, ts: "1712.9999" };
    } else {
      payload = { ok: false, error: `no stub for ${method}` };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const { postResult: _ignored, ...depOverrides } = overrides;
  const poller = new SlackPoller({
    resolveOrchestrator: () => null,
    listActiveProjectIds: () => [PROJECT],
    getBotToken: () => BOT_TOKEN,
    getAppToken: () => APP_TOKEN,
    getDefaultChannelId: () => CHANNEL,
    getAllowedChannelIds: () => [],
    getBotUserId: async () => BOT_USER,
    listChannelIdSharers: () => [],
    fetchImpl,
    webSocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    statePath: path.join(stateDir, "state.json"),
    sleepImpl: () => Promise.resolve(),
    pendingRetryMs: 5,
    logger: quietLogger,
    ...depOverrides,
  });

  return {
    poller,
    sockets,
    posts,
    async connect() {
      poller.syncActiveChannels();
      await flush();
      const socket = sockets[sockets.length - 1];
      socket.emit("open");
      socket.emit("message", JSON.stringify({ type: "hello" }));
      await flush();
      return socket;
    },
  };
}

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-poller-"));
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("SlackPoller — inbound handoff", () => {
  it("acks the envelope and injects the message into the live orchestrator", async () => {
    const { target, injected } = recordingTarget();
    const h = makeHarness({ resolveOrchestrator: () => target });
    const socket = await h.connect();

    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();

    // The ack is the non-negotiable half — Slack redelivers without it.
    expect(socket.acked()).toContain("env-1");
    expect(injected).toHaveLength(1);
    expect(injected[0]).toContain("status?");
    expect(injected[0]).toContain("send_slack_message");
    expect(h.poller.getLastChannel(PROJECT)).toBe(CHANNEL);
    expect(h.poller.getLastThreadTs(PROJECT)).toBe("1712.0001");
    expect(h.poller.hasPendingReply(PROJECT)).toBe(true);
    await h.poller.stopAll();
  });

  it("acks BEFORE delivery, so a message survives having no orchestrator", async () => {
    const h = makeHarness({ resolveOrchestrator: () => null });
    const socket = await h.connect();

    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();

    // Slack is satisfied (acked) AND the message is not lost — it is queued.
    expect(socket.acked()).toContain("env-1");
    expect(h.poller.getPendingInboundCount(PROJECT)).toBe(1);
    await h.poller.stopAll();
  });

  it("redelivers a queued inbound once an orchestrator boots", async () => {
    const { target, injected } = recordingTarget();
    let live: InboundTarget | null = null;
    const h = makeHarness({ resolveOrchestrator: () => live });
    const socket = await h.connect();

    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();
    expect(h.poller.getPendingInboundCount(PROJECT)).toBe(1);
    expect(injected).toHaveLength(0);

    live = target; // orchestrator comes online; the drain timer picks it up
    await flush(20);

    expect(injected).toHaveLength(1);
    expect(h.poller.getPendingInboundCount(PROJECT)).toBe(0);
    await h.poller.stopAll();
  });

  it("treats a false injectMessage as NOT delivered (the expectPty guard)", async () => {
    // OrchestratorManager.injectMessage returns false rather than faking
    // success when the PTY changed or died mid-flight. Honoring that is what
    // keeps inbound from being silently dropped.
    const { target, injected } = recordingTarget({ write: false });
    const h = makeHarness({ resolveOrchestrator: () => target });
    const socket = await h.connect();

    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();

    // Attempted (and retried, since the queue keeps draining)…
    expect(injected.length).toBeGreaterThanOrEqual(1);
    // …but never counted as delivered: it stays queued for a live PTY.
    expect(h.poller.getPendingInboundCount(PROJECT)).toBe(1);
    expect(h.poller.hasPendingReply(PROJECT)).toBe(false);
    expect(h.poller.getLastChannel(PROJECT)).toBeUndefined();
    await h.poller.stopAll();
  });

  it("injects only once for the message/app_mention duplicate pair", async () => {
    const { target, injected } = recordingTarget();
    const h = makeHarness({ resolveOrchestrator: () => target });
    const socket = await h.connect();

    const event = mentionEvent("1712.0001");
    socket.emit("message", eventEnvelope("env-1", event));
    socket.emit(
      "message",
      eventEnvelope("env-2", { ...event, type: "app_mention" }),
    );
    await flush();

    expect(socket.acked()).toEqual(["env-1", "env-2"]); // both acked
    expect(injected).toHaveLength(1); // but one injection
    await h.poller.stopAll();
  });

  it("de-duplicates a Slack retry of the same envelope", async () => {
    const { target, injected } = recordingTarget();
    const h = makeHarness({ resolveOrchestrator: () => target });
    const socket = await h.connect();

    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();
    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();

    expect(injected).toHaveLength(1);
    await h.poller.stopAll();
  });

  it("drops inbound from a channel outside the allowlist (but still acks)", async () => {
    const { target, injected } = recordingTarget();
    const h = makeHarness({
      resolveOrchestrator: () => target,
      getAllowedChannelIds: () => ["C_SOMEWHERE_ELSE"],
    });
    const socket = await h.connect();

    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();

    expect(socket.acked()).toContain("env-1");
    expect(injected).toHaveLength(0);
    expect(h.poller.getPendingInboundCount(PROJECT)).toBe(0);
    await h.poller.stopAll();
  });

  it("ignores chatter that does not address the bot", async () => {
    const { target, injected } = recordingTarget();
    const h = makeHarness({ resolveOrchestrator: () => target });
    const socket = await h.connect();

    socket.emit(
      "message",
      eventEnvelope("env-1", mentionEvent("1712.0001", "lunch anyone?")),
    );
    await flush();

    expect(injected).toHaveLength(0);
    await h.poller.stopAll();
  });

  it("reconnects when Slack asks it to disconnect", async () => {
    const h = makeHarness();
    const socket = await h.connect();

    socket.emit(
      "message",
      JSON.stringify({ type: "disconnect", reason: "warning" }),
    );
    await flush(20);

    expect(socket.closed).toBe(true);
    expect(h.sockets.length).toBeGreaterThan(1); // dialed a fresh url
    await h.poller.stopAll();
  });

  it("survives a malformed frame without tearing the socket down", async () => {
    const { target, injected } = recordingTarget();
    const h = makeHarness({ resolveOrchestrator: () => target });
    const socket = await h.connect();

    socket.emit("message", "<not json>");
    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();

    expect(socket.closed).toBe(false);
    expect(injected).toHaveLength(1);
    await h.poller.stopAll();
  });

  it("delivers a backlog in order, ahead of a message that arrives later", async () => {
    const { target, injected } = recordingTarget();
    let live: InboundTarget | null = null;
    const h = makeHarness({ resolveOrchestrator: () => live });
    const socket = await h.connect();

    // Two messages arrive while the orchestrator is down…
    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush(2);
    socket.emit("message", eventEnvelope("env-2", mentionEvent("1712.0002")));
    await flush(2);
    expect(h.poller.getPendingInboundCount(PROJECT)).toBe(2);

    live = target;
    await flush(30);

    // …and the conversation reaches the orchestrator in the order it happened.
    expect(injected).toHaveLength(2);
    expect(injected[0]).toContain("1712.0001");
    expect(injected[1]).toContain("1712.0002");
    await h.poller.stopAll();
  });

  it("bounds the pending queue and says exactly what it dropped", async () => {
    const h = makeHarness({
      resolveOrchestrator: () => null,
      maxPendingPerProject: 2,
    });
    const socket = await h.connect();

    for (const ts of ["1712.0001", "1712.0002", "1712.0003"]) {
      socket.emit("message", eventEnvelope(`env-${ts}`, mentionEvent(ts)));
      await flush(2);
    }

    expect(h.poller.getPendingInboundCount(PROJECT)).toBe(2);
    // Overflow is counted, never silent.
    expect(h.poller.getReliabilityStats(PROJECT).droppedOverflow).toBe(1);
    await h.poller.stopAll();
  });
});

describe("SlackPoller — outbound", () => {
  it("replies into the thread the inbound came from", async () => {
    const { target } = recordingTarget();
    const h = makeHarness({ resolveOrchestrator: () => target });
    const socket = await h.connect();
    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();

    const result = await h.poller.sendMessage(PROJECT, "done");
    expect(result.ok).toBe(true);
    expect(h.posts[0]).toMatchObject({
      channel: CHANNEL,
      text: "done",
      thread_ts: "1712.0001",
    });
    // Replying clears the un-replied nudge.
    expect(h.poller.hasPendingReply(PROJECT)).toBe(false);
    await h.poller.stopAll();
  });

  it("posts to the channel (not a thread) when threadTs is explicitly empty", async () => {
    const { target } = recordingTarget();
    const h = makeHarness({ resolveOrchestrator: () => target });
    const socket = await h.connect();
    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();

    await h.poller.sendMessage(PROJECT, "announcement", { threadTs: "" });
    expect(h.posts[0].thread_ts).toBeUndefined();
    await h.poller.stopAll();
  });

  it("falls back to the configured channel before any inbound", async () => {
    const h = makeHarness();
    const result = await h.poller.sendMessage(PROJECT, "hello");
    expect(result.ok).toBe(true);
    expect(h.posts[0]).toMatchObject({ channel: CHANNEL, text: "hello" });
    await h.poller.stopAll();
  });

  it("prefixes the project when another project shares the channel", async () => {
    const h = makeHarness({
      listChannelIdSharers: () => ["proj2"],
      getProjectLabel: () => "Marblo Web",
    });
    await h.poller.sendMessage(PROJECT, "done");
    expect(h.posts[0].text).toBe("[Marblo Web] done");
    await h.poller.stopAll();
  });

  it("reports a Slack application error instead of pretending it sent", async () => {
    const h = makeHarness({
      postResult: () => ({ ok: false, error: "channel_not_found" }),
    });
    const result = await h.poller.sendMessage(PROJECT, "hello");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("channel_not_found");
    expect(h.poller.getReliabilityStats(PROJECT).sendFailures).toBe(1);
    await h.poller.stopAll();
  });

  it("refuses an empty message and a project with no channel", async () => {
    const h = makeHarness({ getDefaultChannelId: () => null });
    expect((await h.poller.sendMessage(PROJECT, "   ")).ok).toBe(false);
    expect((await h.poller.sendMessage(PROJECT, "hi")).error).toContain(
      "no channel available",
    );
    await h.poller.stopAll();
  });

  it("never leaks the bot token in an error", async () => {
    const h = makeHarness({
      postResult: () => ({ ok: false, error: `bad token ${BOT_TOKEN}` }),
    });
    const result = await h.poller.sendMessage(PROJECT, "hello");
    expect(result.error).not.toContain(BOT_TOKEN);
    expect(result.error).toContain("<token>");
    await h.poller.stopAll();
  });
});

describe("SlackPoller — connection lifecycle", () => {
  it("keeps exactly one connection per project", async () => {
    const h = makeHarness();
    await h.connect();
    h.poller.syncActiveChannels(); // idempotent
    h.poller.syncActiveChannels();
    await flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.poller.hasConnection(PROJECT)).toBe(true);
    await h.poller.stopAll();
    expect(h.poller.hasConnection(PROJECT)).toBe(false);
  });

  it("connects only ONE of two projects sharing an app token", async () => {
    // Socket Mode fans every event out to every connection of an app, so two
    // connected projects would both answer the same mention.
    const h = makeHarness({
      listActiveProjectIds: () => ["projB", "projA"],
      getAppToken: () => APP_TOKEN,
    });
    h.poller.syncActiveChannels();
    await flush();
    expect(h.sockets).toHaveLength(1);
    // Deterministic winner across restarts: lexicographically first.
    expect(h.poller.hasConnection("projA")).toBe(true);
    expect(h.poller.hasConnection("projB")).toBe(false);
    await h.poller.stopAll();
  });

  it("stops the connection when the channel goes inactive", async () => {
    let active = [PROJECT];
    const h = makeHarness({ listActiveProjectIds: () => active });
    await h.connect();
    expect(h.poller.hasConnection(PROJECT)).toBe(true);

    active = [];
    h.poller.syncActiveChannels();
    await flush();
    expect(h.poller.hasConnection(PROJECT)).toBe(false);
    await h.poller.stopAll();
  });

  it("restores the pending queue from disk across a restart", async () => {
    const statePath = path.join(stateDir, "state.json");
    const first = makeHarness({
      resolveOrchestrator: () => null,
      statePath,
    });
    const socket = await first.connect();
    socket.emit("message", eventEnvelope("env-1", mentionEvent("1712.0001")));
    await flush();
    expect(first.poller.getPendingInboundCount(PROJECT)).toBe(1);
    await first.poller.stopAll();

    // A new process: the message queued before the crash must still be there.
    const { target, injected } = recordingTarget();
    const second = makeHarness({
      resolveOrchestrator: () => target,
      statePath,
    });
    second.poller.start();
    await flush(20);
    expect(injected).toHaveLength(1);
    expect(second.poller.getPendingInboundCount(PROJECT)).toBe(0);
    await second.poller.stopAll();
  });
});
