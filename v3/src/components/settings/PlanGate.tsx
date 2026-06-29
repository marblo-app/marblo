import { useState, type ReactNode } from "react";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import type { PlanType } from "../../types/subscription";
import { useTranslation } from "../../lib/i18n";
import { UpgradeModal } from "./UpgradeModal";

// Feature → minimum required plan
const FEATURE_REQUIRED_PLAN: Record<string, PlanType> = {
  flowEditor: "pro",
  orchestrator: "pro",
  flows: "pro",
  teamCollab: "team",
  team_members: "team",
  prioritySupport: "team",
};

interface PlanGateProps {
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PlanGate({ feature, children, fallback }: PlanGateProps) {
  const { t } = useTranslation();
  const canUse = useSubscriptionStore((s) => s.canUse);
  const [showUpgrade, setShowUpgrade] = useState(false);

  if (canUse(feature)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  const requiredPlan = FEATURE_REQUIRED_PLAN[feature] || "pro";

  return (
    <>
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
            <svg
              className="h-8 w-8 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <p className="text-lg font-medium text-gray-200">
            {t("settings.upgrade.needed")}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {t("settings.planGate.requiresPlan")
              .split("{plan}")
              .map((seg, i) =>
                i === 0 ? (
                  seg
                ) : (
                  <span key={i}>
                    <span className="font-medium text-white capitalize">
                      {requiredPlan}
                    </span>
                    {seg}
                  </span>
                ),
              )}
          </p>
          <button
            onClick={() => setShowUpgrade(true)}
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t("settings.planGate.upgradeButton")}
          </button>
        </div>
      </div>

      {showUpgrade && (
        <UpgradeModal
          feature={feature}
          requiredPlan={requiredPlan}
          onClose={() => setShowUpgrade(false)}
        />
      )}
    </>
  );
}
