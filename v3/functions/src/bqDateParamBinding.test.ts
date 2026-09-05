// BigQuery 날짜 파라미터 — 실제 바인딩 값을 관찰하는 회귀 가드
// (ticket ArZtEHWC1G09EZykgvPO)
//
// ★왜 이 파일이 필요한가: v3/tests 에 이미 두 개의 가드가 있다
//   (v3/tests/unit/bq-date-param-guard.test.ts — PR #1361,
//    v3/tests/teamUsageDateBinding.test.ts — PR #1435). 둘 다 소스 텍스트에
//   `"DATE"` 문자열이 있는지를 정규식으로 본다 — **라이브러리가 실제로 무엇을
//   바인딩하는지는 보지 않는다.** 이 결함은 예외를 던지지 않으므로 "질의가
//   성공했다"로는 못 잡고, 문자열 매치만으로도 못 잡는다(예: 다른 표기,
//   TIMESTAMP/DATETIME, 공백 변형). 여기서는 실제 설치된
//   `@google-cloud/bigquery`(8.3.1, functions 의 실제 런타임 의존성)의
//   `BigQuery.valueToQueryParameter_` 를 직접 호출해 결과 파라미터 값을 본다.
//
// 실행: npm run test:bq-date-param-binding

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BigQuery } from "@google-cloud/bigquery";

type QueryParamResult = {
  parameterType?: { type?: string };
  parameterValue?: { value?: string };
};

// ★`valueToQueryParameter_` 는 라이브러리 내부에서 `@private` 로 문서화돼
//   있지만 실제 타입 선언(.d.ts)에는 `private` 표시가 없는 공개 static
//   메서드다 — 캐스팅 없이 그대로 호출한다.
const valueToQueryParameter = BigQuery.valueToQueryParameter_ as (
  value: unknown,
  providedType?: unknown,
) => QueryParamResult;

// ★`__dirname` 은 컴파일 산출물 위치(`.test-out/...`)를 가리켜 못 쓴다 —
//   이 스위트는 `cd v3/functions && npm run test:bq-date-param-binding` 로만
//   돈다는 전제로, 실행 cwd 기준 `src/index.ts` 를 읽는다.
const INDEX_TS = readFileSync(
  path.join(process.cwd(), "src", "index.ts"),
  "utf8",
);

/** 줄 주석을 지운다(설명 주석이 `types: { since: "DATE" }` 를 인용해서 코드처럼 안 잡히게). */
function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

/** `types: { ... }` 블록을 중괄호 균형으로 뽑는다(중첩 객체가 있어도 안전하다). */
function extractTypesBlocks(source: string): string[] {
  const stripped = stripLineComments(source);
  const blocks: string[] = [];
  const marker = /\btypes\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(stripped)) !== null) {
    const open = stripped.indexOf("{", m.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < stripped.length; i += 1) {
      if (stripped[i] === "{") depth += 1;
      else if (stripped[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push(stripped.slice(open, end + 1));
  }
  return blocks;
}

/** 날짜류 파라미터 키가 스칼라(배열 아님)로 어떤 타입 문자열을 선언했는지 뽑는다. */
function declaredScalarType(block: string, key: string): string | undefined {
  const re = new RegExp(`["']?${key}["']?\\s*:\\s*["']([A-Z_]+)["']`);
  return re.exec(block)?.[1];
}

test("실측: 타입 미선언은 값을 그대로 바인딩하고, DATE 선언은 조용히 버린다 (8.3.1)", () => {
  const inferred = valueToQueryParameter("2026-08-01", undefined);
  assert.equal(inferred.parameterType?.type, "STRING");
  assert.equal(inferred.parameterValue?.value, "2026-08-01");

  // ★이게 그 결함이다: 문자열 값에 "DATE" 를 명시하면 파라미터 값이
  //   undefined 로 빠진다 — BQ 는 이걸 NULL 로 보내고, `day >= NULL` 은
  //   에러 없이 0행을 준다.
  const trapped = valueToQueryParameter("2026-08-01", "DATE");
  assert.equal(trapped.parameterType?.type, "DATE");
  assert.equal(
    trapped.parameterValue?.value,
    undefined,
    "types 에 DATE 를 선언하면 값이 undefined 로 새야 이 결함이 재현된 것이다 — " +
      "새지 않는다면 라이브러리 버전이 바뀌어 이 가드 자체를 다시 봐야 한다.",
  );
});

test("index.ts 의 모든 types 블록: 날짜류 키에 선언된 타입이 있다면 실제로도 값이 새지 않는다", () => {
  const DATE_LIKE_KEYS = ["fromDay", "toDayExclusive", "since", "day", "date"];
  const blocks = extractTypesBlocks(INDEX_TS);
  assert.ok(
    blocks.length >= 4,
    "가드가 스캔할 types 블록을 못 찾았다 — 정규식이 낡아 헛도는 중이다",
  );

  for (const block of blocks) {
    for (const key of DATE_LIKE_KEYS) {
      const declared = declaredScalarType(block, key);
      if (declared === undefined) continue;
      // 지금은 여기 도달하지 않는다(날짜류 키는 전부 타입 미선언 상태) —
      // 도달한다는 것 자체가 회귀다. 도달하면 실제 라이브러리로 값이
      // 새는지 확인해서 실패 메시지에 어떤 키·타입이 문제인지 남긴다.
      const bound = valueToQueryParameter("2026-08-01", declared);
      assert.notEqual(
        bound.parameterValue?.value,
        undefined,
        `index.ts 의 types 블록이 "${key}" 를 "${declared}" 로 선언한다 — ` +
          `@google-cloud/bigquery 8.3.1 은 이 값을 조용히 NULL 로 바인딩한다 ` +
          `(에러 없이 0행). 이 키의 타입 선언을 지워라(자동추론에 맡긴다).`,
      );
    }
  }
});
