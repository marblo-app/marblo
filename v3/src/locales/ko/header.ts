/**
 * Korean — `header.*` namespace (top app bar: project picker, settings,
 * logout, plan badge). One namespace per file so parallel i18n PRs don't
 * collide on a single monolith. Keys keep their fully-qualified dotted form.
 */
export const header = {
  "header.selectProject": "프로젝트 선택",
  "header.newProject": "새 프로젝트",
  "header.projectName": "프로젝트 이름",
  "header.add": "추가",
  "header.settings": "설정",
  "header.logout": "로그아웃",
  "header.planBadge.suffix": "플랜",
  "header.searchProjects": "프로젝트 검색",
  "header.recentProjects": "최근",
  "header.myProjects": "내 프로젝트",
  "header.noSearchResults": "검색 결과 없음",
  // 프로젝트 종류(dev | assistant)
  "header.projectKind.label": "프로젝트 종류",
  "header.projectKind.dev": "개발",
  "header.projectKind.assistant": "비서",
  "header.projectKind.devHint": "보드·코드 중심 개발 워크스페이스",
  "header.projectKind.assistantHint": "대화·위키·커넥터 중심 비서 워크스페이스",
  "header.projectKind.badge.dev": "개발",
  "header.projectKind.badge.assistant": "비서",
};
