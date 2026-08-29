/**
 * ★첫실행 심플모드가 **새 계정에서 안 뜨는** 회귀 가드 — 티켓 E3ywX1ftbVr5f1TrFsgp.
 *
 * 증상: 계정 A 가 쓰던 맥에서 계정 B 로 처음 로그인해도 심플 모드(비기너 셸)가
 * 뜨지 않는다. 원인은 진입 판정이 **기기 단위**라는 것이다 —
 * `marblo.beginnerMode` 레코드도, 그 판정이 보는 이전-사용 마커 4종도 전부
 * localStorage(기기)에 있고 uid 는 어디에도 없다. A 가 남긴 "advanced" 가 B 의
 * 첫 실행을 그대로 이긴다.
 *
 * ★고치는 방향이 두 갈래였고, 여기서 **왜 후자를 골랐는지**가 이 파일이 못박는
 * 것이다:
 *
 *   (i)  계정이 바뀌면 accountScope 에서 판정과 마커를 **지운다**  → 탈락.
 *        `adoptIdentity` 는 최초 마운트(undefined → uid)에서도 발화하므로 매
 *        부팅마다 판정이 지워지고, 마커까지 지우면 다음 부팅에 기존 유저가
 *        beginner 로 떨어진다 — 쓰던 사람의 보드가 사라지는, `lib/beginnerMode`
 *        가 대놓고 막고 있는 그 회귀다.
 *   (ii) 판정을 **uid 에 귀속**시키고, 기기에 남은 흔적(레거시 레코드 + 마커)은
 *        **최초 한 계정만** 상속한다 → 채택.
 *
 * 못박는 불변식:
 *   ① 이 계정의 레코드가 있으면 그것이 이긴다(kept).
 *   ② 아직 아무도 안 가져간 기기 흔적은 첫 계정이 상속한다(claimed) — 업그레이드
 *      경로. 쓰던 사람은 advanced 그대로다.
 *   ③ 다른 계정이 이미 가져간 뒤라면 마커는 **남의 흔적**이므로 무시하고 이
 *      계정의 첫 실행으로 판정한다(fresh) → 심플 모드.
 *   ④ A → B → A 로 돌아와도 A 는 advanced 그대로다(레코드가 계정별이라서).
 *   ⑤ 새 계정으로 판정되면 코치마크(첫실행 투어) 기록도 함께 초기화된다 —
 *      A 가 완주한 투어 때문에 B 가 안내를 한 번도 못 보는 일이 없게.
 *
 * 스토어들이 **모듈 평가 시점에** localStorage 를 읽으므로, 매 테스트가 인메모리
 * 스토리지 shim 을 새로 세우고 모듈 레지스트리를 비운 뒤 동적 import 한다
 * (`splitWorkspaceStore.test.ts` 와 같은 패턴).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BEGINNER_MODE_KEY,
  BEGINNER_MODE_CLAIM_KEY,
  beginnerModeAccountKey,
  resolveBeginnerModeForAccount,
  EMPTY_BEGINNER_RECORD,
  type BeginnerModeRecord,
  type PriorInstallMarkers,
} from "../../src/lib/beginnerMode";
import { COACHMARK_KEY, BEGINNER_TOUR_ID } from "../../src/lib/coachmark";

const NO_MARKERS: PriorInstallMarkers = {
  onboardingProgress: false,
  workspaceTab: false,
  workspaceModeFlag: false,
  legacyGateDismissed: false,
  storageUnavailable: false,
};

/** 이전-사용 마커가 하나라도 있는 기기(값이 아니라 존재만 본다). */
const USED_MARKERS: PriorInstallMarkers = { ...NO_MARKERS, workspaceTab: true };

function record(patch: Partial<BeginnerModeRecord> = {}): BeginnerModeRecord {
  return { ...EMPTY_BEGINNER_RECORD, ...patch };
}

// ── 순수 규칙 ───────────────────────────────────────────────────────────────

