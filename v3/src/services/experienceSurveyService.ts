import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

export interface SubmitExperienceShareSurveyInput {
  rating: number;
  liked: string;
  improvements: string;
  shareUrl: string;
  sessionCount: number;
}

export interface SubmitExperienceShareSurveyResult {
  ok: boolean;
  id: string;
  rewardMonths: number;
  reviewStatus: "pending_review" | "already_submitted";
  grantApplied: boolean;
  periodEnd?: string;
}

const submitExperienceShareSurveyFn = httpsCallable<
  SubmitExperienceShareSurveyInput,
  SubmitExperienceShareSurveyResult
>(functions, "submitExperienceShareSurvey");

export async function submitExperienceShareSurvey(
  input: SubmitExperienceShareSurveyInput,
): Promise<SubmitExperienceShareSurveyResult> {
  const res = await submitExperienceShareSurveyFn(input);
  return res.data;
}
