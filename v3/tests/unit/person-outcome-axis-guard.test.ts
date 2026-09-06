/**
 * 사람 축 성과(익명 설치 축 ⋈ 계정 축) 축 규율 — 소스 스캔 가드
 * (티켓 85dkAQMiYauFwg1Z9kaH, 사장님 지시 2026-09-07). `org-execution-ledger-axis-
 * guard.test.ts` 의 형제다 — 다만 그 파일이 "이 표 이름이 있으면 안 된다"를
 * 지키는 반면, 이 파일은 정반대다: **다리는 있어야 하고, 딱 하나여야 한다.**
 *
 * ★고정하는 것 셋:
 *   1. 다리는 `user` kind 가명 하나뿐이다 — `person`/`person_key` 는 없다.
 *   2. `task_outcomes` 쿼리는 `analytics_user_install`/`marblo_identity` 를
 *      **라이브 SQL JOIN 으로 참조하지 않는다**(personAxis.ts §7b 근거 —
 *      로스터 uid 로 같은 가명을 다시 계산해 `userKey IN (...)` 로 좁힌다).
 *   3. `teamMember` kind(응답 가명)와 `user` kind(조인키)를 직접 비교하는
 *      코드가 없다 — 매핑은 uid 를 아는 서버 쪽에서 Map 으로만 한다.
 *   4. 모델 문자열 분류(`classifyModelKey`)는 화면 계약 한 곳에서만 한다 —
 *      성과 판정 로직(personAxis.ts, 화면의 personOutcomeAxisOf/
 *      personOutcomeEnvelopeFor)은 모델 문자열을 분류하지 않는다.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PERSON_AXIS_SRC = readFileSync(
  path.resolve(HERE, "../../functions/src/personAxis.ts"),
  "utf8",
);
const INDEX_SRC = readFileSync(
  path.resolve(HERE, "../../functions/src/index.ts"),
  "utf8",
);
const CONTRACT_SRC = readFileSync(
  path.resolve(
    HERE,
    "../../../marblo-web/src/app/[locale]/org/orgDrilldownContract.ts",
  ),
  "utf8",
);
const PSEUDONYM_SRC = readFileSync(
  path.resolve(HERE, "../../functions/src/analyticsPseudonym.ts"),
  "utf8",
);
const VIEW_SRC = readFileSync(
  path.resolve(
    HERE,
    "../../../marblo-web/src/app/[locale]/org/OrgDrilldownView.tsx",
  ),
  "utf8",
);

/** index.ts 는 거대 파일이다 — 이 콜러블 본문만 잘라서 본다. */
function extractCallable(src: string, name: string): string {
  const marker = `export const ${name} = functions.https.onCall(`;
  const start = src.indexOf(marker);
  expect(start, `${name} 콜러블을 못 찾았다`).toBeGreaterThanOrEqual(0);
  // 다음 최상위 `export const`/`export async function` 까지를 본문으로 본다.
  const rest = src.slice(start + marker.length);
  const nextExportIdx = rest.search(/\nexport (const|async function|function)/);
  return rest.slice(0, nextExportIdx === -1 ? rest.length : nextExportIdx);
}

describe("personAxis.ts §7b — 다리는 user kind 하나, person kind 없음", () => {
  it("★foldPersonOutcomeAxis 가 존재한다(정확한 이름)", () => {
    expect(
      PERSON_AXIS_SRC.includes("export function foldPersonOutcomeAxis("),
    ).toBe(true);
  });

  it("★AnalyticsIdKind 유니언에 person kind 가 없다(이 티켓이 새로 안 만들었다)", () => {
    // ★코드 자체를 본다 — 이 파일의 문서 주석은 "person kind 를 만들지 마라"를
    //   설명하려고 그 낱말을 그대로 인용하므로 전체 파일 문자열 검색으로는
    //   못 가른다. 유니언 타입 선언부만 잘라서 본다.
    const union = PSEUDONYM_SRC.match(/export type AnalyticsIdKind =[\s\S]*?;/);
    expect(union).not.toBeNull();
    expect(/\|\s*"person"/.test(union![0])).toBe(false);
  });

  it("★결정 건이 아닌 행(success===null)은 세지 않되, 귀속 못 한 행은 조용히 버리지 않고 센다", () => {
    const body = PERSON_AXIS_SRC.match(
      /export function foldPersonOutcomeAxis[\s\S]*?\n}/,
    );
    expect(body).not.toBeNull();
    expect(body![0].includes("r.success === null")).toBe(true);
    expect(body![0].includes("unattributedRows += 1")).toBe(true);
    expect(body![0].includes("unstampedRows += 1")).toBe(true);
  });

  it("★foldPersonOutcomeAxis 는 모델 문자열을 분류하지 않는다(원본 그대로 넘긴다)", () => {
    // ★파일 전체가 아니라 함수 본문만 본다 — 이 파일의 문서 주석은 "분류는
    //   화면의 classifyModelKey 가 한다"를 설명하려고 그 이름을 그대로
    //   인용한다.
    const body = PERSON_AXIS_SRC.match(
      /export function foldPersonOutcomeAxis[\s\S]*?\n}/,
    );
    expect(body).not.toBeNull();
    expect(body![0].includes("classifyModelKey")).toBe(false);
  });
});

