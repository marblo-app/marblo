import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useProjectStore } from '../../stores/projectStore';
import { useSubscriptionStore } from '../../stores/subscriptionStore';
import { BillingPage } from './BillingPage';
import { TeamManagement } from './TeamManagement';
import { PlanGate } from './PlanGate';
import { APIKeysSettings } from './APIKeysSettings';

type SettingsTab = 'profile' | 'models' | 'billing' | 'team' | 'apikeys';

const TABS: { id: SettingsTab; label: string; icon?: React.ReactNode }[] = [
  { id: 'profile', label: '프로필' },
  { id: 'models', label: '에이전트 모델' },
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
        {activeTab === 'models' && <ModelPresetSection />}
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

const PRESETS = [
  { id: 'claude-only', label: 'Claude 100%', desc: 'All agents use Claude (highest quality)', icon: '🟣' },
  { id: 'recommended', label: 'Marblo Recommended', desc: 'Claude 60% + Gemini 20% + Codex 20%', icon: '🎯' },
  { id: 'balanced', label: 'Balanced', desc: 'Equal rotation across all models', icon: '⚖️' },
  { id: 'codex-only', label: 'Codex/GPT 100%', desc: 'All agents use OpenAI Codex/GPT', icon: '🟢' },
  { id: 'gemini-only', label: 'Gemini 100%', desc: 'All agents use Google Gemini', icon: '🔵' },
];

function ModelPresetSection() {
  const [current, setCurrent] = useState('recommended');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.electronAPI.modelPreset.get().then(setCurrent).catch(() => {});
  }, []);

  const handleSelect = async (preset: string) => {
    setSaving(true);
    try {
      await window.electronAPI.modelPreset.set(preset);
      setCurrent(preset);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-1 text-sm font-medium text-gray-200">Agent Model Preset</h3>
        <p className="mb-4 text-xs text-gray-500">
          오케스트레이터가 새 에이전트를 스폰할 때 어떤 모델을 사용할지 결정합니다.
          태스크에 특정 tags가 있으면 최적 모델이 자동 선택되고, 없으면 프리셋 비율로 배분됩니다.
        </p>
        <div className="space-y-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              disabled={saving}
              className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                current === p.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-gray-700 hover:border-gray-600 hover:bg-gray-700/50'
              }`}
            >
              <span className="text-xl">{p.icon}</span>
              <div className="flex-1">
                <span className={`text-sm font-medium ${current === p.id ? 'text-blue-400' : 'text-gray-200'}`}>
                  {p.label}
                </span>
                <p className="text-xs text-gray-500">{p.desc}</p>
              </div>
              {current === p.id && (
                <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
