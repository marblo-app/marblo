import { create } from "zustand";
import {
  BEGINNER_MODE_KEY,
  EMPTY_BEGINNER_RECORD,
  parseBeginnerRecord,
  resolveInitialBeginnerMode,
  serializeBeginnerRecord,
  type BeginnerModeRecord,
  type BeginnerModeState,
  type PriorInstallMarkers,
  type PromotionTrigger,
} from "../lib/beginnerMode";
import { ONBOARDING_PROGRESS_KEY } from "../lib/onboardingProgress";
import { DISMISSED_KEY } from "../lib/cliSetupGate";

/**
 * 비기너 모드의 영속 상태 (설계: v3/docs/BEGINNER-MODE-DESIGN.md §4).
 *
 * `workspaceModeStore` 를 **대체하지 않고 그 위에 얹힌다**: App 은
 * beginner → workspaceMode → Layout 순으로 분기하므로, 승격은 이 층을 벗는 것일
 * 뿐 워크스페이스 셸은 자기 persist 값 그대로 복원된다.
 *
 * 판정 규칙은 전부 `lib/beginnerMode` 의 순수함수에 있다. 이 파일은 localStorage
 * 와 시계를 그 규칙에 물려 주는 어댑터일 뿐이며, 읽기/쓰기 실패는 모두 삼켜
 * 인메모리로 degrade 한다(프라이빗 모드에서 앱이 죽지 않게).
 */

// 이 두 키는 다른 스토어가 소유한다 — 여기서는 **존재 여부만** 읽는다(값 해석 금지).
const WORKSPACE_TAB_KEY = "marblo.workspaceSplit.activeTab";
const WORKSPACE_MODE_KEY = "marblo.workspaceMode.enabled";

function readMarkers(): PriorInstallMarkers {
  if (typeof window === "undefined") {
    return {
      onboardingProgress: false,
      workspaceTab: false,
      workspaceModeFlag: false,
      legacyGateDismissed: false,
      // 서버/노드 환경엔 셸 자체가 없다. 여기서 beginner 를 골라 봐야 아무도
      // 안 그리지만, 규칙상 "판정 불가 = 기존 경험" 이므로 unavailable 로 둔다.
      storageUnavailable: true,
    };
  }
  try {
    const has = (k: string) => localStorage.getItem(k) !== null;
    return {
      onboardingProgress: has(ONBOARDING_PROGRESS_KEY),
      workspaceTab: has(WORKSPACE_TAB_KEY),
      workspaceModeFlag: has(WORKSPACE_MODE_KEY),
      legacyGateDismissed: has(DISMISSED_KEY),
      storageUnavailable: false,
    };
  } catch {
    return {
      onboardingProgress: false,
      workspaceTab: false,
      workspaceModeFlag: false,
      legacyGateDismissed: false,
      storageUnavailable: true,
    };
  }
}

function readStored(): BeginnerModeRecord | null {
  if (typeof window === "undefined") return null;
  try {
    return parseBeginnerRecord(localStorage.getItem(BEGINNER_MODE_KEY));
  } catch {
    return null;
  }
}

function persist(record: BeginnerModeRecord): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BEGINNER_MODE_KEY, serializeBeginnerRecord(record));
  } catch {
    // 프라이빗 모드 — 이번 세션 동안은 인메모리 값으로 동작하고 재시작 때 잃는다.
  }
}

/**
 * 모듈 평가 시점에 한 번 판정한다. 첫 렌더 전에 값이 확정돼야 셸이 한 프레임도
 * 깜빡이지 않는다(splitWorkspaceStore 가 초기 탭을 읽는 방식과 동형).
 */
