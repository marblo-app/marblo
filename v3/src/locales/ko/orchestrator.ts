/**
 * Korean — `orchestrator.*` namespace (orchestrator command panel + the slash
 * command catalog's display labels). The slash `command`/`label` (e.g.
 * `tf-plan`) stay as identifiers; only the human-facing `description` and the
 * category labels are translated here. One namespace per file so parallel i18n
 * PRs don't collide. Keys keep their dotted form.
 */
export const orchestrator = {
  // Command panel chrome
  "orchestrator.title": "오케스트레이터",
  "orchestrator.notRunning": "오케스트레이터가 실행 중이 아닙니다",
  "orchestrator.sending": "전송…",
  "orchestrator.board": "보드",
  "orchestrator.aiDecompose": "AI 태스크 분해",
  "orchestrator.addTask": "새 태스크 추가",
  "orchestrator.sessionPicker": "세션 선택",
  "orchestrator.autoStartHint": "(폴더를 열면 자동 시작)",
  // 스폰 차단 안내 — 로그인이 아니라 MCP 가용성으로 막힌 경우(#639 grok 게이트).
  "orchestrator.blocked.mcpTitle":
    "{model} 오케를 띄우지 못했습니다 — Marblo MCP 툴이 붙지 않습니다",
  "orchestrator.blocked.mcpHint":
    "로그인 문제가 아닙니다. 이 CLI 는 신뢰되지 않은 폴더에서 로컬 MCP 서버를 기동하지 않으므로, 해당 CLI 로 프로젝트 폴더를 한 번 신뢰(trust)해 준 뒤 다시 시작하세요. MCP 없이 뜬 오케는 보드·디스패치를 하나도 못 합니다.",
  // 스폰 차단 안내 — 로그인/설치로 막힌 경우. 위저드가 스스로를 억제해도(이미
  // claude 가 준비된 사용자가 grok 을 고른 경우) 이 배너는 항상 뜬다.
  "orchestrator.blocked.authTitle":
    "{model} 오케를 띄우지 못했습니다 — 이 CLI 의 로그인이 필요합니다",
  "orchestrator.blocked.authHint":
    "다른 CLI 가 로그인돼 있어도 오케로 고른 이 CLI 는 따로 로그인해야 합니다. 아래 조치를 실행한 뒤 다시 시작하세요.",
  // 스폰 차단 안내 — 벤더 크레덴셜/잔액으로 막힌 경우(7HthjBEf, DeepSeek).
  // ★조치가 넷으로 갈린다(충전 / 키 등록 / 키 교체 / 네트워크). 어느 것인지는
  // main 이 준 `action` 한 줄이 말하고, 여기 hint 는 그 위에 얹는 공통 맥락이다 —
  // "로그인 문제가 아니다" 를 먼저 못박지 않으면 사용자는 위저드를 찾으러 간다.
  "orchestrator.blocked.vendorTitle":
    "{model} 오케를 띄우지 못했습니다 — 이 모델을 돌리는 벤더 크레덴셜/잔액 문제입니다",
  "orchestrator.blocked.vendorHint":
    "로그인 문제가 아닙니다. 이 모델은 구독이 아니라 벤더 선불 크레딧으로 돌아서, 잔액이 0 이 되거나 키가 없으면 CLI 로그인이 멀쩡해도 뜨지 않습니다. 위 조치를 끝낸 뒤 [사용량] 탭 → 벤더 크레딧에서 새로고침(⟳)해 잔액을 확인하고 다시 시작하세요. 여기서 조용히 기본 모델로 바꿔 띄우지 않는 이유는, 고른 것과 다른 백엔드가 말없이 도는 편이 훨씬 나쁘기 때문입니다.",
  "orchestrator.blocked.login": "{model} 로그인",
  "orchestrator.blocked.dismiss": "닫기",

  // ───────────────────────────────────────────────────────────────────────
  // ★정지 사유 — 오케가 **뜬 뒤에** 멈춘 경우(F-4/F-5, ymRo9BtilQnb48Y5ol68).
  //
  // 위의 `blocked.*` 는 스폰 **전** 게이트고, 이쪽은 PTY 가 이미 뜬 뒤 main 이
  // IPC 로 밀어 주는 축이다. 종전엔 이 축의 사유가 화면 어디에도 없어서 패널이
  // 초록 running 에 고정됐다 — 사장님이 오늘 아침 보신 화면이 그것이다.
  //
  // ★문구 규칙: Title 은 "무슨 일이 났나", Hint 는 **"무엇을 하면 되나"**.
  // "오류" 한 줄로 끝내면 정보량이 종전(=아무것도 없음)과 같다. Label 은 헤더
  // 한 줄에 들어가는 짧은 형태로, 종전의 "Error" 를 대신한다.
  // {model} 은 분류된 CLI id 뿐이다(PTY 원문 아님 — orchestratorHalt 주석).
  "orchestrator.halt.restart": "다시 시작",

  "orchestrator.halt.needsAuthLabel": "로그인 필요",
  "orchestrator.halt.needsAuthTitle":
    "{model} 로그인이 필요합니다 — 오케스트레이터가 멈췄습니다",
  "orchestrator.halt.needsAuthHint":
    "이 CLI 의 로그인 화면이 떠 있어서 부팅을 중단했습니다(로그인 화면에 아무것도 입력하지 않았습니다). 아래 [로그인] 을 누르면 터미널 탭에서 로그인이 열립니다 — 끝낸 뒤 [다시 시작] 을 누르세요.",

  "orchestrator.halt.firstRunDialogLabel": "확인 창이 떠 있습니다",
  "orchestrator.halt.firstRunDialogTitle":
    "폴더 신뢰 확인 같은 첫 실행 화면이 떠 있습니다 — 오케스트레이터가 멈췄습니다",
  "orchestrator.halt.firstRunDialogHint":
    "아래 터미널에 뜬 질문에 직접 답해 주세요(방향키로 고르고 Enter). 저희가 대신 누르지 않는 이유는, 무슨 화면인지 확실하지 않은 상태에서 키를 보내면 엉뚱한 선택이 확정되기 때문입니다. 답한 뒤에도 멈춰 있으면 [다시 시작] 을 누르세요.",

  "orchestrator.halt.rootPathMissingLabel": "폴더 없음",
  "orchestrator.halt.rootPathMissingTitle":
    "작업 폴더가 사라져서 오케스트레이터가 멈췄습니다",
  "orchestrator.halt.rootPathMissingHint":
    "이 프로젝트가 가리키던 폴더가 지워졌거나 옮겨졌습니다(워크트리를 정리하면 흔히 생깁니다). 사이드바에서 프로젝트 폴더를 지금 있는 경로로 다시 지정한 뒤 시작하세요.",

  "orchestrator.halt.spawnFailedLabel": "실행 실패",
  "orchestrator.halt.spawnFailedTitle": "오케스트레이터를 실행하지 못했습니다",
  "orchestrator.halt.spawnFailedHint":
    "터미널 프로세스를 만들지 못했지만 원인을 특정하지 못했습니다. 앱 진단 로그에서 spawn failure의 errno·command·PATH·cwd·세션 수를 확인한 뒤 [다시 시작] 을 눌러 주세요.",
  "orchestrator.halt.spawnFailedEaccesHint":
    "설치 파일의 실행 권한 또는 설치 상태에 문제가 있을 수 있습니다. 앱을 완전히 종료한 뒤 `node scripts/postinstall.mjs`를 다시 실행하고 [다시 시작] 을 눌러 주세요.",
  "orchestrator.halt.spawnFailedEnxioHint":
    "PTY 풀이 가득 찼을 수 있습니다. 여분의 마블로 인스턴스와 터미널을 정리한 뒤 [다시 시작] 을 눌러 주세요.",

  "orchestrator.halt.crashLoopLabel": "반복 종료",
  "orchestrator.halt.crashLoopTitle":
    "오케스트레이터가 반복해서 종료돼 자동 재시작을 멈췄습니다",
  "orchestrator.halt.crashLoopHint":
    "세 번 자동으로 다시 띄웠지만 매번 곧바로 종료됐습니다. [다시 시작] 을 눌러 새 세션으로 띄워 보고, 그래도 같으면 다른 모델로 바꿔서 시작해 보세요.",

  "orchestrator.halt.unknownLabel": "멈춤",
  "orchestrator.halt.unknownTitle": "오케스트레이터가 멈췄습니다",
  // ★사유를 모를 때(구버전 main 이거나 우리가 모르는 표식)도 **다음 행동은
  // 말한다**. 여기서 main 이 준 문자열을 그대로 그리지 않는 것이 규약이다.
  "orchestrator.halt.unknownHint":
    "사유를 확인하지 못했습니다. 아래 터미널에 마지막 화면이 남아 있으면 그걸 확인하고, [다시 시작] 을 눌러 주세요.",
  // 모델 셀렉터의 **단가 꼬리표**. 토큰당 청구되는 칸(env-swap 벤더)에만 붙는다 —
  // 네이티브 칸은 구독으로 돌아 $/1M 이 청구서가 아니다.
  // ★같은 벤더 안에서 3배 차이가 나는 칸들(DeepSeek flash/pro)을 라벨만 보고
  // 고르지 않게 하려는 것이다. 표기는 peak 정가이고, off-peak 절반 안내는
  // 사용량탭 모델 정보표가 한다.
  "orchestrator.modelPrice": "입력 {in} / 출력 {out} · 1M 토큰",
  "orchestrator.modelPriceTip":
    "1M 토큰당 입력 {in} / 출력 {out}. 구독이 아니라 벤더 선불 잔액에서 토큰당 차감됩니다. 표시 단가는 peak 정가이고, off-peak 에는 절반입니다(사용량 탭 → 모델 정보 참조).",
  // Category labels
  "orchestrator.cat.project": "프로젝트 시작",
  "orchestrator.cat.project-step": "단계별 시작",
  "orchestrator.cat.agent": "에이전트",
  "orchestrator.cat.work": "작업",
  "orchestrator.cat.pause": "중단/재개",
  "orchestrator.cat.review": "리뷰",
  "orchestrator.cat.deploy": "배포",
  "orchestrator.cat.sync": "정리",
  "orchestrator.cat.repeat": "반복",
  "orchestrator.cat.util": "유틸",
  // Slash command descriptions (display labels — the command id stays English)
  "orchestrator.cmd.tf-plan.desc": "요구사항 분석 + 태스크 계획",
  "orchestrator.cmd.tf-start.desc": "태스크 일괄 생성 + 에이전트 스폰",
  "orchestrator.cmd.tf-analyze.desc": "요구사항 분석",
  "orchestrator.cmd.tf-create-tasks.desc": "분석 기반 태스크 생성",
  "orchestrator.cmd.tf-spawn-agents.desc": "에이전트 라인업 + 스폰",
  "orchestrator.cmd.tf-spawn.desc": "물리 에이전트 스폰 (터미널 탭)",
  "orchestrator.cmd.tf-agent.desc": "논리 서브에이전트 (빠른 조사)",
  "orchestrator.cmd.tf-work.desc": "태스크 claim + 코딩",
  "orchestrator.cmd.tf-status.desc": "현황 대시보드",
  "orchestrator.cmd.tf-add.desc": "태스크 추가/수정",
  "orchestrator.cmd.tf-flow.desc": "플로우 파이프라인 설계",
  "orchestrator.cmd.tf-hold.desc": "작업 중단 + 현황 정리",
  "orchestrator.cmd.tf-resume.desc": "중단된 작업 이어하기",
  "orchestrator.cmd.tf-review.desc": "PM 코드 리뷰",
  "orchestrator.cmd.tf-feedback.desc": "PM 피드백 확인 + 답변",
  "orchestrator.cmd.tf-fix.desc": "FAILED/BLOCKED 복구",
  "orchestrator.cmd.tf-handoff.desc": "에이전트 실패 → 직접 이어받기",
  "orchestrator.cmd.tf-deploy.desc": "GCP Cloud Run 배포",
  "orchestrator.cmd.tf-sync.desc": "코드 ↔ 티켓 동기화",
  "orchestrator.cmd.tf-done.desc": "프로젝트 완료 + 아카이브",
  "orchestrator.cmd.tf-ralph.desc": "같은 작업 N개 일괄 처리",
  "orchestrator.cmd.tf-guide.desc": "명령어 가이드",

  // OrchestratorChat (AI task-breakdown dialog) — UI shell only; projectName /
  // error.message are runtime data passed in as placeholders.
  "orchestrator.chat.decomposed":
    '"{project}" 프로젝트를 {count}개 태스크로 분해했습니다. {layers}개 레이어로 병렬 실행 가능합니다.',
  "orchestrator.chat.error": "오류가 발생했습니다: {error}. 다시 시도해주세요.",
  "orchestrator.chat.unknownError": "알 수 없는 오류",
  "orchestrator.chat.created": "{count}개 태스크가 칸반 보드에 생성되었습니다!",
  "orchestrator.chat.createError": "태스크 생성 중 오류: {error}",
  "orchestrator.chat.emptyTitle": "프로젝트 요구사항을 자연어로 입력하세요",
  "orchestrator.chat.emptySubtitle":
    "AI가 태스크를 분해하고 의존성 그래프를 생성합니다",
  "orchestrator.chat.decomposing": "태스크를 분해하고 있습니다...",
  "orchestrator.chat.inputPlaceholder":
    "프로젝트 요구사항을 입력하세요... (Shift+Enter로 줄바꿈)",

  // DecompositionResult — summary stat labels
  "orchestrator.decomp.title": "분해 결과",
  "orchestrator.decomp.tasks": "태스크",
  "orchestrator.decomp.layers": "레이어",
  "orchestrator.decomp.dependencies": "의존성",
  "orchestrator.decomp.estHours": "예상 시간",

  // TaskPreview — editable preview chrome (task title/description are data)
  "orchestrator.preview.newTaskTitle": "새 태스크",
  "orchestrator.preview.execLayers": "실행 레이어 (DAG)",
  "orchestrator.preview.descPlaceholder": "설명...",
  "orchestrator.preview.done": "완료",
  "orchestrator.preview.edit": "편집",
  "orchestrator.preview.delete": "삭제",
  "orchestrator.preview.addTask": "+ 태스크 추가",
  "orchestrator.preview.taskCount": "{count}개 태스크",
  "orchestrator.preview.creating": "생성 중...",
  "orchestrator.preview.createOnBoard": "칸반에 생성",
  // ── 워크체인 (티켓 fQtXQ2NzyYs0MRpqByTS) — 오케가 다음에 할 일 ──
  "orchestrator.chain.title": "오케브레인",
  "orchestrator.chain.subtitle":
    "오케가 다음에 할 작정인 것 — 완료는 보드가 판정합니다",
  "orchestrator.chain.toggleShow": "펼치기",
  "orchestrator.chain.toggleHide": "접기",
  "orchestrator.chain.countOpen": "열림 {open}",
  "orchestrator.chain.countReady": "준비 {ready}",
  "orchestrator.chain.state.ready": "준비됨",
  "orchestrator.chain.state.waiting": "대기",
  "orchestrator.chain.state.done": "완료",
  "orchestrator.chain.state.doneSelf": "완료(자기보고)",
  "orchestrator.chain.state.dropped": "내림",
  "orchestrator.chain.state.unsplit": "아직 안 쪼개짐",
  "orchestrator.chain.missionProgress": "{label}: {reached}/{total} 완료",
  "orchestrator.chain.missionCombined": "미션 {count}개 합산",
  "orchestrator.chain.group.progress": "{done}/{total} 단계 완료",
  "orchestrator.chain.unsplitHint":
    "이 미션에 티켓이 없습니다. 쪼개져야 보드가 완료를 판정합니다.",
  "orchestrator.chain.next": "다음",
  "orchestrator.chain.why": "왜",
  "orchestrator.chain.evidence": "근거 티켓",
  "orchestrator.chain.waitingOn": "기다리는 것",
  "orchestrator.chain.missingTask": "보드에 없는 티켓",
  "orchestrator.chain.closedReason": "사유",
  "orchestrator.chain.showClosed": "닫힌 항목 {count}개 보기",
  "orchestrator.chain.hideClosed": "닫힌 항목 숨기기",
  "orchestrator.chain.empty.title": "아직 적어 둔 다음 할 일이 없습니다",
  "orchestrator.chain.empty.hint":
    "오케가 작업을 마치면 여기서 다음 항목을 집습니다. 사장님이 직접 적어 두셔도 됩니다.",
  "orchestrator.chain.empty.create": "항목 적기",
  "orchestrator.chain.add": "항목 적기",
  "orchestrator.chain.form.what": "무엇을",
  "orchestrator.chain.form.whatPlaceholder": "예: 디자인 3/8 재개",
  "orchestrator.chain.form.why": "왜",
  "orchestrator.chain.form.whyPlaceholder":
    "예: 배포가 급해서 잠시 보류 — 배포 끝나면 바로",
  "orchestrator.chain.form.missionLabel": "미션 라벨(선택)",
  "orchestrator.chain.form.missionLabelPlaceholder":
    "이어질 다른 항목과 같은 이름을 쓰면 한 미션으로 묶입니다",
  "orchestrator.chain.form.submit": "추가",
  "orchestrator.chain.form.cancel": "취소",
  "orchestrator.chain.form.required": "무엇·왜 둘 다 적어야 합니다",
  "orchestrator.chain.drop": "내리기",
  "orchestrator.chain.start": "지금 시작",
  "orchestrator.chain.started": "보냄",
  "orchestrator.chain.startFailed": "오케에게 지시를 보내지 못했습니다",
  "orchestrator.chain.removeEvidence": "이 근거 링크 떼기",
  "orchestrator.chain.dropPrompt": "왜 더 이상 유효하지 않은지 한 줄:",
  "orchestrator.chain.dropReasonRequired": "사유가 없으면 내릴 수 없습니다",
  "orchestrator.chain.failed.reason": "작업 체인을 불러오지 못했습니다",
  "orchestrator.chain.failed.permission": "작업 체인을 읽을 권한이 없습니다",
  "orchestrator.chain.failed.permissionOwner": "프로젝트 소유자",
  "orchestrator.chain.writeFailed": "저장하지 못했습니다: {error}",
  "orchestrator.chain.noProject": "프로젝트를 열면 체인이 보입니다",
};
