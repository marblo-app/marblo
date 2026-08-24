// ═══════════════════════════════════════════════════════════════════════════
// analytics_user_daily / analytics_install_profile / analytics_account_profile
// — 파생 분석 테이블의 **순수 계산부**(BQ/Firestore 무의존, node --test).
//   adminAnalytics.ts 와 같은 규약이다: 여기에는 쿼리도 시계도 없고, index.ts
//   가 BQ 에서 뽑은 행을 넣으면 적재할 행이 나온다.
//
// ═══════════════════════════════════════════════════════════════════════════
// ★★ 왜 프로필 테이블이 **두 개**로 쪼개져 있나 — 합치지 마라
// ═══════════════════════════════════════════════════════════════════════════
//
// 이 파일의 첫 설계는 `analytics_user_profile` **한 장**이었다. 한 행에
// `user_key`(계정)와 `install_key`(설치)를 나란히 두는 "통합 테이블" 이다.
// 그 설계는 폐기됐다. 이유는 취향이 아니라 **우리가 이미 배포해 둔 약속**이다.
//
//   v3/src/components/legal/privacyContent.tsx:95  (한국어 · "사용량·비용 기록")
//     "위 비식별 지표와는 별도 테이블이고, **두 기록이 공유하는 조인 키는
//      없습니다**(위 기록의 내부 식별자는 가명입니다)."
//   v3/src/components/legal/privacyContent.tsx:210 (English · 같은 문단)
//     "It lives in a separate table from the de-identified metrics above, and
//      **the two share no join key** (the internal ids on those rows are
//      pseudonyms)."
//
// `user_key` 와 `install_key` 를 한 행에 담는 순간 그 행 자체가 조인 키가 된다.
// 가명화(analyticsPseudonym.ts)로 events↔cost_logs 다리를 끊어 놓고, 파생
// 테이블에서 그 다리를 다시 놓는 꼴이다. 그래서 축을 물리적으로 가른다.
//
//   analytics_install_profile  ← 익명축. 키는 install_key **하나뿐**.
//   analytics_account_profile  ← 계정축. 키는 user_key **하나뿐**.
//   analytics_user_daily       ← 익명축(install_key × day).
//
// ★★ 두 테이블은 조인하지 않는다. 조인 키를 새로 만들지도 마라.
//    - install_profile 에 user_key / uid / 이메일 / 계정 라벨을 넣지 마라.
//    - account_profile 에 install_key / ga_key / 설치 라벨을 넣지 마라.
//    - 두 테이블을 잇는 매핑 테이블·뷰를 만들지 마라.
//    (이 규칙은 주석만이 아니다 — assertAxisPurity() 가 스키마를 검사하고
//     analyticsProfiles.test.ts 가 그 검사를 돌린다.)
//
// ★반대로, **계정축 안에서의 조인은 허용된다.**
//   analytics_account_profile ↔ cost_logs ↔ analytics_purchase 는 정상이다.
//   같은 방침 문단이 그 기록만은 계정에 붙는다고 명시한다(privacyContent.tsx:95):
//     "이 기록만은 성격상 익명일 수 없습니다 — 본인 지출을 본인에게
//      보여드리려면 계정과 이어져 있어야 하기 때문입니다."
//   금지된 것은 딱 하나, **두 축을 잇는 것**이다.
//
// ── 그래서 포기한 것(숨기지 말고 화면에 적어라) ────────────────────────────
//  1) 익명축에는 비용이 없다. cost_usd 는 계정축에만 있다. daily 에도 없다.
//  2) 익명축에는 캐시 지표가 없다. cacheReadTokens/cacheWriteTokens 는
//     index.ts 전체에서 **cost_logs 에만** 존재한다(계정축). 익명 테이블
//     (events / task_outcomes / agent_heartbeats)에는 캐시 컬럼 자체가 없다.
//     → cache_hit_rate 는 analytics_account_profile 에 있다. install 쪽에서
//       찾다가 "없네, cost_logs 붙이면 되겠네" 하지 마라. 그게 그 다리다.
//  3) 익명축에는 is_admin 이 없다. 운영자 자기제외가 구조적으로 불가능하다 —
//     이것도 방침이 이미 고지한 대가다("운영자 본인 활동 제외는 포기했습니다").
//     익명축 숫자는 그만큼 운영자 도그푸드 쪽으로 낙관 편향될 수 있다.
//
// ═══════════════════════════════════════════════════════════════════════════

import {
  coerceNumber,
  countedRate,
  dayNumber,
  dayString,
  IDENTITY_SCHEME_SWITCH_ON,
  LEGACY_INSTALL_ID_LENGTH,
  ACTIVITY_DEFINITION_INSTALL,
  type RetentionCountedRate,
} from "./adminAnalytics";
import {
  FORBIDDEN_ON_LINK_AXIS,
  LINK_AXIS_TABLES,
  TABLE_USER_INSTALL,
} from "./personAxis";
import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";
import {
  VIEW_TEAM_USAGE_DAILY,
  VIEW_TEAM_USAGE_UNATTRIBUTED,
} from "./teamUsage";

// ── 테이블 좌표 ──────────────────────────────────────────────────────────────
// 데이터셋은 원본과 같은 marblo_telemetry 다(cost_logs 가 여기 있어야 계정축
// 조인이 성립한다). 축 분리는 데이터셋이 아니라 **테이블과 컬럼**으로 한다.

export const ANALYTICS_DATASET = "marblo_telemetry";
export const TABLE_USER_DAILY = "analytics_user_daily";
export const TABLE_INSTALL_PROFILE = "analytics_install_profile";
export const TABLE_ACCOUNT_PROFILE = "analytics_account_profile";

/** 익명축 테이블 — 여기에 계정축 컬럼이 들어오면 안 된다. */
export const ANONYMOUS_AXIS_TABLES: ReadonlyArray<string> = [
  TABLE_USER_DAILY,
  TABLE_INSTALL_PROFILE,
];
/**
 * 계정축 테이블·뷰.
 *
 * ★팀 오버뷰 뷰 두 벌(#1103 설계 §4.2)이 여기 등재돼 있다. 등재돼 있어야
 * `assertAxisPurity()` 가 그 컬럼 목록을 `FORBIDDEN_ON_ACCOUNT_AXIS` 로 검사하고,
 * 테스트가 CI 에서 그 검사를 돌린다 — 누가 나중에 뷰에 익명축 조인키를 더하면
 * **테스트가 깨진다.** 주석이 아니라 빨간불이다.
 */
export const ACCOUNT_AXIS_TABLES: ReadonlyArray<string> = [
  TABLE_ACCOUNT_PROFILE,
  VIEW_TEAM_USAGE_DAILY,
  VIEW_TEAM_USAGE_UNATTRIBUTED,
];

export { VIEW_TEAM_USAGE_DAILY, VIEW_TEAM_USAGE_UNATTRIBUTED };
/**
 * ★링크축 테이블 — `user_key` 와 `install_key` 를 한 행에 담는 것이 허용된
 * **유일한** 자리다(사람 축 설계 §4, PR #1081). 목록의 정본은 personAxis.ts 에
 * 있고 여기서는 축 판정에 쓰기 위해 다시 내보낸다.
 *
 * ★이 축이 생겼다고 익명축이 넓어진 것이 아니다. `FORBIDDEN_ON_ANONYMOUS_AXIS`
 * 는 한 글자도 바뀌지 않았고, `analytics_user_daily`/`analytics_install_profile`
 * 에 `user_key` 를 넣으려는 시도는 여전히 여기서 던진다. 축이 셋이 된 것뿐이다.
 */
export { LINK_AXIS_TABLES, FORBIDDEN_ON_LINK_AXIS, TABLE_USER_INSTALL };

/**
 * ★익명축 테이블에 **절대** 나타나면 안 되는 컬럼명(계정으로 되짚는 다리).
 * 스키마 상수를 이 목록으로 검사하는 테스트가 있다 — 새 컬럼을 추가할 때
 * 여기 걸리면 그 컬럼은 익명축에 둘 수 없는 값이다.
 */
export const FORBIDDEN_ON_ANONYMOUS_AXIS: ReadonlyArray<string> = [
  "user_key",
  "user_id",
  "userid",
  "uid",
  "account_key",
  "account_id",
  "account_label",
  "email",
  "customer_key",
  "billing_key",
  "cost_usd",
  "total_cost_usd",
  "mrr_usd",
  "ltv_usd",
  "cache_read_tokens",
  "cache_write_tokens",
  "cache_hit_rate",
  "is_admin",
];

/**
 * ★계정축 테이블에 **절대** 나타나면 안 되는 컬럼명(반대 방향의 다리).
 */
export const FORBIDDEN_ON_ACCOUNT_AXIS: ReadonlyArray<string> = [
  "install_key",
  "install_id",
  "installid",
  "client_id",
  "clientid",
  "ga_key",
  "ga_client_id",
  "install_label",
];

// ── ★D1/D3/D7/D14/D30 정의 — 문서로만 두지 않고 코드에 박는다 ───────────────
//
// 업계에 두 정의가 다 쓰인다. 안 적으면 다음 사람이 다르게 읽고, 같은 화면이
// 다른 숫자로 보인다. 그래서 **고르지 않고 둘 다 저장한다.** 표본이 작을수록
// 두 값이 크게 벌어져서, 어느 쪽을 인용하느냐가 결론을 뒤집는다.
//
// 기준일(day 0) = 그 설치의 **첫 활동일**(first_active_day). 가입일도, 첫
// 하트비트일도 아니다 — 아래 ACTIVITY_DEFINITION 을 충족한 첫 날이다.

export const HORIZON_DEFINITION_EXACT =
  "exact(=bracket/classic): 첫 활동일(day 0) 로부터 **정확히 +N일 당일**에 " +
  "활동이 있었는가. day 0 자체는 분자에 넣지 않는다.";

export const HORIZON_DEFINITION_WINDOW =
  "window(=rolling/range): 첫 활동일 **다음날(+1일)부터 +N일까지 창 안에서 " +
  "하루라도** 활동이 있었는가. 창은 양끝 포함이고 day 0 은 제외한다.";

export const HORIZON_DEFINITION_PENDING =
  "pending: 오늘이 아직 day 0 + N 에 도달하지 않아 **판정 자체가 불가능한** " +
  "설치. 분자에도 분모에도 넣지 않고 따로 센다 — 분모에 넣으면 어제 들어온 " +
  "신규가 자동으로 D7 이탈로 찍힌다.";

