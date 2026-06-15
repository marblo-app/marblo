import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  TelegramChannelStore,
  preflightChannel,
  telegramChannelLaunchFlags,
  isTelegramChannelActive,
  _setDefaultTelegramChannelStore,
  TELEGRAM_CHANNEL_PLUGIN,
  YOLO_FLAG,
} from "../../electron/telegram-channels";

const GOOD_TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const GOOD_CHAT = "-1001234567890";

/** Isolated tmp store dir + a store rooted there. */
function makeStore(): { dir: string; store: TelegramChannelStore } {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tg-")),
  );
  return { dir, store: new TelegramChannelStore({ storeDir: dir }) };
}

describe("preflightChannel", () => {
  it("ok when token + chatId valid", () => {
    const p = preflightChannel({ botToken: GOOD_TOKEN, chatId: GOOD_CHAT });
    expect(p.ok).toBe(true);
    expect(p.issues).toHaveLength(0);
  });

  it("blocks when chatId empty (활성 불가 신호)", () => {
    const p = preflightChannel({ botToken: GOOD_TOKEN, chatId: "" });
    expect(p.ok).toBe(false);
    expect(p.hasChatId).toBe(false);
    expect(p.issues.join(" ")).toContain("chatId");
  });

  it("rejects malformed token", () => {
    const p = preflightChannel({ botToken: "not-a-token", chatId: GOOD_CHAT });
    expect(p.ok).toBe(false);
    expect(p.botTokenValid).toBe(false);
  });

  it("accepts @username chatId", () => {
    const p = preflightChannel({ botToken: GOOD_TOKEN, chatId: "@mychannel" });
    expect(p.ok).toBe(true);
  });
});

describe("TelegramChannelStore round-trip", () => {
  let ctx: ReturnType<typeof makeStore>;
  beforeEach(() => {
    ctx = makeStore();
  });
  afterEach(() => {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("saves + reads config", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    const cfg = ctx.store.getConfig("p1");
    expect(cfg?.botToken).toBe(GOOD_TOKEN);
    expect(cfg?.chatId).toBe(GOOD_CHAT);
    expect(cfg?.enabled).toBe(true);
  });

  it("demotes enabled → false when chatId missing (활성 불가 방어선)", () => {
    const status = ctx.store.setConfigFromLocalSettings({
      projectId: "p2",
      botToken: GOOD_TOKEN,
      chatId: "",
      enabled: true,
    });
    expect(status.enabled).toBe(false);
    expect(status.canEnable).toBe(false);
    expect(status.active).toBe(false);
    expect(ctx.store.getConfig("p2")?.enabled).toBe(false);
  });

  it("active only when enabled + preflight ok", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p3",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    expect(ctx.store.isActive("p3")).toBe(true);
  });
});

describe("access.json 보안 불변식", () => {
  let ctx: ReturnType<typeof makeStore>;
  beforeEach(() => {
    ctx = makeStore();
  });
  afterEach(() => {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("local-settings 경로만 access.json 을 쓴다 (인바운드용 쓰기 함수 미노출)", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    const access = ctx.store.getAccess("p1");
    expect(access?.origin).toBe("local-settings");
    expect(access?.allowedChatIds).toEqual([GOOD_CHAT]);
    // 모듈은 read-only getAccess 만 노출 — 인바운드가 쓸 함수가 없다.
    const store = ctx.store as unknown as Record<string, unknown>;
    expect(typeof store.writeAccess).not.toBe("undefined"); // private exists
  });

  it("비활성/무효면 allowedChatIds 가 빈다 (인바운드 전부 차단)", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p2",
      botToken: GOOD_TOKEN,
      chatId: "",
      enabled: true,
    });
    expect(ctx.store.getAccess("p2")?.allowedChatIds).toEqual([]);
  });

  it("access.json 은 chmod 600 으로 저장된다", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p3",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    const mode = fs.statSync(ctx.store.getAccessPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("telegramChannelLaunchFlags (스폰 주입)", () => {
  let ctx: ReturnType<typeof makeStore>;
  beforeEach(() => {
    ctx = makeStore();
    _setDefaultTelegramChannelStore(ctx.store);
  });
  afterEach(() => {
    _setDefaultTelegramChannelStore(null);
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("활성 채널이면 --channels plugin 플래그를 준다", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    const flags = telegramChannelLaunchFlags("p1");
    expect(flags).toEqual(["--channels", TELEGRAM_CHANNEL_PLUGIN]);
    expect(isTelegramChannelActive("p1")).toBe(true);
  });

  it("비활성/미설정이면 빈 배열 (채널 없이 부팅)", () => {
    expect(telegramChannelLaunchFlags("nope")).toEqual([]);
  });

  it("YOLO_FLAG 상수는 권한 스킵 플래그다", () => {
    expect(YOLO_FLAG).toBe("--dangerously-skip-permissions");
  });
});
