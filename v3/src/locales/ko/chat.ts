/**
 * Korean — `chat.*` namespace (team chat panel, components/chat/ProjectChat).
 *
 * Only the chrome (empty states, input placeholder, queue-failure toast) is
 * translated. Message bodies and sender names are user/agent data — never
 * routed through t().
 */
export const chat = {
  "chat.empty.noProject": "프로젝트를 선택하세요",
  "chat.empty.noMessages": "메시지가 없습니다",
  "chat.empty.startHint": "팀 채팅을 시작하세요",
  "chat.inputPlaceholder": "메시지 입력... (@로 멘션)",
  "chat.orchestratorQueueFailed": "⚠️ 오케스트레이터 큐 등록에 실패했습니다.",
};