/** 세 정의를 한 덩어리로. 테이블 description 과 문서가 같은 문자열을 쓴다. */
export const HORIZON_DEFINITIONS = [
  HORIZON_DEFINITION_EXACT,
  HORIZON_DEFINITION_WINDOW,
  HORIZON_DEFINITION_PENDING,
].join("\n");

/** 활동 정의(익명축). adminAnalytics 의 단일 정의를 그대로 승계한다. */
export const ACTIVITY_DEFINITION = ACTIVITY_DEFINITION_INSTALL;

export const PRESENT_ONLY_DEFINITION =
  'present_only = 그날 하트비트는 있는데 status="working" 0건이고 이벤트도 ' +
  "0건. 사람이 아니라 **떠 있는 프로세스**다. active 와 배타적이며 코호트 " +
  "분모에 절대 들어가지 않는다 — 실측에서 어떤 설치가 14일 중 13일 '활동' 으로 " +
  "잡혔는데 하트비트 35,170건 중 working 0건·이벤트 0건이었다.";

// ═══════════════════════════════════════════════════════════════════════════
// ★활성화 분자·분모의 모집단 규약 (ticket sx56j9XA26yEXka8QIhr)
// ═══════════════════════════════════════════════════════════════════════════
//
// 2026-08-24 에 "첫 실행 → 첫 스폰 3.1%(18/577)" 가 제품 판단의 기준선으로
// 인용됐는데, 그 비율은 **분자와 분모가 서로 다른 모집단**이었다. 실측으로
// analytics_install_profile 606행을 출처별로 가르면:
//
//   어트리뷰션만 있고 이벤트 0  : 564행 — first_run 564 · first_spawn 0 · 활동일 0
//   이벤트만 있고 어트리뷰션 0  :  43행 — first_run  12 · first_spawn 17 · 활동일 184
//   둘 다                       :   1행
//
// 왜 갈리나 — **분모는 미인증 경로에서, 분자는 인증 경로에서 온다.**
//   · `linkInstallAttribution`(#906, 2026-08-10 배포)은 **미인증** 콜러블이다.
//     로그인하지 않은 설치도 install_attribution 에 한 줄을 남긴다.
//   · 반면 telemetryService 의 `flushTelemetry`/`flushHeartbeats` 는
//     `if (!auth.currentUser) return;` 로 **로그인 전 텔레메트리를 전량 폐기**한다.
//     그래서 로그인하지 않은 설치는 events 에 단 한 줄도 남기지 않는다.
//   → first_spawn_at 은 events 에서만 오므로, 어트리뷰션만 있는 행은 **분자를
//     가질 수 있는 자격 자체가 없다.** 그 행들을 분모에 넣으면 비율은 설계상
//     0 으로 수렴한다. 실제로 first_run_at 주차 기준 08-10 199건/스폰 0,
//     08-17 368건/스폰 1 이 그 결과다 — 전환율이 떨어진 게 아니다.
//
// 그래서 이 파일은 비율을 고르지 않고 **모집단을 라벨링한다**:
//   · `first_run_source`      — first_run_at 이 어느 출처에서 왔나.
//   · `activation_observable` — 이 설치가 first_spawn_at 을 가질 **수** 있나.
//   · `cohort_day`            — 주차 코호트 진입일(단일 정의).
//   · `ft_browser_installs` / `install_class` — 분모 중복·개발 재실행 축.
//
// ★비율을 여기서 계산해 저장하지 않는다. `summarizeFirstSpawnActivation()` 이
//   분자·분모를 **둘 다** 돌려주고, 화면은 "1/3 (33.3%)" 를 그린다.

export const ACTIVATION_OBSERVABLE_DEFINITION =
  "activation_observable = 이 설치가 인증 텔레메트리(events/heartbeats/" +
  "task_outcomes)를 한 줄이라도 남겼는가(observed_days > 0). ★false 면 " +
  "first_spawn_at 이 null 인 것은 '스폰을 안 했다' 가 아니라 '관측 자체가 " +
  "불가능하다' 다 — 활성화 비율의 분모에 넣지 마라.";

export const FIRST_RUN_SOURCE_DEFINITION =
  "first_run_source = first_run_at 의 출처. " +
  "'event'(app:first_run 이벤트) / " +
  "'attribution'(install_attribution.linkedAt — ★미인증 경로라 분자 자격이 " +
  "없을 수 있다) / " +
  "'activity'(이벤트도 어트리뷰션도 없어 첫 활동일로 대체 — 시각은 그 날 " +
  "00:00Z 가 아니라 null 이고 cohort_day 만 채운다) / null(셋 다 없음).";

export const COHORT_DAY_DEFINITION =
  "cohort_day = 주차 코호트 진입일. DATE(first_run_at) 이 있으면 그것, 없으면 " +
  "first_active_day. ★없는 시각을 지어내지 않으려고 날짜 컬럼을 따로 둔다 — " +
  "이게 없던 동안 이벤트만 있는 설치 43개 중 31개가 주차 표에서 통째로 빠졌다.";

/**
 * 한 브라우저(ga_key)가 이 수 이상의 '설치' 를 만들었으면 사람이 아니라
 * **재설치 루프**로 본다.
 *
 * 근거(2026-08-24 실측): install_attribution 631행의 고유 gaClientId 는 **5개**다
 * (539행 / 69행 / 16행 / 6행 / 1행). GA4 client_id 는 브라우저 프로필당 하나이므로
 * 539명이 각자 설치했다면 브라우저도 539개여야 한다. 한 브라우저가 2주 만에
 * 539번 '최초 실행' 을 했다는 건 localStorage 가 매 실행 초기화되는 개발 루프다.
 * 채널 태그가 붙은 유일한 버전(3.0.35)은 80건이 **전부 dev** 였다.
 */
export const REINSTALL_LOOP_MIN_INSTALLS = 5;

export const INSTALL_CLASS_DEFINITION =
  "install_class = 분모 위생 등급. " +
  "'dev_tagged'(ft_build_channel='dev' — #1071 이후 앱이 직접 표시) / " +
  "'reinstall_loop'(같은 ga_key 가 " +
  `${REINSTALL_LOOP_MIN_INSTALLS}개 이상의 설치를 만들었다) / ` +
  "'distinct'(ga_key 가 있고 재설치 루프도 아니다) / " +
  "'unknown'(ga_key 가 없어 판단 불가 — 조용히 distinct 로 치지 않는다). " +
  "★ft_build_channel NULL 은 '알 수 없음' 이 아니라 '#1071(2026-08-21) 이전 " +
  "앱이라 채널 파라미터가 존재하지 않았다' 다. 그 과거분은 앱을 고쳐도 채워지지 " +
  "않으므로 ga_key 축으로 가른다.";

export type ProfileHorizonKey = "d1" | "d3" | "d7" | "d14" | "d30";

/** 저장하는 지평. 지시 스펙: d1/d3/d7/d14/d30. */
export const PROFILE_HORIZONS: ReadonlyArray<{
  key: ProfileHorizonKey;
  days: number;
}> = [
  { key: "d1", days: 1 },
  { key: "d3", days: 3 },
  { key: "d7", days: 7 },
  { key: "d14", days: 14 },
  { key: "d30", days: 30 },
];

// ── id_scheme ────────────────────────────────────────────────────────────────
// 2026-06-13 에 설치 식별자가 Firebase uid(28자) → UUID(36자) 로 바뀌었다.
// 두 스킴을 이어붙이면 **같은 사람이 이탈한 것처럼** 보인다(실측에서 실제로
// 그랬다). 이어붙이지 않고, 어느 스킴인지 컬럼으로 남겨 다음 사람이 경계를
// 눈으로 볼 수 있게 한다.

export type IdScheme = "legacy_uid28" | "uuid36" | "unknown";

export const ID_SCHEME_NOTE =
  `★${IDENTITY_SCHEME_SWITCH_ON} 에 설치 식별자 스킴이 Firebase uid(28자) → ` +
  "UUID(36자) 로 교체됐다. 경계를 넘겨 두 id 를 이어붙이면 같은 사람이 이탈한 " +
  "것처럼 보인다 — 잇지 말고 id_scheme 으로 갈라서 읽어라.";

/**
 * 설치 키의 식별자 스킴을 판정한다.
 *
 * ★주의: 선행 티켓(analytics_identity)이 install_key 를 HMAC 가명으로 바꾸면
 * 원시 길이 정보가 사라진다. 그래서 **원시 설치 id 길이**를 별도 인자로 받을 수
 * 있게 열어 뒀다(rawLength). 가명뿐이고 길이를 모르면 "unknown" 이다 —
 * 추측으로 legacy/uuid 를 찍는 것보다 모른다고 적는 쪽이 낫다.
 */
export function classifyIdScheme(
  key: string,
  rawLength?: number | null
): IdScheme {
  const len =
    typeof rawLength === "number" && rawLength > 0 ? rawLength : key.length;
  if (len === LEGACY_INSTALL_ID_LENGTH) return "legacy_uid28";
  if (len === 36) return "uuid36";
  return "unknown";
}

// ── 작은 유틸 ────────────────────────────────────────────────────────────────

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

function nullableStr(v: unknown): string | null {
  const s = str(v, "");
  return s === "" ? null : s;
}

/** 두 ISO 타임스탬프 중 **이른** 쪽. null 은 없는 것으로 친다. */
function earliest(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a <= b ? a : b;
}

