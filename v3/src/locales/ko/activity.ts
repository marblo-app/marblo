/**
 * Korean — `activity.*` namespace (Activity Stream panel + agent activity
 * feeds + the structural templates/labels built in
 * `services/activityFormatters.ts`).
 *
 * 경계: 여기 있는 건 앱이 소유한 **UI 틀** — 액션 종류명, 헤드라인 템플릿,
 * detail 라벨, 빈상태/툴팁/푸터 문구뿐이다. `{title}` / `{agent}` / `{body}`
 * / `{result}` 같은 플레이스홀더로 들어오는 값(태스크 제목·에이전트 메시지·
 * 툴 결과·미션 요약)은 에이전트/오케/MCP 가 런타임에 사용자 언어로 생성한
 * **실데이터라 번역하지 않고 그대로 보간**한다. ../README.md 참고.
 */
export const activity = {
  // Activity type 라벨 (필터 칩 툴팁 + 행 헤더 + 매크로 요약).
  "activity.type.taskCreated": "태스크 생성",
  "activity.type.taskClaimed": "태스크 선점",
  "activity.type.taskProgress": "태스크 진행",
  "activity.type.taskCompleted": "태스크 완료",
  "activity.type.taskBlocked": "태스크 차단",
  "activity.type.agentSpawned": "에이전트 생성",
  "activity.type.pmFeedback": "PM 피드백",
  "activity.type.activityNote": "활동 노트",
  "activity.type.missionStep": "미션 단계",
  "activity.type.missionState": "미션 상태",
  "activity.type.missionNote": "미션 노트",
  "activity.type.error": "오류",
  "activity.type.other": "기타",

  // 헤드라인 템플릿 — 구조적 틀만. {…} 는 entry 실데이터(비번역).
  "activity.headline.taskCreated": '태스크: "{title}" 생성됨',
  "activity.headline.taskClaimed": '태스크: {agent} 선점 — "{title}"',
  "activity.headline.taskProgress": '태스크: "{title}" 진행',
  "activity.headline.taskCompleted": '태스크: "{title}" 완료',
  "activity.headline.taskBlocked": '태스크: "{title}" 차단됨 — {reason}',
  "activity.headline.agentSpawned": "에이전트: {name} 생성됨",
  "activity.headline.agentSpawnedWithTask":
    '에이전트: {name} 생성됨 → "{task}"',
  "activity.headline.mission": "미션: {body}",
  "activity.headline.missionNotePrefix": "미션: {agent} 노트",
  "activity.headline.notePrefix": "노트: {agent}",
  "activity.headline.pmFeedback": 'PM: "{title}" 피드백',
  "activity.headline.error": "오류: {tool} 실패 — {result}",

  // Detail 펼침 영역의 KV 라벨.
  "activity.label.title": "제목",
  "activity.label.role": "역할",
  "activity.label.description": "설명",
  "activity.label.agent": "에이전트",
  "activity.label.task": "태스크",
  "activity.label.status": "상태",
  "activity.label.reason": "사유",
  "activity.label.name": "이름",
  "activity.label.agentId": "에이전트 ID",
  "activity.label.model": "모델",
  "activity.label.step": "단계",
  "activity.label.state": "상태",
  "activity.label.mission": "미션",
  "activity.label.note": "노트",
  "activity.label.message": "메시지",
  "activity.label.comment": "코멘트",
  "activity.label.tool": "도구",

  // 데이터 누락 시 표시하는 정적 fallback (실데이터 자리이지만 앱이 소유).
  "activity.fallback.title": "제목 없음",
  "activity.fallback.reason": "사유 없음",
  "activity.fallback.role": "에이전트",
  "activity.fallback.missionStep": "단계",
  "activity.fallback.missionState": "상태 변경",
  "activity.fallback.errorResult": "알 수 없음",
  "activity.fallback.noteMessage": "(메시지 없음)",

  // 상대 시간 표기.
  "activity.time.justNow": "방금",
  "activity.time.minutesAgo": "{n}분 전",
  "activity.time.hoursAgo": "{n}시간 전",
  "activity.time.daysAgo": "{n}일 전",

  // 패널/피드 UI 틀.
  "activity.ui.openTask": "태스크 열기",
  "activity.ui.viewAgent": "에이전트 보기",
  "activity.ui.emptyNoActivity":
    "활동이 아직 없습니다. 에이전트가 MCP 도구를 호출하면 여기 표시됩니다.",
  "activity.ui.emptyNoFilterMatch": "이 필터에 해당하는 항목이 없습니다.",
  "activity.ui.footer": "출처: audit_logs · 최근 {count}건 · ⌘⇧A 토글",
  "activity.ui.macroNoAgents": "활성 에이전트가 없습니다.",
  "activity.ui.macroNoRecent": "최근 활동 없음.",
  "activity.ui.feedTitle": "통합 활동 피드",
  "activity.ui.feedCount": "{count}개 활동",
  "activity.ui.feedAll": "전체",
  "activity.ui.feedEmpty": "활동이 없습니다",
  "activity.ui.feedEmptyShort": "아직 활동이 없습니다",
};
