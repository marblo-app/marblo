/**
 * 워크로드 태그 어휘 — **1층·2층이 함께 읽는 단일 소스**.
 *
 * ── 왜 이 파일이 생겼나 ─────────────────────────────────────────────────
 * "이 티켓이 무거운 일이냐 가벼운 일이냐" 는 판단은 이미 라우팅 두 곳에서
 * 쓰인다.
 *
 *   1층 `dispatch-scoring.costEfficiencyScore` — 가벼운 태그면 비용효율을
 *       증폭하고 무거운 태그면 감쇠한다(어느 **하네스**를 고를지).
 *   2층 `model-autoselect.workloadIntensity` — 같은 어휘로 그 하네스 **안의
 *       어느 칸**을 고를지 움직인다.
 *
 * 종전엔 그 어휘가 1층 함수 본문의 인라인 리터럴로만 있었다. 2층이 같은 판단을
 * 하려면 목록을 베껴야 하는데, 베낀 목록은 **말없이 갈라진다** — 태그 하나를
 * 추가하면 하네스는 반응하는데 칸은 반응하지 않는(또는 그 반대) 상태가 되고,
 * 라우팅 로그만 봐서는 그 어긋남이 보이지 않는다. 그래서 어휘를 여기 한 벌로
 * 두고 양쪽이 읽는다.
 *
 * ── 경계 ────────────────────────────────────────────────────────────────
 * 여기 있는 것은 **어휘뿐**이다. "무거우면 몇 점" 은 층마다 다른 정책이라
 * 각 층에 남는다(1층 = 배수 ±0.3, 2층 = 칸당 점수 `WORKLOAD_STEP_WEIGHT`).
 * 의존성 0 — 순수 상수·순수 함수라 어느 쪽에서 import 해도 순환이 없다.
 */

export type WorkloadClass = "heavy" | "cheap";

/**
 * **무거운** 워크로드 태그 — 품질이 비용보다 비싼 일.
 * 이 목록은 종전 `costEfficiencyScore` 본문에 있던 그 네 개 그대로다(무회귀).
 */
export const HEAVY_WORKLOAD_TAGS: readonly string[] = [
  "architecture",
  "multi-file",
  "large-context",
  "complex-edit",
];

/**
 * **가벼운** 워크로드 태그 — 값싼 칸으로 충분한 일.
 * 역시 종전 목록 그대로다.
 */
export const CHEAP_WORKLOAD_TAGS: readonly string[] = [
  "simple-fix",
  "quick-edit",
  "boilerplate",
  "fast-execution",
];

const HEAVY: ReadonlySet<string> = new Set(HEAVY_WORKLOAD_TAGS);
const CHEAP: ReadonlySet<string> = new Set(CHEAP_WORKLOAD_TAGS);

/**
 * 태그 하나의 워크로드 계열. 모르는 태그·비문자열은 `null`(중립)이다.
 *
 * ★정규화(trim + 소문자)를 여기서 한다. 태그는 `dispatch_task(tags=[...])` 로
 * 들어오는 **자유 문자열**이라 `"Simple-Fix"` 나 `" multi-file"` 이 실제로 온다.
 * 종전 1층은 `tag === "simple-fix"` 완전일치라 그런 태그를 조용히 흘렸다 —
 * 어휘를 한 곳으로 모으면서 그 흘림도 같이 막는다(양쪽 층에 동시에 적용된다).
 */
export function classifyWorkloadTag(tag: unknown): WorkloadClass | null {
  if (typeof tag !== "string") return null;
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return null;
  if (HEAVY.has(normalized)) return "heavy";
  if (CHEAP.has(normalized)) return "cheap";
  return null;
}
