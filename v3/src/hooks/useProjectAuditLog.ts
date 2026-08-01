/**
 * 감사 로그 로딩 훅 — 조회 API 를 화면 상태로 바꾼다.
 *
 * ★원장(`audit_logs`)이나 `projectAuditLog` 컬렉션을 직접 읽지 않는다. 오직
 * services/projectAuditService 의 getProjectAuditLog / getProjectAuditActors
 * 만 부른다 — 컬렉션을 직접 쿼리하면 owner/admin 게이트와 서버사이드 필터가
 * 화면마다 갈라지고(#406/#428 의 실패 모드), 룰과 클라이언트 제약이 어긋나는
 * 순간 쿼리 전체가 permission-denied 로 죽는다.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  ProjectAuditEventType,
  ProjectAuditLogQuery,
} from "../types/projectAudit";
import {
  getProjectAuditLog,
  getProjectAuditActors,
} from "../services/projectAuditService";
import {
  auditStateFromError,
  type AuditLoadState,
} from "../lib/projectAuditView";

export interface AuditActorOption {
  actorUid: string;
  actorName: string | null;
  count: number;
}

/**
 * 조회 1회를 상태로 접는다. **throw 하지 않는다** — 감사 섹션 하나가 프로젝트
 * 탭 전체를 언마운트시키면 안 된다(작업량·멤버 관리까지 같이 사라진다).
 *
 * 훅 밖에 두는 이유: 권한 분기(denied vs error)와 graceful 동작이 이 프로젝트
 * 의 실제 계약인데, repo 에 React Testing Library 가 없어서 컴포넌트로는
 * 검증할 수 없다. 순수 async 함수면 단위테스트가 그대로 붙는다.
 */
export async function fetchAuditLogState(
  projectId: string,
  query: ProjectAuditLogQuery = {},
): Promise<AuditLoadState> {
  try {
    const events = await getProjectAuditLog(projectId, query);
    return { status: "ready", events };
  } catch (err) {
    return auditStateFromError(err);
  }
}

/**
 * 필터 UI 에 쓸 행위자 목록. 실패는 **빈 목록으로 접는다** — 이건 이벤트
 * 목록과 달리 부가 정보라서, 못 가져왔다고 별도 에러 화면을 띄우면 정작
 * 이벤트는 잘 보이는데 화면만 시끄러워진다. 진짜 권한 문제라면 이벤트 조회가
 * 같은 이유로 denied 를 돌려주므로 사용자는 정확한 안내를 보게 된다.
 */
export async function fetchAuditActors(
  projectId: string,
): Promise<AuditActorOption[]> {
  try {
    return await getProjectAuditActors(projectId);
  } catch {
    return [];
  }
}

export interface UseProjectAuditLogResult {
  state: AuditLoadState;
  actors: AuditActorOption[];
  reload: () => void;
}

/**
 * @param projectId 빈 문자열이면 아무것도 조회하지 않는다(프로젝트 미선택).
 * @param actorUid  구성원 필터. undefined = 전체.
 * @param type      종류 필터. undefined = 전체.
 */
export function useProjectAuditLog(
  projectId: string,
  actorUid?: string,
  type?: ProjectAuditEventType,
): UseProjectAuditLogResult {
  const [state, setState] = useState<AuditLoadState>({ status: "loading" });
  const [actors, setActors] = useState<AuditActorOption[]>([]);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) {
      setState({ status: "ready", events: [] });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetchAuditLogState(projectId, { actorUid, type }).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, actorUid, type, nonce]);

  /**
   * 행위자 목록은 **필터와 무관하게** 프로젝트 단위로만 다시 읽는다. 필터를
   * 걸 때마다 갱신하면 "u1 로 필터" → 목록이 u1 하나로 줄어들어 다른 사람으로
   * 바꿀 수단이 사라진다(자기 자신을 가두는 필터).
   */
  useEffect(() => {
    if (!projectId) {
      setActors([]);
      return;
    }
    let cancelled = false;
    fetchAuditActors(projectId).then((next) => {
      if (!cancelled) setActors(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce]);

  return { state, actors, reload };
}
