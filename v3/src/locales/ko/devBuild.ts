/**
 * Korean — `devBuild.*` namespace (components/StaleMainBuildBanner).
 *
 * Dev-only surface: it appears when the running main process is executing an
 * older `dist-electron` generation than the one on disk (ticket
 * 4HMJGUJBo0tKPU4mgHyr). ★문면 규율 — 이건 오류 보고가 아니라 조치 안내다.
 * 제목이 먼저 해결책을 말하고, 증상은 그 다음에 설명한다. 모듈 이름은 데이터라
 * {modules}/{count} 로 끼워 넣는다.
 */
export const devBuild = {
  "devBuild.staleTitle": "앱을 재시작하면 해결됩니다",
  "devBuild.staleBody":
    "화면은 최신 코드로 갱신됐지만, 메인 프로세스는 앱을 켠 시점의 코드로 실행 중입니다. 최근 변경이 화면에 반영되지 않거나 목록이 비어 보일 수 있습니다.",
  "devBuild.staleAction": "터미널에서 npm run dev 를 다시 실행하세요.",
  "devBuild.staleModules": "반영 대기 중: {modules}",
  "devBuild.staleModulesOverflow": "{modules} 외 {count}개",
  "devBuild.dismiss": "닫기",
};
