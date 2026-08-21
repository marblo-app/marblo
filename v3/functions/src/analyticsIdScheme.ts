// 설치 식별자 스킴 판정 — 순수 로직(BQ/Firebase 무의존).
// analyticsPseudonym.ts 와 같은 규약으로 node --test 단위검증한다.
//
// ── ★왜 이 모듈이 있나 (ticket dTpcKWwRw5DvEMKxpCZi) ─────────────────────────
// 2026-06-13 에 설치 id 스킴이 갈렸다. 그날 이전은 Firebase uid(28자), 이후는
// `crypto.randomUUID()`(36자 소문자 UUID)다. 두 스킴을 **이어붙이면 같은 사람이
// 그날 이탈한 것처럼 보인다** — 실측에서 실제로 그렇게 보였다.
//
// BQ 실측(2026-08-21, agent_heartbeats.userId, 집계만):
//   28자: 205,192행 / 고유 1개 / 2026-04-19 ~ 2026-06-13  (전부 Firebase uid 꼴)
//   36자: 11,219,097행 / 고유 14개 / 2026-06-13 ~ 2026-08-21 (전부 소문자 UUID)
// 교차오염 0건 — 28자 중 UUID 꼴 0, 36자 중 uid 꼴 0. 경계가 깨끗하다.
// 그래서 판정은 **날짜가 아니라 모양**으로 한다. 날짜 기준은 경계 당일
// (06-13 은 양쪽이 다 있다) 을 못 가르지만 모양은 가른다.
//
// ★이 모듈은 조인키를 만들지 않는다. 스킴을 **라벨링**할 뿐이다. 서로 다른
// 스킴의 두 id 를 한 사람으로 접합하려면 그건 별도 매핑이고, 그 매핑에는
// 이 모듈이 답하지 않는다 — canStitchIdScheme 은 항상 false 를 준다.

/**
 * 설치 id 스킴.
 * - `uid28`  : 2026-06-13 이전. Firebase uid 28자.
 * - `uuid36` : 2026-06-13 이후. 소문자 UUID 36자.
 * - `unknown`: 위 둘 중 어느 모양도 아님 — 접합 금지, 조인키로 쓰지 않는다.
 */
export type IdScheme = "uid28" | "uuid36" | "unknown";

/** 스킴이 갈린 날. 라벨이 아니라 **문서용 상수**다 — 판정은 모양으로 한다. */
export const ID_SCHEME_SWITCH_DATE = "2026-06-13";

const UUID36_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Firebase uid — 영숫자 28자. installAttribution.UUID_RE 와 같은 규약. */
const UID28_RE = /^[A-Za-z0-9]{28}$/;

/**
 * 스토리지를 못 쓰는 설치가 쓰는 리터럴(telemetryService.getClientId).
 * **모든 설치가 공유하는 값**이라 조인키가 될 수 없다 — unknown 으로 접는다.
 */
const SHARED_SENTINEL = "anon";

/**
 * ★조인키가 될 수 **없는** 값인가 — 모든 설치가 공유하는 리터럴이라
 * 키로 쓰면 전원이 한 사람으로 뭉친다.
 *
 * `classifyIdScheme` 이 unknown 을 주는 경우는 둘인데 처리가 다르다:
 *  - 공유 리터럴('anon'): **적재 제외.** 키로 쓰면 인원이 뭉쳐 왜곡된다.
 *  - 그 외 미분류 모양: **적재한다**(id_scheme='unknown'). 모양을 모를 뿐
 *    실재하는 설치다 — 빼면 인원이 줄어 보이고 그게 "이탈" 로 오독된다.
 */
export function isSharedSentinel(raw: unknown): boolean {
  return (
    typeof raw === "string" && raw.trim().toLowerCase() === SHARED_SENTINEL
  );
}

/**
 * 설치 id 하나의 스킴을 판정한다. 모양만 본다(시각 인자를 받지 않는 게 의도다).
 *
 * 원시값을 **되돌려주지 않는다** — 라벨만 나간다. 호출측이 실수로 원시 id 를
 * 로그·테이블에 흘리는 경로를 하나 줄이기 위해서다.
 */
export function classifyIdScheme(raw: unknown): IdScheme {
  if (typeof raw !== "string") return "unknown";
  const v = raw.trim();
  if (v.length === 0) return "unknown";
  if (v.toLowerCase() === SHARED_SENTINEL) return "unknown";
  if (UUID36_RE.test(v.toLowerCase()) && v.length === 36) return "uuid36";
  if (UID28_RE.test(v)) return "uid28";
  return "unknown";
}

/**
 * 두 id 를 **같은 사람으로 이어붙여도 되는가**.
 *
 * ★스킴이 다르면 무조건 false. 06-13 을 가로질러 잇는 순간 그 접합은 근거가
 * 없다 — 같은 사람일 수도, 아닐 수도 있고 데이터로는 못 가린다. 근거 없는
 * 접합보다 **끊긴 채로 두고 unmapped 로 세는 쪽**이 정직하다.
 *
 * 같은 스킴이어도 이 함수는 "이어도 된다" 를 뜻하지 않는다 — 동일 id 인지는
 * 호출측이 판단한다. 여기서 막는 건 **스킴 교차 접합** 하나다.
 */
export function canStitchIdScheme(a: unknown, b: unknown): boolean {
  const sa = classifyIdScheme(a);
  const sb = classifyIdScheme(b);
  if (sa === "unknown" || sb === "unknown") return false;
  return sa === sb;
}

/**
 * 조인 성립 여부.
 * - `joined`   : 상대 축에서 짝을 찾았다.
 * - `unmapped` : 못 찾았다. ★조용히 빼지 않는다 — 빼면 인원이 줄어 보이고,
 *                그게 나중에 "이탈" 로 오독된다. 남겨서 센다.
 */
export type LinkConfidence = "joined" | "unmapped";

/** 못 붙은 것을 버리지 않고 라벨링한다(은닉 금지). */
export function resolveLinkConfidence(matched: boolean): LinkConfidence {
  return matched ? "joined" : "unmapped";
}
