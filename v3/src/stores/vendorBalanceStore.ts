import { create } from "zustand";

/**
 * 벤더 선불 잔액 캐시(렌더러 쪽).
 *
 * ── 캐시가 **두 겹**인 이유 ─────────────────────────────────────────────
 * 진짜 캐시는 메인 프로세스(`electron/vendor-balance.ts`, TTL 10분 + 새로고침
 * 하한)에 있다. 여기 한 겹을 더 두는 것은 **IPC 왕복까지 줄이려는 것**이 아니라,
 * 사용량 탭을 열고 닫을 때마다 컴포넌트가 다시 마운트되면서 `load()` 가 불리는데
 * 그때마다 "로딩중" 으로 깜빡이지 않게 하기 위해서다. 이미 읽은 값이 있으면
 * 화면은 그 값을 계속 들고 있고, 갱신은 사용자가 새로고침을 누를 때만 한다.
 *
 * ★그래서 폴링이 없다. 앱 수명 동안 벤더 API 로 나가는 요청은 (탭 첫 진입 1회)
 * + (사용자가 새로고침을 누른 횟수) 뿐이고, 그마저 메인의 TTL·하한을 통과해야
 * 실제 요청이 된다.
 *
 * ── 상태를 접지 않는다 ──────────────────────────────────────────────────
 * 실패는 `status` 로 렌더러까지 그대로 온다(no-key / unauthorized / http-error /
 * network-error / malformed). 이 스토어는 그 값을 **가공하지 않고** 보관만 한다 —
 * 화면이 사유별로 다른 문장을 쓰기 때문이다.
 */

export type VendorBalanceLoadState = "idle" | "loading" | "loaded";

interface VendorBalanceEntry {
  state: VendorBalanceLoadState;
  /** 마지막으로 받은 결과. 갱신 중에도 **비우지 않는다**(깜빡임 방지). */
  result: VendorBalanceResult | null;
  /**
   * IPC 자체가 던졌을 때의 메시지(브리지 없음·핸들러 예외). 벤더 실패와 성격이
   * 달라 `result.status` 와 섞지 않는다.
   */
  bridgeError: string | null;
}

interface VendorBalanceState {
  byVendor: Record<string, VendorBalanceEntry>;
  /** 아직 안 읽었으면 한 번 읽는다. 이미 읽었으면 no-op. */
  load: (vendor: string) => Promise<void>;
  /** 사용자가 새로고침을 눌렀다 — 메인의 TTL 을 건너뛴다(하한은 메인이 쥔다). */
  refresh: (vendor: string) => Promise<void>;
}

const EMPTY: VendorBalanceEntry = {
  state: "idle",
  result: null,
  bridgeError: null,
};

export function vendorBalanceEntry(
  state: VendorBalanceState,
  vendor: string
): VendorBalanceEntry {
  return state.byVendor[vendor] ?? EMPTY;
}

async function fetchBalance(
  vendor: string,
  force: boolean
): Promise<VendorBalanceResult | null> {
  // Electron 밖(웹 프리뷰·컴포넌트 테스트)에는 브리지가 없다. 던지지 않고 null 로
  // 떨어뜨려 화면이 "조회불가" 를 그리게 한다 — factSheet 스토어와 같은 규율.
  const api = window.electronAPI?.usage;
  if (!api?.vendorBalance) return null;
  return api.vendorBalance(vendor, { force });
}

export const useVendorBalanceStore = create<VendorBalanceState>((set, get) => {
  const run = async (vendor: string, force: boolean) => {
    const prev = get().byVendor[vendor] ?? EMPTY;
    if (prev.state === "loading") return; // 동시 호출은 메인도 접지만 여기서 먼저 접는다
    set((s) => ({
      byVendor: { ...s.byVendor, [vendor]: { ...prev, state: "loading" } },
    }));
    try {
      const result = await fetchBalance(vendor, force);
      set((s) => ({
        byVendor: {
          ...s.byVendor,
          [vendor]: {
            state: "loaded",
            // 브리지가 없으면 이전 값을 그대로 둔다(없으면 null).
            result: result ?? prev.result,
            bridgeError: null,
          },
        },
      }));
    } catch (err) {
      set((s) => ({
        byVendor: {
          ...s.byVendor,
          [vendor]: {
            state: "loaded",
            result: prev.result,
            bridgeError: err instanceof Error ? err.message : String(err),
          },
        },
      }));
    }
  };

  return {
    byVendor: {},
    load: async (vendor) => {
      const entry = get().byVendor[vendor];
      if (entry && entry.state !== "idle") return;
      await run(vendor, false);
    },
    refresh: (vendor) => run(vendor, true),
  };
});
