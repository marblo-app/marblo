/**
 * Korean — `project.*` namespace. 프로젝트 탭(멤버 · 역할 · 작업량).
 * Add the matching key to ../en/project.ts (typed against this file).
 */
export const project = {
  "project.title": "프로젝트",
  "project.subtitle": "멤버 · 역할 · 작업량을 한 곳에서",
  "project.memberCount": "멤버 {count}명",
  "project.myRole": "내 역할",

  // No project selected
  "project.noProject.title": "선택된 프로젝트가 없습니다",
  "project.noProject.desc":
    "멤버를 초대하고 작업량을 보려면 먼저 프로젝트 폴더를 여세요.",
  "project.noProject.cta": "프로젝트 열기",

  // Workload
  "project.workload.heading": "구성원별 작업량",
  "project.workload.sourceNote": "에이전트 · 티켓 · 머지 이력 기준",
  "project.workload.emptyTitle": "아직 집계할 작업량 데이터가 없습니다",
  "project.workload.emptyDesc":
    "에이전트를 띄우거나 티켓을 선점하면 여기에 구성원별로 쌓입니다.",
  "project.workload.rowEmpty": "기록 없음",
  "project.workload.totalAgents": "에이전트",
  "project.workload.colMember": "멤버",
  "project.workload.colAgents": "에이전트",
  "project.workload.colInProgress": "진행중",
  "project.workload.colReview": "리뷰",
  "project.workload.colDone": "완료",
  "project.workload.colStuck": "정체",
  "project.workload.colMerges": "머지",
  "project.workload.colLastActive": "최근 활동",
  "project.workload.unattributed": "미귀속",
  "project.workload.unattributedHint":
    "선점자가 없거나, 이미 나간 멤버의 에이전트이거나, 에이전트 이름이 겹쳐 소유자를 특정할 수 없는 항목입니다.",

  // Presence
  "project.presence.online": "온라인",
  "project.presence.idle": "자리비움",
  "project.presence.offline": "오프라인",

  // Relative time
  "project.time.justNow": "방금",
  "project.time.minsAgo": "{count}분 전",
  "project.time.hoursAgo": "{count}시간 전",
  "project.time.daysAgo": "{count}일 전",
};
