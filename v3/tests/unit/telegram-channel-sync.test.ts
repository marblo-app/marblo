import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  TelegramChannelStore,
  _setDefaultTelegramChannelStore,
  type RemoteTelegramChannelMeta,
} from "../../electron/telegram-channels";
import {
  pullTelegramChannelMeta,
  pushTelegramChannelMetaAll,
  pushTelegramChannelMetaOne,
  syncTelegramChannelMeta,
  getTelegramProjectLabel,
  _setTelegramProjectLabels,
  type RemoteProjectDoc,
  type TelegramMetaRemote,
} from "../../electron/telegram-channel-sync";

const GOOD_TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const GOOD_CHAT = "-1001234567890";

/** 격리된 tmp 스토어를 만들어 기본 싱글톤으로 주입한다. */
function makeIsolatedStore(): { dir: string; store: TelegramChannelStore } {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tgs-")),
  );
  const store = new TelegramChannelStore({
    storeDir: dir,
    pluginDir: path.join(dir, "plugin"),
  });
  _setDefaultTelegramChannelStore(store);
  return { dir, store };
}

/** 호출을 기록하는 가짜 원격 게이트웨이. */
function makeRemote(projects: RemoteProjectDoc[]): {
  remote: TelegramMetaRemote;
  writes: Array<{
    projectId: string;
    meta: RemoteTelegramChannelMeta | null;
  }>;
} {
  const writes: Array<{
    projectId: string;
    meta: RemoteTelegramChannelMeta | null;
  }> = [];
  return {
    writes,
    remote: {
      listMyProjects: async () => projects,
      writeChannelMeta: async (projectId, meta) => {
        writes.push({ projectId, meta });
      },
    },
  };
}

function remoteMeta(
  over: Partial<RemoteTelegramChannelMeta> = {},
): RemoteTelegramChannelMeta {
  return {
    chatId: GOOD_CHAT,
    enabled: true,
    inboundCapability: "trigger",
    hasBotToken: true,
    updatedAt: 1_000,
    ...over,
  };
}

let ctx: { dir: string; store: TelegramChannelStore };
beforeEach(() => {
  ctx = makeIsolatedStore();
  _setTelegramProjectLabels(null);
});
afterEach(() => {
  _setDefaultTelegramChannelStore(null);
  _setTelegramProjectLabels(null);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

describe("pullTelegramChannelMeta — 새 기기에서 채널 메타 복원", () => {
  it("원격 메타를 로컬에 복원하고 프로젝트 이름을 라벨 캐시에 채운다", async () => {
    const { remote } = makeRemote([
      {
        projectId: "p1",
        name: "Marblo",
        telegramChannel: remoteMeta(),
      },
      { projectId: "p2", name: "NoChannel", telegramChannel: null },
    ]);
    const restored = await pullTelegramChannelMeta(remote);
    expect(restored).toBe(1);
    const cfg = ctx.store.getConfig("p1");
    expect(cfg?.chatId).toBe(GOOD_CHAT);
    expect(cfg?.botToken).toBeNull();
    expect(cfg?.enabled).toBe(false);
    expect(cfg?.restoredFromSync).toBe(true);
    expect(getTelegramProjectLabel("p1")).toBe("Marblo");
    expect(getTelegramProjectLabel("p2")).toBe("NoChannel");
    expect(ctx.store.getConfig("p2")).toBeNull();
  });

  it("로컬 레코드가 있는 프로젝트는 건드리지 않는다 (로컬 승리)", async () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    const { remote } = makeRemote([
      {
        projectId: "p1",
        name: "Marblo",
        telegramChannel: remoteMeta({ chatId: "999999", updatedAt: 9e12 }),
      },
    ]);
    const restored = await pullTelegramChannelMeta(remote);
    expect(restored).toBe(0);
    expect(ctx.store.getConfig("p1")?.chatId).toBe(GOOD_CHAT);
    expect(ctx.store.getConfig("p1")?.enabled).toBe(true);
  });
});

describe("pushTelegramChannelMetaAll — 기존 채널 자동 업로드(리컨사일)", () => {
  it("원격이 없거나 오래된 프로젝트만 push 하고 토큰은 싣지 않는다", async () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    ctx.store.setConfigFromLocalSettings({
      projectId: "p2",
      botToken: GOOD_TOKEN.replace("123456789", "987654321"),
      chatId: "12345",
      enabled: false,
    });
    const localP2 = ctx.store.getConfig("p2")!;
    const { remote, writes } = makeRemote([
      { projectId: "p1", name: null, telegramChannel: null }, // 원격 없음 → push
      {
        projectId: "p2",
        name: null,
        // 원격이 로컬보다 최신 → skip
        telegramChannel: remoteMeta({ updatedAt: localP2.updatedAt + 10_000 }),
      },
    ]);
    const pushed = await pushTelegramChannelMetaAll(remote, "machine-A");
    expect(pushed).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].projectId).toBe("p1");
    expect(writes[0].meta?.hasBotToken).toBe(true);
    expect(writes[0].meta?.updatedByMachineId).toBe("machine-A");
    expect(JSON.stringify(writes)).not.toContain(GOOD_TOKEN);
  });

  it("복원 대기(토큰 없음) 레코드는 push 하지 않는다 — 권위자는 토큰 보유 기기", async () => {
    ctx.store.applyRemoteMeta("p1", remoteMeta());
    const { remote, writes } = makeRemote([
      { projectId: "p1", name: null, telegramChannel: null },
    ]);
    const pushed = await pushTelegramChannelMetaAll(remote);
    expect(pushed).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("내가 멤버가 아닌 프로젝트에는 쓰지 않는다", async () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "foreign",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    const { remote, writes } = makeRemote([]); // 내 프로젝트 목록에 없음
    const pushed = await pushTelegramChannelMetaAll(remote);
    expect(pushed).toBe(0);
    expect(writes).toHaveLength(0);
  });
});

