import { create } from "zustand";
import {
  BEGINNER_MODE_CLAIM_KEY,
  BEGINNER_MODE_KEY,
  beginnerModeAccountKey,
  EMPTY_BEGINNER_RECORD,
  parseBeginnerRecord,
  resolveBeginnerModeForAccount,
  serializeBeginnerRecord,
  type BeginnerAccountOutcome,
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

/**
 * 지금 판정의 주인 uid. null = 아직 신원이 정해지지 않았다(로그인 전).
 *
 * ★영속 키가 여기서 갈린다 — 판정은 기기가 아니라 **계정**에 붙는다
 * (티켓 E3ywX1ftbVr5f1TrFsgp). 신원 전에는 레거시(기기) 키를 쓰는데, 그건
 * 로그인 전 화면이 비기너 셸을 그리는 일이 없으므로 사실상 안 쓰이는 자리이고,
 * 혹시 쓰이더라도 "아직 임자 없는 기기 흔적" 이라는 그 키의 정의와 일치한다.
 */
let activeUid: string | null = null;

function storageKey(): string {
  return activeUid ? beginnerModeAccountKey(activeUid) : BEGINNER_MODE_KEY;
}

function readRecordAt(key: string): BeginnerModeRecord | null {
  if (typeof window === "undefined") return null;
  try {
    return parseBeginnerRecord(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function readClaimedBy(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(BEGINNER_MODE_CLAIM_KEY);
  } catch {
    return null;
  }
}

function persist(record: BeginnerModeRecord): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(), serializeBeginnerRecord(record));
  } catch {
    // 프라이빗 모드 — 이번 세션 동안은 인메모리 값으로 동작하고 재시작 때 잃는다.
  }
}

/**
 * 기기 흔적의 임자를 적고 레거시 레코드를 거둔다 — 상속이 **한 번만** 일어나게.
 * 지우지 못해도(프라이빗 모드) 최악은 다음 계정이 한 번 더 상속하는 것뿐이다.
 */
function markMachineClaimed(uid: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BEGINNER_MODE_CLAIM_KEY, uid);
    localStorage.removeItem(BEGINNER_MODE_KEY);
  } catch {
    /* 프라이빗 모드 */
  }
}

/**
 * 이전-사용 마커는 **부팅 시점에 한 번** 찍어 둔다.
 *
 * ★판정이 모듈 평가에서 신원 채택(로그인 뒤)으로 미뤄졌기 때문에 필요한 스냅샷이다.
 * 지금은 이 마커들을 쓰는 곳이 전부 유저 조작(탭 전환·체크리스트·게이트 닫기)이라
 * 그 사이에 새로 생길 일이 없지만, 그건 **다른 파일의 사정**이다. 언젠가 부팅
 * 경로가 마커 하나를 먼저 쓰게 되면 그 순간 모든 신규 설치가 조용히 어드밴스드로
 * 떨어지고, 증상은 "가끔 심플모드가 안 뜬다" 로만 보인다. 스냅샷이 그 결합을 끊는다.
 */
const bootMarkers = readMarkers();

/**
 * 모듈 평가 시점의 **중립** 판정. 이 시점엔 uid 가 없으므로 어떤 localStorage
 * 레코드도 읽어 모드를 결정하지 않는다.
 *
 * ★인증 준비 전에는 `advanced` 를 안전한 중립값으로 둔다. 계정 레코드를 아직
 * 모르는 상태에서 `beginner` 를 고르면, 인증 채택보다 먼저 셸이 그려지는 경로가
 * 하나라도 생겼을 때 승격한 사용자를 비기너로 되돌리는 회귀가 된다. 진짜 판정과
 * 영속은 신원이 정해질 때({@link BeginnerModeStoreState.adoptAccount})만 일어난다.
 * 신규 사용자는 그 직후 계정별 레코드가 없어 `beginner` 로 채택되므로 첫 화면의
 * 의도된 동작은 그대로다.
 */
function initialRecord(): {
  record: BeginnerModeRecord;
  entryReason: BeginnerEntryReason;
} {
  return {
    record: {
      ...EMPTY_BEGINNER_RECORD,
      state: "advanced",
    },
    entryReason: "restart",
  };
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

  /**
   * ★신원을 채택한다 — 계정 귀속 판정의 유일한 입구
   * (호출부는 `lib/accountScope.resetAccountScopedState` 하나뿐이다).
   *
   * 돌려주는 값은 "이번 채택이 무엇을 했나" 다:
   *   kept/null — 그대로(같은 계정, 또는 로그아웃)
   *   claimed   — 기기 흔적을 이 계정이 물려받았다
   *   fresh     — 이 계정의 첫 실행이다(다른 계정이 쓰던 기기)
   *
   * 호출부는 `fresh` 를 보고 다른 계정 귀속 온보딩 기록(코치마크 투어)도 함께
   * 되돌린다 — 남이 완주한 안내 때문에 새 계정이 첫 실행 안내를 못 보는 일이
   * 없게.
   */
  adoptAccount: (uid: string | null) => BeginnerAccountOutcome | null;
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

    adoptAccount: (uid) => {
      // 로그아웃은 판정을 건드리지 않는다. 같은 계정으로 다시 들어오는 게 가장
      // 흔한 경로인데, 여기서 판정을 되돌리면 그 유저가 이유 없이 화면을 잃는다.
      // 로그아웃 상태에서는 비기너 셸이 그려지지 않으므로 남겨 둬도 안전하다.
      if (uid === null) return null;
      if (activeUid === uid) return null;

      activeUid = uid;
      const { record, outcome } = resolveBeginnerModeForAccount({
        uid,
        accountRecord: readRecordAt(beginnerModeAccountKey(uid)),
        legacyRecord: readRecordAt(BEGINNER_MODE_KEY),
        claimedBy: readClaimedBy(),
        markers: bootMarkers,
        now: Date.now(),
      });

      if (outcome !== "kept") persist(record);
      // ★청구 도장은 **상속했을 때만** 찍는다. fresh 에서도 찍으면(=임자를 새
      // 계정으로 갈아치우면) 그 계정의 레코드가 나중에 유실됐을 때 "임자가 나"
      // 로 읽혀 남이 남긴 마커를 자기 근거로 상속하게 된다 — 새 계정이 다시
      // 어드밴스드로 떨어지는, 이 티켓의 증상 그대로다.
      if (outcome === "claimed") markMachineClaimed(uid);
      set({
        ...record,
        // 진입 계측은 계정마다 다시 쏜다 — 아니면 두 번째 계정의 비기너 진입이
        // 퍼널에서 통째로 사라진다.
        enteredReported: false,
        entryReason: outcome === "fresh" ? "fresh_install" : "restart",
      });
      return outcome;
    },

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
  })
);

/** 셸 분기용 셀렉터 — App 이 읽는 단 하나의 값. */
export function isBeginnerMode(state: BeginnerModeState): boolean {
  return state === "beginner";
}
