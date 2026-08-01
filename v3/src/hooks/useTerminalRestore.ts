import { useEffect, useRef } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import { useProjectStore } from "../stores/projectStore";
import {
  readPersistedTerminals,
  resolveRestoreCwd,
} from "../lib/terminalPersist";

/**
 * 앱 시작 / 프로젝트 전환 시, 그 프로젝트의 영속화된 사용자 spawn 터미널
 * (name + cwd + command 메타) 을 다시 spawn 한다.
 *
 * 셸 PTY 자체는 resume 메커니즘이 없어 새 PTY 가 생성됨 (히스토리 없음).
 * 대신 사용자가 갖고 있던 "터미널 탭 N개" 가 자동으로 그 모양 그대로
 * 복구되어 보임. 에이전트의 useAgentReconnect 와 같은 시맨틱.
 *
 * 가드:
 *   - attemptedRef 로 프로젝트 단위 1회만 시도 (project 전환 시 reset).
 *   - 이미 같은 name 의 세션이 있으면 skip (다른 윈도우 attach broadcast
 *     이나 중복 호출 방지).
 *   - createSession 자체가 name dedup 으로 localStorage 에 다시 push 안 함.
 */
export function useTerminalRestore(): void {
  const currentProject = useProjectStore((s) => s.currentProject);
  const sessions = useTerminalStore((s) => s.sessions);
  const createSession = useTerminalStore((s) => s.createSession);

  const attemptedProjectRef = useRef<string | null>(null);

  useEffect(() => {
    const projectId = currentProject?.id;
    if (!projectId) return;
    if (attemptedProjectRef.current === projectId) return;
    attemptedProjectRef.current = projectId;

    const persisted = readPersistedTerminals(projectId);
    if (persisted.length === 0) return;

    let restored = 0;
    let skipped = 0;
    for (const t of persisted) {
      if (sessions.some((s) => s.name === t.name)) {
        skipped++;
        continue;
      }
      // cwd 는 명시적 핀일 때만 살아있다(terminalPersist v2). 핀이 없거나
      // 그 경로가 사라졌으면 undefined 를 넘겨 createSession 이 **현재**
      // rootPath 로 스폰하게 한다 — 죽은 워크트리 경로로 스폰하면 메인의
      // notifyRootPathMissing 이 살아있는 창의 rootPath 까지 갈아치운다.
      resolveRestoreCwd(t.cwd, window.electronAPI.fs.pathExists)
        .then((cwd) => createSession(t.name, t.command, t.args, cwd))
        .catch((err) => {
          console.warn(
            `[TerminalRestore] failed to spawn '${t.name}' (non-fatal):`,
            err,
          );
        });
      restored++;
    }
    console.debug(
      `[TerminalRestore] project=${projectId}: ${restored} respawned, ${skipped} already-present`,
    );
  }, [currentProject?.id, sessions, createSession]);
}
