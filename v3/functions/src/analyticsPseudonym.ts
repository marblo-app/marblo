// 익명 세계(events / task_outcomes / agent_heartbeats)에 적히는 조인키 가명화 —
// 순수 로직(BQ/Firebase 무의존). telemetryMetadata.ts 와 같은 규약으로 index.ts
// 에서 떼어내 node --test 로 단위검증한다.
//
// ── ★왜 이 모듈이 있나 (ticket U5OPOKf0D3I2TSRP8yUq) ─────────────────────────
// 처리방침은 제품사용 분석 테이블을 "계정 식별자 없음" 으로 고지한다. 그 문장은
// uid 컬럼만 없애서는 반쪽이었다: cost_logs 는 (userId=계정 uid, projectId,
// agentId, taskId) 를 보관하는데, 익명 세계도 **같은 원시 id** 를 그대로 적재하고
// 있었다. 즉 누구든 두 테이블을 agentId(또는 taskId·projectId)로 조인하면 익명
// 이벤트를 계정으로 되짚을 수 있었다 — uid 를 안 적었을 뿐 재연결은 가능했다.
//
// 여기서 그 다리를 끊는다. 익명 세계에 적히는 조인키는 원시값이 아니라
// **비밀 솔트로 키드된 HMAC 가명**이다. 솔트는 BigQuery 에 없고 함수 런타임 env
// 에만 있으므로, 웨어하우스만 들여다보는 쪽에서는 어떤 컬럼으로도 cost_logs 와
// 조인이 성립하지 않는다.
//
// ── 지키는 것 / 포기한 것 ────────────────────────────────────────────────────
//  - 지킴: 익명 세계 **내부** 조인·집계. 같은 종류(kind)면 같은 변환이라
//    events↔task_outcomes↔agent_heartbeats 는 그대로 이어지고,
//    COUNT(DISTINCT agentId) 같은 지표도 값이 바뀔 뿐 수치는 동등하다.
//  - 지킴: cost_logs 의 계정 연결(본인 Usage 되돌려주기). 그쪽은 손대지 않는다.
//  - 포기: events↔cost_logs 조인이 필요하던 어드민 분석 전부 —
//    운영자 자기제외(resolveAdminClientIds)와 하네스→실모델 비용 분해.
//    betaSegments 의 계정축 은퇴와 같은 방향의 의도적 손실이다.
//
// ── ★fail-safe: 솔트가 없으면 원시값이 아니라 null 을 적는다 ─────────────────
// 솔트 미설정 시 "원시값으로 폴백" 은 조용히 프라이버시 약속을 깨는 길이다.
// 그래서 이 모듈은 솔트가 없으면 조인키를 **버린다**(null). 대신 배포는
// scripts/check-deploy-env.mjs 가 ANALYTICS_ID_SALT 부재로 막고, 런타임도
// 인스턴스당 1회 에러 로그를 남긴다 — 조용한 열화가 아니라 시끄러운 실패다.

