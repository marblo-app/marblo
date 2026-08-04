/**
 * 감사 로그 로딩 훅 — 두 소스를 병렬로 읽어 하나의 화면 상태로 접는다.
 *
 * 소스는 둘이다:
 *   - `projectAuditLog` — 렌더러발 **사람** 행위 (owner/admin read)
 *   - `audit_logs`      — MCP 툴 호출 = **오케/에이전트** 행위 (멤버 전원 read)
 *
 * ★컬렉션을 직접 쿼리하지 않는다. 오직 services/projectAuditService 의 조회 API
 * (getProjectAuditLog / getProjectAuditActors / getProjectLedgerLog /
 * getProjectLedgerActors)만 부른다 — 컬렉션을 화면마다 직접 짜면 게이트와
 * 서버사이드 필터가 갈라지고, 룰과 클라이언트 제약이 어긋나는 순간 쿼리 전체가
 * permission-denied 로 죽는다(#406/#428 의 실패 모드).
 *
 * ★소스별 에러를 **격리**한다. 한 소스가 거부돼도 다른 소스는 그대로 보여주고,
 * 무엇이 빠졌는지는 안내로 말한다. 하나가 죽었다고 둘 다 숨기면, 멤버 전원이
 * 읽을 수 있는 원장까지 사람 쪽 거부 하나 때문에 안 보이게 된다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProjectAuditEvent,
  ProjectAuditLogQuery,
} from "../types/projectAudit";
import type { AuditLog } from "../types/audit";
import {
  getProjectAuditLog,
  getProjectAuditActors,
  getProjectLedgerLog,
  getProjectLedgerActors,
  getProjectTaskTitles,
} from "../services/projectAuditService";
import {
  auditStateFromError,
  buildAuditRows,
  mergeAuditActors,
  parseAuditTypeFilter,
  type AuditActorTally,
  type AuditLoadState,
  type AuditSources,
  type AuditSourceState,
  type UnifiedAuditRow,
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

/**
 * 필터 UI 안 쓰이는 부가 정보 — 티켓 제목 조인용 맵. `fetchAuditActors` 와
 * 같은 이유로 실패는 빈 맵으로 접는다(부가 정보라 별도 에러 화면을 만들지
 * 않는다).
 */
export async function fetchProjectTaskTitles(
  projectId: string,
): Promise<Record<string, string>> {
  try {
    return await getProjectTaskTitles(projectId);
  } catch {
    return {};
  }
}

/** 원장 조회 1회 → 상태 + 이벤트. 사람 쪽과 같은 이유로 throw 하지 않는다. */
export async function fetchLedgerLogState(
  projectId: string,
  query: { actorUid?: string; toolName?: string; limit?: number } = {},
): Promise<{ state: AuditSourceState; events: AuditLog[] }> {
  try {
    const events = await getProjectLedgerLog(projectId, query);
    return { state: { status: "ready", count: events.length }, events };
  } catch (err) {
    return { state: auditStateFromError(err), events: [] };
  }
}

export interface UnifiedAuditQuery {
  actorUid?: string;
  /** 종류 필터의 raw 값(사람 type 또는 `tool:<toolName>`). undefined = 전체. */
  typeFilter?: string;
  limit?: number;
}

export interface UnifiedAuditFetch {
  human: ProjectAuditEvent[];
  agent: AuditLog[];
  sources: AuditSources;
}

/**
 * 두 소스를 **병렬로** 읽는다.
 *
 * 직렬로 읽으면 느린 것도 문제지만 더 나쁜 건 실패 전파다 — 앞 소스가 throw
 * 하면 뒤 소스는 아예 시도조차 안 된다. `Promise.all` 로 묶되 각 갈래가 자기
 * try/catch 를 들고 있어서 **어느 쪽도 다른 쪽을 죽이지 못한다.**
 *
 * 종류 필터가 한 소스를 고르면 다른 소스는 조회하지 않고 `skipped` 로 둔다 —
 * `ready(0)` 로 쓰면 "조회했는데 0건"이라는 없는 사실을 단정하게 된다.
 */
export async function fetchUnifiedAuditSources(
  projectId: string,
  query: UnifiedAuditQuery = {},
): Promise<UnifiedAuditFetch> {
  const filter = parseAuditTypeFilter(query.typeFilter);
  const wantHuman = filter.source !== "agent";
  const wantAgent = filter.source !== "human";

  const [human, agent] = await Promise.all([
    wantHuman
      ? fetchAuditLogState(projectId, {
          actorUid: query.actorUid,
          type: filter.source === "human" ? filter.type : undefined,
          limit: query.limit,
        })
      : Promise.resolve<AuditLoadState | null>(null),
    wantAgent
      ? fetchLedgerLogState(projectId, {
          actorUid: query.actorUid,
          toolName: filter.source === "agent" ? filter.toolName : undefined,
          limit: query.limit,
        })
      : Promise.resolve(null),
  ]);

  return {
    human: human?.status === "ready" ? human.events : [],
    agent: agent?.events ?? [],
    sources: {
      human: human ? toSourceState(human) : { status: "skipped" },
      agent: agent ? agent.state : { status: "skipped" },
    },
  };
}

