import { useState, useEffect } from "react";
import { telemetry } from "../../services/telemetryService";
import { useTaskStore } from "../../stores/taskStore";

export function FirstProjectSurvey() {
  const [visible, setVisible] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const tasks = useTaskStore((s) => s.tasks);

  useEffect(() => {
    let done = false;
    try {
      done = localStorage.getItem("marblo.survey.first_project") === "1";
    } catch {}
    
    if (done) return;

    const hasDone = tasks.some((t) => t.status === "DONE");
    if (hasDone) {
      setVisible(true);
    }
  }, [tasks]);

  if (!visible) return null;

  const handleSubmit = () => {
    if (rating === 0) return;

    try {
      localStorage.setItem("marblo.survey.first_project", "1");
    } catch {}
    telemetry.surveyFirstProject(rating, feedback.trim() || undefined);
    setVisible(false);
  };

  const handleSkip = () => {
    try {
      localStorage.setItem("marblo.survey.first_project", "1");
    } catch {}
    setVisible(false);
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-80 rounded-xl border border-[#313244] bg-[#1e1e2e] shadow-2xl p-5">
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-base font-semibold text-[#cdd6f4]">오늘 어땠나요?</h3>
        <button onClick={handleSkip} className="text-[#a6adc8] hover:text-[#cdd6f4]">
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
        간단히 개선점이나 좋았던 점을 적어 주세요
        <span className="text-[#6c7086]"> (선택)</span>
      </label>
      <textarea
        id="first-project-survey-feedback"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        className="mt-2 h-20 w-full resize-none rounded-lg border border-[#313244] bg-[#11111b] px-3 py-2 text-sm text-[#cdd6f4] outline-none transition-colors placeholder:text-[#6c7086] focus:border-[#89b4fa]"
        maxLength={500}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={rating === 0}
        className="mt-4 w-full rounded-lg bg-[#89b4fa] px-4 py-2 text-sm font-semibold text-[#11111b] transition-colors hover:bg-[#b4befe] disabled:cursor-not-allowed disabled:bg-[#45475a] disabled:text-[#a6adc8]"
      >
        제출
      </button>
    </div>
  );
}