/** 두 ISO 타임스탬프 중 **늦은** 쪽. */
function latest(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

/** 카운트 맵을 count 내림차순(동률은 키 오름차순)으로 정렬해 배열로. */
function rankCounts(
  map: Map<string, number>,
  limit?: number
): Array<{ key: string; count: number }> {
  const out = Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return limit == null ? out : out.slice(0, limit);
}

/** 정렬된 일련번호 배열의 최대 연속 길이와 마지막 연속 길이. */
function streaksOf(sortedDays: number[]): { max: number; last: number } {
  if (sortedDays.length === 0) return { max: 0, last: 0 };
  let max = 1;
  let run = 1;
  for (let i = 1; i < sortedDays.length; i += 1) {
    run = sortedDays[i] === sortedDays[i - 1] + 1 ? run + 1 : 1;
    if (run > max) max = run;
  }
  return { max, last: run };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) analytics_user_daily — 익명축(install_key × day)
// ═══════════════════════════════════════════════════════════════════════════
//
// ★비용 컬럼이 없다. 일부러 없다. 토큰 수는 events/heartbeats(익명축)에서
//   나오므로 익명축에 남아도 되지만, 달러 금액은 계정축(cost_logs)의 개념이다.
//   daily 에 cost_usd 를 두면 누군가 반드시 계정축 합계와 맞춰 보게 되고,
//   그 대사(reconciliation) 자체가 두 축을 잇는 소프트 조인이 된다.
//
// ★models 도 STRUCT<model, calls> 까지다. STRUCT<..., cost> 로 넓히지 마라 —
//   같은 이유다.

/** index.ts 가 BQ 에서 뽑아 주는 (설치 × 날짜) 원시 집계 한 줄. */
export type DailySourceRow = {
  /** 익명 설치 축 키. events/heartbeats 의 userId(=clientId) 또는 그 가명. */
  installKey?: unknown;
  /** 'YYYY-MM-DD' (UTC). */
  day?: unknown;
  /** status="working" 하트비트 건수. */
  workingBeats?: unknown;
  /** 전체 하트비트 건수(working 포함). */
  presenceBeats?: unknown;
  /** events 행 수. */
  eventCount?: unknown;
  tokensInput?: unknown;
  tokensOutput?: unknown;
  /** 그날 마지막으로 관측된 앱 버전. */
  appVersion?: unknown;
  tasksCompleted?: unknown;
  tasksFailed?: unknown;
  /** 모델별 호출 수. ★cost 는 담지 않는다. */
  models?: unknown;
  roles?: unknown;
  taskTypes?: unknown;
  errorCategories?: unknown;
  /** 원시 설치 id 길이(가명화 이전 값을 index.ts 가 알 때만). */
  installKeyRawLength?: unknown;
};

export type DailyModelUse = { model: string; calls: number };
export type DailyErrorCount = { category: string; count: number };

export type UserDailyRow = {
  /** 원시 설치 축 키. 기존 컬럼은 보존한다. */
  install_key: string;
  /**
   * 링크표/identity 와 같은 HMAC 설치 키. 신규 행부터 채우며 과거 행은 null 이다.
   */
  install_key_hmac: string | null;
  day: string;
  /** ★active = working 하트비트 ≥1 **또는** 이벤트 ≥1. 하트비트 존재가 아니다. */
  active: boolean;
  /** ★좀비 격리 열. active 와 배타적이다. */
  present_only: boolean;
  working_beats: number;
  presence_beats: number;
  event_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  app_version: string | null;
  tasks_completed: number;
  tasks_failed: number;
  models: DailyModelUse[];
  roles: string[];
  task_types: string[];
  error_categories: DailyErrorCount[];
  id_scheme: IdScheme;
};

function parseModelUses(v: unknown): DailyModelUse[] {
  if (!Array.isArray(v)) return [];
  const merged = new Map<string, number>();
  for (const raw of v) {
    if (raw == null) continue;
    const o = raw as Record<string, unknown>;
    const model = str(o.model ?? o.key, "");
    if (model === "") continue;
    merged.set(
      model,
      (merged.get(model) ?? 0) + coerceNumber(o.calls ?? o.count)
    );
  }
  return rankCounts(merged).map(({ key, count }) => ({
    model: key,
    calls: count,
  }));
}

function parseErrorCounts(v: unknown): DailyErrorCount[] {
  if (!Array.isArray(v)) return [];
  const merged = new Map<string, number>();
  for (const raw of v) {
    if (raw == null) continue;
    const o = raw as Record<string, unknown>;
    const category = str(o.category ?? o.key, "");
    if (category === "") continue;
    merged.set(category, (merged.get(category) ?? 0) + coerceNumber(o.count));
  }
  return rankCounts(merged).map(({ key, count }) => ({
    category: key,
    count,
  }));
}

function parseStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const raw of v) {
    const s = str(raw, "");
    if (s !== "") seen.add(s);
  }
  return Array.from(seen).sort();
}

/**
 * (설치 × 날짜) 원시 집계 → analytics_user_daily 행.
 *
 * 같은 (installKey, day) 가 여러 줄로 와도 합쳐진다 — 소스 쿼리가 테이블별로
 * 쪼개져 오기 때문이다(events / heartbeats / task_outcomes 각각 한 줄).
 */
export function buildUserDailyRows(
  rows: ReadonlyArray<DailySourceRow>,
  analyticsIdSalt: string | null = null
): UserDailyRow[] {
  type Acc = {
    installKey: string;
    day: string;
    rawLength: number | null;
    workingBeats: number;
    presenceBeats: number;
    eventCount: number;
    tokensInput: number;
    tokensOutput: number;
    appVersion: string | null;
    tasksCompleted: number;
    tasksFailed: number;
    models: Map<string, number>;
    roles: Set<string>;
    taskTypes: Set<string>;
    errors: Map<string, number>;
  };
  const acc = new Map<string, Acc>();

  for (const row of rows) {
    const installKey = str(row.installKey, "");
    const day = str(row.day, "");
    // "anon" 은 clientId 미제공 폴백이다 — 사람 한 명이 아니라 잡동사니다.
    if (installKey === "" || installKey === "anon") continue;
    if (dayNumber(day) == null) continue;

    const mapKey = `${installKey} ${day}`;
    let a = acc.get(mapKey);
    if (!a) {
      a = {
        installKey,
        day,
        rawLength: null,
        workingBeats: 0,
        presenceBeats: 0,
        eventCount: 0,
        tokensInput: 0,
        tokensOutput: 0,
        appVersion: null,
        tasksCompleted: 0,
        tasksFailed: 0,
        models: new Map(),
        roles: new Set(),
        taskTypes: new Set(),
        errors: new Map(),
      };
      acc.set(mapKey, a);
    }
    const rawLen = coerceNumber(row.installKeyRawLength);
    if (rawLen > 0) a.rawLength = rawLen;
    a.workingBeats += coerceNumber(row.workingBeats);
    a.presenceBeats += coerceNumber(row.presenceBeats);
    a.eventCount += coerceNumber(row.eventCount);
    a.tokensInput += coerceNumber(row.tokensInput);
    a.tokensOutput += coerceNumber(row.tokensOutput);
    a.tasksCompleted += coerceNumber(row.tasksCompleted);
    a.tasksFailed += coerceNumber(row.tasksFailed);
    const ver = nullableStr(row.appVersion);
    if (ver != null) a.appVersion = ver;
    for (const m of parseModelUses(row.models)) {
      a.models.set(m.model, (a.models.get(m.model) ?? 0) + m.calls);
    }
    for (const r of parseStringList(row.roles)) a.roles.add(r);
    for (const t of parseStringList(row.taskTypes)) a.taskTypes.add(t);
    for (const e of parseErrorCounts(row.errorCategories)) {
      a.errors.set(e.category, (a.errors.get(e.category) ?? 0) + e.count);
    }
  }

  const out: UserDailyRow[] = [];
  for (const a of acc.values()) {
    // ★단 한 곳의 활동 정의. 하트비트가 떠 있기만 한 날은 활동이 아니다.
    const active = a.workingBeats >= 1 || a.eventCount >= 1;
    // ★좀비: 하트비트는 왔는데 working 0 · 이벤트 0. active 와 배타적이다.
    const presentOnly = !active && a.presenceBeats >= 1;
    const installKeyHmac = pseudonymizeAnalyticsId(
      "install",
      a.installKey,
      analyticsIdSalt
    );
    out.push({
      install_key: a.installKey,
      install_key_hmac:
        typeof installKeyHmac === "string" && installKeyHmac.length > 0
          ? installKeyHmac
          : null,
      day: a.day,
      active,
      present_only: presentOnly,
      working_beats: a.workingBeats,
      presence_beats: a.presenceBeats,
      event_count: a.eventCount,
      tokens_input: a.tokensInput,
      tokens_output: a.tokensOutput,
      tokens_total: a.tokensInput + a.tokensOutput,
      app_version: a.appVersion,
      tasks_completed: a.tasksCompleted,
      tasks_failed: a.tasksFailed,
      models: rankCounts(a.models).map(({ key, count }) => ({
        model: key,
        calls: count,
      })),
      roles: Array.from(a.roles).sort(),
      task_types: Array.from(a.taskTypes).sort(),
      error_categories: rankCounts(a.errors).map(({ key, count }) => ({
        category: key,
        count,
      })),
      id_scheme: classifyIdScheme(a.installKey, a.rawLength),
    });
  }
  // 결정적 정렬 — 재빌드 diff 를 사람이 읽을 수 있게.
  out.sort(
    (x, y) =>
      x.install_key.localeCompare(y.install_key) || x.day.localeCompare(y.day)
  );
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) analytics_install_profile — 익명축(설치당 1행)
// ═══════════════════════════════════════════════════════════════════════════
//
// daily 를 접어서 만든다. 여기서 계정 쪽 값을 **끌어오지 않는다.**

/** install_attribution 에서 온 first-touch 한 줄(익명 웹축). */
export type InstallFirstTouchRow = {
  installKey?: unknown;
  /** GA4 client id — 익명 웹축 키. ★계정 축 키가 아니다. */
  gaKey?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  referrerHost?: unknown;
  landingPath?: unknown;
  linkSource?: unknown;
  platform?: unknown;
  buildChannel?: unknown;
  /** 웹 첫 방문 시각(GA4). 없으면 null. */
  firstVisitAt?: unknown;
  /** 앱이 어트리뷰션을 링크한 시각 = 사실상 첫 실행. */
  linkedAt?: unknown;
};

/** 설치별 이정표 타임스탬프(events 에서 뽑는다). */
export type InstallMilestoneRow = {
  installKey?: unknown;
  firstRunAt?: unknown;
  firstSpawnAt?: unknown;
  firstCompletedAt?: unknown;
};

export type InstallProfileInput = {
  /** 'YYYY-MM-DD'(UTC). ★주입받는다 — 순수 함수를 시계에 묶지 않는다. */
  today: string;
  /** buildUserDailyRows 의 출력을 그대로 넣는다(단일 진실). */
  daily: ReadonlyArray<UserDailyRow>;
  firstTouch?: ReadonlyArray<InstallFirstTouchRow>;
  milestones?: ReadonlyArray<InstallMilestoneRow>;
  /** top_errors 상한(기본 5). */
  topErrorLimit?: number;
};

