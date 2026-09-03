import { telemetry } from "../../services/telemetryService";

interface Props {
  onComplete: () => void;
}

export function CliFailSurvey({ onComplete }: Props) {
  const options = [
    "Claude Code 설치",
    "로그인",
    "CLI",
    "잘 모르겠다",
    "기타",
  ];

  const handleSelect = (reason: string) => {
    try {
      localStorage.setItem("marblo.survey.cli_fail", "1");
    } catch {
      // localStorage unavailable (private mode, quota, etc.) — best effort only
    }
    telemetry.surveyCliFail(reason);
    onComplete();
  };

  const handleSkip = () => {
    try {
      localStorage.setItem("marblo.survey.cli_fail", "1");
    } catch {
      // localStorage unavailable (private mode, quota, etc.) — best effort only
    }
    onComplete();
  };

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-[#cdd6f4] mb-2">
        무엇이 어려우셨나요?
      </h3>
      <p className="text-sm text-[#a6adc8] mb-4">
        5초만 시간 내어 알려주시면 마블로 개선에 큰 도움이 됩니다.
      </p>
      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => handleSelect(opt)}
            className="w-full text-left px-4 py-2 rounded-md border border-[#45475a] text-[#cdd6f4] hover:bg-[#313244] transition-colors"
          >
            {opt}
          </button>
        ))}
      </div>
      <div className="mt-4 text-right">
        <button
          onClick={handleSkip}
          className="text-xs text-[#a6adc8] hover:text-[#cdd6f4]"
        >
          건너뛰기
        </button>
      </div>
    </div>
  );
}
