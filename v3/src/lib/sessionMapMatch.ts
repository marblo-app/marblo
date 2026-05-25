/**
 * 순수 매칭 로직 — agents × sessions × 현재 sessionMap 에서
 * 새로 등록해야 할 (agentId, sessionId) 쌍 계산.
 *
 * 별도 파일로 둔 이유: hook 파일에서 import 하면 store → firebase 체인까지
 * 끌려와 vitest 환경에서 어차피 fail. 순수 함수는 부수효과 없이 단위
 * 테스트 가능.
 *
 * 매칭 휴리스틱은 AgentListPanel.rows 와 동일 — agent name 의 suffix 가
 * session.name 끝에 붙으면 매칭. 라벨 prefix("Agent: ", "🟣 ", "🔵 ", ...) 가
 * 5+ 곳에서 다양해서 suffix 만 공통분모로 잡음.
 */

interface AgentLike {
  id: string;
  name: string;
}
interface SessionLike {
  id: string;
  name: string;
  isAgent?: boolean;
}

export function computeSessionMapUpdates(
  agents: AgentLike[],
  sessions: SessionLike[],
  currentMap: Record<string, string>,
): Array<[string, string]> {
  const updates: Array<[string, string]> = [];
  for (const agent of agents) {
    const matched = sessions.find(
      (s) => s.isAgent && s.name.endsWith(agent.name),
    );
    if (!matched) continue;
    if (currentMap[agent.id] === matched.id) continue;
    updates.push([agent.id, matched.id]);
  }
  return updates;
}
