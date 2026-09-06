/**
 * "이 알림이 유실되면 보드 재동기화 스위프가 다시 밀어주는가?" 의 **정직한 답**
 * (티켓 B0G7agMgarQPqIYEc3Jq).
 *
 * ── 왜 이 모듈이 생겼나 ─────────────────────────────────────────────────────
 * `tools.ts` 의 미전달 기록은 지금까지 **무조건** 이렇게 적었다:
 *   "보드 재동기화 스위프가 이 상태를 다시 밀어줍니다."
 * 이 문장은 대부분의 경우 **거짓**이었고, 거짓 위로가 폐루프 미작동을 몇 주간
 * 숨겼다(사장님: "폐루프가 안 도는데 왜인지 모르겠다"). 실제 스위프
 * (`orchestrator-board-resync.ts`) 의 커버리지는 두 겹으로 좁다:
 *
 *   (1) `classifyResyncAttention` 첫 줄이 `if (row.isMission) return null;` —
 *       ★미션 티켓은 통째로 제외된다. (컨덕터 report-watchdog 소관이라는
 *       전제인데, 암묵 미션에는 컨덕터가 없어 실제로는 아무도 안 본다.)
 *   (2) 스위프가 읽는 티켓 자체가 `RESYNC_ATTENTION_STATUSES` 뿐이다.
 *       ★전진 신호를 유발하는 **DONE 전이는 애초에 조회 대상이 아니다** —
 *       미션 제외가 없었더라도 전진 신호는 절대 재전달되지 않는다.
 *
 * 그래서 재전달 여부는 "알림이 말하는 티켓이 스위프가 다시 읽을 상태로 남아
 * 있는가" 로만 참이 된다. 이 모듈이 그 판정을 한 곳에 모은다.
 *
 * 순수 — import 가 없다. 그래서 mcp-server(Node16 ESM)와 electron(commonjs)
 * 양쪽 tsconfig 에서 함께 쓸 수 있다(`orchestrator-board-resync` 가
 * `./mcp-server/context` 를 쓰는 것과 같은 경로).
 */

/**
 * 보드 재동기화 스위프가 **읽는** 티켓 상태 집합.
 * main.ts 의 `listAttentionTasks` 쿼리가 이 상수를 그대로 쓴다 — 쿼리와 이
 * 모듈의 판정이 갈라지면 다시 거짓 위로가 된다.
 * ★DONE 과 TODO 가 없다는 것이 이 목록의 핵심이다.
 */
export const RESYNC_ATTENTION_STATUSES = [
  "REVIEW",
  "FAILED",
  "BLOCKED",
  "CLAIMED",
  "IN_PROGRESS",
] as const;

export type ResyncAttentionStatus = (typeof RESYNC_ATTENTION_STATUSES)[number];

export interface ResyncCoverageInput {
  /** 오케에 보내려던 알림 원문. 접두사로 축을 판별한다. */
  message: string;
  /** 이 티켓이 미션 컨텍스트인가(= 스위프가 통째로 제외하는가). */
  isMissionContext: boolean;
}

/**
 * 이 알림이 유실됐을 때 스위프가 **실제로** 같은 사실을 다시 밀어주는가.
 *
 * ★fail-closed 다. 모르는 포맷이면 `false` — "다시 밀어준다" 는 거짓 위로를
 * 한 번 더 하는 것보다, 재전달이 있는데 없다고 적는 쪽이 훨씬 덜 해롭다.
 * (`directDeliverySeenKeys` 의 fail-open 과 방향이 반대인 것은 의도다: 저쪽은
 * 중복 통보를 감수하고, 이쪽은 거짓 안심을 감수하지 않는다.)
 */
export function resyncRedeliversNotification(
  input: ResyncCoverageInput,
): boolean {
  // (1) 미션 티켓은 스위프가 첫 줄에서 제외한다.
  if (input.isMissionContext) return false;

  const trimmed = input.message.trim();
  // REVIEW 축 — 티켓은 REVIEW 로 남아 있으므로 다음 틱에 다시 읽힌다.
  if (trimmed.startsWith("[Review Submitted]")) return true;
  // FAILED/BLOCKED 축 — 같은 이유. DONE 은 조회 집합에 없으므로 여기서 빠진다.
  if (trimmed.startsWith("[Task Update]")) {
    const match = trimmed.match(/\s→\s([A-Z_]+)\b/);
    const next = match?.[1];
    return next === "FAILED" || next === "BLOCKED";
  }
  // [Dependency Resolved](대상 티켓은 TODO), [Task Deleted], [Task Activity]/
  // [질문], [Mission Advance], [Mission Handoff] — 전부 스위프 축이 아니다.
  return false;
}

/**
 * 미전달 기록에 붙일 **후속 문장**. 참이면 무엇이 다시 미는지, 거짓이면
 * ★재전달이 없다는 사실과 그 이유를 적는다. 거짓일 때 이 기록이 유일한 흔적
 * 이라는 것을 명시해야 사람이 읽고 움직인다.
 */
export function describeResyncFollowup(input: ResyncCoverageInput): string {
  if (resyncRedeliversNotification(input)) {
    return (
      "보드 재동기화 스위프가 이 티켓의 상태(REVIEW/FAILED/BLOCKED)를 " +
      "다음 틱에 다시 밀어줍니다."
    );
  }
  if (input.isMissionContext) {
    return (
      "★자동 재전달 없음 — 보드 재동기화 스위프는 미션 티켓을 제외합니다" +
      "(orchestrator-board-resync.classifyResyncAttention). 이 기록이 유일한 흔적이니 " +
      "오케에 직접 알려야 폐루프가 이어집니다."
    );
  }
  return (
    "★자동 재전달 없음 — 보드 재동기화 스위프는 " +
    `${RESYNC_ATTENTION_STATUSES.join("/")} 상태의 티켓만 다시 읽습니다` +
    "(DONE·TODO 는 조회 대상이 아닙니다). 이 기록이 유일한 흔적이니 " +
    "오케에 직접 알려야 폐루프가 이어집니다."
  );
}

/**
 * 미전달 기록의 **머리말**(티켓 rjoTuGmIlXJQpjDvWMMR).
 *
 * 예전엔 재전달 여부와 무관하게 "⚠️ [알림 미전달] ...전달되지 않았습니다" 가
 * 항상 붙었다. `resyncRedeliversNotification` 이 참이면(스위프가 곧 다시
 * 밀어준다) 이건 사고가 아니라 **정상적으로 지연된 것** — 오케가 그 순간
 * 바빠서 못 받았을 뿐 폐루프는 끊기지 않는다. 그런데도 "미전달"·"⚠️" 문구가
 * 상시로 뜨면 사람이 그 경고를 무시하도록 훈련된다. 참일 때만 머리말을
 * 낮춘다 — 거짓(진짜 유실)일 때는 그대로 사고로 읽혀야 한다.
 */
export function describeNotifyFailureHeadline(
  input: ResyncCoverageInput,
): string {
  return resyncRedeliversNotification(input)
    ? "ℹ️ [알림 지연] 오케스트레이터가 지금 바빠 알림을 바로 받지 못했습니다"
    : "⚠️ [알림 미전달] 오케스트레이터 알림이 전달되지 않았습니다";
}