function initialRecord(): {
  record: BeginnerModeRecord;
  entryReason: BeginnerEntryReason;
} {
  const stored = readStored();
  const state = resolveInitialBeginnerMode(stored, readMarkers());
  // 이미 판정이 굳어 있었다면 이번 부팅은 재시작이다 — 신규 설치로 계상하면
  // 비기너 진입 수가 세션 수만큼 부풀어 퍼널 분모가 망가진다.
  if (stored) return { record: stored, entryReason: "restart" };
  // 최초 판정 — 그대로 굳혀 둔다. 이후 다른 키가 생겨도 모드가 흔들리지 않는다.
  const record: BeginnerModeRecord = {
    ...EMPTY_BEGINNER_RECORD,
    state,
    enteredAt: state === "beginner" ? Date.now() : 0,
  };
  persist(record);
  return { record, entryReason: "fresh_install" };
}

/**
 * 이번 세션이 어떤 경로로 비기너 화면에 들어왔나 — 계측 전용(영속 아님).
 * fresh_install(최초 판정) / restart(이미 비기너인 채 재시작) / settings(설정 복귀).
 */
export type BeginnerEntryReason = "fresh_install" | "restart" | "settings";

interface BeginnerModeStoreState extends BeginnerModeRecord {
  /** 진입 계측을 이 세션에서 이미 쐈는가(중복 발화 방지, 영속 아님). */
  enteredReported: boolean;
  entryReason: BeginnerEntryReason;

  /** 어드밴스드로 승격. `trigger` 는 계측용. */
  promote: (trigger: PromotionTrigger | "manual") => void;
  /** 설정 토글에서 비기너로 되돌리기. */
  revertToBeginner: () => void;
  /** 승격 모달을 띄운 사실을 기록(다시는 안 띄운다). */
  markPromotionShown: () => void;
  /**
   * 챗 안 첫 완료를 관측했다. **최초 1회만** 기록하고, 그때의 경과(ms)를 돌려
   * 준다(계측용). 이미 기록됐으면 null.
   */
  markFirstCompletion: () => number | null;
  markEnteredReported: () => void;
}

const initial = initialRecord();

export const useBeginnerModeStore = create<BeginnerModeStoreState>(
  (set, get) => ({
    ...initial.record,
    enteredReported: false,
    entryReason: initial.entryReason,

    promote: () => {
      const next: BeginnerModeRecord = {
        state: "advanced",
        enteredAt: get().enteredAt,
        firstCompletionAt: get().firstCompletionAt,
        // 승격하는 순간 모달을 본 것으로 친다 — 되돌아왔을 때 다시 조르지 않게.
        promotionShownAt: get().promotionShownAt || Date.now(),
      };
      persist(next);
      set({ ...next });
    },

    revertToBeginner: () => {
      const next: BeginnerModeRecord = {
        state: "beginner",
        // 되돌린 시점을 새 기준으로 삼지 않는다: enteredAt 은 "이 설치가 처음
        // 비기너가 된 때" 이고, 첫완료 TTFV 의 분모라 다시 쓰면 지표가 늘어난다.
        enteredAt: get().enteredAt || Date.now(),
        firstCompletionAt: get().firstCompletionAt,
        promotionShownAt: get().promotionShownAt,
      };
      persist(next);
      set({ ...next, enteredReported: false, entryReason: "settings" });
    },

    markPromotionShown: () => {
      if (get().promotionShownAt) return;
      const next: BeginnerModeRecord = {
        state: get().state,
        enteredAt: get().enteredAt,
        firstCompletionAt: get().firstCompletionAt,
        promotionShownAt: Date.now(),
      };
      persist(next);
      set({ ...next });
    },

    markFirstCompletion: () => {
      if (get().firstCompletionAt) return null;
      const at = Date.now();
      const next: BeginnerModeRecord = {
        state: get().state,
        enteredAt: get().enteredAt,
        firstCompletionAt: at,
        promotionShownAt: get().promotionShownAt,
      };
      persist(next);
      set({ ...next });
      return get().enteredAt ? at - get().enteredAt : 0;
    },

    markEnteredReported: () => set({ enteredReported: true }),
  }),
);

/** 셸 분기용 셀렉터 — App 이 읽는 단 하나의 값. */
export function isBeginnerMode(state: BeginnerModeState): boolean {
  return state === "beginner";
}
