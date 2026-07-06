import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  TelegramChannelStore,
  preflightChannel,
  isTelegramChannelActive,
  _setDefaultTelegramChannelStore,
  YOLO_FLAG,
} from "../../electron/telegram-channels";

const GOOD_TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const GOOD_CHAT = "-1001234567890";

/** Isolated tmp store dir + plugin dir + a store rooted there. */
function makeStore(): {
  dir: string;
  pluginDir: string;
  store: TelegramChannelStore;
} {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tg-")),
  );
  // 플러그인 브릿지가 실제 ~/.claude 를 건드리지 않도록 tmp 로 격리 주입.
  const pluginDir = path.join(dir, "plugin");
  return {
    dir,
    pluginDir,
    store: new TelegramChannelStore({ storeDir: dir, pluginDir }),
  };
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

describe("공식 플러그인 config 브릿지 (~/.claude/channels/telegram)", () => {
  let ctx: ReturnType<typeof makeStore>;
  const OWNER = "1584537551";
  beforeEach(() => {
    ctx = makeStore();
  });
  afterEach(() => {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  function readAccess(): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(ctx.store.getPluginAccessPath(), "utf-8"),
    );
  }
  function readEnv(): string {
    return fs.readFileSync(ctx.store.getPluginEnvPath(), "utf-8");
  }

  it("활성 연결 시 .env + access.json 을 생성한다", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(true);
    expect(fs.existsSync(ctx.store.getPluginAccessPath())).toBe(true);
    expect(readEnv()).toContain(`TELEGRAM_BOT_TOKEN=${GOOD_TOKEN}`);
    const access = readAccess();
    expect(access.dmPolicy).toBe("allowlist");
    expect(access.allowFrom).toEqual([OWNER]);
  });

  it(".env·access.json 은 chmod 600, 디렉토리는 700", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    expect(fs.statSync(ctx.store.getPluginEnvPath()).mode & 0o777).toBe(0o600);
    expect(fs.statSync(ctx.store.getPluginAccessPath()).mode & 0o777).toBe(
      0o600,
    );
    expect(fs.statSync(ctx.store.getPluginDir()).mode & 0o777).toBe(0o700);
  });

  it("멱등 — 같은 입력 재저장 시 동일 결과", () => {
    const input = {
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    };
    ctx.store.setConfigFromLocalSettings(input);
    const env1 = readEnv();
    const access1 = readAccess();
    ctx.store.setConfigFromLocalSettings(input);
    expect(readEnv()).toBe(env1);
    expect(readAccess()).toEqual(access1);
  });

  it("비활성화 시 .env 토큰을 제거하고 access 를 disabled 로 중화", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    ctx.store.setConfigFromLocalSettings({ projectId: "p1", enabled: false });
    // .env 는 다른 키가 없으므로 삭제된다(토큰 노출 제거).
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(false);
    const access = readAccess();
    expect(access.dmPolicy).toBe("disabled");
    expect(access.allowFrom).toEqual([]);
  });

  it("삭제(remove) 시 플러그인 토큰 정리", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    ctx.store.remove("p1");
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(false);
  });

  it("access.json 의 소유하지 않는 필드(groups·delivery 옵션)를 보존", () => {
    // 활성화로 파일 생성 후, 플러그인/skill 이 쓴 것처럼 필드를 덧붙인다.
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    const p = ctx.store.getPluginAccessPath();
    const cur = JSON.parse(fs.readFileSync(p, "utf-8"));
    cur.groups = { "-100999": { requireMention: true, allowFrom: [] } };
    cur.ackReaction = "👀";
    fs.writeFileSync(p, JSON.stringify(cur, null, 2));
    // 재저장 — 소유 필드만 갱신되고 나머지는 보존되어야 한다.
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    const after = readAccess();
    expect(after.groups).toEqual({
      "-100999": { requireMention: true, allowFrom: [] },
    });
    expect(after.ackReaction).toBe("👀");
    expect(after.dmPolicy).toBe("allowlist");
  });

  it(".env 의 다른 키는 비활성화해도 보존(토큰만 제거)", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    const envPath = ctx.store.getPluginEnvPath();
    fs.appendFileSync(envPath, "TELEGRAM_ACCESS_MODE=static\n");
    ctx.store.setConfigFromLocalSettings({ projectId: "p1", enabled: false });
    const env = readEnv();
    expect(env).toContain("TELEGRAM_ACCESS_MODE=static");
    expect(env).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("ensurePluginConfig — 파일이 지워져도 저장된 config 로부터 복구", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    fs.rmSync(ctx.store.getPluginDir(), { recursive: true, force: true });
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(false);
    ctx.store.ensurePluginConfig("p1");
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(true);
    expect(readEnv()).toContain(`TELEGRAM_BOT_TOKEN=${GOOD_TOKEN}`);
  });

  it("비활성(chatId 없음) 저장은 플러그인 파일을 만들지 않는다", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: "",
      enabled: true,
    });
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(false);
    expect(fs.existsSync(ctx.store.getPluginAccessPath())).toBe(false);
  });
});

describe("isTelegramChannelActive (스폰 게이팅 신호)", () => {
  // NOTE: 오케스트레이터의 --channels 주입은 제거됐다(폴러는 electron main 소유,
  // ticket vw38IB2VcmOIOlFV51Wa). isTelegramChannelActive 는 이제 telegram-poller
  // 가 "이 프로젝트의 getUpdates 루프를 돌릴지" 판단하는 신호로 쓰인다.
  let ctx: ReturnType<typeof makeStore>;
  beforeEach(() => {
    ctx = makeStore();
    _setDefaultTelegramChannelStore(ctx.store);
  });
  afterEach(() => {
    _setDefaultTelegramChannelStore(null);
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("활성 채널(enabled+프리플라이트 통과)이면 true", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    expect(isTelegramChannelActive("p1")).toBe(true);
  });

  it("비활성/미설정이면 false", () => {
    expect(isTelegramChannelActive("nope")).toBe(false);
  });

  it("YOLO_FLAG 상수는 권한 스킵 플래그다", () => {
    expect(YOLO_FLAG).toBe("--dangerously-skip-permissions");
  });
});
