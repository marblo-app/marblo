import { useState, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useProjectStore } from "../../stores/projectStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useTranslation } from "../../lib/i18n";
import { BillingPage } from "./BillingPage";
import { TeamManagement } from "./TeamManagement";
import { PlanGate } from "./PlanGate";
import { APIKeysSettings } from "./APIKeysSettings";
import { PrivacySettings } from "./PrivacySettings";

type SettingsTab =
  | "profile"
  | "models"
  | "billing"
  | "team"
  | "apikeys"
  | "privacy"
  | "language";

interface TabSpec {
  id: SettingsTab;
  labelKey:
    | "settings.tab.profile"
    | "settings.tab.models"
    | "settings.tab.billing"
    | "settings.tab.team"
    | "settings.tab.privacy"
    | "settings.tab.apikeys"
    | "settings.tab.language";
  icon?: React.ReactNode;
}

const TABS: TabSpec[] = [
  { id: "profile", labelKey: "settings.tab.profile" },
  { id: "models", labelKey: "settings.tab.models" },
  { id: "billing", labelKey: "settings.tab.billing" },
  { id: "team", labelKey: "settings.tab.team" },
  { id: "privacy", labelKey: "settings.tab.privacy" },
  { id: "language", labelKey: "settings.tab.language" },
  {
    id: "apikeys",
    labelKey: "settings.tab.apikeys",
    icon: (
      <svg
        className="mr-1.5 inline h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25z"
        />
      </svg>
    ),
  },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const getPlan = useSubscriptionStore((s) => s.getPlan);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  const plan = getPlan();

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">
            {t("settings.title")}
          </h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              plan === "team"
                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                : plan === "pro"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-gray-500/20 text-gray-400 border border-gray-500/30"
            }`}
          >
            {plan.toUpperCase()} {t("header.planBadge.suffix")}
          </span>
        </div>

        {/* Tab navigation */}
        <div className="mb-6 flex border-b border-gray-700">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-blue-500 text-blue-400"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.icon}
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "profile" && <ProfileSection />}
        {activeTab === "models" && <ModelPresetSection />}
        {activeTab === "billing" && <BillingPage />}
        {activeTab === "team" &&
          (currentProject ? (
            <PlanGate feature="team_members">
              <TeamManagement projectId={currentProject.id} />
            </PlanGate>
          ) : (
            <div className="py-12 text-center text-sm text-gray-500">
              {t("settings.team.selectProjectFirst")}
            </div>
          ))}
        {activeTab === "apikeys" && <APIKeysSettings />}
        {activeTab === "privacy" && <PrivacySettings />}
        {activeTab === "language" && <LanguageSection />}
      </div>
    </div>
  );
}

function ProfileSection() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-4 text-sm font-medium text-gray-200">
          {t("settings.profile.heading")}
        </h3>
        <div className="flex items-center gap-4">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              className="h-16 w-16 rounded-full"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500 text-xl font-medium text-white">
              {user?.displayName?.[0] || user?.email?.[0] || "?"}
            </div>
          )}
          <div>
            <p className="text-lg font-medium text-white">
              {user?.displayName || "User"}
            </p>
            <p className="text-sm text-gray-400">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-4 text-sm font-medium text-gray-200">
          {t("settings.account.heading")}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400">
              {t("settings.account.name")}
            </label>
            <p className="mt-1 text-sm text-gray-200">
              {user?.displayName || "-"}
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-400">
              {t("settings.account.email")}
            </label>
            <p className="mt-1 text-sm text-gray-200">{user?.email || "-"}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400">
              {t("settings.account.uid")}
            </label>
            <p className="mt-1 font-mono text-xs text-gray-500">{user?.uid}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LanguageSection() {
  const { t, locale, setLocale } = useTranslation();
  const OPTIONS: {
    id: "ko" | "en";
    labelKey: "settings.language.korean" | "settings.language.english";
  }[] = [
    { id: "ko", labelKey: "settings.language.korean" },
    { id: "en", labelKey: "settings.language.english" },
  ];
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-1 text-sm font-medium text-gray-200">
          {t("settings.language.heading")}
        </h3>
        <p className="mb-4 text-xs text-gray-500">
          {t("settings.language.help")}
        </p>
        <div className="space-y-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setLocale(opt.id)}
              className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                locale === opt.id
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-700 hover:border-gray-600 hover:bg-gray-700/50"
              }`}
            >
              <span className="text-xl">{opt.id === "ko" ? "🇰🇷" : "🇺🇸"}</span>
              <div className="flex-1">
                <span
                  className={`text-sm font-medium ${
                    locale === opt.id ? "text-blue-400" : "text-gray-200"
                  }`}
                >
                  {t(opt.labelKey)}
                </span>
                <p className="text-xs text-gray-500">{opt.id.toUpperCase()}</p>
              </div>
              {locale === opt.id && (
                <svg
                  className="h-5 w-5 text-blue-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const PRESETS = [
  {
    id: "claude-only",
    label: "Claude 100%",
    desc: "All agents use Claude (highest quality)",
    icon: "🟣",
  },
  {
    id: "recommended",
    label: "Marblo Recommended",
    desc: "Claude 60% + Antigravity 20% + Codex 20%",
    icon: "🎯",
  },
  {
    id: "balanced",
    label: "Balanced",
    desc: "Equal rotation across Claude / Antigravity / Codex",
    icon: "⚖️",
  },
  {
    id: "codex-only",
    label: "Codex 100%",
    desc: "All agents use OpenAI Codex",
    icon: "🟢",
  },
  {
    id: "antigravity-only",
    label: "Antigravity 100%",
    desc: "All agents use Google Antigravity (agy)",
    icon: "🟠",
  },
];

function ModelPresetSection() {
  const [current, setCurrent] = useState("recommended");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.electronAPI.modelPreset
      .get()
      .then(setCurrent)
      .catch(() => {});
  }, []);

  const handleSelect = async (preset: string) => {
    setSaving(true);
    try {
      await window.electronAPI.modelPreset.set(preset);
      setCurrent(preset);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-1 text-sm font-medium text-gray-200">
          Agent Model Preset
        </h3>
        <p className="mb-4 text-xs text-gray-500">
          오케스트레이터가 새 에이전트를 스폰할 때 어떤 모델을 사용할지
          결정합니다. 태스크에 특정 tags가 있으면 최적 모델이 자동 선택되고,
          없으면 프리셋 비율로 배분됩니다.
        </p>
        <div className="space-y-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              disabled={saving}
              className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                current === p.id
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-700 hover:border-gray-600 hover:bg-gray-700/50"
              }`}
            >
              <span className="text-xl">{p.icon}</span>
              <div className="flex-1">
                <span
                  className={`text-sm font-medium ${
                    current === p.id ? "text-blue-400" : "text-gray-200"
                  }`}
                >
                  {p.label}
                </span>
                <p className="text-xs text-gray-500">{p.desc}</p>
              </div>
              {current === p.id && (
                <svg
                  className="h-5 w-5 text-blue-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
      <SubscriptionPlansSection />
    </div>
  );
}

// Patent claim 8 (구독제 vs 토큰단위 과금체계 구분):
// 사용자가 어떤 모델을 구독제로 쓰는지 선언하면 cost-tracker 가
// per-token 단가 대신 월정액 + 한도 기반으로 비용을 산출함. 빈 리스트면
// 모든 모델은 기본 토큰단가로 과금 (현행 동작과 동일).
function SubscriptionPlansSection() {
  const [plans, setPlans] = useState<SubscriptionPlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.subscriptionPlans
      .list()
      .then((p) => {
        setPlans(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const update = (i: number, patch: Partial<SubscriptionPlanEntry>) => {
    setPlans((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  };

  const addPlan = () => {
    setPlans((prev) => [
      ...prev,
      { modelPrefix: "claude-opus", monthlyFlatUsd: 200 },
    ]);
  };

  const removePlan = (i: number) => {
    setPlans((prev) => prev.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.subscriptionPlans.save(plans);
      if (result.success) {
        setSavedAt(Date.now());
      } else {
        setError(result.error || "저장 실패");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <h3 className="mb-1 text-sm font-medium text-gray-200">
        구독제 플랜 등록
      </h3>
      <p className="mb-4 text-xs text-gray-500">
        Claude Max, ChatGPT Plus 처럼 월정액 구독으로 쓰는 모델이 있으면 여기
        등록하세요. 등록된 모델은 토큰 단가가 아닌 월정액으로 비용이 계산되고,
        선택적으로 월간 토큰 한도를 넘으면 그 초과분만 토큰 단가로 과금합니다.
        등록 안 하면 기본 토큰 단가가 적용됩니다.
      </p>

      <div className="space-y-3">
        {plans.length === 0 && (
          <p className="text-xs text-gray-500 italic">
            등록된 구독 플랜이 없습니다. 모든 모델은 토큰 단가로 과금됩니다.
          </p>
        )}
        {plans.map((p, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 rounded border border-gray-700 bg-gray-900/40 p-3"
          >
            <input
              className="w-40 rounded bg-gray-800 px-2 py-1 text-xs text-gray-200"
              placeholder="claude-opus"
              value={p.modelPrefix}
              onChange={(e) => update(i, { modelPrefix: e.target.value })}
            />
            <span className="text-xs text-gray-500">월정액 USD</span>
            <input
              type="number"
              min={0}
              step={1}
              className="w-20 rounded bg-gray-800 px-2 py-1 text-xs text-gray-200"
              value={p.monthlyFlatUsd}
              onChange={(e) =>
                update(i, { monthlyFlatUsd: Number(e.target.value) || 0 })
              }
            />
            <span className="text-xs text-gray-500">월 토큰한도</span>
            <input
              type="number"
              min={0}
              step={100000}
              className="w-32 rounded bg-gray-800 px-2 py-1 text-xs text-gray-200"
              placeholder="(선택)"
              value={p.monthlyTokenAllowance ?? ""}
              onChange={(e) =>
                update(i, {
                  monthlyTokenAllowance: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
            />
            <button
              onClick={() => removePlan(i)}
              className="ml-auto rounded bg-red-500/20 px-2 py-1 text-xs text-red-400 hover:bg-red-500/30"
            >
              삭제
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={addPlan}
          className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700/50"
        >
          + 플랜 추가
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-blue-500/20 px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
        {savedAt && <span className="text-xs text-green-400">저장됨</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