describe("resolveBeginnerModeForAccount — 계정 귀속 진입판정", () => {
  it("① 이 계정의 레코드가 있으면 그대로 쓴다(마커도 기기 흔적도 안 본다)", () => {
    const mine = record({
      state: "advanced",
      enteredAt: 5,
      promotionShownAt: 7,
    });
    const out = resolveBeginnerModeForAccount({
      uid: "A",
      accountRecord: mine,
      legacyRecord: record({ state: "beginner" }),
      claimedBy: "B",
      markers: NO_MARKERS,
      now: 1_000,
    });
    expect(out.outcome).toBe("kept");
    expect(out.record).toEqual(mine);
  });

  it("② 미청구 기기 흔적은 첫 계정이 상속한다 — 쓰던 유저는 advanced 그대로", () => {
    const legacy = record({
      state: "advanced",
      enteredAt: 3,
      firstCompletionAt: 4,
      promotionShownAt: 5,
    });
    const out = resolveBeginnerModeForAccount({
      uid: "A",
      accountRecord: null,
      legacyRecord: legacy,
      claimedBy: null,
      markers: USED_MARKERS,
      now: 1_000,
    });
    expect(out.outcome).toBe("claimed");
    // 타임스탬프까지 그대로 물려받는다 — enteredAt 은 첫완료 TTFV 의 분모다.
    expect(out.record).toEqual(legacy);
  });

  it("② 레거시 레코드가 없어도 마커만으로 상속 판정한다(비기너 모드 이전 설치)", () => {
    const out = resolveBeginnerModeForAccount({
      uid: "A",
      accountRecord: null,
      legacyRecord: null,
      claimedBy: null,
      markers: USED_MARKERS,
      now: 1_000,
    });
    expect(out.outcome).toBe("claimed");
    expect(out.record.state).toBe("advanced");
  });

  it("② 흔적이 아무것도 없는 진짜 신규 설치는 비기너다", () => {
    const out = resolveBeginnerModeForAccount({
      uid: "A",
      accountRecord: null,
      legacyRecord: null,
      claimedBy: null,
      markers: NO_MARKERS,
      now: 1_000,
    });
    expect(out.outcome).toBe("claimed");
    expect(out.record.state).toBe("beginner");
    expect(out.record.enteredAt).toBe(1_000);
  });

  it("★③ 다른 계정이 이미 가져간 기기 흔적은 무시한다 — 새 계정은 심플 모드", () => {
    const out = resolveBeginnerModeForAccount({
      uid: "B",
      accountRecord: null,
      // A 가 남긴 것들. 여기서 이게 이기면 B 는 심플 모드를 영영 못 본다.
      legacyRecord: record({ state: "advanced", enteredAt: 3 }),
      claimedBy: "A",
      markers: USED_MARKERS,
      now: 1_000,
    });
    expect(out.outcome).toBe("fresh");
    expect(out.record.state).toBe("beginner");
    expect(out.record.enteredAt).toBe(1_000);
    // 남의 계정 계측이 새 계정으로 새지 않는다.
    expect(out.record.firstCompletionAt).toBe(0);
    expect(out.record.promotionShownAt).toBe(0);
  });

  it("청구자가 자기 자신이면(레코드만 유실) 기기 흔적을 다시 읽는다", () => {
    const out = resolveBeginnerModeForAccount({
      uid: "A",
      accountRecord: null,
      legacyRecord: null,
      claimedBy: "A",
      markers: USED_MARKERS,
      now: 1_000,
    });
    expect(out.outcome).toBe("claimed");
    expect(out.record.state).toBe("advanced");
  });

  it("storage 를 못 읽으면 기존 경험(advanced)으로 degrade 한다", () => {
    const out = resolveBeginnerModeForAccount({
      uid: "A",
      accountRecord: null,
      legacyRecord: null,
      claimedBy: null,
      markers: { ...NO_MARKERS, storageUnavailable: true },
      now: 1_000,
    });
    expect(out.record.state).toBe("advanced");
  });
});

// ── 스토어 배선 ─────────────────────────────────────────────────────────────

function makeStorageShim(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    storage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, String(v));
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
    },
  };
}

/** 인메모리 스토리지를 심고 모듈 레지스트리를 비운 뒤 스토어를 새로 올린다. */
async function boot(seed: Record<string, string> = {}) {
  const { map, storage } = makeStorageShim(seed);
  vi.resetModules();
  vi.stubGlobal("window", {} as unknown as Window);
  vi.stubGlobal("localStorage", storage);
  const beginner = (await import("../../src/stores/beginnerModeStore"))
    .useBeginnerModeStore;
  return { beginner, map };
}

afterEach(() => vi.unstubAllGlobals());

/** 계정 A 가 이미 쓰던 기기의 프로필. */
const USED_MACHINE: Record<string, string> = {
  [BEGINNER_MODE_KEY]: JSON.stringify(
    record({ state: "advanced", enteredAt: 3 })
  ),
  "marblo.workspaceSplit.activeTab": "board",
};

