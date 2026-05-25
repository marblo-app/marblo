import React from "react";
import { Check } from "lucide-react";

interface ProgressIndicatorProps {
  steps: Array<{
    id: string;
    title: string;
  }>;
  currentStep: number;
  completedSteps?: Set<number>;
  onStepClick?: (step: number) => void;
  variant?: "dots" | "bar" | "stepper";
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  steps,
  currentStep,
  completedSteps = new Set(),
  onStepClick,
  variant = "stepper",
}) => {
  if (variant === "dots") {
    return (
      <div className="flex items-center justify-center gap-2">
        {steps.map((_, index) => (
          <button
            key={index}
            onClick={() => onStepClick?.(index)}
            disabled={!onStepClick}
            className={`w-2 h-2 rounded-full transition-all ${
              index === currentStep
                ? "w-8 bg-blue-600"
                : completedSteps.has(index)
                  ? "bg-green-600"
                  : "bg-gray-300 dark:bg-gray-600"
            } ${onStepClick ? "cursor-pointer hover:opacity-80" : ""}`}
          />
        ))}
      </div>
    );
  }

  if (variant === "bar") {
    const progress = ((currentStep + 1) / steps.length) * 100;

    return (
      <div className="w-full">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Step {currentStep + 1} of {steps.length}
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {Math.round(progress)}% Complete
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          <div className="flex items-center">
            <button
              onClick={() => onStepClick?.(index)}
              disabled={
                !onStepClick ||
                (!completedSteps.has(index) && index !== currentStep)
              }
              className={`
                relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all
                ${
                  index === currentStep
                    ? "border-blue-600 bg-blue-600 text-white"
                    : completedSteps.has(index)
                      ? "border-green-600 bg-green-600 text-white"
                      : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400"
                }
                ${
                  onStepClick &&
                  (completedSteps.has(index) || index === currentStep)
                    ? "cursor-pointer hover:opacity-80"
                    : "cursor-default"
                }
              `}
            >
              {completedSteps.has(index) ? (
                <Check className="w-5 h-5" />
              ) : (
                <span className="text-sm font-semibold">{index + 1}</span>
              )}
            </button>

            <div className={`ml-3 ${index !== steps.length - 1 ? "mr-4" : ""}`}>
              <p
                className={`text-sm font-medium ${
                  index === currentStep
                    ? "text-gray-900 dark:text-white"
                    : completedSteps.has(index)
                      ? "text-green-600 dark:text-green-500"
                      : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {step.title}
              </p>
            </div>
          </div>

          {index < steps.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-4 transition-all ${
                completedSteps.has(index)
                  ? "bg-green-600"
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};