// ── ★축 경계 — 지우지 마라 (ticket dTpcKWwRw5DvEMKxpCZi → cZWmTzoOXpHCg9HAUwqw) ─
//
//   익명축  analytics_identity              install_key / ga_key / first_touch
//   계정축  analytics_purchase / cost_logs  user_key / 금액
//   링크축  analytics_user_install          (user_key, install_key) 쌍 ★단 하나
//
// ★2026-08-21 개정: 이 주석은 원래 "두 축은 조인하지 않는다. 조인키를 만들지도
//   않는다" 였다. 사람 축 설계(v3/docs/person-axis-user-key-design-2026-08-21.md,
//   PR #1081)가 그 규칙을 **좁은 예외 하나**로 바꿨다. 지금 참인 문장은 이것이다:
//
//     두 축을 잇는 자리는 `marblo_identity.analytics_user_install` **하나뿐**이고,
//     그 자리는 `PERSON_AXIS_EFFECTIVE_FROM` 게이트가 열려 있을 때만 채워진다.
//
//   ★코드만 고치고 이 주석을 안 고치면 다음 사람이 주석을 믿는다. 그래서 kind
//   `user` 추가와 이 문단은 같은 커밋에 있다.
//
//   근거: 배포된 처리방침 v3/src/components/legal/privacyContent.tsx:127
//         (EN :246) "두 기록이 공유하는 조인 키는 없습니다 /
//         the two share no join key". ★이 문장은 처리방침 개정(PR #1080)에서
//         지운 게 아니라 **범위를 넓혀 유지**했다 — 계정에서 파생한 가명
//         사용자키까지 포함해 저 행의 식별자는 전부 가명이고, 가명을 만드는
//         키(솔트)는 그 데이터가 저장되는 곳에 없다. 그래서 이 문장은 여전히
//         축 경계의 근거다. 처리방침을 손대면 행 번호부터 다시 맞춰라.
//
// ★그래도 바뀌지 않은 것 셋 — 이쪽이 규칙의 본체다.
//
//  1) **익명 테이블에는 여전히 `user_key` 가 없다.** `analytics_identity` 에도,
//     `analytics_user_daily`/`analytics_install_profile` 에도 컬럼 자리조차 없다.
//     실측: agent_heartbeats.userId 는 36자 익명 설치 UUID(고유 14),
//     cost_logs.userId 는 28자 계정 UID(고유 5) — 두 축을 **한 행에** 이으면
//     산출물은 "익명 설치 → 계정" 매핑, 즉 계정 재식별 그 자체다. 같은 salt 로
//     HMAC 해도 조인은 그대로 성립한다(그게 조인의 목적이니까).
//     기계가 대신 읽는다: analyticsProfiles.assertAxisPurity /
//     FORBIDDEN_ON_ANONYMOUS_AXIS.
//  2) **소급은 저장이 아니라 조회로 한다.** 링크는 별도 표에만 있고, 그 표를
//     지우면 **소급이** 그 자리에서 취소된다.
//     ★2026-08-29 정정(ticket VZ0K2FIeASLrWy9bwvN1): 이 자리에는 "이벤트 행에
//     `user_key` 컬럼을 만들지 않는다" 가 함께 적혀 있었다. 지금은 틀린 말이다 —
//     `events` 에 forward-only 각인 컬럼 `userKey` 가 있다
//     (personAxisStamp.ts, 설계 §5.4-b). 바뀌지 않은 것은 **소급**이다: 과거
//     행은 한 줄도 고치지 않았고, 그것들을 사람에게 붙이는 유일한 경로는 여전히
//     링크표다. 각인 값을 되돌리는 것은 buildEventStampEraseSql 이 맡고,
//     삭제요청은 링크표 DELETE 와 **둘 다** 불러야 반쪽이 안 남는다.
//  3) **가명화는 익명화가 아니다.** `user_key` 는 HMAC 가명이지 익명값이 아니고
//     PIPA 상 여전히 개인정보다. "HMAC 을 씌웠으니 괜찮다" 는 근거가 아니다 —
//     근거는 개정된 고지와 그에 따른 동의이고, 그 발효일이 게이트다.
//
// ★과잉 적용 금지: 계정축 **안에서의** 조인은 금지가 아니다. 처리방침이 명시적
// 으로 허용한다("이 기록만은 성격상 익명일 수 없습니다"). 금지된 건 두 축을
// **아무 데서나** 잇는 것이고, 잇는 자리는 위의 링크표 하나로 못박혀 있다.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac } from "node:crypto";