/** 지평 하나의 **설치 단위** 판정. 집계는 summarizeInstallRetention 이 한다. */
export type InstallHorizon = {
  key: ProfileHorizonKey;
  days: number;
  /** ★관측창 미도달. true 면 exact/window 는 둘 다 null(분모에서 뺀다). */
  pending: boolean;
  /** exact 정의 판정. pending 이면 null. */
  exact: boolean | null;
  /** window 정의 판정. pending 이면 null. */
  window: boolean | null;
};

export type ModelMixEntry = {
  model: string;
  calls: number;
  /** calls / 전체 calls. 전체가 0 이면 null(0 이 아니다). */
  share: number | null;
};

/** first_run_at 의 출처. FIRST_RUN_SOURCE_DEFINITION. */
export type FirstRunSource = "event" | "attribution" | "activity" | null;

/** 분모 위생 등급. INSTALL_CLASS_DEFINITION. */
export type InstallClass =
  | "dev_tagged"
  | "reinstall_loop"
  | "distinct"
  | "unknown";

export type InstallProfileRow = {
  install_key: string;
  id_scheme: IdScheme;

  // ── first touch(익명 웹축) ──
  ga_key: string | null;
  ft_utm_source: string | null;
  ft_utm_medium: string | null;
  ft_utm_campaign: string | null;
  ft_referrer_host: string | null;
  ft_landing_path: string | null;
  ft_link_source: string | null;
  ft_platform: string | null;
  ft_build_channel: string | null;

  // ── 이정표 ──
  first_visit_at: string | null;
  first_run_at: string | null;
  /** ★first_run_at 이 어디서 왔나. FIRST_RUN_SOURCE_DEFINITION. */
  first_run_source: FirstRunSource;
  first_spawn_at: string | null;
  first_completed_at: string | null;
  first_active_day: string | null;
  last_active_day: string | null;
  /** ★주차 코호트 진입일. COHORT_DAY_DEFINITION. */
  cohort_day: string | null;

  // ── ★분자 자격·분모 위생 (ticket sx56j9XA26yEXka8QIhr) ──
  /** ACTIVATION_OBSERVABLE_DEFINITION. false 면 활성화 분모에서 뺀다. */
  activation_observable: boolean;
  /** 같은 ga_key 를 공유하는 설치 수. ga_key 가 없으면 null. */
  ft_browser_installs: number | null;
  /** INSTALL_CLASS_DEFINITION. */
  install_class: InstallClass;

  // ── 활동 ──
  observed_days: number;
  active_days: number;
  /** ★좀비로 격리된 날 수. active_days 와 겹치지 않는다. */
  present_only_days: number;
  max_streak: number;
  current_streak: number;
  days_since_last_active: number | null;
  /** 관측 구간 전체에서 활동일이 0 인 설치 = 순수 좀비. */
  zombie: boolean;

  // ── 리텐션(설치 단위 판정 · 분자/분모는 집계 시 나온다) ──
  d1_exact: boolean | null;
  d1_window: boolean | null;
  d1_pending: boolean;
  d3_exact: boolean | null;
  d3_window: boolean | null;
  d3_pending: boolean;
  d7_exact: boolean | null;
  d7_window: boolean | null;
  d7_pending: boolean;
  d14_exact: boolean | null;
  d14_window: boolean | null;
  d14_pending: boolean;
  d30_exact: boolean | null;
  d30_window: boolean | null;
  d30_pending: boolean;

  // ── 사용량(익명축에서 나오는 것만) ──
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  model_mix: ModelMixEntry[];

  // ── 완료·성공(★분자·분모를 그대로 저장한다) ──
  tasks_completed: number;
  tasks_failed: number;
  /** 분모 = completed + failed. 화면이 "1/2 (50.0%)" 를 그릴 수 있게 둘 다 둔다. */
  tasks_attempted: number;
  /** 분모 0 이면 null — 0% 가 아니라 "판단 불가"다. */
  success_rate: number | null;
  success_display: string;
  top_errors: DailyErrorCount[];

  app_version: string | null;
};

function foldFirstTouch(
  rows: ReadonlyArray<InstallFirstTouchRow>
): Map<string, InstallFirstTouchRow> {
  // 설치당 1건이 원칙이다(linkInstallAttribution 이 create 로 선착 1건만 적재).
  // 그래도 중복이 오면 **가장 이른 linkedAt** 을 남긴다 — first-touch 니까.
  const out = new Map<string, InstallFirstTouchRow>();
  for (const row of rows) {
    const key = str(row.installKey, "");
    if (key === "") continue;
    const prev = out.get(key);
    if (prev == null) {
      out.set(key, row);
      continue;
    }
    const a = nullableStr(prev.linkedAt);
    const b = nullableStr(row.linkedAt);
    if (a == null || (b != null && b < a)) out.set(key, row);
  }
  return out;
}

function foldMilestones(
  rows: ReadonlyArray<InstallMilestoneRow>
): Map<
  string,
  { run: string | null; spawn: string | null; done: string | null }
> {
  const out = new Map<
    string,
    { run: string | null; spawn: string | null; done: string | null }
  >();
  for (const row of rows) {
    const key = str(row.installKey, "");
    if (key === "") continue;
    const cur = out.get(key) ?? { run: null, spawn: null, done: null };
    cur.run = earliest(cur.run, nullableStr(row.firstRunAt));
    cur.spawn = earliest(cur.spawn, nullableStr(row.firstSpawnAt));
    cur.done = earliest(cur.done, nullableStr(row.firstCompletedAt));
    out.set(key, cur);
  }
  return out;
}

/**
 * daily(+first touch, 이정표) → analytics_install_profile 행.
 *
 * 순수 함수다. `today` 는 반드시 주입받는다 — 리텐션 판정이 시계에 흔들리면
 * 이 지표는 검증할 수 없다.
 */
