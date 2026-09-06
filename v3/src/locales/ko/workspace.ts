/**
 * Korean — `workspace.*` namespace. Opt-in unified Workspace shell (flag ON).
 * Add the matching key to ../en/workspace.ts (typed against this file).
 */
export const workspace = {
  // Shell chrome
  "workspace.badge": "워크스페이스 베타",
  "workspace.tagline": "IDE 스플릿 — 좌측 터미널 고정 · 우측 작업 탭",
  "workspace.exit": "종료",
  "workspace.browser.openExternal": "외부 브라우저로 열기",
  "workspace.browser.external.title": "이 링크는 외부 브라우저에서 열립니다",
  "workspace.browser.external.reason":
    "인증·결제 또는 사이트 정책 때문에 앱 탭에 넣지 않았습니다.",
  "workspace.browser.external.signInReason":
    "구글 계정 로그인은 앱 안 탭에서 끝낼 수 없습니다 — 구글이 임베디드 브라우저 로그인을 막습니다. 바깥 브라우저에서 로그인해도 이 탭에는 로그인 상태가 남지 않습니다. 이 사이트에 이메일·비밀번호 로그인이 따로 있으면 돌아가서 그걸로 로그인하세요. 그 로그인은 이 탭에 저장돼 다음부터 바로 열립니다.",
  "workspace.browser.backToPage": "이 페이지로 돌아가기",
  "workspace.browser.clearSiteData.button": "사이트 데이터 지우기",
  "workspace.browser.clearSiteData.title": "{host} 데이터를 지웁니다",
  "workspace.browser.clearSiteData.body":
    "쿠키·캐시·서비스 워커·로컬 스토리지가 모두 삭제되고, 이 사이트의 로그인 상태가 풀립니다. 되돌릴 수 없습니다.",
  "workspace.browser.clearSiteData.categoriesHeader": "삭제되는 항목",
  "workspace.browser.clearSiteData.category.cookies": "쿠키",
  "workspace.browser.clearSiteData.category.cache": "캐시",
  "workspace.browser.clearSiteData.category.serviceWorkers": "서비스 워커",
  "workspace.browser.clearSiteData.category.localStorage": "로컬 스토리지",
  "workspace.browser.clearSiteData.cookiesHeader": "저장된 쿠키 ({count}개)",
  "workspace.browser.clearSiteData.noCookies": "저장된 쿠키가 없습니다.",
  "workspace.browser.clearSiteData.sessionCookie": "세션 종료 시 만료",
  "workspace.browser.clearSiteData.loading": "확인하는 중…",
  "workspace.browser.clearSiteData.previewError":
    "사이트 데이터를 확인할 수 없습니다.",
  "workspace.browser.clearSiteData.cancel": "취소",
  "workspace.browser.clearSiteData.confirm": "지우고 새로고침",
  "workspace.browser.clearSiteData.confirming": "지우는 중…",
  "workspace.browser.clearSiteData.failed":
    "사이트 데이터 삭제에 실패했습니다.",
  "workspace.browser.clearSiteData.originChanged":
    "확인하는 사이 사이트가 바뀌었습니다. 새로 불러온 내용을 확인하고 다시 눌러주세요.",

  // IDE split shell
  "workspace.terminals": "터미널",
  "workspace.collapseTerminals": "터미널 접기",
  "workspace.expandTerminals": "터미널 펼치기",
  "workspace.resizeTerminals": "오케·에이전트 높이 조절",
  "workspace.showFiles": "파일 트리 열기",
  "workspace.hideFiles": "파일 트리 닫기",
  "workspace.showActivity": "액티비티 스트림 열기",
  "workspace.activity": "액티비티",
  "workspace.tab.startHere": "시작하기",
  "workspace.tab.board": "보드",
  "workspace.tab.agents": "마블로봇",
  "workspace.tab.fleet": "플릿 관리",
  "workspace.tab.project": "프로젝트",
  "workspace.tab.settings": "설정",
  "workspace.tab.code": "코드",
  "workspace.tab.worktrees": "워크트리",
  "workspace.tab.history": "완료 이력",
  "workspace.tab.lanes": "병렬 작업",
  "workspace.tab.browser": "웹",
  "workspace.tab.guide": "가이드",
  "workspace.tab.usage": "사용량",
  "workspace.tab.store": "스토어",
  "workspace.tab.harness": "하네스",
  "workspace.tab.missions": "미션",
  "workspace.tab.flows": "플로우 (베타)",
  "workspace.tab.deploy": "배포",

  // ── 마블로 모드 첫 진입 코치마크 투어 ──────────────────────────────────
  "workspace.tour.progress": "안내 {current}/{total}",
  "workspace.tour.next": "다음",
  "workspace.tour.back": "이전",
  "workspace.tour.done": "시작하기",
  "workspace.tour.skip": "건너뛰기",
  "workspace.tour.never": "다시 보지 않기",
  "workspace.tour.board.title": "보드 — 티켓 한눈에",
  "workspace.tour.board.body":
    "TODO부터 DONE까지 칸반으로 흘러갑니다. 카드를 누르면 담당 에이전트와 기록을 볼 수 있어요.",
  "workspace.tour.code.title": "코드 — 파일과 변경점",
  "workspace.tour.code.body":
    "프로젝트 파일을 열고, 에이전트가 고친 diff 를 여기서 검토합니다.",
  "workspace.tour.agents.title": "에이전트 — 팀원 목록",
  "workspace.tour.agents.body":
    "지금 일하는 에이전트와 터미널을 보고, 직접 스폰하거나 멈출 수 있어요.",
  "workspace.tour.harness.title": "하네스 — CLI·모델 연결",
  "workspace.tour.harness.body":
    "Claude·Codex 같은 하네스 연결과 모델 경로를 관리하는 곳입니다.",
  "workspace.tour.usage.title": "사용량 — 비용과 한도",
  "workspace.tour.usage.body":
    "이번 달 사용량과 플랜 한도를 확인합니다. 예산을 넘기기 전에 여기서 봐요.",
  "workspace.tour.settings.title": "설정 — 계정·비기너 모드·알림",
  "workspace.tour.settings.body":
    "계정, 비기너 모드·마블로 모드 전환, 알림 등을 바꿉니다. 비기너 모드로 돌아갈 때도 여기예요.",
};
