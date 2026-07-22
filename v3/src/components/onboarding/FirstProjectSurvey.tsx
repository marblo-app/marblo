import { useState, useEffect } from "react";
import { telemetry } from "../../services/telemetryService";
import { useTaskStore } from "../../stores/taskStore";

export function FirstProjectSurvey() {
  const [visible, setVisible] = useState(false);
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

  const handleRate = (rating: number) => {
    try {
      localStorage.setItem("marblo.survey.first_project", "1");
    } catch {}
    telemetry.surveyFirstProject(rating);
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
      <div className="flex justify-between mt-4">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => handleRate(star)}
            className="text-3xl text-[#45475a] hover:text-[#f9e2af] transition-colors focus:outline-none"
            title={`${star}점`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}
