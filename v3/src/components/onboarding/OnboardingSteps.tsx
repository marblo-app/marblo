import React, { useState } from "react";
import { ChevronRight, ChevronLeft, Check } from "lucide-react";

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  content: React.ReactNode;
  optional?: boolean;
}

interface OnboardingStepsProps {
  steps: OnboardingStep[];
  currentStep: number;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onSkip?: () => void;
}

export const OnboardingSteps: React.FC<OnboardingStepsProps> = ({
  steps,
  currentStep,
  onStepChange,
  onComplete,
  onSkip,
}) => {
  // completedSteps is collected but not rendered yet — kept for future
  // "step X/N complete" indicator. Prefix with _ so noUnusedLocals stays
  // happy without losing the write site.
  const [, setCompletedSteps] = useState<Set<number>>(new Set());

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      onStepChange(currentStep + 1);
    } else {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      onComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      onStepChange(currentStep - 1);
    }
  };

  const handleSkipStep = () => {
    if (steps[currentStep]?.optional) {
      handleNext();
    }
  };

  const currentStepData = steps[currentStep];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-6">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {currentStepData?.title}
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            {currentStepData?.description}
          </p>
        </div>

        <div className="min-h-[400px]">{currentStepData?.content}</div>
      </div>

      <div className="border-t dark:border-gray-700 p-6">
        <div className="flex items-center justify-between">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 0}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>

          <div className="flex gap-2">
            {onSkip && currentStep === 0 && (
              <button
                onClick={onSkip}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Skip Setup
              </button>
            )}

            {currentStepData?.optional && (
              <button
                onClick={handleSkipStep}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Skip This Step
              </button>
            )}

            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {currentStep === steps.length - 1 ? (
                <>
                  Complete
                  <Check className="w-4 h-4" />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
