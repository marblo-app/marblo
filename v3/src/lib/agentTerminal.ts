/**
 * 에이전트 → PTY 세션 짝짓기 — 어드밴스드 에이전트 탭과 비기너 셸의 **공용 규칙.**
 *
 * PTY 세션은 이름으로만 에이전트와 이어져 있다. `attachSession` 이 5군데 이상에서
 * 서로 다른 라벨 형식으로 불리기 때문이다:
 *
 *   "Agent: <name>"           (Layout.tsx 최초 스폰)
 *   "🟣 <name>"                (useAgentReconnect / restartAgent / AgentStatusCard)
 *   "🔵 <name>" / "🟢 <name>"  (gemini / gpt+codex)
 *
 * 그래서 판정은 `endsWith` 다. 트레이드오프는 그대로다 — 한 에이전트 이름이 다른
 * 이름의 접미사이면(예: "foo-1" vs "x-foo-1") 엉뚱한 세션이 잡힌다. 근본 수리는
 * Agent 문서에 정식 `ptySessionId` 를 싣는 것이고, 그때 고칠 자리도 여기 한 곳이다.
 *
 * ★이 규칙을 파일로 뽑은 이유가 그것이다. 비기너 셸이 자기 판본을 들면 두 화면이
 * 갈라지고, 갈라진 쪽은 라벨 형식이 하나 더 늘어나는 날 조용히 터미널을 못 찾는다.
 */

export interface PtySessionLike {
  id: string;
  name: string;
  isAgent?: boolean;
}

/**
 * 이 에이전트의 살아 있는 PTY 세션 id. 못 찾으면 `undefined` —
 * "아직 붙지 않았다"(스폰 직후·재시작 후 재접속 전)와 "죽었다" 를 여기서
 * 구분하지 않는다. 호출부는 둘 다 "지금은 볼 화면이 없다" 로 그리면 된다.
 */
export function findAgentPtySessionId(
  sessions: readonly PtySessionLike[],
  agentName: string,
): string | undefined {
  if (!agentName) return undefined;
  return sessions.find((s) => s.isAgent && s.name.endsWith(agentName))?.id;
}
