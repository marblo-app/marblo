"use client";

import { useState } from "react";
import {
  WelcomeScreen,
  OnboardingSteps,
  ProgressIndicator,
  ProfileSetupForm,
  ChannelIntegrationGuide,
  SetupWizard,
} from "../../components/onboarding";
import type {
  OnboardingStep,
  WizardConfig,
  CompanyProfile,
} from "../../components/onboarding";

interface OnboardingState {
  currentStep: number;
  completedSteps: Set<number>;
  profile?: CompanyProfile;
  channels?: { channelId: string; config: string }[];
  config?: WizardConfig;
  showWelcome: boolean;
}

export default function OnboardingPage() {
  const [state, setState] = useState<OnboardingState>({
    currentStep: 0,
    completedSteps: new Set(),
    showWelcome: true,
  });

  const handleGetStarted = () => {
    setState((prev) => ({ ...prev, showWelcome: false }));
  };

  const handleSkipOnboarding = () => {
    // 온보딩을 완전히 건너뛰고 메인 애플리케이션으로 이동
    window.location.href = "/dashboard";
  };

  const handleProfileSubmit = (profile: CompanyProfile) => {
    setState((prev) => ({
      ...prev,
      profile,
      currentStep: 1,
      completedSteps: new Set([...prev.completedSteps, 0]),
    }));
  };

  const handleChannelConnect = async (channelId: string, config: string) => {
    // 채널 연동 로직
    console.debug("Connecting channel:", channelId, config);

    setState((prev) => ({
      ...prev,
      channels: [...(prev.channels || []), { channelId, config }],
    }));
  };

  const handleChannelSkip = () => {
    setState((prev) => ({
      ...prev,
      currentStep: 2,
      completedSteps: new Set([...prev.completedSteps, 1]),
    }));
  };

  const handleWizardSave = async (config: WizardConfig) => {
    setState((prev) => ({
      ...prev,
      config,
      currentStep: 3,
      completedSteps: new Set([...prev.completedSteps, 2]),
    }));
  };

  const handleComplete = () => {
    // 온보딩 완료 처리
    console.debug("Onboarding completed with:", {
      profile: state.profile,
      channels: state.channels,
      config: state.config,
    });

    // 완료 후 대시보드로 이동
    window.location.href = "/dashboard";
  };

  const handleStepChange = (step: number) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  };

  const steps: OnboardingStep[] = [
    {
      id: "profile",
      title: "프로필 설정",
      description: "회사 정보와 마케팅 목표를 설정해주세요",
      content: (
        <ProfileSetupForm
          initialProfile={state.profile}
          onSubmit={handleProfileSubmit}
          onSkip={() => handleStepChange(1)}
        />
      ),
    },
    {
      id: "channels",
      title: "채널 연동",
      description: "마케팅 채널을 연동하여 통합 관리를 시작하세요",
      content: (
        <ChannelIntegrationGuide
          onConnect={handleChannelConnect}
          onSkip={handleChannelSkip}
        />
      ),
      optional: true,
    },
    {
      id: "preferences",
      title: "환경 설정",
      description: "개인화 설정과 보안 옵션을 구성하세요",
      content: (
        <SetupWizard
          initialConfig={state.config}
          onSave={handleWizardSave}
          onSkip={() => handleStepChange(3)}
        />
      ),
      optional: true,
    },
    {
      id: "complete",
      title: "설정 완료",
      description: "모든 설정이 완료되었습니다",
      content: (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full mb-6">
            <svg
              className="w-10 h-10 text-green-600 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            🎉 설정 완료!
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
            마블로 설정이 완료되었습니다. 이제 통합 대시보드에서 마케팅 성과를
            확인하고 관리하세요.
          </p>
          <button
            onClick={handleComplete}
            className="px-8 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors"
          >
            대시보드로 이동
          </button>
        </div>
      ),
    },
  ];

  const progressSteps = steps.map((step) => ({
    id: step.id,
    title: step.title,
  }));

  if (state.showWelcome) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <WelcomeScreen
          onGetStarted={handleGetStarted}
          onSkip={handleSkipOnboarding}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              마블로 설정
            </h1>
            <button
              onClick={handleSkipOnboarding}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              나중에 설정하기
            </button>
          </div>
          <div className="mt-6">
            <ProgressIndicator
              steps={progressSteps}
              currentStep={state.currentStep}
              completedSteps={state.completedSteps}
              variant="stepper"
            />
          </div>
        </div>

        <div className="h-[calc(100vh-140px)]">
          <OnboardingSteps
            steps={steps}
            currentStep={state.currentStep}
            onStepChange={handleStepChange}
            onComplete={handleComplete}
            onSkip={handleSkipOnboarding}
          />
        </div>
      </div>
    </div>
  );
}
