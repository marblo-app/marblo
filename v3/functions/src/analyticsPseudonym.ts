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

// ── ★축 경계 — 지우지 마라 (ticket dTpcKWwRw5DvEMKxpCZi) ─────────────────────
//
//   익명축  analytics_identity              install_key / ga_key / first_touch
//   계정축  analytics_purchase / cost_logs  user_key / 금액
//
//   ★두 축은 조인하지 않는다. 조인키를 만들지도 않는다.
//     근거: 배포된 처리방침 v3/src/components/legal/privacyContent.tsx:95
//           (EN :210) "두 기록이 공유하는 조인 키는 없습니다 /
//           the two share no join key"
//
// ★analytics_identity 에 `user_key` 가 없는 것은 **빠뜨린 게 아니라 뺀 것**이다.
// install_key(익명 설치) 와 user_key(계정) 를 같은 행에 두면 그 행 자체가 위
// 문구가 없다고 말한 그 조인키가 된다. 실측: agent_heartbeats.userId 는 36자
// 익명 설치 UUID(고유 14), cost_logs.userId 는 28자 계정 UID(고유 5) — 두 축을
// 이으면 산출물은 "익명 설치 → 계정" 매핑, 즉 계정 재식별이다. 양쪽을 같은
// salt 로 HMAC 해도 조인은 그대로 성립한다(그게 조인의 목적이니까). 가명화는
// 익명화가 아니다. 컬럼 자리조차 만들지 않은 이유도 같다 — 빈 컬럼이 있으면
// 다음 사람이 "채우면 되겠네" 로 읽는다.
//
// ★과잉 적용 금지: 계정축 **안에서의** 조인은 금지가 아니다. 처리방침이 명시적
// 으로 허용한다("이 기록만은 성격상 익명일 수 없습니다"). 금지된 건 두 축을
// **잇는 것** 하나다.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac } from "node:crypto";

/**
 * 가명 공간(종류). 종류가 다르면 같은 원시값이어도 다른 가명이 된다.
 *
 * - `agent`/`task`/`project`/`flow`: 익명 세계 row 의 내부 조인키(#915).
 * - `install`/`ga`: analytics_identity 의 익명축 키.
 * - ★`user`(계정 uid 축)는 여기 **없다.** analytics_purchase 티켓
 *   (`6EnTiEzL7T2NpjOnTTSj`)이 자기 축의 것으로 추가한다. 이 파일에서
 *   익명축과 계정축이 만나더라도 **두 축을 잇는 표는 만들지 않는다** — 위 경계 참조.
 */
export type AnalyticsIdKind =
  | "agent"
  | "task"
  | "project"
  | "flow"
  | "install"
  | "ga";

/** 가명 앞에 붙는 짧은 태그 — BQ 에서 눈으로 종류를 구분하기 위한 것뿐이다. */
const KIND_PREFIX: Record<AnalyticsIdKind, string> = {
  agent: "ag",
  task: "tk",
  project: "pj",
  flow: "fl",
  install: "in",
  ga: "ga",
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
 * ★`install`/`ga` kind 는 **일부러 여기 없다.** 이 표는 익명 세계 테이블에
 * insert 하기 직전 `pseudonymizeAnalyticsRow` 가 훑는 목록이다. 여기에
 * `userId: "install"` 을 올리면 지금 살아 있는 events/agent_heartbeats 의
 * 쓰기 동작이 바뀌어 기존 분석이 그 시점에 끊긴다. 그 두 kind 는
 * analytics_identity 백필이 `pseudonymizeAnalyticsId` 를 **명시적으로** 불러
 * 쓴다 — 자동 치환 대상이 아니다.
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
