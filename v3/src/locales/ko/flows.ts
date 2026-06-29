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

  // NodePalette — per-type descriptions (some are locale-invariant tech lists)
  "flows.palette.input": "텍스트/파일/변수",
  "flows.palette.llm": "Claude/GPT/Gemini",
  "flows.palette.agent": "CLI 에이전트 실행",
  "flows.palette.code": "Python/Shell/Node",
  "flows.palette.api": "HTTP 요청",
  "flows.palette.integration": "Slack/Notion/Sheets",
  "flows.palette.human": "PM 확인 게이트",
  "flows.palette.branch": "if/else 분기",
  "flows.palette.output": "결과 표시",

  // FlowKanbanLink — node run-status labels
  "flows.status.running": "실행 중",
  "flows.status.waiting": "대기 중",
  "flows.status.completed": "완료",
  "flows.status.error": "오류",
  "flows.status.unknown": "-",

  // CodeNode — empty script placeholder
  "flows.codeNode.clickToWrite": "클릭하여 코드 작성",

  // NodeConfigPanel — agent config
  "flows.config.selectPlaceholder": "-- 선택 --",
  "flows.config.connectionMode": "연결 모드",
  "flows.config.mode.existing": "기존 세션 연결",
  "flows.config.mode.auto": "자동 스폰 (새 에이전트)",
  "flows.config.mode.existingHint": "Agents 탭에서 실행 중인 세션에 연결합니다",
  "flows.config.mode.autoHint":
    "플로우 실행 시 새 에이전트를 자동으로 스폰합니다",
  "flows.config.selectAgentSession": "에이전트 세션 선택",
  "flows.config.noRunningAgents":
    "실행 중인 에이전트가 없습니다. Agents 탭에서 먼저 스폰하세요.",
  "flows.config.agentName": "에이전트 이름",
  "flows.config.taskPlaceholder": "이 에이전트가 수행할 작업...",
  // NodeConfigPanel — code config
  "flows.config.codeHint.pre":
    "직접 실행할 코드를 작성하세요. 이전 노드 결과는 ",
  "flows.config.codeHint.post": " 변수로 접근합니다.",
  "flows.config.cwdPlaceholder": "프로젝트 루트 (기본값)",
  // NodeConfigPanel — integration config
  "flows.config.bodyPlaceholder": "전송할 내용...",
  "flows.config.inputRefHint.pre": "이전 노드 결과를 ",
  "flows.config.inputRefHint.post": "로 참조할 수 있습니다.",
  "flows.config.apiTokenPlaceholder": "설정에서 환경변수로 관리 권장",
  "flows.config.apiTokenHint":
    "보안을 위해 Settings 탭의 환경변수를 사용하세요.",

  // NodeConfigPanel — integration action labels (option display names)
  "flows.action.send_message": "메시지 전송",
  "flows.action.upload_file": "파일 업로드",
  "flows.action.create_channel": "채널 생성",
  "flows.action.create_page": "페이지 생성",
  "flows.action.update_page": "페이지 수정",
  "flows.action.query_database": "DB 쿼리",
  "flows.action.send_photo": "이미지 전송",
  "flows.action.read_range": "범위 읽기",
  "flows.action.write_range": "범위 쓰기",
  "flows.action.append_row": "행 추가",
  "flows.action.create_issue": "이슈 생성",
  "flows.action.create_pr": "PR 생성",
  "flows.action.add_comment": "코멘트 추가",
  "flows.action.create_thread": "스레드 생성",
  "flows.action.send_email": "이메일 전송",
  "flows.action.trigger": "웹훅 트리거",
};
