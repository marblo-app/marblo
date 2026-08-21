/**
 * 처리방침 1회성 명확화 고지 — 순수 로직(의존성 0).
 *
 * trainingConsent.ts / marketingConsent.ts 와 같은 분리 규약: Firestore 를
 * 만지지 않고 "언제 띄울 것인가" 판정과 로컬 억제만 둔다(vitest 가 firebase
 * 부트 없이 판정을 직접 검사한다).
 *
 * ── 이게 왜 동의가 아니라 고지인가 (ticket woXp2c70oR0tliGB8Vs6) ────────
 * 이번 처리방침 변경은 두 조각이다.
 *   (1) 익명화 강화 — 서버가 이벤트에 붙이던 계정 UID 부착을 중단했다. 수집이
 *       **줄었고**, 문서가 원래 고지하던 "계정 UID 없는 익명 설치 ID" 가 뒤늦게
 *       사실이 됐다. 축소 방향이라 새로 받을 동의가 없다.
 *   (2) 사용량·비용 기록(계정 연결) 고지 추가 — 새 수집이 아니라 **이미 하고
 *       있던 것의 누락된 고지**다. 정산·본인 사용량 표시에 필수인 기록이라
 *       역시 "동의하지 않으면 안 하겠다" 를 제시할 수 없다.
 * 둘 다 새 동의를 받을 게 없으므로 CURRENT_POLICY_VERSION 을 올리지 않는다
 * (올리면 전 사용자에게 PIPA 모달 재프롬프트 — #797~#809 saga). 그렇다고 (2)를
 * 조용히 넘기지도 않는다. 그 사이의 정직한 자리가 이 **1회성 고지 배너**다.
 *
 * ── ★2차 고지 (2026-08-21, 티켓 vilkbSrnzbAv4ezbZMRT / CjNfGmXvynZ5bk5vLuCZ) ──
 * 사람 축 분석 개방. 이번 건은 위 두 조각과 **방향이 반대**다 — 축소도, 누락
 * 고지 보완도 아니고, 처리방침이 적어 뒀던 "계정 단위 이벤트 분석과 운영자 본인
 * 활동 제외는 포기했습니다" 라는 **약속을 거두는** 변경이다.
 *
 * 사장님 결정(2026-08-21): **CURRENT_POLICY_VERSION 은 올리지 않는다.** 새로
 * 수집하는 항목이 없고(로그인 확인에만 쓰고 버리던 값에서 파생), 재동의를 받을
 * 대상 자체가 없기 때문이다.
 *
 * ★그 대신 이 배너는 **반드시 떠야 한다.** 버전을 안 올리기로 한 이상 이 배너가
 * 유일한 고지 경로다. 여기를 빠뜨리면 "약속을 거뒀는데 아무도 모르는" 상태가
 * 되고, 그건 이 선택에서 유일하게 나쁜 결말이다. 그래서 아래
 * PRIVACY_CLARIFICATION_VERSION 을 "2026-08-21" 로 올린다 — 억제 키에 들어가는
 * 값이라, 1차 고지를 이미 닫은 사람에게도 한 번 더 뜬다.
 *
 * ── 불변식 ──────────────────────────────────────────────────────────
 *  - 이 배너는 아무것도 write 하지 않는다. 봤다는 사실도, 닫았다는 사실도
 *    동의로 기록되지 않는다(기록할 동의 자체가 없다).
 *  - 닫기는 이 기기 로컬 억제일 뿐이다. 전문은 언제나 처리방침 화면에 있다.
 *  - 아직 PIPA 동의 모달을 봐야 하는 사용자에게는 뜨지 않는다 — 그 사람은
 *    지금 최신 문구를 통째로 읽고 동의하는 중이라 고지할 "변경" 이 없다.
 */

/**
 * 고지 문안 버전. 이 배너로 알릴 내용이 또 생기면 올린다(억제 키에 들어가므로
 * 올리면 이전에 닫은 사람에게도 한 번 더 뜬다).
 *
 * ★`CURRENT_POLICY_VERSION` 과 일부러 분리한다 — 저쪽은 동의 재프롬프트 축이고
 * 이쪽은 고지 축이다. 섞으면 "고지하려다 전 사용자 재동의" 가 된다.
 *
 * 이력:
 *   2026-08-10  1차 — 익명화 강화 + 사용량·비용 기록 누락 고지 보완.
 *   2026-08-21  2차 — 사람 축 분석 개방(가명 구분값). 위 "2차 고지" 문단 참조.
 *               ★이 값을 올리는 것이 CURRENT_POLICY_VERSION 을 안 올리기로 한
 *               결정의 **조건**이다. 되돌리려면 그 결정부터 되돌려야 한다.
 */
export const PRIVACY_CLARIFICATION_VERSION = "2026-08-21";

export interface PrivacyClarificationInput {
  /** 서명된 사람 uid. 없으면(로그인 전/에이전트 신원) 노출하지 않는다. */
  uid: string | null;
  /** 동의 레코드를 권위 있게 읽었나(privacyConsentStore.hasLoaded). */
  consentLoaded: boolean;
  /**
   * PIPA 동의 모달이 지금 떠야 하는가(store.needsPrompt). true 면 뜨지 않는다 —
   * 최신 전문을 읽고 동의하려는 사람에게 "바뀐 점" 배너는 소음이다.
   */
  needsPolicyPrompt: boolean;
  /** 이 기기에서 닫았나. */
  dismissedLocally: boolean;
}

/** 1회성 명확화 고지를 띄울지 판정한다. 전부 만족해야 한다. */
export function shouldShowPrivacyClarification({
  uid,
  consentLoaded,
  needsPolicyPrompt,
  dismissedLocally,
}: PrivacyClarificationInput): boolean {
  if (!uid) return false;
  if (!consentLoaded) return false;
  if (needsPolicyPrompt) return false;
  return !dismissedLocally;
}

// ─── 닫기 로컬 기록 ─────────────────────────────────────────────────
const DISMISS_PREFIX = "marblo:privacyClarificationSeen:";

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function privacyClarificationKeyFor(
  uid: string,
  version: string,
): string {
  return `${DISMISS_PREFIX}${uid}:${version}`;
}

/** 닫음 기록. best-effort — 실패해도 throw 하지 않는다(다음 실행에 한 번 더 뜰 뿐). */
export function rememberPrivacyClarificationSeen(
  uid: string,
  version: string = PRIVACY_CLARIFICATION_VERSION,
): void {
  if (!uid || !version) return;
  try {
    safeLocalStorage()?.setItem(privacyClarificationKeyFor(uid, version), "1");
  } catch {
    // private mode / quota.
  }
}

export function hasSeenPrivacyClarification(
  uid: string,
  version: string = PRIVACY_CLARIFICATION_VERSION,
): boolean {
  if (!uid || !version) return false;
  try {
    return (
      safeLocalStorage()?.getItem(privacyClarificationKeyFor(uid, version)) ===
      "1"
    );
  } catch {
    return false;
  }
}
