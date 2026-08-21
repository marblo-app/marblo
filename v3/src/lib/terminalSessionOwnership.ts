/**
 * "이 터미널이 비어 있는 이유" 를 **사실로** 가르는 판정기.
 *
 * 배경(티켓 r44KdZ4SJL4mZ2K8wC0P): 팀 모드에서 남의 티켓을 열면 그 에이전트
 * PTY 는 내 기기에 존재하지 않는다. 에이전트는 상대방 기기에서 멀쩡히 돌고
 * 있고, 내 쪽에 세션이 없을 뿐이다. 그런데 화면은 "세션이 만료되었습니다" 라고
 * 말했다 — "내 세션이었는데 끝났다" 는 뜻이라 **사실과 다르다.** 사용자는
 * "내가 돌리던 게 죽었나" 로 읽고 복구를 시도한다.
 *
 * ★판정 근거는 추측이 아니라 이미 존재하는 원장이다:
 *   - `agents/{id}.machineId` — 그 에이전트를 **실제로 띄운 기기**의 안정 id.
 *     main 이 상태 변화 때 스탬프한다(main.stampAgentMachineOwnership).
 *     electron 쪽 `reconnect-manager.classifyMachineOwnership` 이 부팅 복구를
 *     own/foreign/legacy 로 가르는 데 쓰는 바로 그 필드다. 여기서도 같은 축을
 *     쓴다 — 화면과 복구 로직이 다른 근거로 다른 말을 하면 안 된다.
 *   - `agents/{id}.ownerId` — 그 에이전트를 만든 계정. 내 uid 와 다르면
 *     "다른 팀원", 같으면(=공유 계정의 내 다른 기기) "다른 기기".
 *   - 이 기기의 `machineId` — projectStore 가 IPC 로 받아 캐시한 값.
 *
 * ★근거가 없으면 **거짓말하지 말고 종전 문구로 떨어진다**(`unknown`).
 * "남의 것" 이라고 잘못 말하는 게 "만료" 라고 잘못 말하는 것보다 나쁘다 —
 * 후자는 재시도해 보면 알지만, 전자는 자기 에이전트를 포기하게 만든다.
 * 그래서 아래 모든 미지(스냅샷 미도착, machineId 미스탬프 구 doc, IPC 미도착)는
 * 전부 `unknown` 으로 모인다.
 */
import type { Agent } from "../types/agent";
import type { MessageKey } from "../locales/ko";

export type TerminalSessionOwnership =
  /** ① 내 기기의 에이전트다 — 세션이 정말 끝났다. 종전 문구 + 복구 안내. */
  | "own"
  /** ② 다른 팀원(다른 계정)의 기기에서 실행 중. 복구 안내를 띄우면 안 된다. */
  | "foreign-user"
  /** ② 같은 계정의 **다른 기기**에서 실행 중. 역시 여기서 복구할 게 없다. */
  | "foreign-machine"
  /** ③ 이 터미널을 뒷받침하는 에이전트 doc 자체가 없다(삭제·회수·타 프로젝트). */
  | "agent-missing"
  /** 판정 근거 없음 — 호출자는 반드시 종전 문구를 그대로 쓴다. */
  | "unknown";

/** `agentSessionMap` 의 결정적 fallback id 형식(`agent-${agentId}`). */
const DETERMINISTIC_SESSION_PREFIX = "agent-";

/**
 * ptySessionId → agentId 역인덱스.
 *
 * 두 경로를 다 본다:
 *  1. 원장(`agentSessionMap`)에 박힌 실제 매핑 — launch/attach 시점에 기록된다.
 *  2. 결정적 fallback `agent-${agentId}` — 원장에 없는 에이전트(예: 남의 기기가
 *     띄운 것)를 티켓 상세의 "터미널 보기" 가 열 때 쓰는 바로 그 id.
 *
 * 에이전트로 환원되지 않으면 null — 사용자가 직접 띄운 셸 탭이라는 뜻이고,
 * 그건 "세션이 끝났다" 가 실제로 맞는 경우다.
 */
export function resolveAgentIdForSession(
  sessionId: string,
  sessionIdByAgentId: Record<string, string>,
): string | null {
  if (!sessionId) return null;
  for (const [agentId, mapped] of Object.entries(sessionIdByAgentId)) {
    if (mapped === sessionId) return agentId;
  }
  if (sessionId.startsWith(DETERMINISTIC_SESSION_PREFIX)) {
    const agentId = sessionId.slice(DETERMINISTIC_SESSION_PREFIX.length);
    return agentId || null;
  }
  return null;
}

export interface TerminalOwnershipInput {
  sessionId: string;
  /** agentId → ptySessionId (`useAgentSessionMap.map`). */
  sessionIdByAgentId: Record<string, string>;
  /** 현재 프로젝트의 에이전트 doc 들. */
  agents: Agent[];
  /**
   * `agents` 가 스냅샷을 한 번이라도 받았는가(`agentStore.hydrated`).
   * false 면 빈 배열이 "없다" 인지 "아직 안 왔다" 인지 구분되지 않으므로
   * `agent-missing` 을 절대 주장하지 않는다.
   */
  agentsHydrated: boolean;
  /** 이 기기의 machineId. IPC 응답 전이면 null → 판정 불가. */
  localMachineId: string | null;
  /** 지금 로그인한 uid(`projectStore.subscribedUserId`). 모르면 null. */
  localUserId: string | null;
}

