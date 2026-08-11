/**
 * 스폰 차단 '사유' 의 **정규 어휘** (티켓 iyxb4KsJpgPgoKYUBPsu).
 *
 * ── 무엇이 틀려 있었나 ───────────────────────────────────────────────────
 * 온보딩이 cli_setup_step(30일 531명) → multi_agent_success(21명)로 ~96%
 * 이탈하는데 **왜 멈추는지** 를 셀 수 없었다. 차단 이벤트가 아예 없어서가 아니다:
 *   · `onboarding:spawn_blocked` 는 이미 발화하지만 사유가 게이트 원어휘
 *     (not-installed / not-authenticated / vendor-not-configured)로 `errorCategory`
 *     에만 실려 있어 제품 질문("구독 공백이 몇 %인가")과 어휘가 어긋난다.
 *   · ★그리고 **구독 축 차단은 통째로 무음**이었다. 플랜 동시성 캡
 *     (`dispatch-scoring.checkPlanConcurrency`, free=2 / pro=5)이 스폰을 막을 때
 *     텔레메트리가 한 건도 안 나가, "구독이 없어서 멈춘 사람" 이 데이터에 0명으로
 *     보였다 — 없는 게 아니라 **안 세고 있었다**.
 *
 * ── 이 모듈이 하는 일 ───────────────────────────────────────────────────
 * 판정은 하지 않는다. **이미 내려진** 차단 판정의 원어휘를 BQ 에서 GROUP BY 할 수
 * 있는 5칸 어휘로 접기만 한다. 새 분기를 만들지 않는 것이 이 티켓의 규율이다 —
 * 계측이 제품 동작을 바꾸면 그 순간 계측이 아니게 된다.
 *
 * ── 왜 electron 을 import 하지 않는 순수 모듈인가 ────────────────────────
 * `harness-manager` 의 관측자 주입과 같은 이유다: 이 규칙은 메인 프로세스의 두
 * 초크포인트(`telemetry.spawnBlocked`, `bridge-server` 의 플랜 캡)가 공유하고,
 * 유닛 테스트는 BrowserWindow 없이 규칙만 검증해야 한다.
 */

/**
 * BQ `events.metadata.$.reason` 에 실리는 정규 어휘. 이 5칸이 곧 "무엇을 고쳐야
 * 하나" 의 답이다 — 각 칸이 서로 **다른 조치**로 이어지지 않으면 칸을 나눈 의미가
 * 없다:
 *  · no_subscription  → 요금제(구독) 부재. 무료티어/온램프 투자 판단의 입력값.
 *  · needs_auth       → CLI 는 깔렸는데 로그인이 없다. 연결 마법사가 고칠 수 있다.
 *  · no_cli           → 바이너리 자체가 없다. 설치 안내가 고칠 수 있다.
 *  · quota_exhausted  → 요금제는 **있는데** 한도에 걸렸다(=돈 낸 사람이다).
 *  · other            → 위 넷 중 어느 것도 아니다(벤더키 미설정 등). 원어휘는
 *                       같은 행의 `errorCategory` 에 그대로 남으므로 정보 손실은
 *                       없다.
 */
export const SPAWN_BLOCK_REASONS = [
  "no_subscription",
  "needs_auth",
  "no_cli",
  "quota_exhausted",
  "other",
] as const;

export type SpawnBlockReason = (typeof SPAWN_BLOCK_REASONS)[number];

/**
 * 플랜 캡 차단의 **원어휘**(errorCategory 에 실리는 값).
 *
 * 캡에 걸렸다는 사실 하나로는 "구독이 없어서" 인지 "요금제 한도를 다 썼는지" 를
 * 가를 수 없는데, 그 둘은 정반대의 조치로 이어진다(전자는 결제 유도, 후자는 한도
 * 상향/대기). 캡 판정이 이미 알고 있는 plan 값으로 여기서 가른다.
 *
 * ★plan 미해석(undefined)은 캡이 애초에 막지 않는다(`getPlanAgentLimit` 이 -1 =
 * 무제한을 돌려준다). 그래도 방어적으로 free 와 같은 칸에 둔다 — 알 수 없는 값을
 * 유료로 세면 "구독 공백" 이 과소계상된다.
 */
export type PlanCapErrorCategory = "plan-cap-free" | "plan-cap-paid";

export function planCapErrorCategory(
  plan: string | undefined,
): PlanCapErrorCategory {
  const normalized = (plan ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "free"
    ? "plan-cap-free"
    : "plan-cap-paid";
}

/**
 * 원어휘 → 정규 어휘. **모르는 값은 반드시 `other`** 로 떨어진다 — 새 차단 사유가
 * 생겼을 때 조용히 needs_auth 같은 기존 칸에 섞이면 그 칸의 수치가 오염된다.
 *
 * ★`vendor-not-configured`(BYOM 벤더 키 미등록)는 `other` 다. 구독 공백처럼 보이지만
 * 조치가 완전히 다르다 — 마블로 구독을 팔아도 해결되지 않고, 사용자가 자기 벤더
 * 키를 등록해야 풀린다. no_subscription 에 섞으면 온램프 투자 판단의 입력값이
 * 그만큼 부풀려진다.
 */
export function normalizeSpawnBlockReason(
  raw: string | undefined,
): SpawnBlockReason {
  switch ((raw ?? "").trim()) {
    case "not-installed":
      return "no_cli";
    case "not-authenticated":
      return "needs_auth";
    case "plan-cap-free":
      return "no_subscription";
    case "plan-cap-paid":
      return "quota_exhausted";
    default:
      return "other";
  }
}
