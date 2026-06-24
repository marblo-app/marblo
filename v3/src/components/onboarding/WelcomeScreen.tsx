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
import { useTranslation } from "../../lib/i18n";

interface WelcomeScreenProps {
  onGetStarted: () => void;
  onSkip?: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onGetStarted,
  onSkip,
}) => {
  const { t } = useTranslation();

  const features = [
    {
      icon: <BarChart3 className="w-6 h-6" />,
      title: t("onboarding.welcome.feature.dashboard.title"),
      description: t("onboarding.welcome.feature.dashboard.desc"),
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: t("onboarding.welcome.feature.automation.title"),
      description: t("onboarding.welcome.feature.automation.desc"),
    },
    {
      icon: <Target className="w-6 h-6" />,
      title: t("onboarding.welcome.feature.ai.title"),
      description: t("onboarding.welcome.feature.ai.desc"),
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: t("onboarding.welcome.feature.collaboration.title"),
      description: t("onboarding.welcome.feature.collaboration.desc"),
    },
  ];

  const steps = [
    t("onboarding.welcome.step.profile"),
    t("onboarding.welcome.step.channels"),
    t("onboarding.welcome.step.dashboard"),
    t("onboarding.welcome.step.team"),
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] p-8 text-center">
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-6">
          <Rocket className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
          {t("onboarding.welcome.title")}
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          {t("onboarding.welcome.subtitle")}
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
          {t("onboarding.welcome.stepsTitle")}
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
          {t("onboarding.welcome.getStarted")}
          <ArrowRight className="w-5 h-5" />
        </button>
        {onSkip && (
          <button
            onClick={onSkip}
            className="px-8 py-3 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors"
          >
            {t("onboarding.common.setupLater")}
          </button>
        )}
      </div>
    </div>
  );
};
