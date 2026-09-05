/**
 * 기기 귀속 (티켓 t5X4CUwr4LqbEZNRpeEZ) — A 기기에서 인증한 것이 B 기기로
 * 조용히 넘어가지 않는다.
 *
 * ★이 스위트가 고정하는 세 가지가 티켓의 검증 요구다:
 *   1. 기기 A 인증 → 기기 B 에서 열면 자동 활성화되지 않고, 사실이 화면에 뜬다.
 *   2. 귀속 기록이 없는 기존 채널은 계속 동작한다(마이그레이션 무회귀).
 *   3. 귀속 검사가 예외를 던져도 폴링은 막히지 않는다(fail-open, #1419 규율).
 *
 * ★막지 못하는 것은 테스트할 수 없다는 사실도 여기 적어 둔다: 다른 맥이
 * api.telegram.org 를 직접 부르는 것은 우리 코드도 firestore.rules 도 관여하지
 * 않는 경로다(2026-09-05 사고가 그것이었다). 이 스위트는 "자동 계승 차단 ·
 * 사실 표시 · 탐지"만 고정한다 — 차단을 고정하지 않는다.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  TelegramChannelStore,
  _setDefaultTelegramChannelStore,
  setTelegramBindingObserver,
  getTelegramChannelStatus,
  setTelegramChannelFromLocalSettings,
  isTelegramChannelActive,
  applyRemoteTelegramChannelMeta,
  type TelegramBindingObserver,
} from "../../electron/telegram-channels";
import {
  buildTelegramChannelBinding,
  classifyTelegramBinding,
  parseTelegramChannelBinding,
  type TelegramChannelBinding,
} from "../../electron/telegram-channel-binding";
import { telegramLeaseTokenHash } from "../../electron/telegram-poller-lease";

const GOOD_TOKEN = "123456789:AAHfakeBotTokenForTestsOnly_abcdEFGH";
const OTHER_TOKEN = "987654321:BBHdifferentFakeTokenForTests_zyxwVU";
const GOOD_CHAT = "-1001234567890";

const MACHINE_A = "machine-a-macbookpro";
const MACHINE_B = "machine-b-macmini";

function makeIsolatedStore(): { dir: string; store: TelegramChannelStore } {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tgb-")),
  );
  const store = new TelegramChannelStore({
    storeDir: dir,
    pluginDir: path.join(dir, "plugin"),
  });
  _setDefaultTelegramChannelStore(store);
  return { dir, store };
}

/** 기기 A 가 GOOD_TOKEN 으로 인증했다는 귀속 사실. */
function bindingOfA(over: Partial<TelegramChannelBinding> = {}) {
  return buildTelegramChannelBinding({
    machineId: MACHINE_A,
    hostLabel: "Dongwon-MacBookPro",
    botToken: GOOD_TOKEN,
    boundByUid: "uid-owner",
    now: 1_000,
    ...over,
  });
}

/**
 * 관측자 주입 헬퍼. observed 가 던지도록도 만들 수 있다 — fail-open 검증용.
 */
function installObserver(opts: {
  machineId: string;
  observed?: TelegramChannelBinding | null;
  throws?: boolean;
}): void {
  const observer: TelegramBindingObserver = {
    machineId: () => opts.machineId,
    observed: () => {
      if (opts.throws) throw new Error("firestore unavailable");
      return opts.observed;
    },
  };
  setTelegramBindingObserver(observer);
}

