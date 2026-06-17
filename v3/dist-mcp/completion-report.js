/**
 * 완료 보고(completion report) 규약 헬퍼 — 순수 로직 모음 (I/O 없음).
 *
 * 배경: 에이전트는 작업 중 add_activity 로 진행 상황을 흩뿌리고, 최종 "무엇이
 * 문제였고 어떻게 풀었는지" 요약은 PR 본문에만 남겨, 보드/티켓에서 완료 내역을
 * 한눈에 볼 수 없었다. 이 모듈은 submit_for_review / update_task_status(REVIEW|DONE)
 * 가 구조화 완료 요약을 티켓에 "✅ 완료 보고" activity 로 남기고, 누락 시
 * (하드 블록 없이) 보완을 요청하는 nudge 를 돌려주는 데 쓰는 순수 헬퍼다.
 *
 * firebase/electron 의존이 없어 단위 테스트가 직접 호출한다. 실제 Firestore
 * 쓰기/조회와 tool 배선은 mcp-server/tools.ts 가 담당한다.
 */
/** 완료 보고 activity 의 선두 마커. 이 문자열로 시작하는 activity 가 "완료 보고"다. */
export const COMPLETION_REPORT_MARKER = "✅ 완료 보고";
/** 보고 메시지에 찍히는 라벨 순서. 표시 순서 = 이 배열 순서. */
const FIELD_LABELS = [
    ["problem", "문제"],
    ["approach", "접근"],
    ["changes", "변경"],
    ["verification", "검증"],
    ["pr", "PR"],
];
/**
 * 구조화 요약을 "✅ 완료 보고" activity 메시지 한 덩어리로 변환.
 * 비어 있는(공백뿐인) 필드는 생략한다. 실질 내용이 하나도 없으면 null.
 */
export function formatCompletionReport(summary) {
    if (!summary)
        return null;
    const lines = FIELD_LABELS.map(([key, label]) => {
        const value = summary[key]?.trim();
        return value ? `- ${label}: ${value}` : null;
    }).filter((line) => line !== null);
    if (lines.length === 0)
        return null;
    return [COMPLETION_REPORT_MARKER, ...lines].join("\n");
}
/** activity 메시지가 완료 보고인가 (마커로 시작; 선행 공백 허용). */
export function isCompletionReport(message) {
    if (!message)
        return false;
    return message.trimStart().startsWith(COMPLETION_REPORT_MARKER);
}
/** 메시지 목록(보통 최근 activity 들) 중 완료 보고가 하나라도 있는가. */
export function hasCompletionReport(messages) {
    return messages.some((message) => isCompletionReport(message));
}
/**
 * REVIEW/DONE 전이인데 완료 보고가 없을 때 tool 응답 끝에 덧붙일 soft nudge.
 *
 * ⚠️ 하드 블록이 아니다 — 상태 전이는 이미 처리됐고, 이 텍스트는 호출 에이전트의
 * PTY 응답으로 돌아가 "지금 보완하라"고 권할 뿐이다. submit 을 거부하면 에이전트가
 * stranding 되므로 절대 블록하지 않는다 (mission 의 보고-감시 nudge 와 같은 결).
 */
export function buildCompletionNudge(taskId, status) {
    return [
        "",
        `⚠️ [완료 보고 누락] 이 태스크(${status})에 "${COMPLETION_REPORT_MARKER}" 기록이 없습니다.`,
        "상태 전이는 그대로 처리됐습니다(블로킹 아님). 다만 보드/티켓에서 완료 내역을 한눈에",
        "보려면 지금 아래 형식으로 한 줄 보완을 남겨주세요:",
        `add_activity(task_id="${taskId}", message="${COMPLETION_REPORT_MARKER}\\n- 문제: ...\\n- 접근: ...\\n- 변경: ...\\n- 검증: ...\\n- PR: ...")`,
    ].join("\n");
}
/**
 * 완료 보고 규약의 순수 결정 로직 (I/O 없음).
 *
 *   1. summary 가 실질 내용을 담고 있으면 → 그 보고를 기록, nudge 없음.
 *   2. 아니고, 최근 activity 에 이미 완료 보고가 있으면 → 기록·nudge 둘 다 없음.
 *   3. 둘 다 없으면 → 기록 없음 + soft nudge 반환.
 */
export function resolveCompletionReport(taskId, status, summary, recentMessages) {
    const report = formatCompletionReport(summary);
    if (report)
        return { report, nudge: "" };
    if (hasCompletionReport(recentMessages))
        return { report: null, nudge: "" };
    return { report: null, nudge: buildCompletionNudge(taskId, status) };
}
//# sourceMappingURL=completion-report.js.map