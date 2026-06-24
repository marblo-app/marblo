/**
 * Korean — `flows.*` namespace (Flows tab: empty state, preset cards, usage
 * guide, node-type legend). The FLOW_PRESETS array is seed content for the
 * created flow document (names, node labels, Python scripts) — that's data,
 * not UI shell, so it stays untranslated. Guide steps embed locale-invariant
 * literals (`+ New Flow`, `Node Palette`, `/tf-flow`) so they're split into
 * pre/keyword/post segments. Keys keep their dotted form.
 */
export const flows = {
  "flows.empty.title": "플로우를 선택하거나 새로 만드세요",
  "flows.empty.subtitle":
    "좌측 + 버튼으로 빈 플로우를 만들거나, 아래 프리셋을 선택하세요",
  "flows.preset.create": "클릭하여 생성",

  "flows.guide.title": "플로우 사용 가이드",
  "flows.guide.step1.pre": "좌측 ",
  "flows.guide.step1.mid": "로 빈 플로우 생성하거나 ",
  "flows.guide.step1.preset": "프리셋",
  "flows.guide.step1.post": " 선택",
  "flows.guide.step2.pre": "좌측 하단 ",
  "flows.guide.step2.post": "에서 노드를 캔버스로 드래그",
  "flows.guide.step3.pre": "노드의 ",
  "flows.guide.step3.handle": "핸들(점)",
  "flows.guide.step3.post": "을 드래그해서 다른 노드에 연결",
  "flows.guide.step4.pre": "노드 클릭 시 우측에 ",
  "flows.guide.step4.panel": "설정 패널",
  "flows.guide.step4.post": " 표시",
  "flows.guide.step5.pre": "오케스트레이터에 ",
  "flows.guide.step5.post": " 입력으로 AI가 플로우 자동 생성",

  "flows.nodeTypes.title": "노드 종류",
  "flows.nodeTypes.agent": "AI 에이전트 실행",
  "flows.nodeTypes.llm": "LLM API 호출",
  "flows.nodeTypes.api": "HTTP 요청",
  "flows.nodeTypes.integration": "Slack/Notion 등",
  "flows.nodeTypes.branch": "조건 분기",
  "flows.nodeTypes.human": "사람 승인",
  "flows.nodeTypes.io": "시작/종료",
};