export interface TerminalOwnershipVerdict {
  ownership: TerminalSessionOwnership;
  /** 판정에 쓰인 에이전트(있을 때). 문구에 이름을 넣고 싶을 때 쓴다. */
  agent: Agent | null;
}

export function classifyTerminalSessionOwnership({
  sessionId,
  sessionIdByAgentId,
  agents,
  agentsHydrated,
  localMachineId,
  localUserId,
}: TerminalOwnershipInput): TerminalOwnershipVerdict {
  const agentId = resolveAgentIdForSession(sessionId, sessionIdByAgentId);
  // 에이전트 세션이 아니다(사용자 셸 탭) → 종전 문구가 맞다.
  if (!agentId) return { ownership: "unknown", agent: null };

  // 스냅샷 전에는 "없다" 를 주장할 수 없다.
  if (!agentsHydrated) return { ownership: "unknown", agent: null };

  const agent = agents.find((a) => a.id === agentId) ?? null;
  if (!agent) return { ownership: "agent-missing", agent: null };

  return {
    ownership: classifyAgentMachine(agent, localMachineId, localUserId),
    agent,
  };
}

/**
 * 에이전트 doc 하나를 이 기기/계정 기준으로 가른다.
 *
 * 세션 매핑이 필요 없는 표면(티켓 상세의 "터미널 보기" 버튼 등)이 같은 근거로
 * 같은 말을 하도록 분리해 뒀다. 반환값은 `agent-missing` 을 제외한 4종.
 */
export function classifyAgentMachine(
  agent: Pick<Agent, "machineId" | "ownerId">,
  localMachineId: string | null,
  localUserId: string | null,
): Exclude<TerminalSessionOwnership, "agent-missing"> {
  // 구 doc(스탬프 이전) 이거나 IPC 미도착 — 어느 쪽도 "남의 것" 의 근거가
  // 못 된다. electron 쪽 `legacy` 분류와 같은 태도로 안전하게 떨어진다.
  if (!agent.machineId || !localMachineId) return "unknown";

  if (agent.machineId === localMachineId) return "own";

  // 여기부터는 "이 기기가 띄운 게 아니다" 가 확정이다. 남은 건 누구 것이냐.
  if (localUserId && agent.ownerId && agent.ownerId !== localUserId) {
    return "foreign-user";
  }
  // 소유 계정이 같거나(공유 계정의 다른 기기) 알 수 없으면 기기 축으로만
  // 말한다 — "다른 팀원" 은 근거가 있을 때만 쓴다.
  return "foreign-machine";
}

/** ②의 두 갈래 — 여기서 복구(재시작) 안내를 띄우면 안 되는 상태. */
export function isRunningElsewhere(
  ownership: TerminalSessionOwnership,
): boolean {
  return ownership === "foreign-user" || ownership === "foreign-machine";
}

/** 죽은/없는 PTY 앞에서 화면이 쓸 3줄(+색). 문구 자체가 아니라 **키**다. */
export interface DeadSessionNoticeCopy {
  /** SGR color for the headline. 33=yellow(경고), 36=cyan(정상·정보). */
  color: "33" | "36";
  glyph: string;
  titleKey: MessageKey;
  reasonKey: MessageKey;
  hintKey: MessageKey;
}

/**
 * 판정 → 문구 매핑. 순수 함수라 테스트가 "어떤 상태에서 복구 안내가 나가는가"
 * 를 직접 못 박을 수 있다.
 *
 * ★`unknown` 은 `own` 과 같은 문구로 떨어진다 — 근거 없이 "남의 것" 이라고
 * 말하지 않기 위한 안전판이다(오탐 비용이 비대칭이다).
 */
export function deadSessionNoticeCopy(
  ownership: TerminalSessionOwnership,
): DeadSessionNoticeCopy {
  if (isRunningElsewhere(ownership)) {
    const byUser = ownership === "foreign-user";
    return {
      // 고장이 아니라 정상이라서 경고색을 쓰지 않는다.
      color: "36",
      glyph: "\u2139",
      titleKey: byUser
        ? "terminal.session.remoteUser"
        : "terminal.session.remoteMachine",
      reasonKey: byUser
        ? "terminal.session.remoteUserReason"
        : "terminal.session.remoteMachineReason",
      // ★복구(재시작) 안내를 여기 두지 않는다 — 이 기기에서 눌러도 안 된다.
      hintKey: "terminal.session.remoteHint",
    };
  }

  if (ownership === "agent-missing") {
    return {
      color: "33",
      glyph: "\u26a0",
      titleKey: "terminal.session.agentMissing",
      reasonKey: "terminal.session.agentMissingReason",
      hintKey: "terminal.session.agentMissingHint",
    };
  }

  // "own" 과 "unknown" — 내 세션이 끝났다. 종전 문구 + 복구 안내.
  return {
    color: "33",
    glyph: "\u26a0",
    titleKey: "terminal.session.expired",
    reasonKey: "terminal.session.expiredReason",
    hintKey: "terminal.session.restartHint",
  };
}
