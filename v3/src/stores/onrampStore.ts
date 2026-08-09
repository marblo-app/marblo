import { create } from "zustand";
import {
  checkOnrampQuota,
  type OnrampQuotaVerdict,
} from "../lib/onrampDecompose";

/**
 * L0 온램프의 **한도 원장과 모달 재노출 기록**
 * (설계: v3/docs/onramp-ladder-design-2026-08-09.md §4-F·§5-A).
 *
 * 두 축이 한 스토어에 있는 이유는 둘이 **같은 사건으로 움직이기** 때문이다:
 * 분해 한도가 소진되는 순간이 곧 M1(연결 안내)을 띄우는 순간이다(설계 §4-F —
 * "초과 시 조용한 실패 금지, M1 로 유도").
 *
 * ── 영속 규칙 ────────────────────────────────────────────────────────────
 *  - **분해 횟수·생애 티켓 수는 persist 한다.** 재시작으로 한도가 초기화되면
 *    "생애 21장" 이 그냥 사라진다(보드 위생이 이 한도의 목적이다 — R2).
 *  - **M1 노출 횟수는 persist 하지 않는다.** 설계가 정한 축이 "세션당 2회" 라
 *    새 세션에서는 다시 0 이어야 한다.
 *
 * 저장 실패(프라이빗 모드)는 전부 삼키고 인메모리로 degrade 한다 —
 * `beginnerModeStore` 와 같은 자세다. 한도를 못 적는 것이 앱을 죽일 이유는 없다.
 */

export const ONRAMP_STORAGE_KEY = "marblo.onramp.l0";

interface OnrampRecord {
  /** 분해를 몇 번 돌렸나(설계 §4-F: 3회). */
  decomposeCount: number;
  /** L0 데모로 보드에 실제로 만든 티켓 수(생애 21장). */
  demoTicketCount: number;
}

const EMPTY: OnrampRecord = { decomposeCount: 0, demoTicketCount: 0 };

function readRecord(): OnrampRecord {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(ONRAMP_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<OnrampRecord>;
    return {
      decomposeCount: Number(parsed.decomposeCount) || 0,
      demoTicketCount: Number(parsed.demoTicketCount) || 0,
    };
  } catch {
    return EMPTY;
  }
}

function writeRecord(record: OnrampRecord): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ONRAMP_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* 프라이빗 모드 — 인메모리로 계속 간다 */
  }
}

interface OnrampState extends OnrampRecord {
  /** 이번 **세션**에 M1 을 띄운 횟수(persist 하지 않는다). */
  blockShownThisSession: number;
  /** 분해 1회 + 그 결과로 만든 티켓 수를 함께 기록한다. */
  recordDecompose: (ticketCount: number) => void;
  markBlockShown: () => void;
  quota: () => OnrampQuotaVerdict;
  /** 테스트·프리뷰용 초기화. 실제 UI 에는 걸려 있지 않다. */
  reset: () => void;
}

export const useOnrampStore = create<OnrampState>((set, get) => ({
  ...readRecord(),
  blockShownThisSession: 0,

  recordDecompose: (ticketCount) => {
    const next: OnrampRecord = {
      decomposeCount: get().decomposeCount + 1,
      demoTicketCount: get().demoTicketCount + Math.max(0, ticketCount),
    };
    writeRecord(next);
    set(next);
  },

  markBlockShown: () =>
    set((s) => ({ blockShownThisSession: s.blockShownThisSession + 1 })),

  quota: () =>
    checkOnrampQuota({
      decomposeCount: get().decomposeCount,
      demoTicketCount: get().demoTicketCount,
    }),

  reset: () => {
    writeRecord(EMPTY);
    set({ ...EMPTY, blockShownThisSession: 0 });
  },
}));
