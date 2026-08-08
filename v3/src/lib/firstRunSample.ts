/**
 * 첫 실행 샘플 프로젝트 자동 연결의 **판단 규칙** (티켓 yk8ouW2pS6nGzH272rXy).
 *
 * 효과(폴더 시드·프로젝트 등록)는 훅이 하고, "지금 해도 되는가" 만 여기서 정한다.
 * 이 판단이 한 칸이라도 느슨하면 증상이 지독하다 — 이미 자기 저장소를 쓰는
 * 사용자의 창이 뜬금없이 샘플 폴더로 갈아타 버린다. 그래서 순수 함수로 떼어
 * 모든 경계 조건을 테스트로 못박는다.
 */

export interface SampleSeedGate {
  /** 로그인된 사용자가 있는가 — 프로젝트 생성은 ownerId 를 요구한다. */
  signedIn: boolean;
  /**
   * Firestore 프로젝트 스냅샷이 한 번이라도 정착했는가.
   * ★이게 없으면 콜드 스타트의 빈 스냅샷을 "프로젝트 없음" 으로 오독해,
   *   이미 프로젝트가 있는 복귀 유저에게도 샘플을 물린다.
   */
  projectsHydrated: boolean;
  /** 이 계정의 프로젝트 수. 0 이 아니면 온보딩 대상이 아니다. */
  projectCount: number;
  /** 이 창이 이미 폴더를 보고 있는가(세션 복원 결과 포함). */
  hasRootPath: boolean;
  /**
   * 이 창이 **복원하려고 하는** 폴더가 이미 정해져 있는가(창별 restore 레코드나
   * 전역 app-state 의 lastRootPath).
   *
   * ★`hasRootPath` 만으로는 부족하다. 세션 복원(useSessionRestore)은 main 으로
   * 두 번 왕복한 뒤에야 rootPath 를 세우는데, 이 훅은 같은 마운트에서 **동기로**
   * 판단한다 — 그 찰나에는 아직 rootPath 가 비어 있어 "폴더 없는 신규 유저" 로
   * 보인다(클린룸 E2E Z6 실측). 프로젝트가 하나라도 있으면 projectCount 가
   * 막아주지만, 오프라인·권한오류로 스냅샷이 빈 채 정착한 복귀 유저는 그 보호도
   * 못 받는다 — 그 경우 쓰던 폴더가 샘플로 갈아치워진다.
   */
  hasRestoreTarget: boolean;
  /** 선택된 프로젝트가 있는가. */
  hasCurrentProject: boolean;
  /**
   * Cmd+Shift+N 로 연 새 창인가. 새 창은 사용자가 **직접 폴더를 고르려고**
   * 연 것이므로(Layout 의 folder-picker 화면) 자동 연결이 그 의도를 가로챈다.
   */
  isNewWindow: boolean;
  /** 이 기기에서 이미 한 번 시도했는가(localStorage 마커). */
  alreadyAttempted: boolean;
}

/**
 * 샘플을 시드하고 자동 연결해도 되는 순간인지.
 *
 * 전부 AND 다 — 하나라도 모르면(아직 hydrate 전) 하지 않는다. "나중에 한 번 더
 * 볼 기회"는 매 렌더마다 오지만, 잘못 건 자동 연결을 되돌릴 기회는 없다.
 */
export function shouldSeedSampleProject(gate: SampleSeedGate): boolean {
  if (!gate.signedIn) return false;
  if (gate.isNewWindow) return false;
  if (gate.alreadyAttempted) return false;
  if (!gate.projectsHydrated) return false;
  if (gate.projectCount > 0) return false;
  if (gate.hasCurrentProject) return false;
  if (gate.hasRootPath) return false;
  if (gate.hasRestoreTarget) return false;
  return true;
}

/**
 * 이 기기에서 자동 시드를 이미 시도했다는 마커.
 *
 * 계정이 아니라 **기기** 단위인 것이 의도다: 사용자가 샘플 프로젝트를 지우고
 * 자기 저장소만 쓰기로 했는데 다음 실행에서 샘플이 되살아나면 그건 버그다.
 */
export const SAMPLE_SEED_ATTEMPTED_KEY = "marblo:firstRunSampleSeeded";

export function hasAttemptedSampleSeed(): boolean {
  try {
    return localStorage.getItem(SAMPLE_SEED_ATTEMPTED_KEY) !== null;
  } catch {
    // private mode 등 — 읽을 수 없으면 "안 했다"로 본다. 세션 내 중복은
    // 훅의 ref 가 막으므로 최악이라도 실행마다 1회다.
    return false;
  }
}

export function rememberSampleSeedAttempt(path: string): void {
  try {
    localStorage.setItem(SAMPLE_SEED_ATTEMPTED_KEY, path);
  } catch {
    /* private mode — 다음 실행에 한 번 더 시도할 뿐, 시드는 멱등이다 */
  }
}
