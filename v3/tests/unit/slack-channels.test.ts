import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SlackAccessViolationError,
  SlackChannelStore,
  preflightSlackChannel,
} from "../../electron/slack-channels";
import * as slackChannels from "../../electron/slack-channels";

const BOT = "xoxb-1111111111-2222222222-abcdefghijklmnop";
const BOT2 = "xoxb-9999999999-8888888888-ponmlkjihgfedcba";
const APP = "xapp-1-A01234567-1234567890-abcdefghijklmnopqrstuvwxyz";
const APP2 = "xapp-1-B76543210-0987654321-zyxwvutsrqponmlkjihgfedc";
const CHANNEL = "C0123ABCDEF";
const OTHER_CHANNEL = "C0456GHIJKL";

let storeDir: string;
let store: SlackChannelStore;

beforeEach(() => {
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-channels-"));
  store = new SlackChannelStore({ storeDir });
});

afterEach(() => {
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe("preflightSlackChannel", () => {
  it("passes with a well-formed bot token, app token and channel id", () => {
    const pre = preflightSlackChannel({
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
    });
    expect(pre.ok).toBe(true);
    expect(pre.issues).toEqual([]);
  });

  it("fails and explains when the app token is missing", () => {
    const pre = preflightSlackChannel({
      botToken: BOT,
      appToken: null,
      channelId: CHANNEL,
    });
    expect(pre.ok).toBe(false);
    expect(pre.hasAppToken).toBe(false);
    expect(pre.issues.join(" ")).toContain("xapp");
  });

  it("rejects a bot token pasted into the app token field", () => {
    // The most likely configuration mistake: Slack shows both tokens on one page.
    const pre = preflightSlackChannel({
      botToken: BOT,
      appToken: BOT,
      channelId: CHANNEL,
    });
    expect(pre.ok).toBe(false);
    expect(pre.appTokenValid).toBe(false);
  });

  it("rejects a channel NAME where a channel id is required", () => {
    const pre = preflightSlackChannel({
      botToken: BOT,
      appToken: APP,
      channelId: "#general",
    });
    expect(pre.ok).toBe(false);
    expect(pre.channelIdValid).toBe(false);
  });
});

describe("SlackChannelStore — local settings write path", () => {
  it("saves a complete config and reports it active", () => {
    const status = store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    expect(status.canEnable).toBe(true);
    expect(status.active).toBe(true);
    expect(store.isActive("p1")).toBe(true);

    const cfg = store.getConfig("p1");
    expect(cfg?.botToken).toBe(BOT);
    expect(cfg?.appToken).toBe(APP);
    expect(cfg?.channelId).toBe(CHANNEL);
  });

  it("demotes enabled to false when the preflight fails (defensive)", () => {
    const status = store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: null,
      channelId: CHANNEL,
      enabled: true, // requested, but not achievable
    });
    expect(status.enabled).toBe(false);
    expect(status.active).toBe(false);
    expect(store.getConfig("p1")?.enabled).toBe(false);
  });

  it("merges partial input instead of clearing unspecified fields", () => {
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    // Change only the channel — the tokens must survive untouched.
    store.setConfigFromLocalSettings({
      projectId: "p1",
      channelId: OTHER_CHANNEL,
    });
    const cfg = store.getConfig("p1");
    expect(cfg?.botToken).toBe(BOT);
    expect(cfg?.appToken).toBe(APP);
    expect(cfg?.channelId).toBe(OTHER_CHANNEL);
  });

  it("keeps secrets out of the status object handed to the renderer", () => {
    const status = store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(BOT);
    expect(serialized).not.toContain(APP);
    expect(status.hasBotToken).toBe(true);
    expect(status.hasAppToken).toBe(true);
  });

  it("writes the config and access files owner-only (0600)", () => {
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    for (const file of [store.getConfigPath(), store.getAccessPath()]) {
      const mode = fs.statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("removes the config and its access record together", () => {
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    expect(store.remove("p1")).toBe(true);
    expect(store.getConfig("p1")).toBeNull();
    expect(store.getAccess("p1")).toBeNull();
    expect(store.remove("p1")).toBe(false);
  });
});

describe("SlackChannelStore — access (permission) invariants", () => {
  it("whitelists exactly the enabled channel and nothing else", () => {
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    const access = store.getAccess("p1");
    expect(access?.allowedChannelIds).toEqual([CHANNEL]);
    expect(access?.origin).toBe("local-settings");
  });

  it("empties the whitelist when the channel is disabled", () => {
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    store.setConfigFromLocalSettings({ projectId: "p1", enabled: false });
    expect(store.getAccess("p1")?.allowedChannelIds).toEqual([]);
  });

  it("rejects an access write that did not come from local settings", () => {
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    // `private` is erased at runtime, so the origin guard — not the TS
    // modifier — is what actually stops an inbound path that reached this
    // method. Prove the guard fires and the file is left untouched.
    const escalate = () =>
      (
        store as unknown as {
          writeAccess(access: unknown, origin: string): void;
        }
      ).writeAccess(
        {
          projectId: "p1",
          allowedChannelIds: ["C_ATTACKER"],
          inboundCapability: "trigger",
          origin: "slack-inbound",
          updatedAt: Date.now(),
        },
        "slack-inbound",
      );
    expect(escalate).toThrow(SlackAccessViolationError);
    expect(store.getAccess("p1")?.allowedChannelIds).toEqual([CHANNEL]);
  });

  it("exports no permission-write function (inbound can only read)", () => {
    // The structural half of the invariant: slack-poller can only import a
    // getter, so it has nothing to call even by mistake.
    const exported = Object.keys(slackChannels);
    expect(exported).toContain("getSlackChannelAccess");
    expect(
      exported.filter(
        (name) => /Access/.test(name) && /^set|^write/.test(name),
      ),
    ).toEqual([]);
  });
});

describe("SlackChannelStore — one Slack app per project", () => {
  it("blocks enabling a second project on the same app token", () => {
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    // Socket Mode fans every event out to every connection of an app, so a
    // second project on the same app token would double-answer.
    const status = store.setConfigFromLocalSettings({
      projectId: "p2",
      botToken: BOT2,
      appToken: APP,
      channelId: OTHER_CHANNEL,
      enabled: true,
    });
    expect(status.enabled).toBe(false);
    expect(status.canEnable).toBe(false);
    expect(status.preflight.issues.join(" ")).toContain("app token");
    expect(store.findAppTokenConflicts("p2", APP)).toEqual(["p1"]);
  });

  it("allows two projects that each have their own Slack app", () => {
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    const status = store.setConfigFromLocalSettings({
      projectId: "p2",
      botToken: BOT2,
      appToken: APP2,
      channelId: OTHER_CHANNEL,
      enabled: true,
    });
    expect(status.active).toBe(true);
  });

  it("flags (but does not block) two projects sharing one channel", () => {
    store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: BOT,
      appToken: APP,
      channelId: CHANNEL,
      enabled: true,
    });
    const status = store.setConfigFromLocalSettings({
      projectId: "p2",
      botToken: BOT2,
      appToken: APP2,
      channelId: CHANNEL,
      enabled: true,
    });
    // Legal pattern (one team channel, two projects) — the poller disambiguates
    // outbound with a [project] prefix instead of refusing the config.
    expect(status.active).toBe(true);
    expect(status.preflight.issues.join(" ")).toContain("접두");
    expect(store.listChannelIdSharers("p2", CHANNEL)).toEqual(["p1"]);
  });
});

describe("SlackChannelStore — read robustness", () => {
  it("returns empty state for a missing store rather than throwing", () => {
    expect(store.getConfig("nope")).toBeNull();
    expect(store.listConfigs()).toEqual([]);
    expect(store.getAccess("nope")).toBeNull();
    expect(store.getStatus("nope").active).toBe(false);
  });

  it("survives a corrupt store file", () => {
    fs.writeFileSync(store.getConfigPath(), "{not json", "utf-8");
    expect(store.listConfigs()).toEqual([]);
    expect(store.getStatus("p1").canEnable).toBe(false);
  });

  it("ignores a store entry whose secret shape is unexpected", () => {
    fs.writeFileSync(
      store.getConfigPath(),
      JSON.stringify({
        p1: {
          botToken: "raw-string-not-an-envelope",
          appToken: null,
          channelId: CHANNEL,
          enabled: true,
        },
      }),
      "utf-8",
    );
    const cfg = store.getConfig("p1");
    expect(cfg?.botToken).toBeNull();
    // …and with no usable token the channel cannot be active.
    expect(store.isActive("p1")).toBe(false);
  });
});