let ctx: { dir: string; store: TelegramChannelStore };
beforeEach(() => {
  ctx = makeIsolatedStore();
  setTelegramBindingObserver(null);
});
afterEach(() => {
  _setDefaultTelegramChannelStore(null);
  setTelegramBindingObserver(null);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
describe("판정 (순수 로직)", () => {
  it("같은 machineId 면 own — 아무것도 막지 않는다", () => {
    const d = classifyTelegramBinding(bindingOfA(), MACHINE_A, GOOD_TOKEN);
    expect(d.verdict).toBe("own");
    expect(d.autoEnableAllowed).toBe(true);
    expect(d.notice).toBeNull();
  });

  it("다른 machineId + 같은 봇이면 foreign — 자동 활성만 막고 문구를 준다", () => {
    const d = classifyTelegramBinding(bindingOfA(), MACHINE_B, GOOD_TOKEN);
    expect(d.verdict).toBe("foreign");
    expect(d.autoEnableAllowed).toBe(false);
    // ★문구는 두 가지를 함께 말해야 한다: 토큰 재입력이 필요하다는 것과,
    //   그렇게 하면 앞 기기가 잃는다는 것(봇당 수신자는 하나다).
    expect(d.notice).toContain("Dongwon-MacBookPro");
    expect(d.notice).toContain("봇 토큰을 다시 입력");
    expect(d.notice).toContain("끊깁니다");
  });

  it("다른 machineId 라도 봇이 다르면 other-bot — 경쟁이 아니므로 막지 않는다", () => {
    const d = classifyTelegramBinding(bindingOfA(), MACHINE_B, OTHER_TOKEN);
    expect(d.verdict).toBe("other-bot");
    expect(d.autoEnableAllowed).toBe(true);
  });

  it("귀속 없음(null)=기존 채널, 미관측(undefined)=미지 — 둘 다 막지 않는다", () => {
    expect(classifyTelegramBinding(null, MACHINE_B, GOOD_TOKEN)).toMatchObject({
      verdict: "unbound",
      autoEnableAllowed: true,
    });
    expect(
      classifyTelegramBinding(undefined, MACHINE_B, GOOD_TOKEN),
    ).toMatchObject({ verdict: "unknown", autoEnableAllowed: true });
  });

  it("이 기기의 machineId 를 모르면 판정 불가 — fail-open", () => {
    const d = classifyTelegramBinding(bindingOfA(), "", GOOD_TOKEN);
    expect(d.verdict).toBe("unknown");
    expect(d.autoEnableAllowed).toBe(true);
  });

  it("귀속 레코드에 봇 토큰 원문이 실리지 않는다 — 해시만", () => {
    const b = bindingOfA();
    expect(b.tokenHash).toBe(telegramLeaseTokenHash(GOOD_TOKEN));
    expect(JSON.stringify(b)).not.toContain(GOOD_TOKEN);
  });

  it("인수하면 직전 보유자가 previous 로 남는다 — 누가 언제 가져갔나", () => {
    const taken = buildTelegramChannelBinding({
      machineId: MACHINE_B,
      hostLabel: "Dongwon-MacMini",
      botToken: GOOD_TOKEN,
      boundByUid: "uid-owner",
      now: 9_000,
      previous: bindingOfA(),
    });
    expect(taken.previous).toMatchObject({
      machineId: MACHINE_A,
      hostLabel: "Dongwon-MacBookPro",
      boundByUid: "uid-owner",
    });
    // 자기 자신으로의 갱신은 이력이 아니다.
    const renewed = buildTelegramChannelBinding({
      machineId: MACHINE_A,
      hostLabel: "Dongwon-MacBookPro",
      botToken: GOOD_TOKEN,
      boundByUid: "uid-owner",
      now: 9_000,
      previous: bindingOfA(),
    });
    expect(renewed.previous).toBeUndefined();
  });

  it("깨진 원격 값은 null 로 정규화된다(신뢰 경계)", () => {
    expect(parseTelegramChannelBinding(null)).toBeNull();
    expect(parseTelegramChannelBinding("nope")).toBeNull();
    expect(parseTelegramChannelBinding({ machineId: "" })).toBeNull();
    expect(parseTelegramChannelBinding({ machineId: "m" })).toBeNull(); // boundAt 없음
    expect(
      parseTelegramChannelBinding({ machineId: "m", boundAt: 1 }),
    ).toMatchObject({ machineId: "m", hostLabel: "m" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("★1. 기기 A 에서 인증한 채널은 기기 B 에서 자동 활성화되지 않는다", () => {
  it("A 가 enabled=true 로 push 한 메타를 B 가 복원해도 꺼진 채로 내려앉는다", () => {
    // 기기 B 관점: 로컬 레코드 없음, 원격 메타는 A 가 켜 둔 상태.
    installObserver({ machineId: MACHINE_B, observed: bindingOfA() });
    const created = applyRemoteTelegramChannelMeta("p1", {
      chatId: GOOD_CHAT,
      enabled: true, // ★A 기기에서는 켜져 있었다
      inboundCapability: "trigger",
      hasBotToken: true,
      updatedAt: 1_000,
    });
    expect(created).toBe(true);
    const cfg = ctx.store.getConfig("p1");
    expect(cfg?.enabled).toBe(false); // ★넘어오지 않는다
    expect(cfg?.botToken).toBeNull(); // 토큰은 동기화되지 않는다
    expect(cfg?.restoredFromSync).toBe(true);
  });

  it("★B 기기 화면에 사실이 뜬다 — 어느 기기가 인증했고, 켜면 그 기기가 잃는다", () => {
    installObserver({ machineId: MACHINE_B, observed: bindingOfA() });
    applyRemoteTelegramChannelMeta("p1", {
      chatId: GOOD_CHAT,
      enabled: true,
      inboundCapability: "trigger",
      hasBotToken: true,
      updatedAt: 1_000,
    });
    const status = getTelegramChannelStatus("p1");
    expect(status.deviceBinding.verdict).toBe("foreign");
    expect(status.deviceBinding.autoEnableAllowed).toBe(false);
    // ★뮤테이션 감지 지점: getStatus 의 귀속 검사를 지우면 여기서 깨진다.
    expect(status.preflight.issues.join(" ")).toContain("Dongwon-MacBookPro");
    expect(status.preflight.issues.join(" ")).toContain("끊깁니다");
    expect(status.deviceBinding.notice).toBeTruthy();
  });

  it("남의 기기 귀속을 '물려받은 enabled' 로는 켤 수 없다 (자동 계승 차단)", () => {
    // 이미 켜진 로컬 레코드가 있는 상태에서 귀속이 남의 것으로 관측되면,
    // enabled 를 명시하지 않은 저장(예: chatId 만 수정)은 채널을 켠 채로
    // 두지 않는다 — 이것이 "자동으로 활성되지 않는다"의 실제 강제 지점이다.
    installObserver({ machineId: MACHINE_B, observed: null });
    setTelegramChannelFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    expect(ctx.store.getConfig("p1")?.enabled).toBe(true);

    // 이제 A 기기가 같은 봇의 귀속을 쥐고 있다는 사실이 관측된다.
    installObserver({ machineId: MACHINE_B, observed: bindingOfA() });
    const status = setTelegramChannelFromLocalSettings({
      projectId: "p1",
      chatId: GOOD_CHAT, // enabled 를 명시하지 않는다 → 계승 시도
    });
    expect(status.enabled).toBe(false); // ★강등됐다
    expect(status.deviceBinding.verdict).toBe("foreign");
  });

  it("사용자가 여기서 **명시적으로** 켜는 것은 막지 않는다 (정당한 인수)", () => {
    // ★차단 층이 아니다. 기기를 갈아탄 본인이 영영 못 켜는 상태를 만들면
    //   지금보다 나쁘다 — 대가는 안내문이 미리 말한다.
    installObserver({ machineId: MACHINE_B, observed: bindingOfA() });
    const status = setTelegramChannelFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true, // 명시적 인수
    });
    expect(status.enabled).toBe(true);
    expect(status.canEnable).toBe(true); // 토글을 잠그지 않는다
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("★2. 귀속 기록이 없는 기존 채널은 계속 동작한다 (마이그레이션 무회귀)", () => {
  it("원격에 귀속 필드가 없으면(unbound) 활성 채널이 그대로 산다", () => {
    installObserver({ machineId: MACHINE_B, observed: null });
    setTelegramChannelFromLocalSettings({
      projectId: "legacy",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    // 재저장(계승 경로)에도 꺼지지 않는다.
    const status = setTelegramChannelFromLocalSettings({
      projectId: "legacy",
      chatId: GOOD_CHAT,
    });
    expect(status.deviceBinding.verdict).toBe("unbound");
    expect(status.enabled).toBe(true);
    expect(status.active).toBe(true);
    expect(isTelegramChannelActive("legacy")).toBe(true);
  });

  it("관측자가 아예 안 꽂힌 상태(구 빌드 경로)에서도 그대로 동작한다", () => {
    setTelegramBindingObserver(null);
    setTelegramChannelFromLocalSettings({
      projectId: "legacy",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    const status = setTelegramChannelFromLocalSettings({
      projectId: "legacy",
      chatId: GOOD_CHAT,
    });
    expect(status.deviceBinding.verdict).toBe("unknown");
    expect(status.enabled).toBe(true);
    expect(isTelegramChannelActive("legacy")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("★3. 귀속 검사가 터져도 폴링은 막히지 않는다 (fail-open, #1419 규율)", () => {
  it("관측자가 예외를 던져도 status 는 살아 있고 채널은 활성이다", () => {
    installObserver({ machineId: MACHINE_B, observed: null });
    setTelegramChannelFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });

    // 이제 귀속 조회가 터진다(오프라인·권한·Firestore 장애).
    installObserver({ machineId: MACHINE_B, throws: true });

    // ★던지지 않는다. 이 expect 가 store.classifyBinding 의 try/catch 를 고정한다.
    const status = getTelegramChannelStatus("p1");
    expect(status.deviceBinding.verdict).toBe("unknown");
    expect(status.deviceBinding.autoEnableAllowed).toBe(true);
    expect(status.deviceBinding.failOpenReason).toContain(
      "firestore unavailable",
    );
    // ★핵심: 폴러가 보는 값이 그대로 살아 있다.
    expect(status.active).toBe(true);
    expect(isTelegramChannelActive("p1")).toBe(true);
  });

  it("검사가 터진 상태의 저장도 채널을 끄지 않는다", () => {
    installObserver({ machineId: MACHINE_B, observed: null });
    setTelegramChannelFromLocalSettings({
      projectId: "p1",
      botToken: GOOD_TOKEN,
      chatId: GOOD_CHAT,
      enabled: true,
    });
    installObserver({ machineId: MACHINE_B, throws: true });
    const status = setTelegramChannelFromLocalSettings({
      projectId: "p1",
      chatId: GOOD_CHAT,
    });
    expect(status.enabled).toBe(true);
    expect(status.active).toBe(true);
  });
});