/**
 * 가명 공간(종류). 종류가 다르면 같은 원시값이어도 다른 가명이 된다.
 *
 * ★이 목록은 **더하는 형태로만** 관리한다. 축이 하나 늘 때마다 여기서 충돌이
 *   난다(#1075 ↔ #1077 이 실제로 그랬다). 한 줄에 몰아쓰지 말고 축별 항목으로
 *   남겨야 다음 축이 붙을 때 충돌이 한 줄 추가로 끝난다.
 *
 * - `agent`/`task`/`project`/`flow`: 익명 세계 row 의 내부 조인키(#915).
 * - `install`/`ga`: analytics_identity 의 **익명축** 키
 *   (ticket dTpcKWwRw5DvEMKxpCZi).
 * - `user`: **계정축** uid 키. `us_` + HMAC(salt, "user:" + uid) — 설계 §3.3.
 *   사람 축 구현(#1084)이 한 벌만 추가했다. 두 벌이 생기면 계정축 **안**의 조인이
 *   조용히 갈라진다(행은 그대로 있고 조인 결과만 빈다).
 * - `order`/`purchase`: analytics_purchase 의 **계정축** 키
 *   (ticket 6EnTiEzL7T2NpjOnTTSj).
 *     - `order`    : 주문번호/paymentId → `od_...`
 *     - `purchase` : 소스 문서키 → `pu_...` (행 멱등키 row_id)
 *   결제 원장의 주문번호와 소스 문서키는 **원시값이 BigQuery 에 닿으면 안 되는
 *   값**이다(주문번호는 PG 콘솔 조회키, 문서키는 `${uid}_${ms}` 라 uid 를
 *   품는다). 같은 솔트·같은 스킴을 쓰므로 새 가명 체계가 생기지 않는다.
 *
 * - `teamMember`: **팀 축** 구성원 가명. `tm_` + HMAC(salt, "teamMember:" + uid) —
 *   설계 §5.4. 팀 오버뷰의 사용량 탭(`getTeamUsageSummary`)과 감사 탭
 *   (`getTeamProjectAudit`)이 **이 한 벌을 같이 쓴다.** 두 벌이 생기면 두 탭이
 *   같은 사람을 다른 가명으로 부르고, 화면이 둘을 대조하지 못한다.
 *
 *   ★**여기서 `user` kind 를 재사용하면 안 된다**(설계 §5.4). 팀 응답은 가명 옆에
 *   표시 이름을 실을 수 있는데, `user_key` 는 링크축
 *   `marblo_identity.analytics_user_install` 의 조인 키다. 두 가명이 같으면
 *   `user_key → displayName` ⨝ `user_key → install_key` 로 **익명 설치 기록이
 *   사람 이름으로 되짚어진다** — `PERSON_AXIS_EFFECTIVE_FROM` 게이트가 막으려던
 *   결과가 게이트를 건드리지도 않고 성립한다. kind 를 달리하면 같은 솔트라도
 *   다이제스트가 달라져 조인이 성립하지 않는다.
 *
 *   ★바깥으로 나가는 가명은 그 화면 전용 공간이다.
 *
 * ★`person` kind 를 만들지 마라. `person_key` 와 `user_key` 는 같은 uid 에서 나온
 *   **서로 다른 두 값**이다(kind 가 HMAC 입력에 들어가므로). 둘을 다 두면
 *   `WHERE person_key = user_key` 가 영원히 0행이 되는데, 조인이 에러를 내지 않고
 *   그냥 빈다 — 행은 그대로 있고 표만 비어 보인다(설계 §3.1). 키는 하나다.
 *
 * ★익명축(install/ga)과 계정축(user/order/purchase)이 이 파일에 나란히 있더라도
 *   **두 축을 잇는 표는 만들지 않는다** — 위 경계 참조. 잇는 자리는
 *   `marblo_identity.analytics_user_install` 하나뿐이고 게이트가 열려야 채워진다.
 */
export type AnalyticsIdKind =
  | "agent"
  | "task"
  | "project"
  | "flow"
  // 익명축 — analytics_identity (dTpcKWwRw5DvEMKxpCZi)
  | "install"
  | "ga"
  // 계정축 — 사람 축 (#1084)
  | "user"
  // 계정축 — 팀 오버뷰 응답 전용 가명 공간 (#1103 설계 §4.6)
  | "teamMember"
  // 계정축 — analytics_purchase (6EnTiEzL7T2NpjOnTTSj)
  | "order"
  | "purchase"
  // 팀 축 — 팀 오버뷰(사용량·감사) 응답의 구성원 가명. 설계 §5.4.
  | "teamMember";

/** 가명 앞에 붙는 짧은 태그 — BQ 에서 눈으로 종류를 구분하기 위한 것뿐이다. */
const KIND_PREFIX: Record<AnalyticsIdKind, string> = {
  agent: "ag",
  task: "tk",
  project: "pj",
  flow: "fl",
  install: "in",
  ga: "ga",
  user: "us",
  teamMember: "tm",
  order: "od",
  purchase: "pu",
};

/**
 * 익명 세계 row 에서 가명화 대상 필드 → 가명 공간.
 *
 * ★여기 없는 필드는 원시값 그대로 적힌다. 새 조인키 컬럼을 익명 테이블에
 * 추가할 때 이 표에 올리는 걸 잊으면 다리가 다시 생긴다.
 *
 * `retryOf` 는 재시도 대상 티켓 id 다(telemetryService 의 recordTaskRetry 는
 * taskId 축) — taskId 와 같은 공간에 둔다.
 *
 * ★`install`/`ga`/`user` kind 는 **일부러 여기 없다.** 이 표는 익명 세계 테이블에
 * insert 하기 직전 `pseudonymizeAnalyticsRow` 가 훑는 목록이다. 여기에
 * `userId: "install"` 을 올리면 지금 살아 있는 events/agent_heartbeats 의
 * 쓰기 동작이 바뀌어 기존 분석이 그 시점에 끊긴다. 그 kind 들은
 * 백필·링크 적재가 `pseudonymizeAnalyticsId` 를 **명시적으로** 불러 쓴다 —
 * 자동 치환 대상이 아니다.
 *
 * ★★특히 `userId: "user"` 는 **절대 금지**다(설계 §3.4). 익명 세계의 `userId`
 * 컬럼에 들어 있는 값은 계정 uid 가 아니라 **익명 설치 UUID**(36자, 고유 14)다.
 * 이걸 `user` kind 로 가명화하면 그 순간부터 `install` kind 로 만든
 * `analytics_identity.install_key` 와 값이 달라져서 익명축 조인이 통째로 끊긴다.
 * 행은 계속 쌓이고 조인만 0 이 된다 — 조용한 실패다.
 */
