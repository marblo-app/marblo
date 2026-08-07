import { create } from "zustand";
import {
  COACHMARK_KEY,
  EMPTY_TOUR_RECORD,
  parseCoachmarkStore,
  serializeCoachmarkStore,
  tourRecord,
  type CoachmarkStore as CoachmarkRecordMap,
  type CoachmarkTourRecord,
} from "../lib/coachmark";

/**
 * 코치마크 투어의 영속 상태 — "이 투어를 봤는가" 한 가지만 든다.
 *
 * 판정 규칙(다시 띄울까/그만 띄울까)은 전부 `lib/coachmark` 의 순수함수에 있고,
 * 이 파일은 localStorage 와 시계를 거기에 물려 주는 어댑터다(`beginnerModeStore`
 * 와 동형). 읽기/쓰기 실패는 삼켜 인메모리로 degrade 한다 — 프라이빗 모드에서
 * 투어 하나 때문에 앱이 죽으면 안 된다.
 */

function readStored(): CoachmarkRecordMap {
  if (typeof window === "undefined") return { tours: {} };
  try {
    return parseCoachmarkStore(localStorage.getItem(COACHMARK_KEY));
  } catch {
    return { tours: {} };
  }
}

function persist(map: CoachmarkRecordMap): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COACHMARK_KEY, serializeCoachmarkStore(map));
  } catch {
    // 프라이빗 모드 — 이번 세션 동안만 기억한다.
  }
}

interface CoachmarkStoreState {
  tours: Record<string, CoachmarkTourRecord>;
  /** 투어를 띄웠다(권한 횟수 +1). */
  markStarted: (tourId: string) => void;
  /** 끝까지 봤다 — 다시는 안 띄운다. */
  markCompleted: (tourId: string) => void;
  /** '다시 보지 않기' — 다시는 안 띄운다. */
  markDismissed: (tourId: string) => void;
  /** 설정에서 '안내 다시 보기'. 기록을 지워 처음 상태로 되돌린다. */
  resetTour: (tourId: string) => void;
}

export const useCoachmarkStore = create<CoachmarkStoreState>((set, get) => {
  const write = (tourId: string, patch: Partial<CoachmarkTourRecord>): void => {
    const current = tourRecord({ tours: get().tours }, tourId);
    const next: Record<string, CoachmarkTourRecord> = {
      ...get().tours,
      [tourId]: { ...current, ...patch },
    };
    persist({ tours: next });
    set({ tours: next });
  };

  return {
    tours: readStored().tours,

    markStarted: (tourId) =>
      write(tourId, {
        startedCount:
          tourRecord({ tours: get().tours }, tourId).startedCount + 1,
      }),

    markCompleted: (tourId) => write(tourId, { completedAt: Date.now() }),

    markDismissed: (tourId) => write(tourId, { dismissedAt: Date.now() }),

    resetTour: (tourId) => {
      const next = { ...get().tours, [tourId]: { ...EMPTY_TOUR_RECORD } };
      persist({ tours: next });
      set({ tours: next });
    },
  };
});

/** 셀렉터 — 컴포넌트가 특정 투어 기록만 구독할 때. */
export function selectTour(
  state: CoachmarkStoreState,
  tourId: string,
): CoachmarkTourRecord {
  return state.tours[tourId] ?? EMPTY_TOUR_RECORD;
}
