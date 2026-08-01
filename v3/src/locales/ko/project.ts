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

  // Audit log (사람 행위 + 오케 행위 병합 — owner/admin 전용)
  "project.audit.heading": "감사 로그",
  "project.audit.sourceNote": "구성원 · 오케 행위 기준 · 최신순",
  "project.audit.filterActor": "구성원 필터",
  "project.audit.filterActorAll": "전체 구성원",
  "project.audit.filterType": "종류 필터",
  "project.audit.filterTypeAll": "전체 종류",
  "project.audit.filterTypeHumanGroup": "사람 행위",
  "project.audit.filterTypeAgentGroup": "오케 행위 (MCP 툴)",
  "project.audit.count": "{count}건",
  // 사람/오케 구분 — 뭉개면 "이 사람이 티켓 40개를 옮겼다"로 읽히는데 실제로는
  // 그가 발주한 에이전트가 옮긴 것이다.
  "project.audit.actor.human": "사람",
  "project.audit.actor.agentHint":
    "오케(에이전트)가 한 행위입니다. 옆의 이름은 이 에이전트를 발주한 구성원입니다.",
  "project.audit.actor.agentModelUnknown": "모델 미상",
  "project.audit.actor.unknown": "귀속 불가",
  "project.audit.failed": "실패",
  // 소스별 부분 실패 — 거부와 장애를 다른 문구로 가른다.
  "project.audit.notice.humanDenied":
    "사람 행위 기록은 볼 권한이 없어 빠져 있습니다. 아래 목록은 오케 행위만 담고 있습니다.",
  "project.audit.notice.agentDenied":
    "오케 행위 기록은 볼 권한이 없어 빠져 있습니다. 아래 목록은 사람 행위만 담고 있습니다.",
  "project.audit.notice.humanError":
    "사람 행위 기록을 불러오지 못했습니다. 아래 목록에는 빠져 있습니다.",
  "project.audit.notice.agentError":
    "오케 행위 기록을 불러오지 못했습니다. 아래 목록에는 빠져 있습니다.",
  // 빈 화면은 "왜 비었나"를 반드시 말한다. 그냥 '기록 없음'만 띄우면 owner 가
  // 기능 고장으로 읽는다(실제로 그렇게 접수됐다).
  "project.audit.emptyTitle": "아직 기록이 없습니다",
  "project.audit.emptyDesc":
    "감사 로그는 {version} 버전부터 쌓입니다. 그 이전에 있었던 활동은 기록이 남아 있지 않습니다.",
  "project.audit.emptyAgentNote":
    "이 표에는 구성원이 앱에서 직접 한 행위(채팅 전송·티켓 상태 변경·에이전트 스폰)와 에이전트가 MCP 툴로 한 행위가 함께 기록됩니다. 앱 밖에서 한 일이나 MCP 툴을 거치지 않은 파일 수정은 여기 남지 않습니다.",
  "project.audit.emptyFilteredTitle": "조건에 맞는 기록이 없습니다",
  "project.audit.emptyFilteredDesc":
    "선택한 구성원·종류에 해당하는 기록이 없습니다. 필터를 '전체'로 되돌리면 남아 있는 기록을 모두 볼 수 있습니다.",
  "project.audit.denied": "감사 로그를 볼 권한이 없습니다",
  "project.audit.deniedDesc":
    "구성원 행위 기록은 소유자·관리자만 볼 수 있습니다.",
  "project.audit.error": "감사 로그를 불러오지 못했습니다",
  "project.audit.retry": "다시 시도",
  "project.audit.type.chatMessageSent": "채팅 전송",
  "project.audit.type.agentSpawned": "에이전트 스폰",
  "project.audit.type.taskClaimed": "티켓 선점",
  "project.audit.type.taskStatusChanged": "상태 변경",
  "project.audit.type.unknown": "알 수 없음",

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
