import { useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useDeployStore } from '../../stores/deployStore';
import { useOrchestratorStore } from '../../stores/orchestratorStore';

export function DeployTab() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const gcpConfig = useDeployStore((s) => s.gcpConfig);
  const deployments = useDeployStore((s) => s.deployments);
  const loading = useDeployStore((s) => s.loading);
  const subscribeToConfig = useDeployStore((s) => s.subscribeToConfig);
  const subscribeToDeployments = useDeployStore((s) => s.subscribeToDeployments);
  const ptySessionId = useOrchestratorStore((s) => s.ptySessionId);
  const orchestratorStatus = useOrchestratorStore((s) => s.status);

  useEffect(() => {
    if (!currentProject?.id) return;
    const unsubConfig = subscribeToConfig(currentProject.id);
    const unsubDeploys = subscribeToDeployments(currentProject.id);
    return () => {
      unsubConfig();
      unsubDeploys();
    };
  }, [currentProject?.id, subscribeToConfig, subscribeToDeployments]);

  const isOrchestratorRunning = orchestratorStatus === 'running';

  const handleDeployRequest = async () => {
    if (!ptySessionId || !isOrchestratorRunning) return;
    const configInfo = gcpConfig?.connected
      ? `GCP 프로젝트: ${gcpConfig.projectId}, 리전: ${gcpConfig.region}`
      : '';
    const prompt = `현재 프로젝트를 Cloud Run에 배포해줘. ${configInfo}. deploy.sh 스크립트를 참고해서 Docker 빌드 → 푸시 → Cloud Run 배포 진행.`;
    await window.electronAPI.pty.write(ptySessionId, prompt + '\r');
  };

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        프로젝트를 선택해주세요
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Deploy</h1>
            <p className="text-sm text-gray-400">GCP Cloud Run 배포 관리</p>
          </div>
          <button
            onClick={handleDeployRequest}
            disabled={!isOrchestratorRunning}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              isOrchestratorRunning
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'cursor-not-allowed bg-gray-700 text-gray-500'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            배포 요청
          </button>
        </div>

        {/* GCP Connection Card */}
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${gcpConfig?.connected ? 'bg-green-400' : 'bg-gray-600'}`} />
              <div>
                <h2 className="text-sm font-semibold text-white">GCP 연결</h2>
                {gcpConfig?.connected ? (
                  <p className="text-xs text-gray-400">
                    {gcpConfig.projectId} · {gcpConfig.region}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">연결되지 않음</p>
                )}
              </div>
            </div>
            {!gcpConfig?.connected && (
              <button
                onClick={() => {
                  if (!ptySessionId || !isOrchestratorRunning) return;
                  window.electronAPI.pty.write(
                    ptySessionId,
                    'GCP 프로젝트를 연결해줘. gcloud auth login + 프로젝트 설정 가이드를 진행해줘.\r',
                  );
                }}
                disabled={!isOrchestratorRunning}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  isOrchestratorRunning
                    ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                    : 'cursor-not-allowed text-gray-600'
                }`}
              >
                연결 설정
              </button>
            )}
          </div>
        </div>

        {/* Deployment History */}
        <div className="rounded-lg border border-gray-700 bg-gray-800">
          <div className="border-b border-gray-700 px-5 py-3">
            <h2 className="text-sm font-semibold text-white">배포 이력</h2>
          </div>
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">로딩 중...</div>
          ) : deployments.length === 0 ? (
            <div className="p-8 text-center">
              <svg className="mx-auto h-12 w-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="mt-2 text-sm text-gray-500">아직 배포 이력이 없습니다</p>
              <p className="mt-1 text-xs text-gray-600">
                오케스트레이터에게 <span className="text-blue-400">/tf-deploy</span>로 배포를 요청하세요
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {deployments.map((d) => (
                <div key={d.id} className="flex items-center gap-4 px-5 py-3">
                  <StatusBadge status={d.status} />
                  <div className="flex-1">
                    <p className="text-sm text-white">{d.serviceName}</p>
                    <p className="text-xs text-gray-500">{d.image}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">
                      {d.startedAt.toLocaleString('ko-KR')}
                    </p>
                    <p className="text-xs text-gray-500">{d.triggeredBy}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Guide */}
        {!gcpConfig?.connected && (
          <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 p-5">
            <h3 className="text-sm font-semibold text-gray-300">시작하기</h3>
            <ol className="mt-3 space-y-2 text-xs text-gray-400">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400">1</span>
                오케스트레이터를 시작하고 <span className="text-blue-400">"GCP 프로젝트 연결해줘"</span>라고 요청
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400">2</span>
                <span><code className="text-green-400">gcloud auth login</code> + 프로젝트 ID / 리전 설정</span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400">3</span>
                <span><span className="text-blue-400">/tf-deploy</span>로 Cloud Run 배포 요청</span>
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-500/20 text-gray-400',
    building: 'bg-yellow-500/20 text-yellow-400',
    deploying: 'bg-blue-500/20 text-blue-400',
    success: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}
