/**
 * 링크백 발화 규칙 — 마커 × 동의 × 첫실행 × 팝아웃 (티켓 VfWJtnAl).
 *
 * ── 이 파일이 잠그는 결함 ───────────────────────────────────────────────────
 *   `notifyInstallAttribution()` 의 호출 지점이 `FirstRunFlow.onComplete` 하나
 *   뿐이었고, `isFirstRunFlowPending()` 은 기존 설치에 **항상 false** 다
 *   ("False for every existing install — deliberately"). 그래서 링크백 배포
 *   (2026-08-10) 이전에 첫 실행을 마친 설치는 링크백을 **영원히** 못 보냈다 —
 *   텔레메트리를 보낸 설치 42개 중 39개가 그 상태였다(조사 ZLbWocCS).
 *
 * ── ★소급 백필이 아니다 ────────────────────────────────────────────────────
 *   여기서 넓히는 것은 **발화 조건**뿐이다. 과거 행을 우리가 만들지 않는다.
 *   그 설치들이 다음에 켜질 때 스스로 보낸다.
 *
 * ── 이 파일이 못 박는 세 가지 ──────────────────────────────────────────────
 *   1) 정확히 1회 — 성공 뒤엔 다시 안 보낸다.
 *   2) 실패 시 재시도 — 열기가 던지면 마커를 되돌린다.
 *   3) ★텔레메트리 미동의면 아예 안 연다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  INSTALL_LINK_SENT_KEY,
  decideLaunchLinkback,
  type LaunchLinkbackFacts,
} from "../../src/lib/attributionLink";

// ════════════════════════════════════════════════════════════════════════════
// 1. 순수 판정 — 조합 전수. 여기서 갈리면 아래 부수효과 테스트는 볼 필요가 없다
// ════════════════════════════════════════════════════════════════════════════

const FIRE: LaunchLinkbackFacts = {
  alreadySent: false,
  telemetryEnabled: true,
  firstRunFlowPending: false,
  detachedWindow: false,
};

describe("decideLaunchLinkback — 마커 × 동의 × 첫실행 × 팝아웃", () => {
  it("★기존 설치(마커 없음 · 동의 · 첫실행 플로우 아님)에서 연다 — 이게 고친 결함이다", () => {
    expect(decideLaunchLinkback(FIRE)).toBeNull();
  });

  it("마커가 있으면 안 연다 — 성공 뒤 재발송 없음", () => {
    expect(decideLaunchLinkback({ ...FIRE, alreadySent: true })).toBe(
      "already_sent",
    );
  });

  it("★텔레메트리 미동의면 안 연다", () => {
    expect(decideLaunchLinkback({ ...FIRE, telemetryEnabled: false })).toBe(
      "telemetry_declined",
    );
  });

  it("★미동의는 마커가 없어도 이긴다 — 동의가 마커보다 앞이다", () => {
    expect(
      decideLaunchLinkback({
        ...FIRE,
        telemetryEnabled: false,
        alreadySent: false,
      }),
    ).toBe("telemetry_declined");
  });

  it("첫 실행 플로우가 떠 있으면 여기서 안 연다 — onComplete 가 연다", () => {
    expect(decideLaunchLinkback({ ...FIRE, firstRunFlowPending: true })).toBe(
      "first_run_flow_pending",
    );
  });

  it("팝아웃 창은 첫 실행이 아니다 — 본창 세션에 얹혀 있다", () => {
    expect(decideLaunchLinkback({ ...FIRE, detachedWindow: true })).toBe(
      "detached_window",
    );
  });

  it("★16개 조합 전수 — 딱 한 조합에서만 연다", () => {
    const fired: LaunchLinkbackFacts[] = [];
    for (const alreadySent of [true, false]) {
      for (const telemetryEnabled of [true, false]) {
        for (const firstRunFlowPending of [true, false]) {
          for (const detachedWindow of [true, false]) {
            const f = {
              alreadySent,
              telemetryEnabled,
              firstRunFlowPending,
              detachedWindow,
            };
            if (decideLaunchLinkback(f) === null) fired.push(f);
          }
        }
      }
    }
    expect(fired).toEqual([FIRE]);
  });

  it("★미동의 조합은 하나도 열리지 않는다", () => {
    for (const alreadySent of [true, false]) {
      for (const firstRunFlowPending of [true, false]) {
        for (const detachedWindow of [true, false]) {
          expect(
            decideLaunchLinkback({
              alreadySent,
              telemetryEnabled: false,
              firstRunFlowPending,
              detachedWindow,
            }),
          ).not.toBeNull();
        }
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. 마커의 부수효과 — 언제 쓰고 언제 되돌리나
// ════════════════════════════════════════════════════════════════════════════

let telemetryEnabled = true;
const CLIENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

vi.mock("../../src/services/telemetryService", () => ({
  getClientId: () => CLIENT_ID,
  isTelemetryEnabled: () => telemetryEnabled,
}));
vi.mock("../../src/lib/i18n", () => ({
  useLocaleStore: { getState: () => ({ locale: "ko" }) },
}));

/** 실패를 흉내낼 수 있는 최소 localStorage. */
function makeStorage(opts: { writable?: boolean; readable?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    getItem(k: string) {
      if (opts.readable === false) throw new Error("storage read blocked");
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem(k: string, v: string) {
      if (opts.writable === false) throw new Error("storage write blocked");
      map.set(k, v);
    },
    removeItem(k: string) {
      if (opts.writable === false) throw new Error("storage write blocked");
      map.delete(k);
    },
  };
}

type Harness = {
  storage: ReturnType<typeof makeStorage>;
  opened: string[];
};

function install(opts: {
  storage?: ReturnType<typeof makeStorage>;
  openThrows?: boolean;
}): Harness {
  const storage = opts.storage ?? makeStorage();
  const opened: string[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = storage;
  g.window = {
    location: { protocol: "file:" },
    open: (url: string) => {
      if (opts.openThrows) throw new Error("openExternal failed");
      opened.push(url);
      return null;
    },
  };
  return { storage, opened };
}

async function loadService() {
  vi.resetModules();
  return await import("../../src/services/installAttribution");
}

describe("notifyInstallAttributionOnLaunch — 정확히 1회", () => {
  beforeEach(() => {
    telemetryEnabled = true;
  });

  it("★기존 설치가 켜지면 연다 — 그리고 마커가 남는다", async () => {
    const h = install({});
    const svc = await loadService();
    const skip = svc.notifyInstallAttributionOnLaunch({
      firstRunFlowPending: false,
      detachedWindow: false,
    });
    expect(skip).toBeNull();
    expect(h.opened).toHaveLength(1);
    expect(h.opened[0]).toContain(`i=${CLIENT_ID}`);
    expect(h.storage.map.get(INSTALL_LINK_SENT_KEY)).toBe("true");
  });

  it("★성공 뒤 두 번째 실행에서는 안 보낸다", async () => {
    const h = install({});
    const svc = await loadService();
    const ctx = { firstRunFlowPending: false, detachedWindow: false };
    svc.notifyInstallAttributionOnLaunch(ctx);
    expect(svc.notifyInstallAttributionOnLaunch(ctx)).toBe("already_sent");
    expect(svc.notifyInstallAttributionOnLaunch(ctx)).toBe("already_sent");
    expect(h.opened).toHaveLength(1);
  });

  it("★열기가 던지면 마커를 되돌린다 — 다음 실행에서 재시도된다", async () => {
    const storage = makeStorage();
    install({ storage, openThrows: true });
    const failing = await loadService();
    const ctx = { firstRunFlowPending: false, detachedWindow: false };
    failing.notifyInstallAttributionOnLaunch(ctx);
    // ★마커가 남아 있으면 이 설치는 영원히 재시도하지 못한다.
    expect(storage.map.has(INSTALL_LINK_SENT_KEY)).toBe(false);

    // 다음 실행: 열기가 성공한다.
    const h = install({ storage });
    const ok = await loadService();
    expect(ok.notifyInstallAttributionOnLaunch(ctx)).toBeNull();
    expect(h.opened).toHaveLength(1);
    expect(storage.map.get(INSTALL_LINK_SENT_KEY)).toBe("true");
  });

  it("★미동의면 열지도, 마커를 찍지도 않는다", async () => {
    telemetryEnabled = false;
    const h = install({});
    const svc = await loadService();
    expect(
      svc.notifyInstallAttributionOnLaunch({
        firstRunFlowPending: false,
        detachedWindow: false,
      }),
    ).toBe("telemetry_declined");
    expect(h.opened).toHaveLength(0);
    // ★마커도 안 찍힌다 — 나중에 동의하면 그때 보낼 수 있어야 한다.
    expect(h.storage.map.has(INSTALL_LINK_SENT_KEY)).toBe(false);
  });

  it("★미동의로 접힌 설치가 나중에 동의하면 그때 보낸다", async () => {
    const storage = makeStorage();
    telemetryEnabled = false;
    install({ storage });
    const declined = await loadService();
    const ctx = { firstRunFlowPending: false, detachedWindow: false };
    declined.notifyInstallAttributionOnLaunch(ctx);

    telemetryEnabled = true;
    const h = install({ storage });
    const consented = await loadService();
    expect(consented.notifyInstallAttributionOnLaunch(ctx)).toBeNull();
    expect(h.opened).toHaveLength(1);
  });

  it("첫 실행 플로우가 떠 있으면 열지 않는다 — 두 경로가 겹쳐도 1회다", async () => {
    const storage = makeStorage();
    const h = install({ storage });
    const svc = await loadService();
    // 플로우가 떠 있는 동안의 mount.
    expect(
      svc.notifyInstallAttributionOnLaunch({
        firstRunFlowPending: true,
        detachedWindow: false,
      }),
    ).toBe("first_run_flow_pending");
    expect(h.opened).toHaveLength(0);
    // 플로우 완료 → onComplete 가 연다.
    svc.notifyInstallAttribution();
    // 그 뒤 effect 가 firstRunPending=false 로 다시 돈다.
    expect(
      svc.notifyInstallAttributionOnLaunch({
        firstRunFlowPending: false,
        detachedWindow: false,
      }),
    ).toBe("already_sent");
    expect(h.opened).toHaveLength(1);
  });

  it("★스토리지에 못 쓰면 아예 안 연다 — 매 부팅마다 창이 튀는 것보다 낫다", async () => {
    const h = install({ storage: makeStorage({ writable: false }) });
    const svc = await loadService();
    svc.notifyInstallAttributionOnLaunch({
      firstRunFlowPending: false,
      detachedWindow: false,
    });
    expect(h.opened).toHaveLength(0);
  });

  it("★스토리지를 못 읽으면 '보냈다' 로 보고 안 연다", async () => {
    const h = install({ storage: makeStorage({ readable: false }) });
    const svc = await loadService();
    expect(
      svc.notifyInstallAttributionOnLaunch({
        firstRunFlowPending: false,
        detachedWindow: false,
      }),
    ).toBe("already_sent");
    expect(h.opened).toHaveLength(0);
  });

  it("팝아웃 창에서는 열지 않는다", async () => {
    const h = install({});
    const svc = await loadService();
    expect(
      svc.notifyInstallAttributionOnLaunch({
        firstRunFlowPending: false,
        detachedWindow: true,
      }),
    ).toBe("detached_window");
    expect(h.opened).toHaveLength(0);
  });

  it("첫 실행 경로도 미동의면 열지 않는다 — 게이트가 한 몸통에 있다", async () => {
    telemetryEnabled = false;
    const h = install({});
    const svc = await loadService();
    svc.notifyInstallAttribution();
    expect(h.opened).toHaveLength(0);
    expect(h.storage.map.has(INSTALL_LINK_SENT_KEY)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. 호출 지점 — 조사가 찾아낸 결함이 "호출이 한 곳뿐" 이었다
// ════════════════════════════════════════════════════════════════════════════

describe("App 의 링크백 호출 지점", () => {
  const APP = readFileSync(
    fileURLToPath(new URL("../../src/App.tsx", import.meta.url)),
    "utf8",
  );

  it("★첫 실행 플로우 **밖에서도** 발화 경로가 있다 — 이게 39개를 회수한다", () => {
    expect(APP).toContain("notifyInstallAttributionOnLaunch");
    // 플로우 안의 기존 경로도 그대로 남아 있다(신규 설치용).
    expect(APP).toContain("notifyInstallAttribution()");
  });

  it("발화 경로가 첫 실행 상태와 팝아웃 여부를 넘긴다 — 판정을 스스로 내리지 않는다", () => {
    const call = APP.slice(APP.indexOf("notifyInstallAttributionOnLaunch({"));
    expect(call).toContain("firstRunFlowPending");
    expect(call).toContain("detachedWindow");
  });

  it("★'소급 백필이 아니다' 를 코드가 말한다 — 다음 사람이 지표를 오해하지 않게", () => {
    expect(APP).toContain("소급 백필이 아니다");
  });
});
