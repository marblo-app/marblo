import React, { useState } from "react";
import { User, Building, Target, ChevronDown, ArrowRight } from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";

export interface CompanyProfile {
  companyName: string;
  industry: string;
  businessType: string;
  teamSize: string;
  monthlyBudget: string;
  primaryGoals: string[];
  website?: string;
  description?: string;
}

interface ProfileSetupFormProps {
  initialProfile?: Partial<CompanyProfile>;
  onSubmit: (profile: CompanyProfile) => void;
  onSkip?: () => void;
}

/**
 * Data labels: the `value` is a stable English code identifier (what gets
 * stored on the profile), and `labelKey` is the translated display label.
 * Translating the stored value would break persistence/comparison — see
 * ../../locales/README.md §"데이터 겸 UI 라벨".
 */
interface LabeledOption {
  value: string;
  labelKey: MessageKey;
}

const industries: LabeledOption[] = [
  { value: "ecommerce", labelKey: "onboarding.industry.ecommerce" },
  { value: "fashionBeauty", labelKey: "onboarding.industry.fashionBeauty" },
  { value: "foodBeverage", labelKey: "onboarding.industry.foodBeverage" },
  { value: "electronics", labelKey: "onboarding.industry.electronics" },
  { value: "healthMedical", labelKey: "onboarding.industry.healthMedical" },
  { value: "education", labelKey: "onboarding.industry.education" },
  { value: "travel", labelKey: "onboarding.industry.travel" },
  { value: "realEstate", labelKey: "onboarding.industry.realEstate" },
  { value: "finance", labelKey: "onboarding.industry.finance" },
  { value: "software", labelKey: "onboarding.industry.software" },
  {
    value: "gameEntertainment",
    labelKey: "onboarding.industry.gameEntertainment",
  },
  { value: "sportsFitness", labelKey: "onboarding.industry.sportsFitness" },
  { value: "other", labelKey: "onboarding.industry.other" },
];

const businessTypes: LabeledOption[] = [
  { value: "b2c", labelKey: "onboarding.businessType.b2c" },
  { value: "b2b", labelKey: "onboarding.businessType.b2b" },
  { value: "b2b2c", labelKey: "onboarding.businessType.b2b2c" },
  { value: "marketplace", labelKey: "onboarding.businessType.marketplace" },
  { value: "saas", labelKey: "onboarding.businessType.saas" },
  { value: "other", labelKey: "onboarding.businessType.other" },
];

const teamSizes: LabeledOption[] = [
  { value: "solo", labelKey: "onboarding.teamSize.solo" },
  { value: "2to5", labelKey: "onboarding.teamSize.2to5" },
  { value: "6to20", labelKey: "onboarding.teamSize.6to20" },
  { value: "21to50", labelKey: "onboarding.teamSize.21to50" },
  { value: "51to200", labelKey: "onboarding.teamSize.51to200" },
  { value: "201plus", labelKey: "onboarding.teamSize.201plus" },
];

const budgetRanges: LabeledOption[] = [
  { value: "under1m", labelKey: "onboarding.budget.under1m" },
  { value: "1to5m", labelKey: "onboarding.budget.1to5m" },
  { value: "5to10m", labelKey: "onboarding.budget.5to10m" },
  { value: "10to50m", labelKey: "onboarding.budget.10to50m" },
  { value: "over50m", labelKey: "onboarding.budget.over50m" },
  { value: "undecided", labelKey: "onboarding.budget.undecided" },
];

const goalOptions: LabeledOption[] = [
  { value: "revenue", labelKey: "onboarding.goal.revenue" },
  { value: "newCustomers", labelKey: "onboarding.goal.newCustomers" },
  { value: "brandAwareness", labelKey: "onboarding.goal.brandAwareness" },
  { value: "retention", labelKey: "onboarding.goal.retention" },
  { value: "roi", labelKey: "onboarding.goal.roi" },
  { value: "competitive", labelKey: "onboarding.goal.competitive" },
  { value: "global", labelKey: "onboarding.goal.global" },
  { value: "productLaunch", labelKey: "onboarding.goal.productLaunch" },
  { value: "seasonal", labelKey: "onboarding.goal.seasonal" },
  { value: "dataDecision", labelKey: "onboarding.goal.dataDecision" },
];

