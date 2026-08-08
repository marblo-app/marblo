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
  "beginner.connect.pickYourself": "직접 고르기",
  "beginner.connect.installFail": "설치하지 못했어요",
  "beginner.connect.officialDocs": "공식 설치 안내 보기",

  // ── ①-a 원클릭 (모두 설치 + 자동 로그인) ────────────────────────────────
  "beginner.oneClick.ctaTitle": "한 번에 준비하기",
  "beginner.oneClick.ctaBody":
    "필요한 CLI 를 대신 설치하고, 끝나면 로그인 창까지 자동으로 띄워 드려요. 브라우저에서 승인만 하시면 됩니다.",
  "beginner.oneClick.cta": "모두 설치하고 자동 로그인",
  "beginner.oneClick.ctaPending": "설치할 것 {count}개",
  "beginner.oneClick.ctaNothingToInstall":
    "설치는 이미 끝났어요 — 로그인만 하면 됩니다",
  "beginner.oneClick.title": "설치하고 로그인하는 중이에요",
  "beginner.oneClick.step.install": "설치",
  "beginner.oneClick.step.auth": "로그인",
  "beginner.oneClick.status.installing":
    "필요한 CLI 를 설치하고 있어요. 잠시만 기다려 주세요.",
  "beginner.oneClick.status.signIn": "설치가 끝났어요. 로그인 창을 띄우는 중…",
  "beginner.oneClick.status.awaitingAuth":
    "브라우저에서 승인만 하시면 됩니다. 끝나면 자동으로 넘어가요.",
  "beginner.oneClick.status.blocked":
    "자동 설치가 막혔어요. 아래 명령을 터미널에 직접 붙여 넣으면 됩니다.",
  "beginner.oneClick.status.done": "연결됐어요. 바로 시작할 수 있습니다.",
  "beginner.oneClick.installProgress": "{done}/{total} 설치됨",
  "beginner.oneClick.partial":
    "{total}개 중 {failed}개는 실패했지만, 성공한 것으로 계속 진행해요.",
  "beginner.oneClick.terminalHint":
    "{cli} 로그인 창이에요. 브라우저가 열리면 승인해 주세요 — 아래 창은 그대로 두시면 됩니다.",
  "beginner.oneClick.stuck":
    "브라우저가 안 열리면, 아래 창에 나온 주소를 복사해 직접 열어도 됩니다.",
  "beginner.oneClick.blocked.title": "자동 설치가 실패했어요",
  "beginner.oneClick.blocked.body":
    "아래 명령을 터미널에 붙여 넣어 직접 설치한 뒤 '다시 시도' 를 눌러 주세요.",
  "beginner.oneClick.blocked.docs": "공식 설치 안내 보기",
  "beginner.oneClick.done": "준비 끝! 이제 무엇을 만들지 말씀해 주세요.",
  "beginner.oneClick.retry": "다시 시도",
  "beginner.oneClick.manual": "직접 고를게요",
  "beginner.oneClick.close": "닫기",
  "beginner.oneClick.footerHint": "언제든 닫고 직접 진행해도 됩니다.",

  // ── ② 폴더 ──────────────────────────────────────────────────────────────
  "beginner.folder.title": "작업할 폴더를 열어 주세요",
  "beginner.folder.body":
    "프로젝트 폴더를 고르면 그 안에서 에이전트가 일합니다. 비어 있는 새 폴더도 괜찮아요.",
  "beginner.folder.cta": "내 폴더 열기",
  "beginner.folder.preparingTitle": "연습용 프로젝트를 준비하고 있어요",
  "beginner.folder.preparingBody":
    "첫 시작을 위해 작은 예제 폴더를 만들어 자동으로 연결합니다. 몇 초면 끝나요.",
  "beginner.folder.sampleFailed":
    "예제 폴더를 만들지 못했어요. 위 버튼으로 직접 폴더를 열어 주세요.",

  // ── ③ 첫 요청 ───────────────────────────────────────────────────────────
  "beginner.ask.title": "무엇을 만들까요?",
  "beginner.ask.body":
    "하고 싶은 걸 그냥 한국어로 쓰면 됩니다. 티켓으로 쪼개고 에이전트를 붙이는 건 마블로가 알아서 해요.",
  "beginner.ask.placeholder":
    "예: 이 저장소의 README 를 읽고 시작 가이드를 정리해 줘",
  "beginner.ask.send": "보내기",
  "beginner.ask.sending": "보내는 중…",
  "beginner.ask.sent": "전달했어요. 아래에서 진행 상황이 보입니다.",
  "beginner.ask.sentShort": "전달됨",
  "beginner.ask.queuedShort": "대기 중",
  "beginner.ask.failedShort": "전달 실패",
  "beginner.ask.duplicate":
    "방금 보낸 말과 같아요. 이미 전달됐으니 조금 기다리거나 다르게 말해 주세요.",
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

  // ── ⑤ 미니 보드(스트립) + 에이전트 패널(하단 2분할 오른쪽) ──────────────
  // 보드·에이전트는 마블로의 핵심이라 비기너에게도 축소판을 보여 준다. 카드는
  // 눌리고(비기너 판 상세), 에이전트는 "누가 뭐하나" 까지 말한다.
  // 워크트리·diff·모델명은 여전히 감춘다.
  "beginner.board.label": "일감 흐름",
  "beginner.board.todo": "할 일",
  "beginner.board.doing": "진행 중",
  "beginner.board.done": "완료",
  "beginner.board.more": "+{count}개 더",
  "beginner.agents.label": "일하는 팀",
  "beginner.agents.empty":
    "아직 붙은 팀원이 없어요. 무엇을 만들지 말씀하시면 마블로가 팀을 붙입니다.",
  "beginner.agents.noTask": "지금은 맡은 일이 없어요",
  "beginner.agents.openTerminal": "눌러서 무슨 작업 중인지 보기",
  "beginner.agents.terminalEmpty":
    "아직 화면이 없어요. 이 팀원이 막 붙었거나 다시 연결하는 중입니다 — 잠시 뒤 다시 눌러 보세요.",
  "beginner.agents.terminalHint":
    "팀원이 지금 하고 있는 작업 화면이에요. 보기만 해도 되고, 필요하면 여기에 직접 답해 줄 수도 있어요.",

  // ── 챗 ──────────────────────────────────────────────────────────────────
  "beginner.chat.title": "마블로와 대화하기",
  "beginner.chat.hint": "여기에 이어서 말을 걸 수 있어요.",
  "beginner.chat.composerLabel": "이어서 말하기",
  "beginner.chat.dismiss": "이 입력칸 닫기",
  "beginner.chat.placeholder":
    "이어서 하고 싶은 말을 적어 주세요. 예: 방금 만든 가이드에 예시를 더 넣어 줘",
  "beginner.chat.orchestratorRunning": "대화 중",

  // ── 티켓 상세(미니 보드 카드 클릭) ──────────────────────────────────────
  "beginner.taskDetail.label": "일감 상세",
  "beginner.taskDetail.owner": "{name} 이(가) 맡고 있어요",
  "beginner.taskDetail.noOwner": "아직 아무도 붙지 않았어요",
  "beginner.taskDetail.askProgressCta": "진행 상황 물어보기",
  "beginner.taskDetail.askProgress":
    "'{title}' 지금 어디까지 됐어? 짧게 알려줘.",
  "beginner.taskDetail.askStuckCta": "왜 막혔는지 물어보기",
  "beginner.taskDetail.askStuck":
    "'{title}' 이 막힌 것 같아. 왜 멈췄고 내가 뭘 해주면 되는지 쉬운 말로 알려줘.",
  "beginner.taskDetail.askDoneCta": "무엇이 바뀌었는지 물어보기",
  "beginner.taskDetail.askDone":
    "'{title}' 에서 무엇이 어떻게 바뀌었는지 쉬운 말로 정리해 줘.",
  "beginner.taskDetail.close": "닫기",

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
    "요청을 보내면 티켓이 몇 개 생겼는지, 어디까지 왔는지 이 줄에서 계속 보입니다. 카드를 누르면 그 일이 무엇인지 볼 수 있고, 누가 맡았는지는 오른쪽 팀 칸에 나와요.",
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
  // 어드밴스드 상단바에 서는 **되돌리기** 어포던스(비기너 상단바의
  // `beginner.topbar.advanced` 와 정확히 반대 방향).
  "beginner.topbar.simple": "간단 모드",
  "beginner.topbar.simpleHint":
    "탭·보드를 접고 큰 대화창 하나만 보여 줍니다. 설정에서 언제든 되돌릴 수 있어요.",
  "beginner.settings.replayTour": "첫 실행 안내 다시 보기",
  "beginner.settings.replayTourDone":
    "다음에 비기너 화면을 열면 안내가 다시 나와요.",
};
