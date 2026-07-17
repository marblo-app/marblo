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

// 재노출 규칙: 한 번 닫으면 쿨다운 동안 억제하되, 오퍼 가치가 크고 베타 창이
// 한정적이라 최대 횟수까지는 쿨다운 후 다시 부드럽게 넛지한다. 그 뒤엔 영구 중단.
const REPROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7일
const MAX_PROMPTS = 3;

interface DismissRecord {
  dismissedAt: number;
  count: number;
}

function keyFor(uid: string): string {
  return `${DISMISS_KEY_PREFIX}${uid}`;
}

function readRecord(uid: string): DismissRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DismissRecord>;
    if (typeof parsed?.dismissedAt !== "number") return null;
    return {
      dismissedAt: parsed.dismissedAt,
      count: typeof parsed.count === "number" ? parsed.count : 1,
    };
  } catch {
    return null;
  }
}

/**
 * 지금 이 파운더에게 팝업을 보여줄지. 노출 조건:
 *   1) 환경 플래그 ON (isFounderSurveyPromptOpen)
 *   2) 선정된 파운더(hasAccess) AND 아직 미회신(!feedbackSubmitted)
 *   3) dismiss 쿨다운이 지났고 최대 노출 횟수를 넘지 않음
 * 판정은 순수 함수라 SSR/CSR 어디서든 안전(window 없으면 false).
 */
export function shouldShowFounderSurveyPrompt(params: {
  hasAccess: boolean;
  feedbackSubmitted: boolean;
  uid: string;
  now: number;
}): boolean {
  const { hasAccess, feedbackSubmitted, uid, now } = params;
  if (!isFounderSurveyPromptOpen()) return false;
  if (!hasAccess || feedbackSubmitted) return false;
  if (typeof window === "undefined") return false;

  const record = readRecord(uid);
  if (!record) return true;
  if (record.count >= MAX_PROMPTS) return false;
  return now - record.dismissedAt >= REPROMPT_COOLDOWN_MS;
}

/** 사용자가 팝업을 닫음 — dismiss 시각과 누적 노출 횟수를 기록. */
export function recordFounderSurveyPromptDismissed(
  uid: string,
  now: number
): void {
  if (typeof window === "undefined") return;
  const prev = readRecord(uid);
  const next: DismissRecord = {
    dismissedAt: now,
    count: (prev?.count ?? 0) + 1,
  };
  try {
    window.localStorage.setItem(keyFor(uid), JSON.stringify(next));
  } catch {
    // 저장 실패는 무시 — 최악의 경우 다음 로드에서 다시 노출될 뿐이다.
  }
}