function toSourceState(state: AuditLoadState): AuditSourceState {
  return state.status === "ready"
    ? { status: "ready", count: state.events.length }
    : state;
}

export interface UnifiedAuditOptions {
  /** 필터 UI 에 쓸 행위자 목록(두 소스 합산). */
  actors: AuditActorTally[];
  /** 종류 필터에 실을 오케 행위 종류 = 창에 실제 등장한 툴 이름. */
  toolNames: string[];
  /** 티켓 제목 조인용 맵(현재 tasks 스냅샷). 없는 id 는 호출부가 해시로 떨군다. */
  taskTitleById: Record<string, string>;
}

/**
 * 필터 옵션 — 두 소스의 행위자를 합치고 툴 이름을 모은다. 티켓 제목 맵도
 * 여기서 같이 읽는다 — **필터와 무관하게 프로젝트 단위로만** 갱신돼야 하는
 * 성질이 actors/toolNames 와 같다(훅 아래 useEffect 주석 참조).
 *
 * 실패는 전부 빈 값으로 접는다(위 fetchAuditActors 와 같은 이유: 부가
 * 정보라서 여기서 에러를 띄우면 정작 목록은 잘 보이는데 화면만 시끄러워진다).
 */
export async function fetchUnifiedAuditOptions(
  projectId: string,
): Promise<UnifiedAuditOptions> {
  const [human, agent, taskTitleById] = await Promise.all([
    fetchAuditActors(projectId),
    getProjectLedgerActors(projectId).catch(() => ({
      actors: [] as AuditActorTally[],
      toolNames: [] as string[],
    })),
    fetchProjectTaskTitles(projectId),
  ]);

  return {
    actors: mergeAuditActors(human, agent.actors),
    toolNames: agent.toolNames,
    taskTitleById,
  };
}

export interface UseProjectAuditLogResult {
  rows: UnifiedAuditRow[];
  sources: AuditSources;
  actors: AuditActorTally[];
  toolNames: string[];
  taskTitleById: Record<string, string>;
  reload: () => void;
}

/**
 * @param projectId 빈 문자열이면 아무것도 조회하지 않는다(프로젝트 미선택).
 * @param actorUid  구성원 필터. undefined = 전체. **두 소스에 같이 걸린다** —
 *                  원장의 actorUid 도 "발주한 사람"이라 축이 같다.
 * @param typeFilter 종류 필터 raw 값. 사람 종류 또는 `tool:<toolName>`.
 * @param nameByUid 이름 메꿈용(원장엔 이름이 없고, 사람 쪽도 비어 있을 수 있다).
 */
export function useProjectAuditLog(
  projectId: string,
  actorUid?: string,
  typeFilter?: string,
  nameByUid: Record<string, string> = {},
): UseProjectAuditLogResult {
  const [fetched, setFetched] = useState<UnifiedAuditFetch>({
    human: [],
    agent: [],
    sources: { human: { status: "loading" }, agent: { status: "loading" } },
  });
  const [options, setOptions] = useState<UnifiedAuditOptions>({
    actors: [],
    toolNames: [],
    taskTitleById: {},
  });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) {
      setFetched({
        human: [],
        agent: [],
        sources: {
          human: { status: "ready", count: 0 },
          agent: { status: "ready", count: 0 },
        },
      });
      return;
    }
    let cancelled = false;
    setFetched((prior) => ({
      ...prior,
      sources: { human: { status: "loading" }, agent: { status: "loading" } },
    }));
    fetchUnifiedAuditSources(projectId, { actorUid, typeFilter }).then(
      (next) => {
        if (!cancelled) setFetched(next);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, actorUid, typeFilter, nonce]);

  /**
   * 필터 옵션은 **필터와 무관하게** 프로젝트 단위로만 다시 읽는다. 필터를 걸
   * 때마다 갱신하면 "u1 로 필터" → 목록이 u1 하나로 줄어들어 다른 사람으로
   * 바꿀 수단이 사라진다(자기 자신을 가두는 필터). 툴 이름도 같은 이유.
   */
  useEffect(() => {
    if (!projectId) {
      setOptions({ actors: [], toolNames: [], taskTitleById: {} });
      return;
    }
    let cancelled = false;
    fetchUnifiedAuditOptions(projectId).then((next) => {
      if (!cancelled) setOptions(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce]);

  // 병합은 순수함수라 렌더 중에 접어도 안전하다. 이름 메꿈이 members 에 걸려
  // 있어서 members 가 바뀌면 행 라벨만 다시 계산된다(재조회 없음).
  const rows = useMemo(
    () => buildAuditRows(fetched.human, fetched.agent, nameByUid),
    [fetched, nameByUid],
  );

  return {
    rows,
    sources: fetched.sources,
    actors: options.actors,
    toolNames: options.toolNames,
    taskTitleById: options.taskTitleById,
    reload,
  };
}
