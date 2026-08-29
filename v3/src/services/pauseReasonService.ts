import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import type { PauseReasonCode } from "../lib/pauseReasonPrompt";

/**
 * "왜 멈췄나" 문항의 **자유서술 전용** 경로 — `submitPauseReason` callable 위의
 * 얇은 래퍼.
 *
 * ★왜 텔레메트리가 아니라 callable 인가: `lib/telemetry/scrub.ts` 는 free-form
 * note 를 스펙상 전면 차단한다(부분 스크럽은 자연어에서 신뢰할 수 없다는 이유).
 * FirstProjectSurvey → submitExperienceShareSurvey 와 같은 분업이다 — 산문은
 * 여기로, 집계는 텔레메트리로. 선택지만 고르고 한 줄을 안 쓰면 이 호출은 아예
 * 일어나지 않는다.
 */
export interface SubmitPauseReasonInput {
  reason: PauseReasonCode;
  /** 한 줄 메모. 비어 있으면 호출하지 않는다(서버도 빈 값을 거절한다). */
  note: string;
  /** 마지막 실행 이후 공백(일). 답을 읽을 때의 맥락. */
  gapDays: number;
  appVersion?: string;
}

export interface SubmitPauseReasonResult {
  ok: boolean;
  /** 이 계정이 이미 한 번 남겼다 — 덮어쓰지 않고 조용히 지나간다. */
  duplicate: boolean;
}

const submitPauseReasonFn = httpsCallable<
  SubmitPauseReasonInput,
  SubmitPauseReasonResult
>(functions, "submitPauseReason");

export async function submitPauseReason(
  input: SubmitPauseReasonInput,
): Promise<SubmitPauseReasonResult> {
  const res = await submitPauseReasonFn(input);
  return res.data;
}
