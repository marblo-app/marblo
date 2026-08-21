/**
 * ★PTY 세션 종류의 **정본 판정** — 한 곳, 순수함수, 테스트 있음.
 *
 * 왜 파일이 따로 있나 (ticket TaDiWyLNi5ihBnjfVmMs):
 * 비용 수집의 분기가 `sid.startsWith("agent-")` 라는 **인라인 접두사 비교**로
 * 흩어져 있었다. 그 형태의 문제는 틀렸을 때가 아니라 **새 종류가 생겼을 때**다 —
 * 오케스트레이터 PTY(`orch-`)는 어느 분기에도 안 걸리고, 아무도 에러를 보지
 * 못한 채 조용히 빠진다. 두 달 동안 오케 비용이 0 으로 보인 사고가 정확히 그
 * 모양이었다.
 *
 * 그래서 판정을 여기로 모으고, "모르는 종류" 를 `unknown` 이라는 **명시적인 값**
 * 으로 돌려준다. 호출부는 `agent` 인지 묻고, 나머지는 자기 경로를 스스로 밝혀야
 * 한다. 새 접두가 생기면 이 파일의 테스트가 먼저 깨진다.
 *
 * ★비용 축의 id 규약 (cost_logs.agentId):
 *   - 워커      : agent-manager 의 agent id 그대로.
 *   - 보드 오케 : `orchestrator-<projectId>`
 *   - 미션 오케 : `orchestrator-mission-<projectId>`
 * 이 두 오케 id 는 우리가 새로 만든 것이 아니라 orchestrator-manager 가 이미
 * 쓰던 세션 id(= MCP `MARBLO_AGENT_ID`, 격리 홈 키)와 **같은 문자열**이다.
 * 새 접두를 발명하지 않는 쪽을 택했다 — 축이 하나 더 생기면 조인이 하나 더
 * 깨진다.
 */

/** PTY 세션 sid 의 접두. 생성부와 판정부가 같은 상수를 본다. */
export const AGENT_PTY_PREFIX = "agent-";
export const ORCHESTRATOR_PTY_PREFIX = "orch-";

/** 비용 축에서 쓰는 오케 agentId 의 접두 (= orchestrator-manager 의 세션 id). */
export const ORCHESTRATOR_AGENT_ID_PREFIX = "orchestrator-";

export type PtySessionKind = "agent" | "orchestrator" | "unknown";

export interface PtySessionIdentity {
  kind: PtySessionKind;
  /**
   * 비용/텔레메트리가 주체로 쓰는 id. `unknown` 이면 null —
   * ★모르면 지어내지 않는다. 지어낸 id 가 곧 오귀속이다.
   */
  costAgentId: string | null;
}

const UNKNOWN: PtySessionIdentity = { kind: "unknown", costAgentId: null };

/**
 * 오케 PTY sid 는 `orch-<sessionId>-<epochMs>` 다
 * (orchestrator-manager.ts `const ptySessionId = \`orch-${sessionId}-${Date.now()}\``).
 * 꼬리의 epoch 만 떼어내면 세션 id = 비용 축 agentId 가 남는다.
 */
const ORCH_PTY_SUFFIX = /-\d{10,}$/;

/**
 * sid → 세션 종류. 순수함수, 부작용 없음.
 *
 * ★`unknown` 을 돌려주는 것이 이 함수의 존재 이유다. 호출부가 조용히 아무것도
 * 안 하고 넘어가는 대신, "이 sid 는 어느 종류인지 모른다" 를 값으로 받게 한다.
 */
export function classifyPtySessionId(sid: string): PtySessionIdentity {
  if (!sid) return UNKNOWN;

  if (sid.startsWith(AGENT_PTY_PREFIX)) {
    const agentId = sid.slice(AGENT_PTY_PREFIX.length);
    return agentId ? { kind: "agent", costAgentId: agentId } : UNKNOWN;
  }

  if (sid.startsWith(ORCHESTRATOR_PTY_PREFIX)) {
    const body = sid.slice(ORCHESTRATOR_PTY_PREFIX.length);
    const sessionId = body.replace(ORCH_PTY_SUFFIX, "");
    return sessionId
      ? { kind: "orchestrator", costAgentId: sessionId }
      : UNKNOWN;
  }

  return UNKNOWN;
}

/** 비용 축 agentId 가 오케의 것인가. cost_logs 를 오케/워커로 가를 때의 정본. */
export function isOrchestratorAgentId(
  agentId: string | null | undefined
): boolean {
  return !!agentId && agentId.startsWith(ORCHESTRATOR_AGENT_ID_PREFIX);
}