describe("index.ts getTeamProjectOutcomeAxis — 라이브 조인 없음, owner/admin 만", () => {
  const body = extractCallable(INDEX_SRC, "getTeamProjectOutcomeAxis");

  it("★owner/admin 이 아니면 즉시 disabled 로 닫는다(부분집합 없음)", () => {
    expect(body.includes('role !== "owner" && role !== "admin"')).toBe(true);
  });

  it("★PERSON_AXIS_EFFECTIVE_FROM 게이트를 역할과 별개로 본다", () => {
    expect(body.includes("resolvePersonAxisGate()")).toBe(true);
    expect(body.includes("gate.open")).toBe(true);
  });

  it("★analytics_user_install/marblo_identity 를 SQL 안에서 라이브 조인하지 않는다", () => {
    for (const name of ["analytics_user_install", "marblo_identity"]) {
      expect(body.includes(name)).toBe(false);
    }
  });

  it("★두 kind 를 각각 계산하고, 서로 직접 비교하지 않는다", () => {
    expect(/pseudonymizeAnalyticsId\(\s*"teamMember"/.test(body)).toBe(true);
    expect(/pseudonymizeAnalyticsId\(\s*"user"/.test(body)).toBe(true);
    // ★두 가명을 직접 비교하는 코드(같은 표현식 안에서 등호)가 없다 — 매핑은
    //   Map(memberKeyByUserKey) 을 통해서만 이뤄진다.
    expect(/teamMemberKey\s*===\s*userKey/.test(body)).toBe(false);
    expect(/userKey\s*===\s*teamMemberKey/.test(body)).toBe(false);
    expect(body.includes("memberKeyByUserKey")).toBe(true);
  });

  it("★쿼리 파라미터는 가명(userKeys)뿐이다 — 원시 uid 를 파라미터로 넘기지 않는다", () => {
    expect(body.includes("params: { userKeys, effectiveFrom")).toBe(true);
    expect(/params:\s*\{[^}]*\brosterUid\b/.test(body)).toBe(false);
    expect(/params:\s*\{[^}]*\buid\b/.test(body)).toBe(false);
  });

  it("★taskId 당 최신 행 1건만 남긴다(재시도 중복 방지) — QUALIFY 재사용", () => {
    expect(INDEX_SRC.includes("PERSON_OUTCOME_TASK_OUTCOMES_SQL")).toBe(true);
    const sqlMatch = INDEX_SRC.match(
      /const PERSON_OUTCOME_TASK_OUTCOMES_SQL = `[\s\S]*?`;/,
    );
    expect(sqlMatch).not.toBeNull();
    expect(sqlMatch![0].includes("QUALIFY ROW_NUMBER()")).toBe(true);
    expect(sqlMatch![0].includes("PARTITION BY taskId")).toBe(true);
  });

  it("★미인증 요청은 unauthenticated 로 거절한다(401 상당)", () => {
    expect(body.includes('"unauthenticated"')).toBe(true);
    expect(body.indexOf("context.auth?.uid")).toBeLessThan(
      body.indexOf("bigquery.query"),
    );
  });
});

describe("화면 계약 — 모델 분류는 한 곳(classifyModelKey)에서만, 여기서 다시 안 한다", () => {
  it("★personOutcomeAxisOf/personOutcomeEnvelopeFor 는 classifyModelKey 를 안 부른다", () => {
    const axisFn = CONTRACT_SRC.match(
      /export function personOutcomeAxisOf[\s\S]*?\n}/,
    );
    const envFn = CONTRACT_SRC.match(
      /export function personOutcomeEnvelopeFor[\s\S]*?\n}/,
    );
    expect(axisFn).not.toBeNull();
    expect(envFn).not.toBeNull();
    expect(axisFn![0].includes("classifyModelKey")).toBe(false);
    expect(envFn![0].includes("classifyModelKey")).toBe(false);
  });

  it("★byModel 파싱은 숫자가 아닌 항목을 던지지 않고 버린다", () => {
    const parseFn = CONTRACT_SRC.match(
      /function parsePersonOutcomeModelRows[\s\S]*?\n}/,
    );
    expect(parseFn).not.toBeNull();
    expect(parseFn![0].includes("continue")).toBe(true);
  });
});

describe("드릴다운 화면 — 모델 축 분류를 재사용한다(두 벌 안 만든다)", () => {
  it("★OutcomeAxisView 가 classifyModelKey 를 실제로 부른다", () => {
    const viewFn = VIEW_SRC.match(/function OutcomeAxisView[\s\S]*?\n}\n/);
    expect(viewFn).not.toBeNull();
    expect(viewFn![0].includes("classifyModelKey(")).toBe(true);
  });

  it("★firebase·httpsCallable 을 이 화면에서 직접 부르지 않는다(기존 규율 유지)", () => {
    for (const call of ["onSnapshot(", "httpsCallable(", "getDocs("]) {
      expect(VIEW_SRC.includes(call)).toBe(false);
    }
  });
});