export function buildInstallProfileRows(
  input: InstallProfileInput
): InstallProfileRow[] {
  const todayNum = dayNumber(input.today);
  const topErrorLimit = Math.max(1, Math.floor(input.topErrorLimit ?? 5));
  const firstTouch = foldFirstTouch(input.firstTouch ?? []);
  const milestones = foldMilestones(input.milestones ?? []);
  // ★분모 위생 축. foldFirstTouch 는 설치당 1행이므로 ga_key 별 엔트리 수가
  //   곧 "그 브라우저가 만든 설치 수" 다. 실측 631행 → 브라우저 5개.
  const browserInstalls = new Map<string, number>();
  for (const row of firstTouch.values()) {
    const ga = nullableStr(row.gaKey);
    if (ga == null) continue;
    browserInstalls.set(ga, (browserInstalls.get(ga) ?? 0) + 1);
  }

  type Acc = {
    key: string;
    idScheme: IdScheme;
    activeDays: number[];
    presentOnlyDays: number;
    observedDays: number;
    tokensInput: number;
    tokensOutput: number;
    tasksCompleted: number;
    tasksFailed: number;
    models: Map<string, number>;
    errors: Map<string, number>;
    lastVersionDay: string | null;
    lastVersion: string | null;
  };
  const acc = new Map<string, Acc>();

  for (const row of input.daily) {
    let a = acc.get(row.install_key);
    if (!a) {
      a = {
        key: row.install_key,
        idScheme: row.id_scheme,
        activeDays: [],
        presentOnlyDays: 0,
        observedDays: 0,
        tokensInput: 0,
        tokensOutput: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        models: new Map(),
        errors: new Map(),
        lastVersionDay: null,
        lastVersion: null,
      };
      acc.set(row.install_key, a);
    }
    // id_scheme 은 unknown 이 아닌 값이 하나라도 있으면 그걸 쓴다.
    if (a.idScheme === "unknown" && row.id_scheme !== "unknown") {
      a.idScheme = row.id_scheme;
    }
    a.observedDays += 1;
    const dn = dayNumber(row.day);
    if (row.active && dn != null) a.activeDays.push(dn);
    if (row.present_only) a.presentOnlyDays += 1;
    a.tokensInput += row.tokens_input;
    a.tokensOutput += row.tokens_output;
    a.tasksCompleted += row.tasks_completed;
    a.tasksFailed += row.tasks_failed;
    for (const m of row.models) {
      a.models.set(m.model, (a.models.get(m.model) ?? 0) + m.calls);
    }
    for (const e of row.error_categories) {
      a.errors.set(e.category, (a.errors.get(e.category) ?? 0) + e.count);
    }
    if (row.app_version != null) {
      if (a.lastVersionDay == null || row.day >= a.lastVersionDay) {
        a.lastVersionDay = row.day;
        a.lastVersion = row.app_version;
      }
    }
  }

  // ★어트리뷰션은 있는데 활동 행이 하나도 없는 설치도 행을 만든다.
  //   빼면 "다운로드는 했는데 한 번도 안 쓴 사람" 이 통째로 사라지고, 그건 정확히
  //   활성화 퍼널에서 봐야 할 모수다. 실측(2026-08-21)에서 어트리뷰션 550건 대비
  //   최근 활동 설치는 8개였다 — 조용히 빼면 퍼널 분모가 8이 된다.
  //   (계정축에서 "결제만 있고 사용 없는 계정" 을 남기는 것과 같은 원칙이다.)
  for (const key of firstTouch.keys()) {
    if (acc.has(key)) continue;
    acc.set(key, {
      key,
      idScheme: classifyIdScheme(key),
      activeDays: [],
      presentOnlyDays: 0,
      observedDays: 0,
      tokensInput: 0,
      tokensOutput: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      models: new Map(),
      errors: new Map(),
      lastVersionDay: null,
      lastVersion: null,
    });
  }

  const out: InstallProfileRow[] = [];
  for (const a of acc.values()) {
    const activeDays = Array.from(new Set(a.activeDays)).sort((x, y) => x - y);
    const activeSet = new Set(activeDays);
    const firstNum = activeDays.length > 0 ? activeDays[0] : null;
    const lastNum =
      activeDays.length > 0 ? activeDays[activeDays.length - 1] : null;
    const { max: maxStreak, last: lastRun } = streaksOf(activeDays);
    const daysSinceLastActive =
      lastNum != null && todayNum != null ? todayNum - lastNum : null;
    // 끊긴 연속을 "현재 연속" 이라 부르지 않는다. 부분 집계된 오늘 때문에
    // 어제까지는 살아 있는 것으로 본다(adminAnalytics 와 같은 규칙).
    const currentStreak =
      daysSinceLastActive != null && daysSinceLastActive <= 1 ? lastRun : 0;

    const horizons = new Map<ProfileHorizonKey, InstallHorizon>();
    for (const { key, days } of PROFILE_HORIZONS) {
      if (firstNum == null || todayNum == null || todayNum - firstNum < days) {
        // ★관측창 미도달(또는 활동 0) → 판정 불가. 분모에서 뺀다.
        horizons.set(key, {
          key,
          days,
          pending: true,
          exact: null,
          window: null,
        });
        continue;
      }
      let inWindow = false;
      for (let d = firstNum + 1; d <= firstNum + days; d += 1) {
        if (activeSet.has(d)) {
          inWindow = true;
          break;
        }
      }
      horizons.set(key, {
        key,
        days,
        pending: false,
        exact: activeSet.has(firstNum + days),
        window: inWindow,
      });
    }
    const h = (k: ProfileHorizonKey): InstallHorizon =>
      horizons.get(k) ?? {
        key: k,
        days: 0,
        pending: true,
        exact: null,
        window: null,
      };

    const totalCalls = Array.from(a.models.values()).reduce((s, n) => s + n, 0);
    const modelMix: ModelMixEntry[] = rankCounts(a.models).map(
      ({ key, count }) => ({
        model: key,
        calls: count,
        share: totalCalls > 0 ? count / totalCalls : null,
      })
    );

    const attempted = a.tasksCompleted + a.tasksFailed;
    const success = countedRate(a.tasksCompleted, attempted);

    const ft = firstTouch.get(a.key);
    const ms = milestones.get(a.key);
    // 첫 실행: 이정표 이벤트가 우선, 없으면 어트리뷰션 링크 시각.
    const msRun = ms?.run ?? null;
    const ftLinked = ft == null ? null : nullableStr(ft.linkedAt);
    const firstRunAt = earliest(msRun, ftLinked);
    // ★출처를 남긴다. 같은 컬럼에 인증 경로(event)와 미인증 경로(attribution)의
    //   값이 섞여 들어오는데, 그 둘은 분자 자격이 다르다.
    const firstActiveDay = firstNum == null ? null : dayString(firstNum);
    const firstRunSource: FirstRunSource =
      firstRunAt == null
        ? firstActiveDay == null
          ? null
          : "activity"
        : msRun != null && (ftLinked == null || msRun <= ftLinked)
          ? "event"
          : "attribution";
    // ★cohort_day 는 시각을 지어내지 않는다 — 시각이 없으면 첫 활동일을 쓴다.
    const cohortDay =
      firstRunAt != null ? firstRunAt.slice(0, 10) : firstActiveDay;

    // ★분자 자격. 인증 텔레메트리가 한 줄이라도 있어야 first_spawn_at 이
    //   존재할 수 있다(ACTIVATION_OBSERVABLE_DEFINITION).
    const activationObservable = a.observedDays > 0;

    const gaKey = ft == null ? null : nullableStr(ft.gaKey);
    const browserCount = gaKey == null ? null : (browserInstalls.get(gaKey) ?? 1);
    const buildChannel = ft == null ? null : nullableStr(ft.buildChannel);
    const installClass: InstallClass =
      buildChannel === "dev"
        ? "dev_tagged"
        : browserCount != null && browserCount >= REINSTALL_LOOP_MIN_INSTALLS
          ? "reinstall_loop"
          : gaKey != null
            ? "distinct"
            : "unknown";

    out.push({
      install_key: a.key,
      id_scheme: a.idScheme,

      ga_key: gaKey,
      ft_utm_source: ft == null ? null : nullableStr(ft.utmSource),
      ft_utm_medium: ft == null ? null : nullableStr(ft.utmMedium),
      ft_utm_campaign: ft == null ? null : nullableStr(ft.utmCampaign),
      ft_referrer_host: ft == null ? null : nullableStr(ft.referrerHost),
      ft_landing_path: ft == null ? null : nullableStr(ft.landingPath),
      ft_link_source: ft == null ? null : nullableStr(ft.linkSource),
      ft_platform: ft == null ? null : nullableStr(ft.platform),
      ft_build_channel: buildChannel,

      first_visit_at: ft == null ? null : nullableStr(ft.firstVisitAt),
      first_run_at: firstRunAt,
      first_run_source: firstRunSource,
      first_spawn_at: ms?.spawn ?? null,
      first_completed_at: ms?.done ?? null,
      first_active_day: firstActiveDay,
      last_active_day: lastNum == null ? null : dayString(lastNum),
      cohort_day: cohortDay,

      activation_observable: activationObservable,
      ft_browser_installs: browserCount,
      install_class: installClass,

      observed_days: a.observedDays,
      active_days: activeDays.length,
      present_only_days: a.presentOnlyDays,
      max_streak: maxStreak,
      current_streak: currentStreak,
      days_since_last_active: daysSinceLastActive,
      // ★활동일이 0 인데 하트비트만 온 설치 = 좀비. 코호트 제외는 이 플래그가
      //   아니라 활동 정의 자체가 한다(first_active_day 가 null 이라 pending).
      zombie: activeDays.length === 0 && a.presentOnlyDays > 0,

      d1_exact: h("d1").exact,
      d1_window: h("d1").window,
      d1_pending: h("d1").pending,
      d3_exact: h("d3").exact,
      d3_window: h("d3").window,
      d3_pending: h("d3").pending,
      d7_exact: h("d7").exact,
      d7_window: h("d7").window,
      d7_pending: h("d7").pending,
      d14_exact: h("d14").exact,
      d14_window: h("d14").window,
      d14_pending: h("d14").pending,
      d30_exact: h("d30").exact,
      d30_window: h("d30").window,
      d30_pending: h("d30").pending,

      tokens_input: a.tokensInput,
      tokens_output: a.tokensOutput,
      tokens_total: a.tokensInput + a.tokensOutput,
      model_mix: modelMix,

      tasks_completed: a.tasksCompleted,
      tasks_failed: a.tasksFailed,
      tasks_attempted: attempted,
      success_rate: success.rate,
      success_display: success.display,
      top_errors: rankCounts(a.errors, topErrorLimit).map(({ key, count }) => ({
        category: key,
        count,
      })),

      app_version: a.lastVersion,
    });
  }

  out.sort((x, y) => x.install_key.localeCompare(y.install_key));
  return out;
}

// ── ★분자·분모 롤업 ─────────────────────────────────────────────────────────
// 프로필은 설치 단위 boolean 을 저장한다. 화면이 "1/2 (50.0%)" 를 그리려면
// 누군가 분자·분모를 세야 하는데, 그걸 화면이 각자 SQL 로 세게 두면 정의가
// 갈라진다. 그래서 여기 한 곳에서 센다(adminAnalytics.countedRate 재사용).

export type InstallRetentionSummaryHorizon = {
  key: ProfileHorizonKey;
  days: number;
  /** 판정 불가(관측창 미도달)로 분모에서 뺀 설치 수. */
  pending: number;
  exact: RetentionCountedRate;
  window: RetentionCountedRate;
};

export type InstallRetentionSummary = {
  /** 프로필 전체 설치 수(좀비·무활동 포함). */
  installsObserved: number;
  /**
   * ★활동일이 0인 설치 수 = 코호트에 못 들어간 전부.
   * 아래 둘의 합이다. 왜 나누냐 하면 **원인이 다르기 때문**이다 —
   * 좀비는 프로세스가 떠 있던 것이고, neverRan 은 사람이 안 온 것이다.
   */
  installsNeverActive: number;
  /** 하트비트는 왔는데 working·이벤트가 0 인 설치(떠 있던 프로세스). */
  installsZombie: number;
  /** 어트리뷰션만 있고 활동 신호가 아예 없는 설치(다운로드 후 미실행). */
  installsNeverRan: number;
  /** 첫 활동일이 있어 코호트에 들어간 설치 수. ★모든 분모의 뿌리. */
  installsCohort: number;
  horizons: InstallRetentionSummaryHorizon[];
  activityDefinition: string;
  presentOnlyDefinition: string;
  horizonDefinitions: string;
  notes: string[];
};

/** 설치 프로필 배열 → 지평별 분자/분모. */
export function summarizeInstallRetention(
  profiles: ReadonlyArray<InstallProfileRow>
): InstallRetentionSummary {
  const cohort = profiles.filter((p) => p.first_active_day != null);
  const pick = (
    p: InstallProfileRow,
    key: ProfileHorizonKey
  ): { pending: boolean; exact: boolean | null; window: boolean | null } => {
    switch (key) {
      case "d1":
        return {
          pending: p.d1_pending,
          exact: p.d1_exact,
          window: p.d1_window,
        };
      case "d3":
        return {
          pending: p.d3_pending,
          exact: p.d3_exact,
          window: p.d3_window,
        };
      case "d7":
        return {
          pending: p.d7_pending,
          exact: p.d7_exact,
          window: p.d7_window,
        };
      case "d14":
        return {
          pending: p.d14_pending,
          exact: p.d14_exact,
          window: p.d14_window,
        };
      case "d30":
        return {
          pending: p.d30_pending,
          exact: p.d30_exact,
          window: p.d30_window,
        };
    }
  };

  const horizons = PROFILE_HORIZONS.map(({ key, days }) => {
    let pending = 0;
    let exactNum = 0;
    let exactDen = 0;
    let windowNum = 0;
    let windowDen = 0;
    for (const p of cohort) {
      const v = pick(p, key);
      if (v.pending) {
        pending += 1;
        continue;
      }
      exactDen += 1;
      windowDen += 1;
      if (v.exact === true) exactNum += 1;
      if (v.window === true) windowNum += 1;
    }
    return {
      key,
      days,
      pending,
      exact: countedRate(exactNum, exactDen),
      window: countedRate(windowNum, windowDen),
    };
  });

  return {
    installsObserved: profiles.length,
    installsNeverActive: profiles.filter((p) => p.first_active_day == null)
      .length,
    installsZombie: profiles.filter((p) => p.zombie).length,
    installsNeverRan: profiles.filter(
      (p) => p.first_active_day == null && !p.zombie
    ).length,
    installsCohort: cohort.length,
    horizons,
    activityDefinition: ACTIVITY_DEFINITION,
    presentOnlyDefinition: PRESENT_ONLY_DEFINITION,
    horizonDefinitions: HORIZON_DEFINITIONS,
    notes: [
      "★비율은 절대 홀로 읽지 마라. 유의미 사용 표본이 지금 한 자릿수라 " +
        "퍼센트만 보면 실제보다 훨씬 강한 결론이 된다 — 분모 0 은 0% 가 아니라 " +
        "'—'(판단 불가)다.",
      "exact 와 window 를 둘 다 낸다. 어느 쪽을 인용하는지 반드시 같이 말해라.",
      ID_SCHEME_NOTE,
      "이 축에는 is_admin 이 없다 — 익명축이라 운영자 자기제외가 구조적으로 " +
        "불가능하다. 그만큼 운영자 도그푸드 쪽으로 낙관 편향될 수 있다.",
    ],
  };
}

