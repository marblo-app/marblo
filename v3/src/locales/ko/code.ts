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
};
