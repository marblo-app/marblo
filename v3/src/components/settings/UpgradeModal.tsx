import type { PlanType } from "../../types/subscription";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { getPlanLimits } from "../../services/billingService";
import { useUiStore } from "../../stores/uiStore";

interface UpgradeModalProps {
  feature: string;
  requiredPlan: PlanType;
  onClose: () => void;
}

const PLAN_NAMES: Record<PlanType, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  team_plus: "Team Plus",
  enterprise: "Enterprise",
};

// 마스터플랜 §2.1: Pro $15 / Team $25 per seat /
// Team Plus $245/팀 (5 seats incl., +$49/seat).
const PLAN_PRICES: Record<PlanType, string> = {
  free: "$0",
  pro: "$15/mo",
  team: "$25/seat/mo",
  team_plus: "$245/mo",
  enterprise: "Contact Sales",
};

const FEATURE_LABEL_KEYS: Record<string, MessageKey> = {
  flowEditor: "settings.upgrade.feature.flowEditor",
  teamCollab: "settings.upgrade.feature.teamCollab",
  orchestrator: "settings.upgrade.feature.orchestrator",
  prioritySupport: "settings.upgrade.feature.prioritySupport",
  projects: "settings.upgrade.feature.projects",
  agents: "settings.upgrade.feature.agents",
};

export function UpgradeModal({
  feature,
  requiredPlan,
  onClose,
}: UpgradeModalProps) {
  const { t } = useTranslation();
  const openSettingsSection = useUiStore((s) => s.openSettingsSection);

  const requiredLimits = getPlanLimits(requiredPlan);
  const featureLabelKey = FEATURE_LABEL_KEYS[feature];
  const featureLabel = featureLabelKey ? t(featureLabelKey) : feature;

  // Route to the in-app subscription page (Settings → Billing) rather than a
  // direct Paddle popup. BillingPage owns plan selection + the Toss checkout
  // path (Korea/beta launch is Toss-first). Layout switches to the Settings tab
  // when a section is requested; SettingsPage selects the Billing sub-tab.
  const handleUpgrade = () => {
    openSettingsSection("billing");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-full max-w-md rounded-lg border border-gray-700 bg-gray-800 p-6">
        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 text-gray-400 hover:text-white"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* 헤더 */}
        <div className="mb-5">
          <h2 className="text-xl font-bold text-white">
            {t("settings.upgrade.needed")}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            {t("settings.upgrade.featureRequiresPlan")
              .split(/(\{feature\}|\{plan\})/)
              .map((seg, i) => {
                if (seg === "{feature}")
                  return (
                    <span key={i} className="font-medium text-blue-400">
                      {featureLabel}
                    </span>
                  );
                if (seg === "{plan}")
                  return (
                    <span key={i} className="font-medium text-white">
                      {PLAN_NAMES[requiredPlan]}
                    </span>
                  );
                return seg;
              })}
          </p>
        </div>

        {/* 플랜 비교 */}
        <div className="mb-5 rounded-lg border border-gray-700 bg-gray-900 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-white">
                {t("settings.upgrade.planLabel", {
                  plan: PLAN_NAMES[requiredPlan],
                })}
              </p>
              <p className="text-2xl font-bold text-white">
                {PLAN_PRICES[requiredPlan]}
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-300">
            <li>
              {requiredLimits.maxProjects === Infinity
                ? t("settings.upgrade.projectsUnlimited")
                : t("settings.upgrade.projectsCount", {
                    count: requiredLimits.maxProjects,
                  })}
            </li>
            <li>
              {requiredLimits.maxAgents === Infinity
                ? t("settings.upgrade.agentsUnlimited")
                : t("settings.upgrade.agentsCount", {
                    count: requiredLimits.maxAgents,
                  })}
            </li>
            {requiredLimits.hasFlowEditor && (
              <li>{t("settings.upgrade.feature.flowEditor")}</li>
            )}
            {requiredLimits.hasOrchestrator && (
              <li>{t("settings.upgrade.feature.orchestrator")}</li>
            )}
            {requiredLimits.hasTeamCollab && (
              <li>{t("settings.upgrade.feature.teamCollab")}</li>
            )}
            {requiredLimits.hasPrioritySupport && (
              <li>{t("settings.upgrade.feature.prioritySupport")}</li>
            )}
          </ul>
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded border border-gray-600 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            {t("common.close")}
          </button>
          <button
            onClick={handleUpgrade}
            className="flex-1 rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t("settings.upgrade.upgradeTo", {
              plan: PLAN_NAMES[requiredPlan],
            })}
          </button>
        </div>
      </div>
    </div>
  );
}