// ── ★활성화(첫 실행 → 첫 스폰) 분자·분모 ─────────────────────────────────
// 이 비율을 화면마다 각자 SQL 로 세면 정의가 갈라지고, 실제로 갈라졌다.
// 여기 한 곳에서 센다 — 그리고 **비율만 돌려주지 않는다.** 분모에서 무엇을
// 왜 뺐는지까지 같이 돌려준다(뺀 사실을 숨기면 그게 다음 3.1% 다).

export type FirstSpawnActivationSummary = {
  /** 코호트 창에 들어온 프로필 행 수(아무것도 안 뺀 값). */
  installsRaw: number;
  /** 그 중 인증 텔레메트리가 있어 분자를 가질 **수 있는** 행 수. */
  installsObservable: number;
  /** 분모에서 뺀 사유별 건수. 합이 installsRaw - installsObservable 이다. */
  excludedNoTelemetry: number;
  /** 참고용 — dev 로 태깅된 행(분모에서 별도로 뺀다). */
  excludedDevTagged: number;
  /** 참고용 — 같은 브라우저가 만든 재설치 루프 행. */
  excludedReinstallLoop: number;
  /** 고유 브라우저 수(ga_key). ga_key 가 없는 행은 각자 1로 센다. */
  distinctBrowsers: number;
  /** 분자 — first_spawn_at 이 있는 행 수(분모와 같은 모집단에서만 센다). */
  spawned: number;
  /** spawned / installsObservable. 분모 0 이면 null(0% 가 아니다). */
  rate: number | null;
  /** "1/3 (33.3%)" 꼴. 분모 0 이면 "—". */
  display: string;
  notes: string[];
};

export type FirstSpawnActivationOptions = {
  /** cohort_day >= 이 날(포함). 없으면 하한 없음. */
  cohortFrom?: string | null;
  /** cohort_day <= 이 날(포함). 없으면 상한 없음. */
  cohortTo?: string | null;
  /** dev 태깅 행을 분모에서 뺀다(기본 true). */
  excludeDevTagged?: boolean;
  /** 재설치 루프 행을 분모에서 뺀다(기본 true). */
  excludeReinstallLoop?: boolean;
};

/**
 * 첫 실행 → 첫 스폰 활성화율. ★분모는 `activation_observable` 인 행만이다.
 *
 * 왜 그래야 하나는 파일 상단 "활성화 분자·분모의 모집단 규약" 에 있다. 요지는
 * 하나다 — 어트리뷰션만 있는 행은 first_spawn_at 을 가질 자격이 없으므로,
 * 분모에 넣으면 비율이 설계상 0 으로 수렴한다.
 */
export function summarizeFirstSpawnActivation(
  profiles: ReadonlyArray<InstallProfileRow>,
  options: FirstSpawnActivationOptions = {}
): FirstSpawnActivationSummary {
  const from = options.cohortFrom ?? null;
  const to = options.cohortTo ?? null;
  const excludeDev = options.excludeDevTagged !== false;
  const excludeLoop = options.excludeReinstallLoop !== false;

  const inWindow = profiles.filter((p) => {
    if (p.cohort_day == null) return false;
    if (from != null && p.cohort_day < from) return false;
    if (to != null && p.cohort_day > to) return false;
    return true;
  });

  const devTagged = inWindow.filter((p) => p.install_class === "dev_tagged");
  const loop = inWindow.filter((p) => p.install_class === "reinstall_loop");
  const denom = inWindow.filter((p) => {
    if (!p.activation_observable) return false;
    if (excludeDev && p.install_class === "dev_tagged") return false;
    if (excludeLoop && p.install_class === "reinstall_loop") return false;
    return true;
  });
  const spawned = denom.filter((p) => p.first_spawn_at != null).length;
  const counted = countedRate(spawned, denom.length);

  const browsers = new Set<string>();
  for (const p of inWindow) browsers.add(p.ga_key ?? `install:${p.install_key}`);

  const notes: string[] = [
    ACTIVATION_OBSERVABLE_DEFINITION,
    COHORT_DAY_DEFINITION,
  ];
  const unobservable = inWindow.filter((p) => !p.activation_observable).length;
  if (unobservable > 0) {
    notes.push(
      `★분모에서 ${unobservable}행을 뺐다 — 인증 텔레메트리가 0이라 ` +
        "first_spawn_at 이 존재할 수 없는 행이다. 이 행들을 분모에 넣으면 " +
        "비율이 '사람이 안 썼다' 가 아니라 '측정이 안 된다' 를 뜻하게 된다."
    );
  }
  if (inWindow.length > 0 && browsers.size * REINSTALL_LOOP_MIN_INSTALLS <= inWindow.length) {
    notes.push(
      `★분모 위생 경보 — 설치 ${inWindow.length}행이 브라우저 ${browsers.size}개에서 ` +
        "나왔다. 사람 수가 아니라 재설치 루프를 세고 있을 가능성이 높다."
    );
  }
  if (denom.length > 0 && denom.length < 10) {
    notes.push(
      `★모수 ${denom.length}. 퍼센트로 인용하지 마라 — 한 건이 비율을 ` +
        `${(100 / denom.length).toFixed(0)}%p 움직인다.`
    );
  }

  return {
    installsRaw: inWindow.length,
    installsObservable: inWindow.filter((p) => p.activation_observable).length,
    excludedNoTelemetry: unobservable,
    excludedDevTagged: devTagged.length,
    excludedReinstallLoop: loop.length,
    distinctBrowsers: browsers.size,
    spawned,
    rate: counted.rate,
    display: counted.display,
    notes,
  };
}

// ── ★주차 커버리지 접기 (analyticsCoverageGuard 의 입력) ────────────────────

/**
 * 'YYYY-MM-DD' → 그 주의 월요일 'YYYY-MM-DD'.
 *
 * ★날짜를 **달력 날짜 그대로** 다룬다(시간대 변환 없음). cohort_day 는 이미
 *   날짜이고, 여기서 다시 시간대를 태우면 경계 하루가 소리 없이 움직인다.
 */
export function weekStartMonday(day: string): string | null {
  const n = dayNumber(day);
  if (n == null) return null;
  // dayNumber 는 1970-01-01 기준 일련번호이고 1970-01-01 은 목요일이다.
  // (n + 3) % 7 이 0 이면 월요일.
  const offset = ((n + 3) % 7 + 7) % 7;
  return dayString(n - offset);
}

/** 커버리지 검사에 넣을 주차별 파생측 실측(원천측 eventKeys 는 호출측이 채운다). */
export type WeeklyProfileCoverage = {
  week: string;
  cohortInstalls: number;
  observableInstalls: number;
  filledInstalls: number;
  distinctBrowsers: number;
};

/**
 * 프로필 행 → 주차별 (코호트 / 관측가능 / 채워짐 / 고유 브라우저).
 *
 * `pick` 은 검사 대상 컬럼을 고르는 함수다 — first_spawn_at 뿐 아니라
 * first_completed_at 같은 다른 이정표에도 같은 검사를 걸 수 있게 열어 둔다.
 */
export function foldWeeklyProfileCoverage(
  profiles: ReadonlyArray<InstallProfileRow>,
  pick: (row: InstallProfileRow) => string | null
): WeeklyProfileCoverage[] {
  const acc = new Map<
    string,
    { cohort: number; observable: number; filled: number; browsers: Set<string> }
  >();
  for (const p of profiles) {
    if (p.cohort_day == null) continue;
    const week = weekStartMonday(p.cohort_day);
    if (week == null) continue;
    let a = acc.get(week);
    if (!a) {
      a = { cohort: 0, observable: 0, filled: 0, browsers: new Set() };
      acc.set(week, a);
    }
    a.cohort += 1;
    if (p.activation_observable) a.observable += 1;
    if (pick(p) != null) a.filled += 1;
    // ga_key 가 없는 행은 브라우저를 모르는 것이지 같은 브라우저가 아니다 —
    // 각자 1로 센다(모르는 것을 중복으로 접으면 부풀림을 은폐한다).
    a.browsers.add(p.ga_key ?? `install:${p.install_key}`);
  }
  return Array.from(acc.entries())
    .map(([week, a]) => ({
      week,
      cohortInstalls: a.cohort,
      observableInstalls: a.observable,
      filledInstalls: a.filled,
      distinctBrowsers: a.browsers.size,
    }))
    .sort((x, y) => x.week.localeCompare(y.week));
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) analytics_account_profile — 계정축(계정당 1행)
// ═══════════════════════════════════════════════════════════════════════════
//
// ★이 테이블에는 install_key 도, ga_key 도, 설치 라벨도 없다. 계정축 안에서만
//   조인한다(cost_logs / analytics_purchase). 방침이 허용하는 범위가 딱 거기다.
//
// ★캐시 지표가 여기 있는 이유: cacheReadTokens/cacheWriteTokens 는 cost_logs
//   에만 존재한다(index.ts 의 모든 캐시 집계가 cost_logs 기준). 익명 테이블에는
//   캐시 컬럼 자체가 없어서, install_profile 에 cache_hit_rate 를 두려면
//   cost_logs 를 설치 축으로 끌어와야 하고 그게 정확히 금지된 다리다.

/** cost_logs 를 계정×모델로 접은 한 줄. */
export type AccountCostRow = {
  /** 계정 uid. ★이 축에서만 허용된다. */
  userKey?: unknown;
  model?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
  totalCost?: unknown;
  calls?: unknown;
  /** 'YYYY-MM-DD'. 활동일 수·첫/마지막 사용일 계산용. */
  day?: unknown;
};

/** 구매·구독에서 온 계정 한 줄(analytics_purchase / Firestore subscriptions). */
export type AccountBillingRow = {
  userKey?: unknown;
  firstPaidAt?: unknown;
  plan?: unknown;
  mrrUsd?: unknown;
  ltvUsd?: unknown;
};

