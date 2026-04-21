import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useProjectStore } from '../../stores/projectStore';
import { useSubscriptionStore } from '../../stores/subscriptionStore';
import { BillingPage } from './BillingPage';
import { TeamManagement } from './TeamManagement';
import { PlanGate } from './PlanGate';
import { APIKeysSettings } from './APIKeysSettings';

type SettingsTab = 'profile' | 'billing' | 'team' | 'apikeys';

const TABS: { id: SettingsTab; label: string; icon?: React.ReactNode }[] = [
  { id: 'profile', label: '프로필' },
  { id: 'billing', label: '결제' },
  { id: 'team', label: '팀' },
  {
    id: 'apikeys',
    label: 'API Keys',
    icon: (
      <svg className="mr-1.5 inline h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
  const currentProject = useProjectStore((s) => s.currentProject);
  const getPlan = useSubscriptionStore((s) => s.getPlan);
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

  const plan = getPlan();

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">설정</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${
            plan === 'team' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
            plan === 'pro' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
            'bg-gray-500/20 text-gray-400 border border-gray-500/30'
          }`}>
            {plan.toUpperCase()} Plan
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
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'profile' && <ProfileSection />}
        {activeTab === 'billing' && <BillingPage />}
        {activeTab === 'team' && (
          currentProject ? (
            <PlanGate feature="team_members">
              <TeamManagement projectId={currentProject.id} />
            </PlanGate>
          ) : (
            <div className="py-12 text-center text-sm text-gray-500">
              프로젝트를 먼저 선택해주세요.
            </div>
          )
        )}
        {activeTab === 'apikeys' && <APIKeysSettings />}
      </div>
    </div>
  );
}

function ProfileSection() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-4 text-sm font-medium text-gray-200">프로필 정보</h3>
        <div className="flex items-center gap-4">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="h-16 w-16 rounded-full" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500 text-xl font-medium text-white">
              {user?.displayName?.[0] || user?.email?.[0] || '?'}
            </div>
          )}
          <div>
            <p className="text-lg font-medium text-white">
              {user?.displayName || 'User'}
            </p>
            <p className="text-sm text-gray-400">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-4 text-sm font-medium text-gray-200">계정 정보</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400">이름</label>
            <p className="mt-1 text-sm text-gray-200">{user?.displayName || '-'}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400">이메일</label>
            <p className="mt-1 text-sm text-gray-200">{user?.email || '-'}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400">UID</label>
            <p className="mt-1 font-mono text-xs text-gray-500">{user?.uid}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