/**
 * 오케 종류 + projectId → 비용 축 agentId.
 *
 * ★orchestrator-manager 의 세션 id 규약을 그대로 재현한다(board 만 kind 를
 * 생략한다). 두 곳이 어긋나면 격리 홈(CODEX_HOME/GROK_HOME) 조회 키와 비용 축
 * id 가 갈라져 codex/grok 오케가 다시 조용히 0 이 된다.
 */
export function orchestratorCostAgentId(
  kind: "board" | "mission",
  projectId: string
): string {
  return kind === "board"
    ? `${ORCHESTRATOR_AGENT_ID_PREFIX}${projectId}`
    : `${ORCHESTRATOR_AGENT_ID_PREFIX}${kind}-${projectId}`;
}

// ── 오케 세션 → 비용 추적 결정 (ticket TaDiWyLNi5ihBnjfVmMs) ──────────────

/**
 * 오케 세션의 비용-추적 수명주기 이벤트.
 *
 * ★`costAgentId` 는 orchestrator-manager 가 이미 쓰던 세션 id 다
 * (= MARBLO_AGENT_ID, 격리 홈 키, Firestore agents/* doc 키).
 * 비용 축에 새 접두를 발명하지 않는다 — 축이 하나 늘면 조인이 하나 깨진다.
 */
export interface OrchestratorCostSession {
  phase: "start" | "stop";
  costAgentId: string;
  rootPath: string;
  projectId: string | null;
  /** 하네스족(`claude` / `gpt` / `grok` / ...). 모르면 null — 지어내지 않는다. */
  model: string | null;
  /** claude 계열에서 **확정된** 세션 파일 id. 아직 모르면 null. */
  claudeSessionId: string | null;
}

export type OrchestratorCostPlan =
  | {
      action: "track";
      costAgentId: string;
      rootPath: string;
      /** trackSession 에 넘길 세션 id. 격리 홈 하네스는 null 이 정상이다. */
      sessionId: string | null;
      model: string;
    }
  | { action: "stop"; costAgentId: string }
  | { action: "skip"; costAgentId: string; reason: OrchestratorCostSkipReason };

export type OrchestratorCostSkipReason =
  /** 하네스족을 모른다. */
  | "unknown-harness"
  /** claude 인데 세션 파일 id 가 아직 확정되지 않았다 — 곧 다시 들어온다. */
  | "session-id-pending"
  /** 이 하네스는 오케 단위 사용량 출처가 아직 없다. 0 으로 그리면 안 된다. */
  | "no-usage-source";

/**
 * 오케 세션 이벤트 → 비용 추적 행동. **순수함수** — 여기가 회귀 테스트의 표면이다.
 *
 * ★claude 는 세션 파일 id 를 아는 경우에만 추적한다.
 * id 없이 `trackSession` 을 부르면 "프로젝트 폴더에서 제일 최근 JSONL" 분기로
 * 떨어지는데, 그게 2026-06 오귀속의 정확한 메커니즘이다 — 같은 초에 최대 11개
 * agentId 가 한 토큰 번들을 동시 청구했고, 당시 오케 명목 $22,329 중 $5,605 가
 * 워커 행과 바이트 단위로 동일했다. **모르면 안 싣는다.** 남의 비용을 오케에
 * 붙이는 것보다 미수집이 낫다.
 *
 * ★격리 홈 하네스(codex/gpt/grok/gemini)는 자기 홈만 보므로 그 위험이 없다 —
 * 세션 id 없이 바로 등록한다.
 */
export function planOrchestratorCostTracking(
  input: OrchestratorCostSession,
  isCliHomeTracked: (model: string) => boolean,
): OrchestratorCostPlan {
  const { costAgentId } = input;

  if (input.phase === "stop") return { action: "stop", costAgentId };

  const model = (input.model ?? "").trim();
  if (!model) return { action: "skip", costAgentId, reason: "unknown-harness" };

  if (isCliHomeTracked(model)) {
    return {
      action: "track",
      costAgentId,
      rootPath: input.rootPath,
      sessionId: null,
      model,
    };
  }

  if (model === "claude") {
    if (!input.claudeSessionId) {
      return { action: "skip", costAgentId, reason: "session-id-pending" };
    }
    return {
      action: "track",
      costAgentId,
      rootPath: input.rootPath,
      sessionId: input.claudeSessionId,
      model,
    };
  }

  // antigravity / custom / local: 오케 세션을 짚을 수 있는 사용량 출처가 아직
  // 없다. 조용히 0 으로 남기지 않고 사유를 남긴다 — 이 사고의 재발 형태가
  // 정확히 "아무도 에러를 못 본 채 빠지는 것" 이었다.
  return { action: "skip", costAgentId, reason: "no-usage-source" };
}
