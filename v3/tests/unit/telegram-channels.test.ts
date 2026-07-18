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

describe("플러그인 config 정리 — 브릿지 제거 (티켓 kYC4pGM7S4k6967qs8uO)", () => {
  // 과거 빌드는 활성 채널의 봇 토큰을 ~/.claude/channels/telegram/.env 로
  // 실체화했고, 그 토큰으로 외부 claude/Cursor 플러그인 폴러가 부팅해 electron
  // main 폴러의 getUpdates 를 409 로 강탈했다. 이제 토큰은 절대 실체화되지
  // 않고, 남아 있던 실체화는 저장/삭제/기동 시 제거된다.
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
  /** 과거 빌드가 실체화해 둔 것처럼 플러그인 파일을 만들어 둔다. */
  function seedLegacyMaterialization(extraEnv = ""): void {
    fs.mkdirSync(ctx.store.getPluginDir(), { recursive: true });
    fs.writeFileSync(
      ctx.store.getPluginEnvPath(),
      `TELEGRAM_BOT_TOKEN=${GOOD_TOKEN}\n${extraEnv}`,
    );
    fs.writeFileSync(
      ctx.store.getPluginAccessPath(),
      JSON.stringify({
        dmPolicy: "allowlist",
        allowFrom: [OWNER],
        groups: { "-100999": { requireMention: true, allowFrom: [] } },
        pending: {},
        ackReaction: "👀",
      }),
    );
  }

  it("★활성 저장해도 봇 토큰을 플러그인 디렉토리에 실체화하지 않는다", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(false);
    expect(fs.existsSync(ctx.store.getPluginAccessPath())).toBe(false);
    // 마블로 store 쪽 채널은 정상 활성이다(폴러는 electron main 이 소유).
    expect(ctx.store.isActive("p1")).toBe(true);
  });

  it("과거 실체화된 토큰은 저장 시 제거되고 access 는 중화된다", () => {
    seedLegacyMaterialization();
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    // 토큰만 있던 .env 는 파일째 삭제된다.
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(false);
    const access = readAccess();
    expect(access.dmPolicy).toBe("disabled");
    expect(access.allowFrom).toEqual([]);
    // 소유하지 않는 필드는 보존.
    expect(access.groups).toEqual({
      "-100999": { requireMention: true, allowFrom: [] },
    });
    expect(access.ackReaction).toBe("👀");
  });

  it(".env 의 다른 키는 보존하고 토큰만 제거한다", () => {
    seedLegacyMaterialization("TELEGRAM_ACCESS_MODE=static\n");
    ctx.store.neutralizePluginConfig();
    const env = readEnv();
    expect(env).toContain("TELEGRAM_ACCESS_MODE=static");
    expect(env).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("neutralizePluginConfig 는 실제 토큰 제거 여부를 보고한다(멱등)", () => {
    seedLegacyMaterialization();
    expect(ctx.store.neutralizePluginConfig().tokenRemoved).toBe(true);
    expect(ctx.store.neutralizePluginConfig().tokenRemoved).toBe(false);
  });

  it("플러그인 파일이 아예 없으면 no-op — 새로 만들지 않는다", () => {
    expect(ctx.store.neutralizePluginConfig().tokenRemoved).toBe(false);
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(false);
    expect(fs.existsSync(ctx.store.getPluginAccessPath())).toBe(false);
  });

  it("삭제(remove) 시에도 플러그인 토큰 정리", () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: OWNER,
      enabled: true,
    });
    seedLegacyMaterialization();
    ctx.store.remove("p1");
    expect(fs.existsSync(ctx.store.getPluginEnvPath())).toBe(false);
  });
});

describe("토큰 소유권 규칙 — 1 봇 = 1 프로젝트 (getUpdates 단일 소비자)", () => {
  const TOKEN_B = "987654321:BBHfakeOtherBotTokenForTests_ijklMNOP";
  let ctx: ReturnType<typeof makeStore>;
  beforeEach(() => {
    ctx = makeStore();
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
  });
  afterEach(() => {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("★다른 활성 프로젝트가 쓰는 토큰으로는 활성화가 강등 차단된다", () => {
    const status = ctx.store.setConfigFromLocalSettings({
      projectId: "p2",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    expect(status.enabled).toBe(false);
    expect(status.canEnable).toBe(false);
    expect(status.active).toBe(false);
    expect(status.preflight.issues.join(" ")).toContain("p1");
    // 기존 소유자 p1 은 계속 활성.
    expect(ctx.store.isActive("p1")).toBe(true);
    // 인바운드 화이트리스트도 비어 있다(비활성이므로 전부 차단).
    expect(ctx.store.getAccess("p2")?.allowedChatIds).toEqual([]);
  });

  it("서로 다른 토큰이면 두 프로젝트 모두 활성 가능", () => {
    const status = ctx.store.setConfigFromLocalSettings({
      projectId: "p2",
      botToken: TOKEN_B,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    expect(status.enabled).toBe(true);
    expect(ctx.store.isActive("p1")).toBe(true);
    expect(ctx.store.isActive("p2")).toBe(true);
  });

  it("기존 소유자가 비활성화되면 같은 토큰으로 활성화 가능", () => {
    ctx.store.setConfigFromLocalSettings({ projectId: "p1", enabled: false });
    const status = ctx.store.setConfigFromLocalSettings({
      projectId: "p2",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    expect(status.enabled).toBe(true);
    expect(ctx.store.isActive("p2")).toBe(true);
  });

  it("findTokenConflicts — 자기 자신과 비활성 프로젝트는 충돌이 아니다", () => {
    expect(ctx.store.findTokenConflicts("p1", GOOD_TOKEN)).toEqual([]);
    expect(ctx.store.findTokenConflicts("p2", GOOD_TOKEN)).toEqual(["p1"]);
    expect(ctx.store.findTokenConflicts("p2", TOKEN_B)).toEqual([]);
    expect(ctx.store.findTokenConflicts("p2", null)).toEqual([]);
  });

  it("레거시로 이미 둘 다 활성인 경우: 상태에 충돌을 표시하되 active 는 유지(승자 선정은 폴러 dedup 몫)", () => {
    // 설정 경로를 우회해 config 파일을 직접 조작(과거 데이터 재현).
    const raw = JSON.parse(
      fs.readFileSync(ctx.store.getConfigPath(), "utf-8"),
    );
    raw.p2 = { ...raw.p1, projectId: "p2" };
    fs.writeFileSync(ctx.store.getConfigPath(), JSON.stringify(raw));
    const s1 = ctx.store.getStatus("p1");
    const s2 = ctx.store.getStatus("p2");
    expect(s1.canEnable).toBe(false);
    expect(s2.canEnable).toBe(false);
    expect(s1.preflight.issues.join(" ")).toContain("p2");
    expect(s1.active).toBe(true);
    expect(s2.active).toBe(true);
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
