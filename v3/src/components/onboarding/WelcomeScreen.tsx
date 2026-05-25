import React from "react";
import {
  Rocket,
  BarChart3,
  Zap,
  Users,
  Target,
  ArrowRight,
  CheckCircle,
} from "lucide-react";

interface WelcomeScreenProps {
  onGetStarted: () => void;
  onSkip?: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onGetStarted,
  onSkip,
}) => {
  const features = [
    {
      icon: <BarChart3 className="w-6 h-6" />,
      title: "통합 대시보드",
      description: "모든 채널의 성과를 한눈에 확인하고 분석하세요",
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "자동화 워크플로우",
      description: "반복 작업을 자동화하여 효율성을 극대화하세요",
    },
    {
      icon: <Target className="w-6 h-6" />,
      title: "AI 기반 최적화",
      description: "AI가 분석한 인사이트로 마케팅 성과를 개선하세요",
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: "팀 협업",
      description: "팀원들과 실시간으로 협업하고 소통하세요",
    },
  ];

  const steps = [
    "프로필 설정 및 기본 정보 입력",
    "마케팅 채널 연동 (Google Ads, Meta, 네이버 등)",
    "대시보드 개인화 설정",
    "팀원 초대 및 권한 설정",
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] p-8 text-center">
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-6">
          <Rocket className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
          마블로에 오신 것을 환영합니다!
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          통합 마케팅 플랫폼으로 여러 채널의 성과를 한곳에서 관리하고
          최적화하세요. 몇 분만 투자하면 바로 시작할 수 있습니다.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 max-w-6xl">
        {features.map((feature, index) => (
          <div
            key={index}
            className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
          >
            <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg mb-4">
              {feature.icon}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {feature.title}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              {feature.description}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mb-8">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 text-left">
          🚀 설정 단계 (약 5분 소요)
        </h3>
        <ul className="space-y-3 text-left">
          {steps.map((step, index) => (
            <li key={index} className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">{step}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-4">
        <button
          onClick={onGetStarted}
          className="flex items-center gap-2 px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
        >
          시작하기
          <ArrowRight className="w-5 h-5" />
        </button>
        {onSkip && (
          <button
            onClick={onSkip}
            className="px-8 py-3 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors"
          >
            나중에 설정하기
          </button>
        )}
      </div>
    </div>
  );
};
