import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  probeAndHealTelegramWebhook,
  runTelegramChannelHealthCheck,
} from "../../electron/telegram-health";
import {
  TelegramChannelStore,
  _setDefaultTelegramChannelStore,
} from "../../electron/telegram-channels";

const TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const GOOD_CHAT = "-1001234567890";

/** Build a fake fetch that maps api method → JSON response, recording calls. */
function makeFetch(responses: Record<string, unknown>): {
  fetchImpl: (url: string, init?: unknown) => Promise<Response>;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    // Extract the bot API method (…/bot<token>/<method>).
    const method = url.split("/").pop() ?? "";
    calls.push(method);
    const body = responses[method] ?? { ok: false, description: "no stub" };
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response;
  };
  return { fetchImpl, calls };
}

describe("probeAndHealTelegramWebhook", () => {
  it("healthy poller (no webhook) → not set, no delete, count parsed", async () => {
    const { fetchImpl, calls } = makeFetch({
      getWebhookInfo: {
        ok: true,
        result: { url: "", pending_update_count: 0 },
      },
    });
    const h = await probeAndHealTelegramWebhook(TOKEN, { fetchImpl });
    expect(h.ok).toBe(true);
    expect(h.webhookWasSet).toBe(false);
    expect(h.webhookCleared).toBe(false);
    expect(h.pendingUpdateCount).toBe(0);
    expect(calls).toEqual(["getWebhookInfo"]);
  });

  it("webhook set → deleteWebhook called and cleared", async () => {
    const { fetchImpl, calls } = makeFetch({
      getWebhookInfo: {
        ok: true,
        result: { url: "https://evil.example/hook", pending_update_count: 12 },
      },
      deleteWebhook: { ok: true, result: true },
    });
    const h = await probeAndHealTelegramWebhook(TOKEN, { fetchImpl });
    expect(h.webhookWasSet).toBe(true);
    expect(h.webhookCleared).toBe(true);
    expect(h.pendingUpdateCount).toBe(12);
    expect(calls).toEqual(["getWebhookInfo", "deleteWebhook"]);
  });

  it("webhook set but deleteIfSet=false → detected, NOT deleted", async () => {
    const { fetchImpl, calls } = makeFetch({
      getWebhookInfo: {
        ok: true,
        result: { url: "https://evil.example/hook", pending_update_count: 3 },
      },
    });
    const h = await probeAndHealTelegramWebhook(TOKEN, {
      fetchImpl,
      deleteIfSet: false,
    });
    expect(h.webhookWasSet).toBe(true);
    expect(h.webhookCleared).toBe(false);
    expect(calls).toEqual(["getWebhookInfo"]);
  });

  it("network error → ok:false, never throws, no token leak in error", async () => {
    const fetchImpl = async () => {
      throw new Error(
        `ECONNRESET talking to https://api.telegram.org/bot${TOKEN}/getWebhookInfo`,
      );
    };
    const h = await probeAndHealTelegramWebhook(TOKEN, { fetchImpl });
    expect(h.ok).toBe(false);
    expect(h.error).toBeTruthy();
    expect(h.error).not.toContain(TOKEN);
  });

  it("telegram API error payload (ok:false) → ok:false, no delete attempted", async () => {
    const { fetchImpl, calls } = makeFetch({
      getWebhookInfo: { ok: false, description: "Unauthorized" },
    });
    const h = await probeAndHealTelegramWebhook(TOKEN, { fetchImpl });
    expect(h.ok).toBe(false);
    expect(calls).toEqual(["getWebhookInfo"]);
  });

  it("empty/whitespace token → ok:false, no fetch attempted", async () => {
    const fetchImpl = vi.fn();
    const h = await probeAndHealTelegramWebhook("   ", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(h.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never surfaces the bot token in the returned health object", async () => {
    const { fetchImpl } = makeFetch({
      getWebhookInfo: {
        ok: true,
        result: { url: "https://x/y", pending_update_count: 1 },
      },
      deleteWebhook: { ok: true, result: true },
    });
    const h = await probeAndHealTelegramWebhook(TOKEN, { fetchImpl });
    expect(JSON.stringify(h)).not.toContain(TOKEN);
  });
});

describe("runTelegramChannelHealthCheck (channel iteration)", () => {
  afterEach(() => {
    _setDefaultTelegramChannelStore(null);
  });

  function seedActiveChannel(): string {
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tgh-")),
    );
    const store = new TelegramChannelStore({
      storeDir: dir,
      pluginDir: path.join(dir, "plugin"),
    });
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    _setDefaultTelegramChannelStore(store);
    return dir;
  }

  it("no active channels → empty, no probe", async () => {
    _setDefaultTelegramChannelStore(
      new TelegramChannelStore({
        storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tgh-empty-")),
        pluginDir: fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tgh-pl-")),
      }),
    );
    const fetchImpl = vi.fn();
    const reports = await runTelegramChannelHealthCheck("wake", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(reports).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("active channel with stray webhook → heals + reports via onReport", async () => {
    const dir = seedActiveChannel();
    try {
      const seen: string[] = [];
      const fetchImpl = (async (url: string) => {
        const method = url.split("/").pop() ?? "";
        seen.push(method);
        const body =
          method === "getWebhookInfo"
            ? {
                ok: true,
                result: { url: "https://x/hook", pending_update_count: 5 },
              }
            : { ok: true, result: true };
        return {
          ok: true,
          status: 200,
          json: async () => body,
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const reports: string[] = [];
      const out = await runTelegramChannelHealthCheck("interval", {
        fetchImpl,
        onReport: (r) => reports.push(r.projectId),
      });
      expect(out).toHaveLength(1);
      expect(out[0].projectId).toBe("p1");
      expect(out[0].health.webhookCleared).toBe(true);
      expect(seen).toEqual(["getWebhookInfo", "deleteWebhook"]);
      expect(reports).toEqual(["p1"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
