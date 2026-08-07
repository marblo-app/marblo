/**
 * Korean — `beginner.*` namespace. 비기너 모드(오케챗 우선 셸).
 * 설계: v3/docs/BEGINNER-MODE-DESIGN.md
 * Add the matching key to ../en/beginner.ts (typed against this file).
 */
export const beginner = {
  // ── 상단바 ──────────────────────────────────────────────────────────────
  "beginner.topbar.noFolder": "폴더 없음",
  "beginner.topbar.openFolder": "내 폴더 열기",
  "beginner.topbar.changeFolder": "폴더 바꾸기",
  "beginner.topbar.settings": "설정",
  "beginner.topbar.advanced": "개발 모드로 보기",
  "beginner.topbar.advancedHint":
    "보드·워크트리·모델 선택이 있는 원래 화면으로 갑니다. 설정에서 언제든 돌아올 수 있어요.",

  // ── ① 연결 (인증 하나만) ────────────────────────────────────────────────
  "beginner.connect.title": "하나만 연결하면 시작할 수 있어요",
  "beginner.connect.subtitle":
    "Claude 또는 Codex 중 **하나만** 연결하세요. 나머지는 나중에 추가해도 됩니다.",
  "beginner.connect.claudeName": "Claude",
  "beginner.connect.claudeDesc": "Claude Code 구독 계정으로 연결",
  "beginner.connect.codexName": "Codex",
  "beginner.connect.codexDesc": "ChatGPT(Codex) 구독 계정으로 연결",
  "beginner.connect.cta": "연결하기",
  "beginner.connect.connecting": "연결 중…",
  "beginner.connect.installing": "설치하는 중이에요… 잠시만요",
  "beginner.connect.terminalHint":
    "아래 창에서 브라우저 인증을 마쳐 주세요. 끝나면 자동으로 넘어갑니다.",
  "beginner.connect.recheck": "다시 확인",
  "beginner.connect.checking": "확인 중…",
  "beginner.connect.ready": "연결됐어요",
  "beginner.connect.watchDemo": "먼저 데모 보기",
  "beginner.connect.stuck":
    "잘 안 되나요? 터미널에 나온 주소를 브라우저에 직접 붙여 넣어도 됩니다.",

  // ── ② 폴더 ──────────────────────────────────────────────────────────────
  "beginner.folder.title": "작업할 폴더를 열어 주세요",
  "beginner.folder.body":
    "프로젝트 폴더를 고르면 그 안에서 에이전트가 일합니다. 비어 있는 새 폴더도 괜찮아요.",
  "beginner.folder.cta": "내 폴더 열기",

  // ── ③ 첫 요청 ───────────────────────────────────────────────────────────
  "beginner.ask.title": "무엇을 만들까요?",
  "beginner.ask.body":
    "하고 싶은 걸 그냥 한국어로 쓰면 됩니다. 티켓으로 쪼개고 에이전트를 붙이는 건 마블로가 알아서 해요.",
  "beginner.ask.placeholder":
    "예: 이 저장소의 README 를 읽고 시작 가이드를 정리해 줘",
  "beginner.ask.send": "보내기",
  "beginner.ask.sending": "보내는 중…",
  "beginner.ask.sent": "전달했어요. 아래에서 진행 상황이 보입니다.",
  "beginner.ask.resend": "다시 보내기",
  "beginner.ask.queued":
    "아직 오케스트레이터가 준비되지 않아 대기열에만 담겼어요. 잠시 후 다시 보내 주세요.",
  "beginner.ask.failed": "전달하지 못했어요. 잠시 후 다시 시도해 주세요.",
  "beginner.ask.example1": "README 를 읽고 시작 가이드를 정리해 줘",
  "beginner.ask.example2": "테스트가 없는 함수에 테스트를 붙여 줘",
  "beginner.ask.example3": "이 프로젝트 구조를 설명해 줘",

  // ── ④ 인라인 라이브 (★S4) ───────────────────────────────────────────────
  "beginner.live.thinking": "요구사항을 읽고 있어요… (보통 1~3분)",
  "beginner.live.stalled": "아직 티켓이 안 보여요",
  "beginner.live.stalledHelp":
    "오케스트레이터가 못 받았을 수 있어요. 다시 보내거나, 아래 대화창에 직접 적어 주세요.",
  "beginner.live.planned": "할 일 {count}개를 만들었어요",
  "beginner.live.working": "에이전트 {count}명이 일하고 있어요",
  "beginner.live.completed": "{count}건 끝났어요",
  "beginner.live.progress": "{done}/{total} 완료",
  "beginner.live.label": "지금 하는 일",

  // ── 챗 ──────────────────────────────────────────────────────────────────
  "beginner.chat.title": "마블로와 대화하기",
  "beginner.chat.hint": "여기에 이어서 말을 걸 수 있어요.",

  // ── 승격 모달 ───────────────────────────────────────────────────────────
  "beginner.promote.title": "이제 진짜 힘 좀 써볼까요?",
  "beginner.promote.body":
    "여기까지 오셨으면 준비된 거예요. 고급 모드에서는 이런 걸 할 수 있어요.",
  "beginner.promote.point1": "보드에서 여러 에이전트를 직접 지휘하기",
  "beginner.promote.point2": "워크트리·diff 로 바뀐 코드 검토하기",
  "beginner.promote.point3": "티켓마다 모델을 골라 스폰하기",
  "beginner.promote.cta": "고급 모드로 전환",
  "beginner.promote.later": "지금은 그대로",
  "beginner.promote.revertHint": "설정에서 언제든 다시 돌아올 수 있어요.",
  "beginner.promote.reason.completed": "티켓 {count}건을 끝내셨어요",
  "beginner.promote.reason.merged": "첫 머지까지 마치셨어요",
  "beginner.promote.reason.days": "마블로를 며칠째 쓰고 계시네요",

  // ── 코치마크 투어 (첫 실행 안내) ────────────────────────────────────────
  "beginner.tour.progress": "안내 {current}/{total}",
  "beginner.tour.next": "다음",
  "beginner.tour.back": "이전",
  "beginner.tour.done": "시작하기",
  "beginner.tour.skip": "건너뛰기",
  "beginner.tour.never": "다시 보지 않기",
  "beginner.tour.chat.title": "여기가 마블로와 대화하는 곳이에요",
  "beginner.tour.chat.body":
    "터미널처럼 보이지만 그냥 말을 걸면 됩니다. 마블로가 알아듣고 일을 쪼개 에이전트에게 넘겨요.",
  "beginner.tour.ask.title": "첫 요청은 여기에 적어 주세요",
  "beginner.tour.ask.body":
    "무엇을 만들지 한국어로 그냥 쓰면 됩니다. 아래 예시를 눌러도 돼요.",
  "beginner.tour.live.title": "진행 상황은 여기에 나와요",
  "beginner.tour.live.body":
    "요청을 보내면 티켓이 몇 개 생겼는지, 지금 몇 명이 일하는지 이 줄에서 계속 보입니다.",
  "beginner.tour.advanced.title": "언제든 개발 모드로 넘어갈 수 있어요",
  "beginner.tour.advanced.body":
    "보드·워크트리·모델 선택이 필요해지면 여기를 누르세요. 설정에서 다시 돌아올 수 있어요.",

  // ── 설정 토글 ───────────────────────────────────────────────────────────
  "beginner.settings.heading": "비기너 모드",
  "beginner.settings.body":
    "탭·보드·워크트리를 숨기고 큰 대화창 하나만 보여 줍니다. 처음 쓰거나, 조용히 시키기만 하고 싶을 때 좋아요.",
  "beginner.settings.on": "비기너 모드 켜기",
  "beginner.settings.off": "고급 모드로 전환",
  "beginner.settings.restartHint":
    "화면 전체가 바뀝니다. 진행 중인 에이전트는 그대로 계속 돌아가요.",
  "beginner.settings.replayTour": "첫 실행 안내 다시 보기",
  "beginner.settings.replayTourDone":
    "다음에 비기너 화면을 열면 안내가 다시 나와요.",
};
