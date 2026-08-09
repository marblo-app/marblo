/**
 * 학습데이터 기여 동의 — 순수 로직(의존성 0).
 *
 * Firestore 를 만지는 코드는 `privacyConsentService.ts` 에 있고, 여기에는
 * "언제 물어볼 것인가" 판정과 로컬 억제 규약만 둔다(marketingConsent.ts 와 같은
 * 분리 규약) — 그래야 vitest 가 firebase 부트 없이 이 판정을 직접 검사한다.
 *
 * ── 두 축을 섞지 않는다 ──────────────────────────────────────────────
 *  - `firstPartyTelemetry` = 비식별 1차 지표(익명 설치 ID + 집계 지표). 라우팅
 *    라벨(#892)은 **이 안**에서 파생되는 비식별 특징이라 이미 커버된다. 그래서
 *    이 카드는 그 항목을 새로 받지 않는다 — 고지만 명확히 한다.
 *  - `trainingDataCapture` = 프롬프트·응답 **원문**(#889). 데이터 종류 자체가
 *    다르므로(코드·PII 포함 가능) 명시 옵트인만 인정하고, 기본은 언제나 off.
 *
 * ── 규제 불변식(PIPA 제15·22조) ─────────────────────────────────────
 *  - 카드를 봤다는 사실도, 닫았다는 사실도 동의가 아니다. `trainingDataCapture`
 *    는 사용자가 "기여" 를 누른 경우에만 true 가 된다.
 *  - 거부(나중에)는 기여와 **동등하게 쉬워야** 한다 — 둘 다 한 번의 클릭이고,
 *    거부해도 제품 동작은 완전히 동일하다.
 *  - 한 번 물어보면 끝이다. 거부한 사람을 실행마다 다시 조르지 않는다.
 *  - 이미 켠 사람에게는 뜨지 않는다(설정에서 켠 운영자 계정 포함).
 */

/**
 * 동의 문안 버전. 카드에 적힌 설명이 실질적으로 바뀌면 올린다.
 *
 * ★`CURRENT_POLICY_VERSION`(처리방침 전체)과 **일부러 분리**한다: 저쪽을 올리면
 * 전 사용자에게 PIPA 동의 모달이 다시 뜬다(#797~#809 재프롬프트 saga). 원문
 * 기여는 그 모달에 들어 있지 않은 별개 항목이므로 자체 버전을 갖는다.
 */
export const TRAINING_CONSENT_VERSION = "2026-08-09";

export interface TrainingConsentCardInput {
  /** 서명된 사용자 uid. 없으면(로그인 전) 절대 노출하지 않는다. */
  uid: string | null;
  /** 동의 레코드를 **권위 있게** 읽었나(privacyConsentStore.hasLoaded). */
  consentLoaded: boolean;
  /**
   * PIPA 동의 모달이 지금 떠야 하는 상태인가(store.needsPrompt).
   * true 면 이 카드는 뜨지 않는다 — 필수 동의 모달 위에 선택 동의 카드를
   * 겹쳐 올리면 어느 쪽에 답하는지 알 수 없다.
   */
  needsPolicyPrompt: boolean;
  /** 이미 원문 기여를 켰나. 켠 사람에게 다시 묻지 않는다. */
  alreadyOptedIn: boolean;
  /** 이 계정에 이미 한 번 물어봤나(거부 포함) — Firestore 에 남는 사실. */
  alreadyPrompted: boolean;
  /** 이 기기에서 "나중에" 를 눌렀나(로컬 억제, 서버 write 실패 대비). */
  dismissedLocally: boolean;
  /**
   * 사용자가 실제로 마블로를 쓰기 시작했나(프로젝트 1개 이상 연결).
   * 빈 첫 화면에서 기여를 묻는 것은 자연스럽지도, 정직하지도 않다 — 기여할
   * 작업이 아직 없다. 심플 모드에선 폴더 연결 직후가 이 시점이다.
   */
  hasConnectedProject: boolean;
}

/**
 * 학습데이터 기여 카드를 띄울지 판정한다. 위 조건을 **전부** 만족해야 한다.
 *
 * 읽기 실패(consentLoaded=false)는 "동의 안 함" 이 아니라 "모름" 이므로 미노출
 * 쪽으로 닫는다 — privacyConsentService 의 3-state 규약과 같은 방향이다.
 */
export function shouldShowTrainingConsentCard({
  uid,
  consentLoaded,
  needsPolicyPrompt,
  alreadyOptedIn,
  alreadyPrompted,
  dismissedLocally,
  hasConnectedProject,
}: TrainingConsentCardInput): boolean {
  if (!uid) return false;
  if (!consentLoaded) return false;
  if (needsPolicyPrompt) return false;
  if (alreadyOptedIn) return false;
  if (alreadyPrompted) return false;
  if (dismissedLocally) return false;
  return hasConnectedProject;
}

// ─── "나중에" 로컬 기록 ──────────────────────────────────────────────
// 서버 write 가 실패해도 같은 기기에서 다시 조르지 않기 위한 UI 억제일 뿐이다.
// 동의/거부라는 사실 자체는 Firestore(privacyConsent)에만 기록된다.
const DISMISS_PREFIX = "marblo:trainingConsentDismissed:";

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function trainingDismissKeyFor(uid: string, version: string): string {
  return `${DISMISS_PREFIX}${uid}:${version}`;
}

/** "나중에". best-effort — 저장 실패해도 throw 하지 않는다. */
export function rememberTrainingPromptDismissed(
  uid: string,
  version: string = TRAINING_CONSENT_VERSION,
): void {
  if (!uid || !version) return;
  try {
    safeLocalStorage()?.setItem(trainingDismissKeyFor(uid, version), "1");
  } catch {
    // private mode / quota — 서버 마커(trainingDataPrompted)가 본선이고
    // 이건 보조다. 최악의 경우 다음 실행에 한 번 더 뜬다.
  }
}

export function hasDismissedTrainingPrompt(
  uid: string,
  version: string = TRAINING_CONSENT_VERSION,
): boolean {
  if (!uid || !version) return false;
  try {
    return (
      safeLocalStorage()?.getItem(trainingDismissKeyFor(uid, version)) === "1"
    );
  } catch {
    return false;
  }
}