describe("pushTelegramChannelMetaOne — 저장/삭제 직후 단건 push", () => {
  it("채널 제거 후에는 원격 필드 삭제(null)를 전파한다 (좀비 복원 방지)", async () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    ctx.store.remove("p1");
    const { remote, writes } = makeRemote([]);
    await pushTelegramChannelMetaOne("p1", "machine-A", remote);
    expect(writes).toEqual([{ projectId: "p1", meta: null }]);
  });

  it("원격 쓰기 실패는 삼킨다 (fail-soft — 로컬 채널에 영향 없음)", async () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    const throwing: TelegramMetaRemote = {
      listMyProjects: async () => [],
      writeChannelMeta: async () => {
        throw new Error("permission-denied");
      },
    };
    await expect(
      pushTelegramChannelMetaOne("p1", undefined, throwing),
    ).resolves.toBeUndefined();
  });
});

describe("syncTelegramChannelMeta — 전체 동기화 fail-soft", () => {
  it("pull 실패해도 push 는 시도하고, 어떤 실패도 던지지 않는다", async () => {
    ctx.store.setConfigFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    let listCalls = 0;
    const flaky: TelegramMetaRemote = {
      listMyProjects: async () => {
        listCalls += 1;
        if (listCalls === 1) throw new Error("network down"); // pull 실패
        return [{ projectId: "p1", name: "Marblo", telegramChannel: null }];
      },
      writeChannelMeta: async () => {},
    };
    const result = await syncTelegramChannelMeta("machine-A", flaky);
    expect(result.restored).toBe(0);
    expect(result.pushed).toBe(1);
  });

  it("복원과 push 리컨사일이 한 번에 돈다 (신규 기기 시나리오)", async () => {
    const { remote } = makeRemote([
      { projectId: "p1", name: "Marblo", telegramChannel: remoteMeta() },
    ]);
    const result = await syncTelegramChannelMeta(undefined, remote);
    expect(result.restored).toBe(1);
    // 방금 복원된(토큰 없는) 레코드는 되밀지 않는다.
    expect(result.pushed).toBe(0);
  });
});
