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

// ════════════════════════════════════════════════════════════════════════════
// ★불변식 S ⊆ visible(u) 의 **사람 축 확장** (Phase 3, 티켓 wFp2qlIslpjSG87f0zio)
// ════════════════════════════════════════════════════════════════════════════
//
// Phase 2 는 이 불변식을 **프로젝트 집합**에서 지켰다(`orgUsage.ts` 의
// `resolveOrgVisibleProjects` → `isScopeVisible` → `decideOrgUsageAccess` 3단).
// Phase 3 이 그 아래 두 단(사람 › 에이전트·모델)을 얹으면서, 같은 불변식을
// **사람 집합**에서도 지켜야 한다 — 안 그러면 프로젝트 층에서 막은 뺄셈 누수가
// 한 층 아래에서 다시 열린다(총계 − 내 것 = 남의 것).
//
// ★여기서 소스를 스캔하는 이유: 그 판정이 화면 쪽 순수 모듈에 있어서 이 파일이
//   import 할 수 없다(웹은 별도 패키지다). 그런데 **구조가 같다는 것 자체가
//   불변식**이다 — 역할 문자열로 지름길을 내는 순간 부분 가시 역할이 생겼을 때
//   누수가 생기고, 그 사고는 조용하다. 그래서 구조를 바이트로 고정한다.

const ORG_DRILLDOWN_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../marblo-web/src/app/[locale]/org/orgDrilldownContract.ts",
);

const drilldownSource = readFileSync(ORG_DRILLDOWN_SRC, "utf8");

/**
 * ★계약 파일 하나만 훑으면 놓치는 회귀가 있다 — `yJLfoRpqvCcvarIXcT23` 이
 * 정확히 짚어 왔다: **계약을 안 건드리고 화면 컴포넌트가 원장을 직접 구독해
 * 그리는 경우.** 그러면 위 스캔은 조용하다.
 *
 * 그 경로를 막는 것은 화면 파일 자체의 규약이다 — 이 컴포넌트는 firebase 를
 * import 하지 않는다(`OrgViews.tsx` 규약). 데이터는 전부 데이터 층이 정규화해
 * 넘겨준 값으로만 들어온다. 그래서 여기서 **import 자체**를 막으면, 원장을
 * 직접 붙이려는 시도가 계약을 우회하더라도 이 가드에 먼저 걸린다.
 */
const ORG_DRILLDOWN_VIEW_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../marblo-web/src/app/[locale]/org/OrgDrilldownView.tsx",
);

const drilldownViewSource = readFileSync(ORG_DRILLDOWN_VIEW_SRC, "utf8");

describe("사람 축도 같은 3단 구조로 S ⊆ visible 을 지킨다", () => {
  it("★Phase 2 와 같은 3단이 있다 — 가시 집합 · 포함 검사 · 판정", () => {
    // ★여는 괄호까지 붙여서 **정확한 이름**을 요구한다. 괄호를 빼면 이름이
    //   접두사이기만 해도 통과한다 — `resolveVisibleMembersX` 로 바꿔도 초록이
    //   나왔다(실측). 이름 검사가 접두사 검사면 오타 하나가 조용히 지나간다.
    for (const fn of [
      "export function resolveVisibleMembers(",
      "export function isSubsetVisible(",
      "export function decidePersonScopeAccess(",
    ]) {
      expect(drilldownSource.includes(fn)).toBe(true);
    }
  });

  it("★판정 함수는 역할 문자열을 받지 않는다 — 지름길을 낼 입력이 없다", () => {
    const decl = drilldownSource.match(
      /export function decidePersonScopeAccess[\s\S]*?\)\s*:/,
    );
    expect(decl).not.toBeNull();
    for (const roleWord of [
      "org_owner",
      "org_admin",
      "org_member",
      "OrgRole",
    ]) {
      expect(decl![0].includes(roleWord)).toBe(false);
    }
  });

  it("★판정은 포함 검사를 실제로 호출한다 — 통과시키는 지름길이 없다", () => {
    const body = drilldownSource.match(
      /export function decidePersonScopeAccess[\s\S]*?\n}/,
    );
    expect(body).not.toBeNull();
    expect(body![0].includes("resolveVisibleMembers")).toBe(true);
    expect(body![0].includes("isSubsetVisible")).toBe(true);
  });

  it("★가시 집합은 전수 아니면 공집합이다 — 그 사이(부분집합)를 만들지 않는다", () => {
    const body = drilldownSource.match(
      /export function resolveVisibleMembers[\s\S]*?\n}/,
    );
    expect(body).not.toBeNull();
    // `.filter(`/`.slice(`/`.splice(` 가 있으면 부분집합을 만들고 있는 것이다.
    for (const narrowing of [".filter(", ".slice(", ".splice("]) {
      expect(body![0].includes(narrowing)).toBe(false);
    }
  });

  it("★사람 단 계약도 익명축·링크축 표 이름을 읽지 않는다(계정 축 유지)", () => {
    for (const name of FORBIDDEN_EXACT) {
      expect(drilldownSource.includes(name)).toBe(false);
    }
  });

  it("★화면 컴포넌트가 원장을 직접 구독하지 않는다 — 계약을 우회하는 경로", () => {
    // ★이 검사가 없으면, 계약 파일을 한 글자도 안 건드리고 컴포넌트에서
    //   원장을 직접 읽어 그리는 회귀가 조용히 지나간다.
    //
    // ★단순 부분문자열이 아니라 **import 대상**을 본다: 이 파일의 머리 주석이
    //   "firebase 를 import 하지 않는다" 고 적고 있어서, 낱말만 찾으면 규약을
    //   설명한 문장 자체에 걸린다(실측으로 걸렸다). 가드가 규약 문서화를
    //   벌하면 다음 사람은 주석을 지우지, 규약을 지키지 않는다.
    const specifiers = [
      ...drilldownViewSource.matchAll(/\bfrom\s+"([^"]+)"/g),
    ].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(/firebase|firestore/.test(spec)).toBe(false);
    }
    // 호출 자체도 없다 — 데이터 층이 정규화해 넘긴 값만 들어온다.
    for (const call of ["onSnapshot(", "httpsCallable(", "getDocs("]) {
      expect(drilldownViewSource.includes(call)).toBe(false);
    }
  });

  it("★화면 컴포넌트에도 익명축 표 이름과 실행 로그 원문 필드가 없다", () => {
    for (const name of FORBIDDEN_EXACT) {
      expect(drilldownViewSource.includes(name)).toBe(false);
    }
    for (const field of ["toolArgs", "stdout", "transcript"]) {
      expect(drilldownViewSource.includes(field)).toBe(false);
    }
  });

  it("★에이전트 실행 로그 원문 필드가 계약에 없다(방침이 문면으로 금지)", () => {
    // 프롬프트·응답·툴 인자·명령 원문이 이 계약을 지나갈 자리 자체를 안 만든다.
    for (const field of [
      "prompt",
      "response",
      "instruction",
      "toolArgs",
      "params",
      "stdout",
      "transcript",
    ]) {
      expect(drilldownSource.includes(field)).toBe(false);
    }
  });
});
