import React, { useState } from "react";
import { User, Building, Target, ChevronDown, ArrowRight } from "lucide-react";

interface CompanyProfile {
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

const industries = [
  "이커머스/온라인 쇼핑",
  "패션/뷰티",
  "식품/음료",
  "전자제품/가전",
  "건강/의료",
  "교육/학습",
  "여행/숙박",
  "부동산",
  "금융/보험",
  "IT/소프트웨어",
  "게임/엔터테인먼트",
  "스포츠/피트니스",
  "기타",
];

const businessTypes = [
  "B2C (개인 고객 대상)",
  "B2B (기업 고객 대상)",
  "B2B2C (하이브리드)",
  "마켓플레이스",
  "SaaS/구독 서비스",
  "기타",
];

const teamSizes = [
  "1명 (개인)",
  "2-5명",
  "6-20명",
  "21-50명",
  "51-200명",
  "201명 이상",
];

const budgetRanges = [
  "월 100만원 미만",
  "월 100-500만원",
  "월 500-1,000만원",
  "월 1,000-5,000만원",
  "월 5,000만원 이상",
  "예산 미정",
];

const primaryGoals = [
  "매출 증대",
  "신규 고객 확보",
  "브랜드 인지도 향상",
  "고객 재구매율 증가",
  "마케팅 ROI 개선",
  "경쟁사 대비 우위 확보",
  "글로벌 진출",
  "신제품 론칭",
  "계절성 매출 대응",
  "데이터 기반 의사결정",
];

export const ProfileSetupForm: React.FC<ProfileSetupFormProps> = ({
  initialProfile,
  onSubmit,
  onSkip,
}) => {
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
      newErrors.companyName = "회사명을 입력해주세요";
    }
    if (!profile.industry) {
      newErrors.industry = "업종을 선택해주세요";
    }
    if (!profile.businessType) {
      newErrors.businessType = "사업 유형을 선택해주세요";
    }
    if (!profile.teamSize) {
      newErrors.teamSize = "팀 규모를 선택해주세요";
    }
    if (profile.primaryGoals.length === 0) {
      newErrors.primaryGoals = "최소 1개의 목표를 선택해주세요";
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
          프로필 설정
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          더 나은 추천과 분석을 위해 기본 정보를 입력해주세요
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <User className="w-5 h-5" />
            기본 정보
          </h3>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                회사명 *
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
                placeholder="우리 회사"
              />
              {errors.companyName && (
                <p className="text-sm text-red-600 mt-1">
                  {errors.companyName}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                웹사이트
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
                업종 *
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
                  <option value="">업종을 선택해주세요</option>
                  {industries.map((industry) => (
                    <option key={industry} value={industry}>
                      {industry}
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
                사업 유형 *
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
                  <option value="">사업 유형을 선택해주세요</option>
                  {businessTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
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
                팀 규모 *
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
                  <option value="">팀 규모를 선택해주세요</option>
                  {teamSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
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
                월 마케팅 예산
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
                  <option value="">예산 범위를 선택해주세요</option>
                  {budgetRanges.map((range) => (
                    <option key={range} value={range}>
                      {range}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              회사 소개
            </label>
            <textarea
              value={profile.description}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, description: e.target.value }))
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="회사의 주요 사업이나 특징을 간단히 설명해주세요"
            />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Target className="w-5 h-5" />
            마케팅 목표 *
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            주요 마케팅 목표를 선택해주세요 (복수 선택 가능)
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {primaryGoals.map((goal) => (
              <button
                key={goal}
                type="button"
                onClick={() => toggleGoal(goal)}
                className={`p-3 text-left border rounded-lg transition-all ${
                  profile.primaryGoals.includes(goal)
                    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                    : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500"
                }`}
              >
                <span className="text-sm font-medium">{goal}</span>
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
              건너뛰기
            </button>
          )}
          <button
            type="submit"
            className="ml-auto flex items-center gap-2 px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            다음 단계
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
};
