/**
 * 팀 오버뷰 축 규율 — 소스 스캔 가드 (#1103 설계 §4.3 / §4.6).
 *
 * 왜 소스를 스캔하나: 이 결함은 **조용하다.** 팀 오버뷰가 익명축 표를 한 번
 * 조인하면 그 순간 익명 설치 기록이 계정에 귀속되는데, 쿼리는 에러를 내지 않고
 * 그냥 결과를 돌려준다. `PERSON_AXIS_EFFECTIVE_FROM` 게이트는 그 조인을
 * **다른 코드 경로**에서 막고 있어서, 여기서 새로 조인하면 게이트를 건드리지도
 * 않고 우회가 성립한다.
 *
 * 그래서 규칙은 단순하다:
 *
 *   팀 오버뷰 코드(`v3/functions/src/teamUsage.ts`)에 익명축·링크축 표/데이터셋
 *   이름이 **등장하는 것 자체**가 설계 위반이다.
 *
 * ★"오케 사용량이 없네 → 익명축 하트비트로 추정해서 채우자" 가 유일한 현실적
 *   우회 시나리오다. 오케 축의 정답은 추정이 아니라 수집이다(별건 티켓).
 *
 * §4.6 의 가명 공간 분리도 여기서 함께 못 박는다. 응답이 내보내는 가명이 다른
 * 축의 조인 키와 같으면, 조인은 이 화면 밖에서 성립한다 — 읽지 않아도 오염된다.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TEAM_MEMBER_KEY_PREFIX,
  teamMemberKey,
} from "../../functions/src/teamUsage";
import { pseudonymizeAnalyticsId } from "../../functions/src/analyticsPseudonym";

const TEAM_USAGE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../functions/src/teamUsage.ts",
);

const source = readFileSync(TEAM_USAGE_SRC, "utf8");

/**
 * ★등장 자체가 실패인 이름들.
 *
 * - 데이터셋: 링크축 데이터셋 이름이 이 파일에 나오면 그 자체로 설계 위반이다.
 * - 표: 익명축 3종 + 익명축 파생 프로필 2종 + 링크표 + 사람 축 뷰 2벌.
 */
const FORBIDDEN_EXACT = [
  "marblo_identity",
  "analytics_user_install",
  "v_person_since_link",
  "v_person_all_time",
  "task_outcomes",
  "agent_heartbeats",
  "analytics_user_daily",
  "analytics_install_profile",
];

describe("팀 오버뷰는 익명축을 읽지 않는다 (소스 스캔)", () => {
  for (const name of FORBIDDEN_EXACT) {
    it(`teamUsage.ts 에 '${name}' 가 등장하지 않는다`, () => {
      expect(source.includes(name)).toBe(false);
    });
  }

  it("teamUsage.ts 에 익명 이벤트 표 이름이 등장하지 않는다", () => {
    // 단어 경계로 본다 — 한국어 주석의 '이벤트' 같은 말과 섞이지 않게.
    expect(/\bevents\b/.test(source)).toBe(false);
  });

  it("★계정 원장과 그 파생 뷰 말고는 어떤 표도 FROM 절에 오지 않는다", () => {
    const froms = [...source.matchAll(/FROM\s+\S*`?\$\{?[A-Za-z0-9_.$}{`]*/g)].map(
      (m) => m[0],
    );
    // 가드가 헛돌지 않게 최소 개수를 못 박는다(정규식이 안 맞으면 통과가 아니라 실패).
    expect(froms.length).toBeGreaterThanOrEqual(5);
    // FROM 뒤에 오는 것은 전부 템플릿 변수로 조립한 이름이고, 그 변수는
    // cost_logs / v_team_usage_* 셋뿐이다.
    for (const f of froms) {
      expect(
        /SOURCE_TABLE_COST_LOGS|VIEW_TEAM_USAGE_DAILY|VIEW_TEAM_USAGE_UNATTRIBUTED|source|view/.test(
          f,
        ),
      ).toBe(true);
    }
  });

  it("★FROM 에 쓰이는 표 이름 변수가 허용된 세 상수로만 조립된다", () => {
    const decls = source
      .split("\n")
      .filter((l) => /const (source|view) = `/.test(l));
    expect(decls.length).toBeGreaterThanOrEqual(5);
    for (const d of decls) {
      expect(
        /SOURCE_TABLE_COST_LOGS|VIEW_TEAM_USAGE_DAILY|VIEW_TEAM_USAGE_UNATTRIBUTED/.test(
          d,
        ),
      ).toBe(true);
      expect(d.includes("TEAM_USAGE_DATASET")).toBe(true);
    }
  });

  it("★원본 원장을 수정하는 SQL 을 만들지 않는다", () => {
    for (const verb of [
      "DROP ",
      "ALTER ",
      "DELETE ",
      "TRUNCATE ",
      "INSERT INTO",
      "CREATE TABLE",
    ]) {
      expect(source.includes(verb)).toBe(false);
    }
  });
});

describe("가명 공간 분리 (§4.6)", () => {
  const SALT = "guard-test-salt";
  const UID = "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";

  it("★같은 uid 로 만든 팀 가명과 계정축 사람 키가 서로 다르다", () => {
    const tm = teamMemberKey(UID, SALT);
    const us = pseudonymizeAnalyticsId("user", UID, SALT);
    expect(typeof tm).toBe("string");
    expect(typeof us).toBe("string");
    expect(tm).not.toBe(us);
  });

  it("팀 가명 접두는 'tm_' 이다 ('us_' 면 실패)", () => {
    expect(TEAM_MEMBER_KEY_PREFIX).toBe("tm_");
    expect(teamMemberKey(UID, SALT)?.startsWith("tm_")).toBe(true);
    expect(teamMemberKey(UID, SALT)?.startsWith("us_")).toBe(false);
  });

  it("★teamUsage.ts 소스에 사람 축 가명 공간 리터럴이 등장하지 않는다", () => {
    // 그 리터럴이 여기 있으면 두 축의 가명이 같아질 길이 열린 것이다.
    expect(source.includes(["user", ":"].join(""))).toBe(false);
  });

  it("솔트가 없으면 원시 uid 로 폴백하지 않는다", () => {
    expect(teamMemberKey(UID, null)).toBe(null);
  });
});

describe("라벨 규약 (#1090/#1076 계승)", () => {
  it("★금액을 '청구액' 이라고 부르지 않는다", () => {
    // 부정문("청구액이 아니다")은 있어도 되지만, 라벨로 쓰이면 안 된다.
    const labelLines = source
      .split("\n")
      .filter((l) => /TEAM_USAGE_COST_LABEL\s*=/.test(l));
    expect(labelLines.length).toBeGreaterThan(0);
    for (const l of labelLines) expect(l.includes("청구액")).toBe(false);
  });

  it("★오케 칸을 0 으로 그리지 않는다는 사유 문장이 소스에 있다", () => {
    expect(source.includes("0 이 아니라 미수집")).toBe(true);
  });
});
