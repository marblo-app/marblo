// Founder 설문 회신 유도 인앱 팝업(FounderSurveyGate)의 노출 정책.
//
// 오퍼: "선정된 파운더가 성실 설문(7문항)을 회신하면 운영자 검토 후 Pro 최대
// 3개월 무료." 이 동선을 실제로 노출/유도하는 인앱 팝업이 없어 신설한다.
//
// ★라이브 노출 게이트: 실제 사용자 대상 대량 노출은 사장님 승인 전까지 금지.
// 기본값 OFF — dev/staging 에서 NEXT_PUBLIC_FOUNDER_SURVEY_PROMPT_OPEN=true 로만
// 켠다. (isPromoBarOpen 은 기본 ON 이지만 이건 지급성 오퍼라 기본 OFF.)

/** 팝업 노출 자체가 켜졌는지(환경 플래그). 기본 OFF. */
export function isFounderSurveyPromptOpen(): boolean {
  return process.env.NEXT_PUBLIC_FOUNDER_SURVEY_PROMPT_OPEN === "true";
}

// dismiss 상태는 uid 별로 저장 — 다른 계정으로 로그인하면 다시 판단한다.
const DISMISS_KEY_PREFIX = "founder-survey-prompt:";

// 재노출 정책(사장님 지시): 설문을 완료(feedbackSubmitted=true)하기 전까지는
// "방문(세션)당 1회, 매 접속마다" 계속 넛지한다. 즉 닫아도 다음 접속 때 또 뜬다.
// 구현: dismiss 상태를 sessionStorage 에만 저장 → 같은 세션(탭) 안에서는 다시
// 안 뜨지만(스팸 방지), 새 세션/재접속이면 sessionStorage 가 비어 다시 노출된다.
// 영구 localStorage 쿨다운/최대횟수 상한은 제거 — 완료 여부만이 영구 중단 조건.

function keyFor(uid: string): string {
  return `${DISMISS_KEY_PREFIX}${uid}`;
}

/** 이번 세션(탭)에서 이미 닫았는지. sessionStorage 라 새 방문이면 false. */
function wasDismissedThisSession(uid: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(keyFor(uid)) === "1";
  } catch {
    // sessionStorage 접근 불가(프라이버시 모드 등) → 억제 정보 없음 = 노출 쪽.
    return false;
  }
}

/**
 * 지금 이 파운더에게 팝업을 보여줄지. 노출 조건:
 *   1) 환경 플래그 ON (isFounderSurveyPromptOpen)
 *   2) 선정된 파운더(hasAccess) AND 아직 미회신(!feedbackSubmitted)
 *   3) 이번 세션에서 아직 닫지 않음(닫으면 이 세션 동안만 억제, 다음 접속 재노출)
 * 판정은 순수 함수라 SSR/CSR 어디서든 안전(window 없으면 false).
 */
export function shouldShowFounderSurveyPrompt(params: {
  hasAccess: boolean;
  feedbackSubmitted: boolean;
  uid: string;
}): boolean {
  const { hasAccess, feedbackSubmitted, uid } = params;
  if (!isFounderSurveyPromptOpen()) return false;
  if (!hasAccess || feedbackSubmitted) return false;
  if (typeof window === "undefined") return false;
  return !wasDismissedThisSession(uid);
}

/**
 * 사용자가 팝업을 닫음 — 이번 세션 동안만 억제하도록 sessionStorage 에 표시.
 * 다음 방문(새 세션/재접속)에는 세션 저장소가 비어 다시 노출된다.
 */
export function recordFounderSurveyPromptDismissed(uid: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(keyFor(uid), "1");
  } catch {
    // 저장 실패는 무시 — 최악의 경우 같은 세션에서 한 번 더 노출될 뿐이다.
  }
}
