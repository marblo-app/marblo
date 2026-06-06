import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import OrchestratorTerminal from "../orchestrator/OrchestratorTerminal";
import { ErrorBoundary } from "../ErrorBoundary";

// Missions 탭 상단에 inline 으로 들어가는 mission orchestrator PTY 패널.
//
// 설계 원칙 (Layout 깨짐 회귀 방지):
//   - 기본은 collapsed: terminal 자체를 mount 하지 않음 (xterm 인스턴스 0개)
//   - 사용자가 "PTY 보기" 누르면 mount, "숨기기" 로 unmount
//   - ErrorBoundary 로 감싸 panel 실패가 tab 전체로 번지지 않게
//   - 작은 고정 높이 (160px) → 페이지 스크롤 안 깨짐
//   - preload 미준비 시 정보 메시지만, 다른 탭에 영향 0
//
// 같은 projectId 의 mission orchestrator 는 Phase A 의 missionOrchestrators map
// 에 보관되어 PtySkillRunner 가 ensureSession 으로 동일 인스턴스 reuse 한다.
// 사용자가 PTY 패널을 안 열어도 미션은 동작함 — 패널은 가시화 / 직접 입력용.

interface SessionInfo {
  sessionId: string;
  ptySessionId: string;
  status: string;
}

const PTY_HEIGHT = 200;

export function MissionOrchestratorPanel() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const rootPath = useEditorStore((s) => s.rootPath);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<string>("stopped");
  const [error, setError] = useState<string | null>(null);

  const api = window.electronAPI?.missionOrchestrator;
  const [restarting, setRestarting] = useState(false);

  // status listener — open 여부 관계없이 항상 부착 (state 보여주기용).
  useEffect(() => {
    if (!api) return;
    api.onStatusChange(({ status }) => setStatus(status));
    return () => {
      try {
        api.removeStatusListener();
      } catch {
        /* best-effort */
      }
    };
  }, [api]);

  // Restart: stop + 짧은 대기 후 start. 비어있는 PTY 복구 / 세션 재시도용.
  const handleRestart = async () => {
    if (!api || !currentProject?.id || !rootPath) return;
    setRestarting(true);
    setError(null);
    try {
      await api.stop(currentProject.id);
      setSession(null);
      // status 가 stopped 로 도달할 때까지 짧게 대기 (PTY exit 처리 시간).
      await new Promise((r) => setTimeout(r, 500));
      const fresh = await api.start({
        projectId: currentProject.id,
        rootPath,
      });
      if (fresh) {
        setSession(fresh);
        setStatus(fresh.status);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  };

  // open=true 일 때만 session 조회/시작.
  useEffect(() => {
    if (!api || !open) return;
    if (!currentProject?.id || !rootPath) return;
    const projectId = currentProject.id;
    let cancelled = false;
    (async () => {
      try {
        const existing = await api.getSession(projectId);
        if (existing && existing.ptySessionId && !cancelled) {
          setSession(existing);
          setStatus(existing.status);
          return;
        }
        const fresh = await api.start({ projectId, rootPath });
        if (!cancelled && fresh) {
          setSession(fresh);
          setStatus(fresh.status);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, open, currentProject?.id, rootPath]);

  if (!currentProject?.id || !rootPath) return null;

  const statusColor =
    status === "running"
      ? "bg-emerald-400"
      : status === "starting"
        ? "bg-yellow-400 animate-pulse"
        : status === "error"
          ? "bg-red-400"
          : "bg-gray-500";

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/50">
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="font-medium text-gray-200">
            Mission Orchestrator
          </span>
          <span className="text-gray-500">· {status}</span>
          {session?.sessionId && (
            <span
              title={session.sessionId}
              className="font-mono text-[10px] text-gray-600"
            >
              {session.sessionId.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {!api && (
            <span className="text-yellow-400">
              preload 옛 버전 (재시작 필요)
            </span>
          )}
          <button
            onClick={handleRestart}
            disabled={!api || restarting}
            title="세션 종료 후 새로 시작 (PTY 가 비어있을 때 사용)"
            className="rounded border border-gray-700 px-2 py-0.5 text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            {restarting ? "재시작 중..." : "🔄 Restart"}
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={!api}
            className="rounded border border-gray-700 px-2 py-0.5 text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            {open ? "숨기기" : "PTY 보기"}
          </button>
        </div>
      </div>
      {error && (
        <div className="border-t border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}
      {open && api && (
        <ErrorBoundary>
          {session?.ptySessionId ? (
            // OrchestratorTerminal 내부가 `absolute inset-0` 으로 채우므로
            // wrapper 에 반드시 `relative` + 명시 height 가 있어야 그 안에 정렬됨.
            // 안 그러면 xterm 이 페이지 전체 viewport 까지 올라가 Header/TabBar 덮음.
            <div
              style={{ height: PTY_HEIGHT }}
              className="relative overflow-hidden border-t border-gray-700"
            >
              <OrchestratorTerminal
                sessionId={session.ptySessionId}
                panelHeight={PTY_HEIGHT}
              />
            </div>
          ) : (
            <div
              style={{ height: PTY_HEIGHT }}
              className="flex items-center justify-center border-t border-gray-700 text-xs text-gray-500"
            >
              {status === "starting"
                ? "Mission orchestrator 시작 중..."
                : "PTY 준비 중..."}
            </div>
          )}
        </ErrorBoundary>
      )}
    </div>
  );
}
