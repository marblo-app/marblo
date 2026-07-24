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

  // 파싱 불가 .ipynb 폴백. Preview/Raw 토글은 없앴지만 이 경로는 남는다 —
  // 깨진 파일에서 원문마저 못 보면 무엇이 잘못됐는지 확인할 방법이 없다.
  "code.notebook.rawFallback.title":
    "이 노트북을 읽을 수 없어 원문(JSON)을 표시합니다",
  "code.notebook.rawFallback.reason": "원인: {message}",
  "code.notebook.rawFallback.unknownReason":
    "원인을 특정하지 못했습니다 — .ipynb 형식이 아닐 수 있습니다.",
  "code.notebook.run": "실행",
  "code.notebook.restart": "커널 재시작",
  "code.notebook.kernel.loadingRuntime": "Python 런타임 로드 중…",
  "code.notebook.kernel.loadingPackages": "패키지 로드 중…",
  "code.notebook.kernel.running": "실행 중…",
  "code.notebook.kernel.ready": "커널 준비됨",
  "code.notebook.kernel.failed": "커널 오류",

  // Pyodide 자산 미설치. 안내에 나가는 명령은 PYODIDE_INSTALL_COMMAND 하나에서
  // 내려오므로 여기에 직접 적지 말고 {command} 를 쓸 것 — 문구와 실제 스크립트가
  // 어긋나면 "복사해서 붙여넣었는데 안 되는" 원래의 그 버그로 돌아간다.
  "code.notebook.kernel.missingAssets": "Python 런타임 미설치",
  "code.notebook.kernel.missingAssetsError":
    "Python 런타임이 설치되어 있지 않습니다. 레포 루트에서 `{command}` 를 실행한 뒤 다시 시도하세요.",
  "code.notebook.assets.title": "Python 런타임이 준비되지 않았습니다",
  "code.notebook.assets.body":
    "노트북 셀을 실행하려면 Pyodide 런타임(약 31MB)이 필요합니다. 보통 `npm run dev` 가 자동으로 받아두지만, 오프라인이었거나 다운로드가 실패하면 이 화면이 보입니다. 레포 루트에서 아래 명령을 실행한 뒤 [다시 시도]를 누르세요.",
  "code.notebook.assets.copy": "명령 복사",
  "code.notebook.assets.copied": "복사됨",
  "code.notebook.assets.retry": "다시 시도",

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