export type AccountProfileInput = {
  costs: ReadonlyArray<AccountCostRow>;
  billing?: ReadonlyArray<AccountBillingRow>;
  /**
   * 운영자 uid. `ADMIN_UID`(index.ts requireAdmin) 를 그대로 넘긴다 —
   * ★새 운영자 판정 규약을 만들지 마라. 기존 includeAdmin 토글이 이 열을
   * 필터로 쓴다.
   */
  adminUid?: string | null;
};

export type AccountProfileRow = {
  user_key: string;
  is_admin: boolean;

  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;

  /**
   * ★분자·분모를 그대로 저장한다.
   * 분자 = cache_read_tokens, 분모 = input_tokens + cache_read_tokens
   * (프롬프트로 들어간 토큰 중 캐시에서 읽힌 비율. 출력·캐시쓰기는 분모가 아니다.)
   */
  cache_hit_numerator: number;
  cache_hit_denominator: number;
  /** 분모 0 이면 null — 0% 가 아니다. */
  cache_hit_rate: number | null;
  cache_hit_display: string;

  model_mix: ModelMixEntry[];

  first_cost_at: string | null;
  last_cost_at: string | null;
  /** 과금 호출이 있던 날 수(계정축의 "활동일"). */
  cost_days: number;

  first_paid_at: string | null;
  plan: string | null;
  mrr_usd: number | null;
  ltv_usd: number | null;
};

