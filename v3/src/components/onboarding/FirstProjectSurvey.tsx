import { useState, useEffect } from "react";
import { telemetry } from "../../services/telemetryService";
import { submitExperienceShareSurvey } from "../../services/experienceSurveyService";
import {
  hasSubmittedExperienceSurvey,
  incrementExperienceSurveySession,
  isValidShareUrl,
  markExperienceSurveyPrompted,
  markExperienceSurveySubmitted,
  readExperienceSurveyLastPromptedSession,
  shouldShowExperienceSurveyPrompt,
} from "../../lib/experienceSurveyPrompt";

function safeLocalStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function safeSessionStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function FirstProjectSurvey() {
  const [visible, setVisible] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [liked, setLiked] = useState("");
  const [improvements, setImprovements] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storage = safeLocalStorage();
    const currentSessionCount = incrementExperienceSurveySession(
      storage,
      safeSessionStorage(),
    );
    setSessionCount(currentSessionCount);

    const shouldShow = shouldShowExperienceSurveyPrompt({
      sessionCount: currentSessionCount,
      submitted: hasSubmittedExperienceSurvey(storage),
      lastPromptedSession: readExperienceSurveyLastPromptedSession(storage),
    });
    if (shouldShow) {
      markExperienceSurveyPrompted(storage, currentSessionCount);
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const trimmedLiked = liked.trim();
  const trimmedImprovements = improvements.trim();
  const trimmedShareUrl = shareUrl.trim();
  const canSubmit =
    rating > 0 &&
    (trimmedLiked.length > 0 || trimmedImprovements.length > 0) &&
    isValidShareUrl(trimmedShareUrl) &&
    !submitting;

  const handleSubmit = async () => {
    if (rating === 0) return;
    if (!isValidShareUrl(trimmedShareUrl)) {
      setError("SNS 공유 링크를 http 또는 https URL로 붙여주세요.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await submitExperienceShareSurvey({
        rating,
        liked: trimmedLiked,
        improvements: trimmedImprovements,
        shareUrl: trimmedShareUrl,
        sessionCount,
      });
      if (!result.ok) {
        throw new Error("submit_failed");
      }
      markExperienceSurveySubmitted(safeLocalStorage());
      telemetry.surveyFirstProject(rating, {
        likedLength: trimmedLiked.length,
        improvementsLength: trimmedImprovements.length,
        hasShareUrl: true,
        rewardMonths: result.rewardMonths,
        reviewStatus: result.reviewStatus,
        grantApplied: result.grantApplied,
      });
      setVisible(false);
    } catch {
      setError("제출에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    setVisible(false);
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-[#313244] bg-[#1e1e2e] p-5 shadow-2xl">
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="text-xs font-medium uppercase text-[#89b4fa]">
            Experience survey
          </p>
          <h3 className="mt-1 text-base font-semibold text-[#cdd6f4]">
            마블로 사용경험은 어땠나요?
          </h3>
        </div>
        <button
          type="button"
          onClick={handleSkip}
          className="text-[#a6adc8] hover:text-[#cdd6f4]"
          aria-label="설문 닫기"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div
        className="flex justify-between mt-4"
        onMouseLeave={() => setHoverRating(0)}
        aria-label="첫 프로젝트 경험 별점"
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onMouseEnter={() => setHoverRating(star)}
            onFocus={() => setHoverRating(star)}
            onBlur={() => setHoverRating(0)}
            onClick={() => setRating(star)}
            className={`text-3xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f9e2af] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1e2e] ${
              star <= (hoverRating || rating) ? "text-[#f9e2af]" : "text-[#45475a]"
            }`}
            aria-pressed={star <= rating}
            title={`${star}점`}
          >
            ★
          </button>
        ))}
      </div>
      <label className="mt-4 block text-sm text-[#a6adc8]" htmlFor="first-project-survey-feedback">
        좋았던 점
      </label>
      <textarea
        id="first-project-survey-feedback"
        value={liked}
        onChange={(event) => setLiked(event.target.value)}
        className="mt-2 h-20 w-full resize-none rounded-lg border border-[#313244] bg-[#11111b] px-3 py-2 text-sm text-[#cdd6f4] outline-none transition-colors placeholder:text-[#6c7086] focus:border-[#89b4fa]"
        maxLength={1000}
        placeholder="작업 흐름, 에이전트 협업, 결과물 등 좋았던 점을 적어주세요."
      />
      <label className="mt-4 block text-sm text-[#a6adc8]" htmlFor="first-project-survey-improvements">
        개선점
      </label>
      <textarea
        id="first-project-survey-improvements"
        value={improvements}
        onChange={(event) => setImprovements(event.target.value)}
        className="mt-2 h-20 w-full resize-none rounded-lg border border-[#313244] bg-[#11111b] px-3 py-2 text-sm text-[#cdd6f4] outline-none transition-colors placeholder:text-[#6c7086] focus:border-[#89b4fa]"
        maxLength={1000}
        placeholder="막혔던 점이나 다음에 좋아졌으면 하는 부분을 적어주세요."
      />
      <label className="mt-4 block text-sm text-[#a6adc8]" htmlFor="first-project-survey-share-url">
        마블로 경험을 SNS에 공유하고 링크를 붙여주세요
      </label>
      <input
        id="first-project-survey-share-url"
        type="url"
        value={shareUrl}
        onChange={(event) => setShareUrl(event.target.value)}
        className="mt-2 w-full rounded-lg border border-[#313244] bg-[#11111b] px-3 py-2 text-sm text-[#cdd6f4] outline-none transition-colors placeholder:text-[#6c7086] focus:border-[#89b4fa]"
        placeholder="https://..."
      />
      <p className="mt-2 text-xs leading-5 text-[#a6adc8]">
        인스타, 블로그, 유튜브 등 어떤 링크든 가능합니다. 제출하면 5개월 Pro 무료
        리워드가 자동 적용되고 어드민 검토 플래그가 함께 남습니다.
      </p>
      {error && <p className="mt-3 text-xs text-[#f38ba8]">{error}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="mt-4 w-full rounded-lg bg-[#89b4fa] px-4 py-2 text-sm font-semibold text-[#11111b] transition-colors hover:bg-[#b4befe] disabled:cursor-not-allowed disabled:bg-[#45475a] disabled:text-[#a6adc8]"
      >
        {submitting ? "제출 중..." : "링크 제출하고 5개월 Pro 받기"}
      </button>
    </div>
  );
}
