// BigQuery 날짜 파라미터 바인딩 가드 — 팀 사용량 P0 의 회귀 방지.
//
// ★원래 결함(실측 2026-08-30, 재확인 2026-09-01 판정 티켓 BGs6nu60acllBmeKxOXl):
//   @google-cloud/bigquery 8.3.1 에서 STRING 날짜값에 명시적 `"DATE"` 타입을
//   씌우면 파라미터가 **조용히 NULL 로 바인딩**된다. `day >= NULL` 은 에러가
//   아니라 0행을 준다. 그래서 화면이 텅 비는데 로그에는 아무 것도 안 남는다
//   (실측: 타입 선언 시 0행 / 제거 시 806행).
//
// ★왜 주석이 아니라 테스트여야 하나: 고친 커밋(fbdb933e, PR #1361)이 남긴 건
//   주석 세 줄뿐이었다. 주석은 누가 `types` 에 "DATE" 를 다시 넣는 것을 막지
//   못하고, 증상이 예외가 아니라 '조용한 0행'이라 다른 어떤 테스트도, 타입체크도,
//   빌드도 이걸 잡지 못한다. 발효일(2026-09-07) 이후 이 결함이 재발하면 관리자
//   화면이 빈 채로 나가므로 소스 불변식으로 못박는다.
//
// v3/tests 에 두는 이유: functions 의 `test:*` 스크립트는 CI 가 돌리지 않는다.
// CI 가 실제로 돌리는 것은 `cd v3 && npm test`(vitest, include=tests/**) 하나다.
// 가드는 돌아야 가드다.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const V3 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_SRC = path.join(V3, "functions", "src");

/** functions 소스 전부(.ts, 테스트 제외). */
function sourceFiles(): string[] {
  return readdirSync(FUNCTIONS_SRC)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(FUNCTIONS_SRC, f));
}

/**
 * 주석을 지운다 — 단, **줄 수는 보존**한다(실패 메시지의 줄 번호가 맞아야 한다).
 *
 * ★이게 없으면 가드가 자기 자신을 잡는다: 결함을 설명하는 주석
 *   (`types: { since: "DATE" } 를 일부러 안 쓴다`)이 코드처럼 읽힌다.
 *   전체 줄 주석과 블록 주석만 지운다 — 코드 뒤에 붙는 `//` 는 URL(`https://`)
 *   을 자를 수 있어 건드리지 않는다. 문제의 주석들은 전부 전체 줄이다.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  return withoutBlocks
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

/**
 * `types:` 뒤에 오는 객체 리터럴을 중괄호 균형으로 잘라낸다.
 *
 * ★`types:`(질의 파라미터 타입 선언)만 본다. BQ **테이블 스키마**의
 *   `{ name: "day", type: "DATE" }` 는 단수 `type:` 이라 여기 걸리지 않는다 —
 *   그건 정상이고 금지 대상이 아니다.
 */
function typesBlocks(source: string): Array<{ block: string; index: number }> {
  const out: Array<{ block: string; index: number }> = [];
  const marker = /\btypes\s*:\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = marker.exec(source)) !== null) {
    const open = source.indexOf("{", m.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out.push({ block: source.slice(open, end + 1), index: m.index });
  }
  return out;
}

/** 파일 오프셋 → 1-기준 줄 번호. 실패 메시지가 자리를 짚게 한다. */
function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

describe("BigQuery 날짜 파라미터 바인딩", () => {
  it("★어떤 질의도 파라미터에 DATE 타입을 선언하지 않는다 (8.3.1 이 NULL 로 묶는다)", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const source = stripComments(readFileSync(file, "utf-8"));
      for (const { block, index } of typesBlocks(source)) {
        if (/["']DATE["']/.test(block)) {
          offenders.push(
            `${path.relative(V3, file)}:${lineOf(source, index)} — ${block
              .replace(/\s+/g, " ")
              .slice(0, 120)}`,
          );
        }
      }
    }

    expect(
      offenders,
      "질의 파라미터에 DATE 타입을 선언하면 @google-cloud/bigquery 8.3.1 이 값을 " +
        "조용히 NULL 로 바인딩해 0행을 돌려준다(에러 없음). 타입을 생략하면 " +
        "STRING 으로 자동판정되고 BQ 가 DATE 비교에서 캐스팅한다.",
    ).toEqual([]);
  });

  it("팀 사용량 질의 세 곳이 여전히 날짜 창을 파라미터로 넘긴다", () => {
    // 가드가 '검사할 대상이 사라져서' 조용히 통과하는 것을 막는다.
    const index = readFileSync(path.join(FUNCTIONS_SRC, "index.ts"), "utf-8");

    const fromDayBindings = index.match(/fromDay:\s*\w+(\.\w+)*,/g) ?? [];
    expect(fromDayBindings.length).toBeGreaterThanOrEqual(3);

    const toDayBindings = index.match(/toDayExclusive:\s*\w+(\.\w+)*,/g) ?? [];
    expect(toDayBindings.length).toBeGreaterThanOrEqual(3);
  });

  it("배열 파라미터의 원소 타입 선언은 그대로 둔다(빈 배열은 추론이 안 된다)", () => {
    // DATE 를 금지한다고 STRING 배열 선언까지 지우면 빈 배열에서 질의가 깨진다.
    const index = readFileSync(path.join(FUNCTIONS_SRC, "index.ts"), "utf-8");
    expect(index).toContain('projectIds: ["STRING"]');
  });
});
