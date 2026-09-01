/**
 * 조직 롤업 축 규율 — 소스 스캔 가드.
 *
 * `team-usage-axis-guard.test.ts` 의 상속이다(#1333 §4.2 "축 가드 소스 스캔을
 * 그대로 상속한다"). 조직 롤업(`orgUsage.ts`)은 팀 사용량과 같은 계정 축 위에서
 * Node 그룹핑만 하므로, 익명축·링크축 표 이름이 **등장하는 것 자체**가 설계
 * 위반이다 — 조인은 에러 없이 성립하고, 그 순간 익명 설치 기록이 조직 화면에
 * 귀속된다(조용한 결함).
 *
 * ★그리고 이 파일 고유의 금지 하나: `orgUsage.ts` 는 **질의를 만들지 않는다.**
 *   질의는 teamUsage.ts 의 세 빌더뿐이고(#1336 §7 "질의는 그대로 S 전체로 한 번"),
 *   여기 FROM/SELECT 가 생기면 새 배선이 생긴 것이다.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORG_USAGE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../functions/src/orgUsage.ts",
);

const source = readFileSync(ORG_USAGE_SRC, "utf8");

/** ★등장 자체가 실패인 이름들 — team-usage-axis-guard 와 같은 목록. */
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

describe("조직 롤업은 익명축을 읽지 않는다 (소스 스캔)", () => {
  for (const name of FORBIDDEN_EXACT) {
    it(`orgUsage.ts 에 '${name}' 가 등장하지 않는다`, () => {
      expect(source.includes(name)).toBe(false);
    });
  }

  it("orgUsage.ts 에 익명 이벤트 표 이름이 등장하지 않는다", () => {
    expect(/\bevents\b/.test(source)).toBe(false);
  });

  it("★orgUsage.ts 는 질의를 만들지 않는다 — SQL 조각이 없다", () => {
    for (const fragment of ["FROM ", "SELECT ", "WHERE ", "UNNEST"]) {
      expect(source.includes(fragment)).toBe(false);
    }
  });

  it("★teamId 는 권한 판정에 입력되지 않는다(#1336 §3.4) — 판정 함수가 teamId 를 받지 않는다", () => {
    // 판정 함수 시그니처 구간만 본다: decideOrgUsageAccess / resolveOrgVisibleProjects /
    // isScopeVisible 선언부에 teamId 가 등장하면 라벨이 권한이 된 것이다.
    const decisionFns = source.match(
      /export function (decideOrgUsageAccess|resolveOrgVisibleProjects|isScopeVisible)[\s\S]*?\)\s*:/g,
    );
    expect(decisionFns).not.toBeNull();
    expect(decisionFns!.length).toBe(3);
    for (const decl of decisionFns!) {
      expect(decl.includes("teamId")).toBe(false);
    }
  });
});