export const ANALYTICS_ID_FIELDS: Readonly<Record<string, AnalyticsIdKind>> = {
  projectId: "project",
  agentId: "agent",
  parentAgentId: "agent",
  taskId: "task",
  retryOf: "task",
  flowId: "flow",
};

/** env 키 — 값 자체는 절대 로그·응답에 싣지 않는다. */
export const ANALYTICS_ID_SALT_ENV = "ANALYTICS_ID_SALT";

/**
 * 솔트를 읽는다. 미설정/공백이면 null — 호출측은 그때 조인키를 버려야 한다
 * (원시값 폴백 금지).
 */
export function readAnalyticsIdSalt(
  env: Record<string, string | undefined> = process.env
): string | null {
  const raw = env[ANALYTICS_ID_SALT_ENV];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 조인키 하나를 가명으로 바꾼다.
 *
 * - 비어 있는 값(null/undefined/"")은 **모양을 그대로 둔다** — BQ 스키마의
 *   기존 null/"" 관례를 바꾸지 않기 위해서다.
 * - 솔트가 없으면 null(fail-safe).
 * - 같은 (kind, raw, salt) 면 항상 같은 값 → 익명 세계 내부 조인 유지.
 */
export function pseudonymizeAnalyticsId(
  kind: AnalyticsIdKind,
  raw: unknown,
  salt: string | null
): unknown {
  if (typeof raw !== "string" || raw.length === 0) return raw ?? null;
  if (!salt) return null;
  const digest = createHmac("sha256", salt)
    .update(`${kind}:${raw}`)
    .digest("hex")
    .slice(0, 24);
  return `${KIND_PREFIX[kind]}_${digest}`;
}

/**
 * 익명 세계 row 하나를 통째로 가명화한다. ANALYTICS_ID_FIELDS 에 등재된 키만
 * 바꾸고 나머지는 그대로 흘린다(입력을 변형하지 않고 사본을 돌려준다).
 *
 * 익명 테이블에 insert 하기 **직전** 한 번만 호출한다. cost_logs /
 * flow_executions 처럼 계정에 묶인 원장에는 절대 적용하지 않는다 — 그쪽은
 * 원시 id 를 유지해야 본인 Usage 를 되돌려줄 수 있다.
 */
export function pseudonymizeAnalyticsRow<T extends Record<string, unknown>>(
  row: T,
  salt: string | null
): T {
  const out: Record<string, unknown> = { ...row };
  for (const [field, kind] of Object.entries(ANALYTICS_ID_FIELDS)) {
    if (field in out) {
      out[field] = pseudonymizeAnalyticsId(kind, out[field], salt);
    }
  }
  return out as T;
}

/**
 * GA4 client_id → `ga_key` 가명. 리전 브리지(ga4Bridge.ts)와 링크백 적재
 * (installAttribution) 양쪽이 **같은 함수**를 써야 US 안에서 조인이 성립한다.
 *
 * ★`gaClientId` 를 ANALYTICS_ID_FIELDS 에 올리지 않은 건 의도다. 그 표는
 *   `pseudonymizeAnalyticsRow` 가 익명 세계 **이벤트 행**에 적용하는 목록인데,
 *   GA4 조인키는 이벤트 행에 실리지 않는다(브리지 테이블과 어트리뷰션 행에만
 *   있다). 표에 올리면 적용 지점이 아닌 곳까지 훑게 된다.
 *
 * @returns 솔트가 없으면 null(fail-safe — 원시값 폴백 금지).
 */
export function deriveGaKey(
  gaClientId: unknown,
  salt: string | null
): string | null {
  const v = typeof gaClientId === "string" ? gaClientId.trim() : "";
  if (v.length === 0) return null;
  const out = pseudonymizeAnalyticsId("ga", v, salt);
  return typeof out === "string" ? out : null;
}
