import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
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

// missionId: 현재 포커스(선택)된 미션. 이 패널은 그 미션의 오케스트레이터 세션에
// 종속된다 — missionId 가 바뀌면 해당 미션 세션으로 connect/switch 하고, 새 미션이면
// fresh 로 뜬다. null 이면(선택 없음/아카이브) 새 세션을 띄우지 않는다.
export function MissionOrchestratorPanel({
  missionId,
}: {
  missionId: string | null;
}) {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const rootPath = useEditorStore((s) => s.rootPath);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<string>("stopped");
  const [error, setError] = useState<string | null>(null);

  const api = window.electronAPI?.missionOrchestrator;
  const [restarting, setRestarting] = useState(false);
  const [attention, setAttention] = useState(false);
  const reconnectKeyRef = useRef<string | null>(null);

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

  // 선택된 미션에 오케스트레이터를 종속시킨다. missionId 가 바뀌면 그 미션의
  // 세션으로 connect/switch 하고(이미 그 미션이 실행 중이면 reuse, 새 미션이면
  // fresh) 진행상황이 보이도록 패널을 자동으로 펼친다.
  //
  // 예전엔 mount 시 missionId 없이 resolvePrevious → start 로 '직전 세션'을 무조건
  // resume 했는데, 그게 새 미션을 옛(아카이브된) 세션에 붙여 /compact 시키던 버그의
  // 원인이었다 → 그 missionId-less 자동 resume 경로를 제거했다. 미션이 선택되지
  // 않았으면(아카이브/없음) 새 세션을 띄우지 않는다(미션 안 쓰면 비용 0).
  useEffect(() => {
    if (!api || !currentProject?.id || !rootPath) return;
    if (!missionId) {
      // 바인딩된 미션이 사라짐(어밴던/삭제/선택 해제) → 패널 접고 재연결 키 리셋.
      // 실제 PTY stop 은 MissionsTab 의 abandon/delete 핸들러가 미션 스코프로 수행한다
      // (여기서 stop 하면 단순 포커스 해제로도 백그라운드 드라이브를 죽이게 됨).
      reconnectKeyRef.current = null;
      setOpen(false);
      return;
    }
    const projectId = currentProject.id;
    const key = `${projectId}:${missionId}`;
    if (reconnectKeyRef.current === key) return;
    reconnectKeyRef.current = key;
    // 새 미션으로 포커스 전환 → 진행상황 보이게 패널 자동 오픈.
    setOpen(true);
    setAttention(false);
    let cancelled = false;
    (async () => {
      try {
        const res = await api.start({ projectId, rootPath, missionId });
        if (res && !cancelled) {
          setSession(res);
          setStatus(res.status);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, currentProject?.id, rootPath, missionId]);

  // 미션이 사용자 개입을 요구하면 (waiting_for_human + notifyUser) PTY 패널을
  // 자동으로 펼쳐 질문을 바로 보여준다. main 프로세스가 OS 알림도 별도 발사.
  useEffect(() => {
    if (!api?.onNeedsInput) return;
    api.onNeedsInput((notice) => {
      if (notice.projectId !== currentProject?.id) return;
      setOpen(true);
      setAttention(true);
    });
    return () => {
      try {
        api.removeNeedsInputListener?.();
      } catch {
        /* best-effort */
      }
    };
  }, [api, currentProject?.id]);

  // Restart: stop + 짧은 대기 후 start. 비어있는 PTY 복구 / 세션 재시도용.
  const handleRestart = async () => {
    if (!api || !currentProject?.id || !rootPath) return;
    setRestarting(true);
    setError(null);
    try {
      await api.stop(currentProject.id);
      setSession(null);
      reconnectKeyRef.current = null; // 다음 connect 효과가 다시 붙도록 키 리셋
      // status 가 stopped 로 도달할 때까지 짧게 대기 (PTY exit 처리 시간).
      await new Promise((r) => setTimeout(r, 500));
      const fresh = await api.start({
        projectId: currentProject.id,
        rootPath,
        missionId: missionId ?? undefined,
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
        // 바인딩할 미션이 없으면 새 세션을 띄우지 않는다(missionId-less spawn 금지).
        if (!missionId) return;
        const fresh = await api.start({ projectId, rootPath, missionId });
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
  }, [api, open, currentProject?.id, rootPath, missionId]);

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
    <div
      className={`rounded-lg border bg-gray-900/50 transition-colors ${
        attention
          ? "border-amber-500/70 ring-1 ring-amber-500/40"
          : "border-gray-700"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="font-medium text-gray-200">
            Mission Orchestrator
          </span>
          <span className="text-gray-500">· {status}</span>
          {attention && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              {t("missions.orch.awaitingInput")}
            </span>
          )}
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
              {t("missions.orch.preloadStale")}
            </span>
          )}
          <button
            onClick={handleRestart}
            disabled={!api || restarting}
            title={t("missions.orch.restartTitle")}
            className="rounded border border-gray-700 px-2 py-0.5 text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            {restarting ? t("missions.orch.restarting") : "🔄 Restart"}
          </button>
          <button
            onClick={() => {
              setOpen((v) => !v);
              setAttention(false);
            }}
            disabled={!api}
            className="rounded border border-gray-700 px-2 py-0.5 text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            {open ? t("missions.orch.hide") : t("missions.orch.show")}
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
                status={status}
              />
            </div>
          ) : (
            <div
              style={{ height: PTY_HEIGHT }}
              className="flex items-center justify-center border-t border-gray-700 text-xs text-gray-500"
            >
              {status === "starting"
                ? t("missions.orch.starting")
                : t("missions.orch.ptyPreparing")}
            </div>
          )}
          {session?.ptySessionId && (
            <div className="border-t border-gray-800 px-3 py-1 text-[11px] leading-snug text-gray-500">
              💡 {t("missions.orch.stuckHintPrefix")}
              <span className="text-gray-400">
                "{t("missions.orch.stuckHintQuote")}"
              </span>
              {t("missions.orch.stuckHintSuffix")}
            </div>
          )}
        </ErrorBoundary>
      )}
    </div>
  );
}
