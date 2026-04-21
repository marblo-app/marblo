import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { PlanType } from '../../types/subscription';
import { openPaddleCheckout, getPlanLimits } from '../../services/billingService';

interface UpgradeModalProps {
  feature: string;
  requiredPlan: PlanType;
  onClose: () => void;
}

const PLAN_NAMES: Record<PlanType, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
};

const PLAN_PRICES: Record<PlanType, string> = {
  free: '$0',
  pro: '$19/mo',
  team: '$49/mo',
};

const FEATURE_LABELS: Record<string, string> = {
  flowEditor: 'Flow 에디터',
  teamCollab: '팀 협업',
  orchestrator: '오케스트레이터',
  prioritySupport: '우선 지원',
};

export function UpgradeModal({ feature, requiredPlan, onClose }: UpgradeModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const requiredLimits = getPlanLimits(requiredPlan);
  const featureLabel = FEATURE_LABELS[feature] ?? feature;

  const handleUpgrade = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const priceId = import.meta.env[`VITE_PADDLE_${requiredPlan.toUpperCase()}_PRICE_ID`] || '';
      await openPaddleCheckout(user.uid, priceId, user.email || undefined);
      onClose();
    } catch (err) {
      if ((err as Error).message !== '결제 취소') {
        console.error('Checkout 실패:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-full max-w-md rounded-lg border border-gray-700 bg-gray-800 p-6">
        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 text-gray-400 hover:text-white"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* 헤더 */}
        <div className="mb-5">
          <h2 className="text-xl font-bold text-white">업그레이드 필요</h2>
          <p className="mt-2 text-sm text-gray-400">
            <span className="font-medium text-blue-400">{featureLabel}</span> 기능은{' '}
            <span className="font-medium text-white">{PLAN_NAMES[requiredPlan]}</span> 플랜부터 사용 가능합니다.
          </p>
        </div>

        {/* 플랜 비교 */}
        <div className="mb-5 rounded-lg border border-gray-700 bg-gray-900 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-white">{PLAN_NAMES[requiredPlan]} 플랜</p>
              <p className="text-2xl font-bold text-white">{PLAN_PRICES[requiredPlan]}</p>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-300">
            <li>프로젝트 {requiredLimits.maxProjects === Infinity ? '무제한' : `${requiredLimits.maxProjects}개`}</li>
            <li>에이전트 {requiredLimits.maxAgents === Infinity ? '무제한' : `${requiredLimits.maxAgents}개`}</li>
            {requiredLimits.hasFlowEditor && <li>Flow 에디터</li>}
            {requiredLimits.hasOrchestrator && <li>오케스트레이터</li>}
            {requiredLimits.hasTeamCollab && <li>팀 협업</li>}
            {requiredLimits.hasPrioritySupport && <li>우선 지원</li>}
          </ul>
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded border border-gray-600 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            닫기
          </button>
          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="flex-1 rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '처리 중...' : `${PLAN_NAMES[requiredPlan]}으로 업그레이드`}
          </button>
        </div>
      </div>
    </div>
  );
}