export const ProfileSetupForm: React.FC<ProfileSetupFormProps> = ({
  initialProfile,
  onSubmit,
  onSkip,
}) => {
  const { t } = useTranslation();

  const [profile, setProfile] = useState<CompanyProfile>({
    companyName: "",
    industry: "",
    businessType: "",
    teamSize: "",
    monthlyBudget: "",
    primaryGoals: [],
    website: "",
    description: "",
    ...initialProfile,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!profile.companyName.trim()) {
      newErrors.companyName = t("onboarding.profile.error.companyName");
    }
    if (!profile.industry) {
      newErrors.industry = t("onboarding.profile.industryPlaceholder");
    }
    if (!profile.businessType) {
      newErrors.businessType = t("onboarding.profile.businessTypePlaceholder");
    }
    if (!profile.teamSize) {
      newErrors.teamSize = t("onboarding.profile.teamSizePlaceholder");
    }
    if (profile.primaryGoals.length === 0) {
      newErrors.primaryGoals = t("onboarding.profile.error.primaryGoals");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(profile);
    }
  };

  const toggleGoal = (goal: string) => {
    setProfile((prev) => ({
      ...prev,
      primaryGoals: prev.primaryGoals.includes(goal)
        ? prev.primaryGoals.filter((g) => g !== goal)
        : [...prev.primaryGoals, goal],
    }));
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mb-4">
          <Building className="w-8 h-8 text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {t("onboarding.profile.title")}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {t("onboarding.profile.subtitle")}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <User className="w-5 h-5" />
            {t("onboarding.profile.basicInfo")}
          </h3>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t("onboarding.profile.companyName")} *
              </label>
              <input
                type="text"
                value={profile.companyName}
                onChange={(e) =>
                  setProfile((prev) => ({
                    ...prev,
                    companyName: e.target.value,
                  }))
                }
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.companyName
                    ? "border-red-300 dark:border-red-600"
                    : "border-gray-300 dark:border-gray-600"
                }`}
                placeholder={t("onboarding.profile.companyNamePlaceholder")}
              />
              {errors.companyName && (
                <p className="text-sm text-red-600 mt-1">
                  {errors.companyName}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t("onboarding.profile.website")}
              </label>
              <input
                type="url"
                value={profile.website}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, website: e.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t("onboarding.profile.industry")} *
              </label>
              <div className="relative">
                <select
                  value={profile.industry}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      industry: e.target.value,
                    }))
                  }
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none ${
                    errors.industry
                      ? "border-red-300 dark:border-red-600"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                >
                  <option value="">
                    {t("onboarding.profile.industryPlaceholder")}
                  </option>
                  {industries.map((industry) => (
                    <option key={industry.value} value={industry.value}>
                      {t(industry.labelKey)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              {errors.industry && (
                <p className="text-sm text-red-600 mt-1">{errors.industry}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t("onboarding.profile.businessType")} *
              </label>
              <div className="relative">
                <select
                  value={profile.businessType}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      businessType: e.target.value,
                    }))
                  }
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none ${
                    errors.businessType
                      ? "border-red-300 dark:border-red-600"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                >
                  <option value="">
                    {t("onboarding.profile.businessTypePlaceholder")}
                  </option>
                  {businessTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {t(type.labelKey)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              {errors.businessType && (
                <p className="text-sm text-red-600 mt-1">
                  {errors.businessType}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t("onboarding.profile.teamSize")} *
              </label>
              <div className="relative">
                <select
                  value={profile.teamSize}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      teamSize: e.target.value,
                    }))
                  }
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none ${
                    errors.teamSize
                      ? "border-red-300 dark:border-red-600"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                >
                  <option value="">
                    {t("onboarding.profile.teamSizePlaceholder")}
                  </option>
                  {teamSizes.map((size) => (
                    <option key={size.value} value={size.value}>
                      {t(size.labelKey)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              {errors.teamSize && (
                <p className="text-sm text-red-600 mt-1">{errors.teamSize}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t("onboarding.profile.budget")}
              </label>
              <div className="relative">
                <select
                  value={profile.monthlyBudget}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      monthlyBudget: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                >
                  <option value="">
                    {t("onboarding.profile.budgetPlaceholder")}
                  </option>
                  {budgetRanges.map((range) => (
                    <option key={range.value} value={range.value}>
                      {t(range.labelKey)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("onboarding.profile.description")}
            </label>
            <textarea
              value={profile.description}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, description: e.target.value }))
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("onboarding.profile.descriptionPlaceholder")}
            />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Target className="w-5 h-5" />
            {t("onboarding.profile.goalsTitle")} *
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t("onboarding.profile.goalsHint")}
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {goalOptions.map((goal) => (
              <button
                key={goal.value}
                type="button"
                onClick={() => toggleGoal(goal.value)}
                className={`p-3 text-left border rounded-lg transition-all ${
                  profile.primaryGoals.includes(goal.value)
                    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                    : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500"
                }`}
              >
                <span className="text-sm font-medium">{t(goal.labelKey)}</span>
              </button>
            ))}
          </div>
          {errors.primaryGoals && (
            <p className="text-sm text-red-600 mt-2">{errors.primaryGoals}</p>
          )}
        </div>

        <div className="flex items-center justify-between pt-6">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium"
            >
              {t("onboarding.common.skip")}
            </button>
          )}
          <button
            type="submit"
            className="ml-auto flex items-center gap-2 px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t("onboarding.profile.next")}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
};
