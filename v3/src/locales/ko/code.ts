/**
 * Korean — `code.*` namespace (Code tab: editor shell, tabs, diff viewer).
 * One namespace per file so parallel i18n PRs don't collide on a monolith.
 * Keys keep their fully-qualified dotted form.
 *
 * Not translated: file paths, names, languages, and the "Root"/"Project root"
 * labels are machine identifiers / English-by-design.
 */
export const code = {
  "code.rootNotSelected": "프로젝트 루트가 선택되지 않았습니다",
  "code.noFileSelected.title": "파일을 선택하세요",
  "code.noFileSelected.hint": "사이드바에서 파일을 클릭하면 여기에 표시됩니다",
  "code.diffView": "Diff 보기",
  "code.diffLoading": "Diff 로딩 중...",
  "code.saveFailed": "{name} 저장 실패 — 디스크에 기록되지 않았습니다",
  "code.saveFailedDismiss": "저장 실패 알림 닫기",
  "code.rootArchivedHint": "{count}개 아카이브됨 · Worktrees 탭에서 관리",
  "code.rootUnknownHint": "{count}개 판정 불가 · 정리 상태를 확인할 수 없음",

  // .ipynb 노트북 뷰. 셀/커널 이름·언어는 기계 식별자라 번역하지 않는다.
  "code.notebook.cellCount": "{total}셀 · 코드 {code}",
  "code.notebook.empty": "셀이 없는 노트북입니다.",
  "code.notebook.parseError":
    "노트북을 읽지 못했습니다: {message} — 원본 JSON 을 표시합니다.",
  "code.notebook.run": "실행",
  "code.notebook.restart": "커널 재시작",
  "code.notebook.kernel.loadingRuntime": "Python 런타임 로드 중…",
  "code.notebook.kernel.loadingPackages": "패키지 로드 중…",
  "code.notebook.kernel.running": "실행 중…",
  "code.notebook.kernel.ready": "커널 준비됨",
  "code.notebook.kernel.failed": "커널 오류",

  // "이 워크트리 보기" diff 자동 표시 결과. diff 가 안 뜨는 경우마다 이유를
  // 밝힌다 — 조용히 아무것도 안 하면 버그와 구분되지 않는다.
  "code.worktreeDiff.loading": "워크트리 변경사항 확인 중...",
  "code.worktreeDiff.changedCount": "변경 {count}건",
  "code.worktreeDiff.deletedFile": "{path} — 삭제된 파일이라 열 수 없습니다",
  "code.worktreeDiff.clean":
    "이 워크트리에는 변경 사항이 없습니다 (base 와 동일).",
  "code.worktreeDiff.committedOnly":
    "커밋되지 않은 변경이 없습니다 — 이 브랜치는 base 대비 {count}개 파일이 변경되어 있고 모두 커밋된 상태입니다.",
  "code.worktreeDiff.viewFullDiff": "전체 diff 보기",
  "code.worktreeDiff.deletionsOnly":
    "변경 {count}건이 모두 삭제입니다 — 디스크에 남은 파일이 없어 diff 를 표시할 수 없습니다.",
  "code.worktreeDiff.error": "워크트리 diff 를 열지 못했습니다: {message}",
};