describe("beginnerModeStore.adoptAccount — localStorage 배선", () => {
  it("★새 계정의 첫 로그인은 심플 모드로 떨어진다 — A 가 쓰던 기기여도", async () => {
    const { beginner } = await boot(USED_MACHINE);

    expect(beginner.getState().adoptAccount("A")).toBe("claimed");
    expect(beginner.getState().state).toBe("advanced");

    // 그 기기에 계정 B 가 처음 로그인한다.
    expect(beginner.getState().adoptAccount("B")).toBe("fresh");
    expect(beginner.getState().state).toBe("beginner");
    expect(beginner.getState().entryReason).toBe("fresh_install");
    // 진입 계측은 계정마다 다시 쏴야 한다(퍼널 분모).
    expect(beginner.getState().enteredReported).toBe(false);

    // ④ 다시 A 로 돌아오면 A 의 advanced 가 살아 있다.
    expect(beginner.getState().adoptAccount("A")).toBe("kept");
    expect(beginner.getState().state).toBe("advanced");
  });

  it("상속은 계정별 키로 옮기고 레거시 키를 비운다(재청구 금지)", async () => {
    const { beginner, map } = await boot(USED_MACHINE);
    beginner.getState().adoptAccount("A");

    expect(map.get(BEGINNER_MODE_KEY)).toBeUndefined();
    expect(map.get(BEGINNER_MODE_CLAIM_KEY)).toBe("A");
    const mine = map.get(beginnerModeAccountKey("A"));
    expect(mine).toBeDefined();
    expect(JSON.parse(mine!).state).toBe("advanced");
  });

  it("같은 계정을 다시 채택해도 아무 일도 없다(재부팅·토큰 갱신)", async () => {
    const { beginner } = await boot();
    beginner.getState().adoptAccount("A");
    beginner.getState().promote("manual");
    expect(beginner.getState().adoptAccount("A")).toBeNull();
    expect(beginner.getState().state).toBe("advanced");
  });

  it("로그아웃(uid=null)은 판정을 건드리지 않는다 — 재로그인이 흔한 경로다", async () => {
    const { beginner } = await boot();
    beginner.getState().adoptAccount("A");
    beginner.getState().promote("manual");
    expect(beginner.getState().adoptAccount(null)).toBeNull();
    expect(beginner.getState().state).toBe("advanced");
    expect(beginner.getState().adoptAccount("A")).toBeNull();
    expect(beginner.getState().state).toBe("advanced");
  });

  it("승격은 그 계정의 키에만 쓴다(다른 계정으로 새지 않는다)", async () => {
    const { beginner, map } = await boot(USED_MACHINE);
    beginner.getState().adoptAccount("A");
    beginner.getState().adoptAccount("B");
    beginner.getState().promote("manual");

    expect(JSON.parse(map.get(beginnerModeAccountKey("B"))!).state).toBe(
      "advanced"
    );
    // B 의 승격이 A 의 레코드를 덮지 않았다.
    expect(JSON.parse(map.get(beginnerModeAccountKey("A"))!).state).toBe(
      "advanced"
    );
    expect(JSON.parse(map.get(beginnerModeAccountKey("A"))!).enteredAt).toBe(3);
  });

  it("★청구 도장은 상속한 계정에만 남는다 — 새 계정이 남의 마커를 물려받지 않게", async () => {
    const { beginner, map } = await boot(USED_MACHINE);
    beginner.getState().adoptAccount("A");
    beginner.getState().adoptAccount("B");
    expect(map.get(BEGINNER_MODE_CLAIM_KEY)).toBe("A");

    // B 의 레코드만 유실된 채 재부팅(프로필 정리·프라이빗 모드 등).
    map.delete(beginnerModeAccountKey("B"));
    const again = await boot(Object.fromEntries(map));
    expect(again.beginner.getState().adoptAccount("B")).toBe("fresh");
    expect(again.beginner.getState().state).toBe("beginner");
  });

  it("모듈 평가만으로는 아무것도 영속하지 않는다 — 판정의 주인은 uid 다", async () => {
    const { map } = await boot({ "marblo.workspaceSplit.activeTab": "board" });
    expect(map.get(BEGINNER_MODE_KEY)).toBeUndefined();
    expect(map.get(BEGINNER_MODE_CLAIM_KEY)).toBeUndefined();
  });

  it("★콜드 스타트는 인증 전 레거시 키로 비기너를 고르지 않고, uid 채택 뒤 계정 레코드를 복원한다", async () => {
    const first = await boot();
    expect(first.beginner.getState().state).toBe("advanced");

    // 첫 실행에서 마블로 모드로 승격한다. 이 쓰기는 계정 키에만 남는다.
    expect(first.beginner.getState().adoptAccount("A")).toBe("claimed");
    first.beginner.getState().promote("manual");
    const persisted = Object.fromEntries(first.map);
    expect(JSON.parse(persisted[beginnerModeAccountKey("A")]).state).toBe(
      "advanced",
    );
    expect(persisted[BEGINNER_MODE_KEY]).toBeUndefined();

    // 새 renderer 모듈 = 앱 재시작. 이 시점에는 uid 가 아직 없으므로 계정
    // 레코드를 섣불리 못 읽는다. 인증이 준비되면 같은 계정 레코드가 이긴다.
    const restarted = await boot(persisted);
    expect(restarted.beginner.getState().state).toBe("advanced");
    expect(restarted.beginner.getState().adoptAccount("A")).toBe("kept");
    expect(restarted.beginner.getState().state).toBe("advanced");
  });

  it("콜드 스타트 뒤 새 계정을 채택하면 여전히 비기너로 시작한다", async () => {
    const { beginner } = await boot();
    expect(beginner.getState().state).toBe("advanced");
    expect(beginner.getState().adoptAccount("new-account")).toBe("claimed");
    expect(beginner.getState().state).toBe("beginner");
  });
});