/** cost_logs(+구매) → analytics_account_profile 행. */
export function buildAccountProfileRows(
  input: AccountProfileInput
): AccountProfileRow[] {
  const adminUid = (input.adminUid ?? "").trim();

  type Acc = {
    key: string;
    cost: number;
    inTok: number;
    outTok: number;
    cacheRead: number;
    cacheWrite: number;
    models: Map<string, number>;
    days: Set<string>;
    firstDay: string | null;
    lastDay: string | null;
  };
  const acc = new Map<string, Acc>();

  for (const row of input.costs) {
    const key = str(row.userKey, "");
    if (key === "") continue;
    let a = acc.get(key);
    if (!a) {
      a = {
        key,
        cost: 0,
        inTok: 0,
        outTok: 0,
        cacheRead: 0,
        cacheWrite: 0,
        models: new Map(),
        days: new Set(),
        firstDay: null,
        lastDay: null,
      };
      acc.set(key, a);
    }
    a.cost += coerceNumber(row.totalCost);
    a.inTok += coerceNumber(row.inputTokens);
    a.outTok += coerceNumber(row.outputTokens);
    a.cacheRead += coerceNumber(row.cacheReadTokens);
    a.cacheWrite += coerceNumber(row.cacheWriteTokens);
    const model = nullableStr(row.model);
    if (model != null) {
      // calls 가 안 오면 행 1건을 1콜로 센다.
      const calls = Math.max(1, coerceNumber(row.calls));
      a.models.set(model, (a.models.get(model) ?? 0) + calls);
    }
    const day = nullableStr(row.day);
    if (day != null && dayNumber(day) != null) {
      a.days.add(day);
      a.firstDay = earliest(a.firstDay, day);
      a.lastDay = latest(a.lastDay, day);
    }
  }

  const billing = new Map<string, AccountBillingRow>();
  for (const row of input.billing ?? []) {
    const key = str(row.userKey, "");
    if (key === "") continue;
    const prev = billing.get(key);
    if (prev == null) {
      billing.set(key, row);
      continue;
    }
    // 중복이 오면 first_paid_at 이 이른 쪽을 남긴다.
    const a = nullableStr(prev.firstPaidAt);
    const b = nullableStr(row.firstPaidAt);
    if (a == null || (b != null && b < a)) billing.set(key, row);
  }
  // ★결제만 있고 사용 기록이 없는 계정도 행을 만든다 — 조용히 빼면 유료 인원이
  //   줄어 보인다(그 계정이 정확히 우리가 봐야 할 계정이다).
  for (const key of billing.keys()) {
    if (!acc.has(key)) {
      acc.set(key, {
        key,
        cost: 0,
        inTok: 0,
        outTok: 0,
        cacheRead: 0,
        cacheWrite: 0,
        models: new Map(),
        days: new Set(),
        firstDay: null,
        lastDay: null,
      });
    }
  }

  const out: AccountProfileRow[] = [];
  for (const a of acc.values()) {
    const cacheDen = a.inTok + a.cacheRead;
    const cache = countedRate(a.cacheRead, cacheDen);
    const totalCalls = Array.from(a.models.values()).reduce((s, n) => s + n, 0);
    const b = billing.get(a.key);
    // 값이 아예 없으면 null 을 남긴다 — 0 으로 채우면 "무료 사용자" 와
    // "아직 모르는 계정" 이 같은 숫자가 된다.
    const mrr = b == null || b.mrrUsd == null ? null : coerceNumber(b.mrrUsd);
    const ltv = b == null || b.ltvUsd == null ? null : coerceNumber(b.ltvUsd);
    out.push({
      user_key: a.key,
      is_admin: adminUid !== "" && a.key === adminUid,

      total_cost_usd: a.cost,
      input_tokens: a.inTok,
      output_tokens: a.outTok,
      cache_read_tokens: a.cacheRead,
      cache_write_tokens: a.cacheWrite,
      total_tokens: a.inTok + a.outTok + a.cacheRead + a.cacheWrite,

      cache_hit_numerator: a.cacheRead,
      cache_hit_denominator: cacheDen,
      cache_hit_rate: cache.rate,
      cache_hit_display: cache.display,

      model_mix: rankCounts(a.models).map(({ key, count }) => ({
        model: key,
        calls: count,
        share: totalCalls > 0 ? count / totalCalls : null,
      })),

      first_cost_at: a.firstDay,
      last_cost_at: a.lastDay,
      cost_days: a.days.size,

      first_paid_at: b == null ? null : nullableStr(b.firstPaidAt),
      plan: b == null ? null : nullableStr(b.plan),
      mrr_usd: mrr,
      ltv_usd: ltv,
    });
  }

  out.sort((x, y) => x.user_key.localeCompare(y.user_key));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// BigQuery 스키마 상수 (installAttribution.ts 의 SCHEMA 규약)
// ═══════════════════════════════════════════════════════════════════════════
//
// ★description 에 정의를 박아 둔다. 테이블만 보고 들어온 사람이 코드를 안 열어도
//   "active 가 뭔지 / D7 이 어느 정의인지" 를 BQ 콘솔에서 바로 읽게 하기 위해서다.

export type BqField = {
  name: string;
  type: string;
  mode: string;
  description?: string;
  fields?: ReadonlyArray<BqField>;
};

export const USER_DAILY_SCHEMA: ReadonlyArray<BqField> = [
  {
    name: "install_key",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "익명 설치 축 키. ★계정 uid 가 아니다. 이 테이블은 계정축과 조인하지 않는다.",
  },
  { name: "day", type: "DATE", mode: "REQUIRED" },
  {
    name: "active",
    type: "BOOL",
    mode: "REQUIRED",
    description: ACTIVITY_DEFINITION,
  },
  {
    name: "present_only",
    type: "BOOL",
    mode: "REQUIRED",
    description: PRESENT_ONLY_DEFINITION,
  },
  { name: "working_beats", type: "INT64", mode: "NULLABLE" },
  {
    name: "presence_beats",
    type: "INT64",
    mode: "NULLABLE",
    description: "전체 하트비트 수. ★이 값이 크다고 활동이 아니다.",
  },
  { name: "event_count", type: "INT64", mode: "NULLABLE" },
  { name: "tokens_input", type: "INT64", mode: "NULLABLE" },
  { name: "tokens_output", type: "INT64", mode: "NULLABLE" },
  { name: "tokens_total", type: "INT64", mode: "NULLABLE" },
  { name: "app_version", type: "STRING", mode: "NULLABLE" },
  { name: "tasks_completed", type: "INT64", mode: "NULLABLE" },
  { name: "tasks_failed", type: "INT64", mode: "NULLABLE" },
  {
    name: "models",
    type: "RECORD",
    mode: "REPEATED",
    description:
      "모델별 호출 수. ★cost 필드를 추가하지 마라 — 달러 금액은 계정축이다.",
    fields: [
      { name: "model", type: "STRING", mode: "NULLABLE" },
      { name: "calls", type: "INT64", mode: "NULLABLE" },
    ],
  },
  { name: "roles", type: "STRING", mode: "REPEATED" },
  { name: "task_types", type: "STRING", mode: "REPEATED" },
  {
    name: "error_categories",
    type: "RECORD",
    mode: "REPEATED",
    fields: [
      { name: "category", type: "STRING", mode: "NULLABLE" },
      { name: "count", type: "INT64", mode: "NULLABLE" },
    ],
  },
  {
    name: "id_scheme",
    type: "STRING",
    mode: "NULLABLE",
    description: ID_SCHEME_NOTE,
  },
  {
    name: "install_key_hmac",
    type: "STRING",
    mode: "NULLABLE",
    description:
      "in_ + HMAC(salt, 'install:' + raw install_key). ★기존 install_key(raw)는 " +
      "보존하고, 사람 축 링크표/identity 와 조인할 때만 이 컬럼을 쓴다. " +
      "소급 재작성은 하지 않으므로 과거 행은 NULL 일 수 있다.",
  },
  { name: "built_at", type: "TIMESTAMP", mode: "NULLABLE" },
];

const HORIZON_FIELDS: ReadonlyArray<BqField> = PROFILE_HORIZONS.flatMap(
  ({ key, days }) => [
    {
      name: `${key}_exact`,
      type: "BOOL",
      mode: "NULLABLE",
      description: `D${days} · ${HORIZON_DEFINITION_EXACT}`,
    },
    {
      name: `${key}_window`,
      type: "BOOL",
      mode: "NULLABLE",
      description: `D${days} · ${HORIZON_DEFINITION_WINDOW}`,
    },
    {
      name: `${key}_pending`,
      type: "BOOL",
      mode: "NULLABLE",
      description: `D${days} · ${HORIZON_DEFINITION_PENDING}`,
    },
  ]
);

export const INSTALL_PROFILE_SCHEMA: ReadonlyArray<BqField> = [
  {
    name: "install_key",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "익명 설치 축 키. ★이 테이블에 user_key/uid/이메일을 추가하지 마라 — " +
      "그 순간 처리방침이 없다고 고지한 조인 키가 생긴다(privacyContent.tsx:95/210).",
  },
  {
    name: "id_scheme",
    type: "STRING",
    mode: "NULLABLE",
    description: ID_SCHEME_NOTE,
  },
  {
    name: "ga_key",
    type: "STRING",
    mode: "NULLABLE",
    description: "GA4 client id — 익명 웹축 키. 계정축 키가 아니다.",
  },
  { name: "ft_utm_source", type: "STRING", mode: "NULLABLE" },
  { name: "ft_utm_medium", type: "STRING", mode: "NULLABLE" },
  { name: "ft_utm_campaign", type: "STRING", mode: "NULLABLE" },
  { name: "ft_referrer_host", type: "STRING", mode: "NULLABLE" },
  { name: "ft_landing_path", type: "STRING", mode: "NULLABLE" },
  { name: "ft_link_source", type: "STRING", mode: "NULLABLE" },
  { name: "ft_platform", type: "STRING", mode: "NULLABLE" },
  { name: "ft_build_channel", type: "STRING", mode: "NULLABLE" },
  { name: "first_visit_at", type: "TIMESTAMP", mode: "NULLABLE" },
  {
    name: "first_run_at",
    type: "TIMESTAMP",
    mode: "NULLABLE",
    description:
      "★출처가 두 개다(이벤트 · 어트리뷰션) — first_run_source 를 같이 읽어라. " +
      "출처를 무시하고 세면 미인증 설치가 분모에 섞인다.",
  },
  {
    name: "first_run_source",
    type: "STRING",
    mode: "NULLABLE",
    description: FIRST_RUN_SOURCE_DEFINITION,
  },
  { name: "first_spawn_at", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "first_completed_at", type: "TIMESTAMP", mode: "NULLABLE" },
  {
    name: "first_active_day",
    type: "DATE",
    mode: "NULLABLE",
    description:
      "★리텐션 day 0. 가입일도 첫 하트비트일도 아니라 활동 정의를 충족한 첫 날이다.",
  },
  { name: "last_active_day", type: "DATE", mode: "NULLABLE" },
  {
    name: "cohort_day",
    type: "DATE",
    mode: "NULLABLE",
    description: COHORT_DAY_DEFINITION,
  },
  {
    name: "activation_observable",
    type: "BOOL",
    mode: "NULLABLE",
    description: ACTIVATION_OBSERVABLE_DEFINITION,
  },
  {
    name: "ft_browser_installs",
    type: "INT64",
    mode: "NULLABLE",
    description:
      "같은 ga_key(브라우저)를 공유하는 설치 수. ★분모 중복 축이다 — " +
      "2026-08-24 실측에서 631 '설치' 의 고유 브라우저는 5개였다.",
  },
  {
    name: "install_class",
    type: "STRING",
    mode: "NULLABLE",
    description: INSTALL_CLASS_DEFINITION,
  },
  { name: "observed_days", type: "INT64", mode: "NULLABLE" },
  {
    name: "active_days",
    type: "INT64",
    mode: "NULLABLE",
    description: ACTIVITY_DEFINITION,
  },
  {
    name: "present_only_days",
    type: "INT64",
    mode: "NULLABLE",
    description: PRESENT_ONLY_DEFINITION,
  },
  { name: "max_streak", type: "INT64", mode: "NULLABLE" },
  { name: "current_streak", type: "INT64", mode: "NULLABLE" },
  { name: "days_since_last_active", type: "INT64", mode: "NULLABLE" },
  { name: "zombie", type: "BOOL", mode: "NULLABLE" },
  ...HORIZON_FIELDS,
  { name: "tokens_input", type: "INT64", mode: "NULLABLE" },
  { name: "tokens_output", type: "INT64", mode: "NULLABLE" },
  { name: "tokens_total", type: "INT64", mode: "NULLABLE" },
  {
    name: "model_mix",
    type: "RECORD",
    mode: "REPEATED",
    description:
      "★비용 없음. 캐시 지표도 없음 — cacheRead/Write 는 cost_logs(계정축)에만 " +
      "존재한다. 여기에 만들려고 cost_logs 를 끌어오지 마라.",
    fields: [
      { name: "model", type: "STRING", mode: "NULLABLE" },
      { name: "calls", type: "INT64", mode: "NULLABLE" },
      { name: "share", type: "FLOAT64", mode: "NULLABLE" },
    ],
  },
  { name: "tasks_completed", type: "INT64", mode: "NULLABLE" },
  { name: "tasks_failed", type: "INT64", mode: "NULLABLE" },
  {
    name: "tasks_attempted",
    type: "INT64",
    mode: "NULLABLE",
    description:
      "★success_rate 의 분모. 비율만 저장하지 않는다 — 화면이 '1/2 (50.0%)' 를 " +
      "그릴 수 있어야 한다.",
  },
  {
    name: "success_rate",
    type: "FLOAT64",
    mode: "NULLABLE",
    description: "분모 0 이면 NULL. 0% 가 아니라 '판단 불가'다.",
  },
  { name: "success_display", type: "STRING", mode: "NULLABLE" },
  {
    name: "top_errors",
    type: "RECORD",
    mode: "REPEATED",
    fields: [
      { name: "category", type: "STRING", mode: "NULLABLE" },
      { name: "count", type: "INT64", mode: "NULLABLE" },
    ],
  },
  { name: "app_version", type: "STRING", mode: "NULLABLE" },
  { name: "built_at", type: "TIMESTAMP", mode: "NULLABLE" },
];

export const ACCOUNT_PROFILE_SCHEMA: ReadonlyArray<BqField> = [
  {
    name: "user_key",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "계정 uid. ★이 테이블에 install_key/ga_key 를 추가하지 마라 — 익명축과 " +
      "잇는 조인 키가 된다(privacyContent.tsx:95/210).",
  },
  {
    name: "is_admin",
    type: "BOOL",
    mode: "NULLABLE",
    description:
      "ADMIN_UID(index.ts requireAdmin) 기준. 기존 includeAdmin 토글이 이 열을 " +
      "필터로 쓴다 — 새 운영자 판정 규약을 만들지 마라.",
  },
  { name: "total_cost_usd", type: "FLOAT64", mode: "NULLABLE" },
  { name: "input_tokens", type: "INT64", mode: "NULLABLE" },
  { name: "output_tokens", type: "INT64", mode: "NULLABLE" },
  {
    name: "cache_read_tokens",
    type: "INT64",
    mode: "NULLABLE",
    description:
      "★캐시 지표가 계정축에 있는 이유: cacheReadTokens/cacheWriteTokens 는 " +
      "cost_logs 에만 존재한다. 익명 테이블(events/task_outcomes/agent_heartbeats)" +
      "에는 캐시 컬럼 자체가 없다.",
  },
  { name: "cache_write_tokens", type: "INT64", mode: "NULLABLE" },
  { name: "total_tokens", type: "INT64", mode: "NULLABLE" },
  {
    name: "cache_hit_numerator",
    type: "INT64",
    mode: "NULLABLE",
    description: "= cache_read_tokens",
  },
  {
    name: "cache_hit_denominator",
    type: "INT64",
    mode: "NULLABLE",
    description: "= input_tokens + cache_read_tokens",
  },
  {
    name: "cache_hit_rate",
    type: "FLOAT64",
    mode: "NULLABLE",
    description: "분모 0 이면 NULL. 0% 가 아니다.",
  },
  { name: "cache_hit_display", type: "STRING", mode: "NULLABLE" },
  {
    name: "model_mix",
    type: "RECORD",
    mode: "REPEATED",
    fields: [
      { name: "model", type: "STRING", mode: "NULLABLE" },
      { name: "calls", type: "INT64", mode: "NULLABLE" },
      { name: "share", type: "FLOAT64", mode: "NULLABLE" },
    ],
  },
  { name: "first_cost_at", type: "DATE", mode: "NULLABLE" },
  { name: "last_cost_at", type: "DATE", mode: "NULLABLE" },
  { name: "cost_days", type: "INT64", mode: "NULLABLE" },
  { name: "first_paid_at", type: "TIMESTAMP", mode: "NULLABLE" },
  { name: "plan", type: "STRING", mode: "NULLABLE" },
  { name: "mrr_usd", type: "FLOAT64", mode: "NULLABLE" },
  { name: "ltv_usd", type: "FLOAT64", mode: "NULLABLE" },
  { name: "built_at", type: "TIMESTAMP", mode: "NULLABLE" },
];

/**
 * ★축 순수성 검사. 주석은 읽히지 않을 수 있으니 기계가 대신 읽는다.
 *
 * 스키마에 반대 축의 컬럼이 들어오면 여기서 던진다. 테스트가 이걸 돌리고,
 * ensure*Table() 도 테이블을 만들기 전에 돌린다 — 잘못된 스키마가 BQ 에
 * **생성되기 전에** 막는 게 요점이다(생성 후엔 컬럼 삭제가 안 된다).
 *
 * 축은 셋이다: 익명축 / 계정축 / 링크축. 링크축(`analytics_user_install`)만
 * 두 키를 한 행에 담을 수 있고, 그래서 목록이 표 하나다 — 잇는 자리가 하나뿐인
 * 것이 "링크표를 지우면 사람 축이 통째로 사라진다" 의 근거다.
 */
export function assertAxisPurity(
  table: string,
  fields: ReadonlyArray<BqField>
): void {
  const forbidden = ANONYMOUS_AXIS_TABLES.includes(table)
    ? FORBIDDEN_ON_ANONYMOUS_AXIS
    : ACCOUNT_AXIS_TABLES.includes(table)
    ? FORBIDDEN_ON_ACCOUNT_AXIS
    : LINK_AXIS_TABLES.includes(table)
    ? FORBIDDEN_ON_LINK_AXIS
    : null;
  if (forbidden == null) {
    throw new Error(
      `[analyticsProfiles] 축이 선언되지 않은 테이블: ${table}. ` +
        "ANONYMOUS_AXIS_TABLES / ACCOUNT_AXIS_TABLES / LINK_AXIS_TABLES 중 " +
        "하나에 등록해라."
    );
  }
  const walk = (fs: ReadonlyArray<BqField>, path: string): void => {
    for (const f of fs) {
      const name = f.name.toLowerCase();
      if (forbidden.includes(name)) {
        throw new Error(
          `[analyticsProfiles] ${table} 에 반대 축 컬럼 '${path}${f.name}' 이 ` +
            "있다. 두 축을 잇는 조인 키를 만들지 마라 — " +
            "v3/src/components/legal/privacyContent.tsx:95/210 참조."
        );
      }
      if (f.fields) walk(f.fields, `${path}${f.name}.`);
    }
  };
  walk(fields, "");
}
