/**
 * BQ 파라미터 DATE 타입 금지 — 소스 스캔 회귀 가드 (티켓 N1JrYfyoNCbENctruvGq).
 *
 * 왜 소스를 스캔하나: 이 결함은 **조용하다.** @google-cloud/bigquery 8.3.1 에서
 * STRING 값에 `types: { …: "DATE" }` 를 명시하면 파라미터가 조용히 NULL 로
 * 바인딩된다 — `day >= NULL` 은 에러 없이 0행을 준다. 게이트가 열려도 화면이
 * 계속 빈칸이라, 런타임 테스트로는 "0행이 버그" 인지 "정말 0행" 인지 가를 수
 * 없다. 그래서 규칙 자체를 고정한다:
 *
 *   `bigquery.query({ types: { … } })` 블록 안에 `"DATE"` 가 **등장하는 것
 *   자체**가 회귀다. 날짜 파라미터는 타입 선언 없이 STRING 으로 보내고 BQ 의
 *   암묵 캐스팅에 맡긴다(실측 2026-09-01: 선언 시 0행 / 생략 시 806행).
 *   배열 파라미터(빈 배열은 원소 타입 추론 불가)만 `["STRING"]` 류로 선언한다.
 *
 * ★버전을 올려 고치는 길은 막혀 있다 — lock 이 8.3.1 로 고정돼 있고 Cloud
 *   Build 까지 영향이 간다(티켓 제약). 그래서 이 가드는 라이브러리가 아니라
 *   **우리 소스의 패턴**을 지킨다.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../functions/src",
);

/** `// …` 줄 주석을 뗀다 — 기존 이유 주석이 `types: { since: "DATE" }` 를
 *  문장으로 인용하고 있어서, 주석까지 스캔하면 설명문이 위반으로 잡힌다. */
function stripLineComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/** `types: { … }` 블록(중첩 없는 평평한 객체)을 전부 뽑는다. */
function typesBlocks(source: string): string[] {
  return [...stripLineComments(source).matchAll(/types:\s*\{[^}]*\}/g)].map(
    (m) => m[0],
  );
}

const files = readdirSync(FUNCTIONS_SRC)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => path.join(FUNCTIONS_SRC, f));

describe("BQ 질의 파라미터에 DATE 타입을 선언하지 않는다 (소스 스캔)", () => {
  it("★가드가 실제로 무언가를 스캔한다 — types 블록이 최소 4개 있다", () => {
    // 팀 사용량 3곳(수정 후: 배열 타입만 남음) + gaKey 조회 1곳. 이 수가 0 이
    // 되면 정규식이 낡아 가드가 헛도는 것이니 통과가 아니라 실패다.
    const total = files.flatMap((f) => typesBlocks(readFileSync(f, "utf8")));
    expect(total.length).toBeGreaterThanOrEqual(4);
  });

  it("★가드 정규식이 버그 패턴을 실제로 잡는다 (양성 대조)", () => {
    const buggy = `await bigquery.query({
      params: { fromDay: "2026-04-01" },
      types: {
        fromDay: "DATE",
        projectIds: ["STRING"],
      },
    });`;
    const hits = typesBlocks(buggy).filter((b) => b.includes('"DATE"'));
    expect(hits.length).toBe(1);
  });

  for (const file of files) {
    it(`${path.basename(file)} 의 types 블록에 "DATE" 가 없다`, () => {
      const offending = typesBlocks(readFileSync(file, "utf8")).filter((b) =>
        b.includes('"DATE"'),
      );
      expect(offending).toEqual([]);
    });
  }
});
