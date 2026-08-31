/**
 * 팀 라벨 불변식 — firestore.rules 소스 스캔 가드 (#1336 §3.4, 티켓 DdtAH0WUGXyVlKImxm1N).
 *
 * ★고정하는 성질: **`org_teams`/`teamId` 는 어떤 룰 게이트 함수의 판정에도
 * 입력되지 않는다.** 팀은 분석 그룹핑 전용 라벨이지 권한 축이 아니다 — 팀
 * 매핑이 틀리면 차트 행이 잘못 묶일 뿐 행이 새지 않는다는 성질(#1336 §1.2)은
 * 정확히 이 부재 위에 서 있다. 누군가 "팀 단위 열람" 을 룰 함수에 덧대는 순간
 * 이 테스트가 빨개진다 — 그날은 (A) 승격의 날이고, #1336 §8 의 절차(총계
 * 불변식·방침 개정)를 치러야 한다. 라벨에 게이트를 덧대는 지름길을 막는다.
 *
 * 함께 고정: 조직 축 5컬렉션은 클라이언트 전면 차단(서버 전용 티어)이다.
 * 런타임 검증은 firestore.rules.test.ts 의 "조직 축 컬렉션" describe 가 하고,
 * 여기는 소스 수준에서 차단 문구 자체가 남아 있는지를 본다(에뮬레이터 없이
 * 도는 1차 가드 — team-usage-axis-guard 와 같은 방식).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RULES_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../firestore.rules",
);

const ORG_COLLECTIONS = [
  "organizations",
  "org_members",
  "org_project_bindings",
  "org_teams",
  "org_name_history",
] as const;

/** 주석을 걷어낸다 — 주석 속 낱말("teamId 는 판정에 안 들어간다")은 무죄다. */
function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

/**
 * `function <name>(...) { ... }` 블록 전부를 (이름, 본문) 으로 잘라낸다.
 * 정규식 한 줄로는 중첩 중괄호를 못 다루므로 괄호 균형으로 자른다
 * (project-scoped-query-guard 의 extractQueryCalls 와 같은 이유).
 */
function extractRuleFunctions(
  source: string,
): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /\bfunction\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
    }
    out.push({ name: m[1], body: source.slice(start, i) });
  }
  return out;
}

describe("팀 라벨은 권한 축이 아니다 — firestore.rules 소스 스캔", () => {
  const raw = readFileSync(RULES_PATH, "utf8");
  const code = stripComments(raw);
  const fns = extractRuleFunctions(code);

  it("룰에 게이트 함수가 실제로 잡힌다 (스캐너 자기 검증)", () => {
    const names = fns.map((f) => f.name);
    expect(names).toContain("isProjectMember");
    expect(names).toContain("isAdminOrOwner");
    expect(names).toContain("canReadLedgerDoc");
  });

  it("★어떤 룰 함수 본문에도 org_teams 참조가 없다", () => {
    const offenders = fns.filter((f) => f.body.includes("org_teams"));
    expect(
      offenders.map((f) => f.name),
      "org_teams 가 게이트 함수에 들어왔다 — #1336 §3.4 위반. (A) 승격 절차 없이 라벨에 게이트를 덧대지 마라.",
    ).toEqual([]);
  });

  it("★어떤 룰 함수 본문에도 teamId 참조가 없다", () => {
    const offenders = fns.filter((f) => /\bteamId\b/.test(f.body));
    expect(
      offenders.map((f) => f.name),
      "teamId 가 게이트 함수에 들어왔다 — 팀은 분석 라벨이지 권한 축이 아니다(#1336 §3.4).",
    ).toEqual([]);
  });

  it("★조직 축 컬렉션에 대한 조직 축 read 게이트 함수가 없다 — 판정은 콜러블에만", () => {
    // org_members 를 읽어 판정하는 함수(예: isOrgMember/isOrgAdmin)가 룰에
    // 생기면, 조직 역할이 룰 표면(=클라이언트 직접 접근)으로 새기 시작한 것이다.
    const offenders = fns.filter((f) =>
      ORG_COLLECTIONS.some((c) => f.body.includes(`/${c}/`)),
    );
    expect(offenders.map((f) => f.name)).toEqual([]);
  });

  it("조직 축 5컬렉션 전부 서버 전용 차단 블록이 남아 있다", () => {
    for (const collection of ORG_COLLECTIONS) {
      // `match /<col>/{var} {` — 경로 변수의 중괄호를 지나 블록 여는 `{` 부터
      // 균형으로 자른다(indexOf("}") 는 {var} 의 닫는 괄호에 먼저 걸린다).
      const re = new RegExp(`match /${collection}/\\{[A-Za-z0-9_]+\\}\\s*\\{`);
      const m = re.exec(code);
      expect(m, `match /${collection}/ 블록이 없다`).not.toBeNull();
      if (!m) continue;
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < code.length && depth > 0; i++) {
        if (code[i] === "{") depth += 1;
        else if (code[i] === "}") depth -= 1;
      }
      const block = code.slice(start, i);
      expect(
        block.replace(/\s+/g, " "),
        `${collection} 는 클라이언트 전면 차단이어야 한다`,
      ).toContain("allow read, write: if false");
    }
  });
});