// ── 계정 전환 초크포인트 ────────────────────────────────────────────────────

describe("resetAccountScopedState — 계정 전환 초크포인트", () => {
  async function bootScope(seed: Record<string, string> = {}) {
    const { map, storage } = makeStorageShim(seed);
    vi.resetModules();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window);
    vi.stubGlobal("localStorage", storage);
    vi.doMock("../../src/lib/firebase", () => ({
      db: {},
      auth: {},
      functions: {},
      app: {},
      isPackagedLoopbackAuth: false,
      FIREBASE_FUNCTIONS_REGION: "us-central1",
    }));
    const { resetAccountScopedState } = await import(
      "../../src/lib/accountScope"
    );
    const { useBeginnerModeStore } = await import(
      "../../src/stores/beginnerModeStore"
    );
    const { useCoachmarkStore } = await import(
      "../../src/stores/coachmarkStore"
    );
    return {
      resetAccountScopedState,
      useBeginnerModeStore,
      useCoachmarkStore,
      map,
    };
  }

  it("★새 계정이면 심플 모드로 되돌리고 첫실행 투어도 다시 열어 준다", async () => {
    const scope = await bootScope({
      ...USED_MACHINE,
      // A 는 투어까지 완주했다.
      [COACHMARK_KEY]: JSON.stringify({
        tours: {
          [BEGINNER_TOUR_ID]: {
            startedCount: 4,
            completedAt: 99,
            dismissedAt: 0,
          },
        },
      }),
    });

    scope.resetAccountScopedState("A");
    expect(scope.useBeginnerModeStore.getState().state).toBe("advanced");
    expect(
      scope.useCoachmarkStore.getState().tours[BEGINNER_TOUR_ID]?.completedAt
    ).toBe(99);

    scope.resetAccountScopedState("B");
    expect(scope.useBeginnerModeStore.getState().state).toBe("beginner");
    // A 가 완주한 투어 기록이 B 의 첫 실행을 삼키지 않는다.
    expect(
      scope.useCoachmarkStore.getState().tours[BEGINNER_TOUR_ID]?.completedAt ??
        0
    ).toBe(0);
  });

  it("같은 계정의 재부팅에서는 판정도 투어 기록도 그대로다", async () => {
    const scope = await bootScope();

    scope.resetAccountScopedState("A");
    scope.useBeginnerModeStore.getState().promote("manual");
    scope.useCoachmarkStore.getState().markCompleted(BEGINNER_TOUR_ID);

    // 로그아웃 → 같은 계정 재로그인.
    scope.resetAccountScopedState(null);
    scope.resetAccountScopedState("A");

    expect(scope.useBeginnerModeStore.getState().state).toBe("advanced");
    expect(
      scope.useCoachmarkStore.getState().tours[BEGINNER_TOUR_ID]?.completedAt ??
        0
    ).toBeGreaterThan(0);
  });
});
