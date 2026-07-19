/**
 * Korean — `sidebar.*` namespace (file-tree sidebar: toolbar, context menu,
 * inline create/rename, confirm dialog, error toasts). One namespace per file
 * so parallel i18n PRs don't collide. Keys keep their dotted form.
 */
export const sidebar = {
  // Inline create / rename
  "sidebar.tree.fileName": "파일 이름",
  "sidebar.tree.folderName": "폴더 이름",
  // Worktree switch
  "sidebar.tree.toMain": "메인 워크트리로",
  "sidebar.tree.mainUnresolvedNoWorktrees":
    "메인 워크트리를 찾지 못했습니다 — 워크트리 목록이 아직 로드되지 않았습니다. 새로고침 후 다시 시도하세요.",
  "sidebar.tree.mainUnresolvedAmbiguous":
    "메인 워크트리를 특정할 수 없어 이동하지 않았습니다. 엉뚱한 워크트리로 보내지 않기 위한 안전장치입니다 — 프로젝트 폴더 경로를 확인하세요.",
  "sidebar.tree.toTask": "작업 워크트리로",
  "sidebar.tree.toOtherTask": "다른 작업 워크트리로",
  // File-op errors (toast)
  "sidebar.tree.createFailMsg": "생성 실패: {msg}",
  "sidebar.tree.createFail": "생성 실패",
  "sidebar.tree.renameFailMsg": "이름 변경 실패: {msg}",
  "sidebar.tree.renameFail": "이름 변경 실패",
  "sidebar.tree.deleteFailMsg": "삭제 실패: {msg}",
  "sidebar.tree.deleteFail": "삭제 실패",
  "sidebar.tree.pasteFailMsg": "붙여넣기 실패: {msg}",
  "sidebar.tree.pasteFail": "붙여넣기 실패",
  "sidebar.tree.pasteSelf": "자기 자신 안으로 붙여넣을 수 없습니다",
  "sidebar.tree.moveFailMsg": "이동 실패: {msg}",
  "sidebar.tree.moveFail": "이동 실패",
  "sidebar.tree.copyPathFail": "경로 복사 실패",
  // Delete confirm dialog
  "sidebar.tree.deleteTitle": "삭제 확인",
  "sidebar.tree.deleteMsg": "'{name}'을(를) 영구적으로 삭제하시겠습니까?",
  "sidebar.tree.deleteDirSuffix": "\n폴더 안의 모든 항목이 함께 삭제됩니다.",
  // Context menu
  "sidebar.tree.newFile": "새 파일",
  "sidebar.tree.newFolder": "새 폴더",
  "sidebar.tree.cut": "잘라내기",
  "sidebar.tree.copy": "복사",
  "sidebar.tree.paste": "붙여넣기",
  "sidebar.tree.rename": "이름 변경",
  "sidebar.tree.delete": "삭제",
  "sidebar.tree.revealInFinder": "Finder에서 보기",
  "sidebar.tree.copyPath": "경로 복사",
  // Empty state
  "sidebar.tree.openProject": "프로젝트 열기",
  "sidebar.tree.selectFolder": "폴더 선택",
  // Folder-open choice banner
  "sidebar.tree.openFolder": "폴더 열기",
  "sidebar.tree.openFolderMore": "폴더 열기 옵션 더보기",
  "sidebar.tree.registerProject": "프로젝트로 등록",
  "sidebar.tree.browseReadonly": "둘러보기 (읽기전용)",
  "sidebar.tree.cancel": "취소",
  // New project banner
  "sidebar.tree.newProject": "새 프로젝트",
  "sidebar.tree.projectNamePlaceholder": "프로젝트 이름",
  "sidebar.tree.create": "생성",
  "sidebar.tree.createHint": "Enter로 생성 / Esc 취소",
  // Root header badges
  "sidebar.tree.activeWorktree": "활성 워크트리",
  "sidebar.tree.projectRoot": "프로젝트 루트",
  // Stray worktrees-container guard
  "sidebar.tree.strayRootTitle": "다른 프로젝트의 워크트리 폴더입니다",
  "sidebar.tree.strayRootDesc":
    "이 폴더는 현재 프로젝트의 메인 체크아웃이 아니라 워크트리 모음 폴더입니다. 다른 작업의 워크트리가 함께 보일 수 있어요.",
  "sidebar.tree.strayRootToMain": "메인으로",
  "sidebar.tree.strayRootPick": "폴더 선택",
  // Toolbar
  "sidebar.tree.recentFolders": "최근 연 폴더",
  "sidebar.tree.newFileShortcut": "새 파일 (⌘N)",
  "sidebar.tree.newFolderShortcut": "새 폴더 (⇧⌘N)",
  "sidebar.tree.refresh": "새로고침",
  "sidebar.tree.loading": "로딩 중...",
  // Confirm dialog
  "sidebar.tree.confirm": "확인",

  // Sidebar shell (toggle + panel tabs)
  "sidebar.open": "사이드바 열기",
  "sidebar.close": "사이드바 닫기",
  "sidebar.tab.files": "파일",
  "sidebar.tab.commands": "명령어",
  "sidebar.tab.chat": "채팅",

  // TabBar — pop-out affordance (tab labels themselves stay English)
  "sidebar.tab.popOut": "별도 창으로 열기",
  "sidebar.tab.popOutLabel": "{name} 별도 창으로 열기",
};
