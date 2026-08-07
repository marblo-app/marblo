/**
 * 프로젝트 스코프 쿼리 규율 — 소스 스캔 가드 (티켓 4ov5wbQZ25XUXHZVhxdh).
 *
 * 왜 소스를 스캔하나: 이 결함은 **조용하다**. 무스코프 쿼리는 언제나
 * PERMISSION_DENIED 를 받는데, 호출부 대부분이 try/catch 로 그걸 삼키고
 * 빈 결과로 진행한다. 그래서 "죽은 클레임 자동 해제", "DONE 후 의존 해소",
 * "암묵적 미션 마감" 같은 기능이 한 번도 동작하지 않은 채로 오래 살아남았고,
 * 삼키지 않는 한 곳(applyProjection)에서만 "Missing or insufficient permissions"
 * 로 터져 나와 룰/인증 문제로 오인됐다.
 *
 * 런타임 테스트로는 이런 죽은 경로를 다 못 덮는다(대부분 에뮬레이터에서 재현하려면
 * 브리지·에이전트까지 세워야 한다). 그래서 "새 무스코프 쿼리가 들어오는 것" 자체를
 * 소스 수준에서 막는다. 규칙은 단순하다:
 *
 *   query(collection(db, "<프로젝트 스코프 컬렉션>"), …) 호출 텍스트 안에
 *   "projectId" 가 반드시 등장해야 한다.
 *
 * 근거는 firestore.rules — 해당 컬렉션 read 룰이 resource.data.projectId 를
 * 참조하고, Firestore 는 list 를 쿼리 제약식으로 평가한다("rules are not filters").
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_SCOPED_COLLECTIONS } from "../../electron/mcp-server/project-scope";

const ELECTRON_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../electron",
);

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTsFiles(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `query(` 부터 괄호 균형이 맞는 지점까지의 원문을 잘라낸다. 인자 개수·줄바꿈·
 * 중첩 호출과 무관하게 "그 쿼리 호출 전체"를 보게 하려는 것 — 정규식 한 줄
 * 매칭으로는 멀티라인 쿼리를 통째로 놓친다.
 */
function extractQueryCalls(source: string): string[] {
  const calls: string[] = [];
  const re = /\bquery\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(start, i + 1));
  }
  return calls;
}

describe("프로젝트 스코프 쿼리 가드 (electron/)", () => {
  const files = collectTsFiles(ELECTRON_DIR).filter(
    (f) => !f.endsWith(".test.ts"),
  );

  it("스캔 대상 파일이 실제로 존재한다(가드가 공회전하지 않음)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("스코프 컬렉션 쿼리는 전부 projectId 를 고정한다", () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const call of extractQueryCalls(source)) {
        const collectionMatch = call.match(
          /collection\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*["'`]([^"'`]+)["'`]/,
        );
        if (!collectionMatch) continue;
        const collectionId = collectionMatch[1];
        if (!PROJECT_SCOPED_COLLECTIONS.includes(collectionId)) continue;
        if (call.includes("projectId")) continue;

        const line = source.slice(0, source.indexOf(call)).split("\n").length;
        violations.push(
          `${path.relative(ELECTRON_DIR, file)}:${line} — ` +
            `'${collectionId}' 쿼리에 projectId 동등조건이 없습니다.`,
        );
      }
    }

    expect(
      violations,
      "무스코프 쿼리는 Firestore 룰에 항상 거부됩니다(Missing or insufficient " +
        "permissions). where('projectId','==',…) 를 추가하거나 " +
        "requireProjectScope() 를 쓰세요.\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("boundedGetDocs 호출부는 projectId 인자를 넘긴다(위치인자 누락 방지)", () => {
    // boundedGetDocs 는 스코프 주입의 단일 초크포인트다. 인자를 빠뜨리면
    // constraints 가 projectId 자리로 밀려 들어가 타입에러가 나지만, 시그니처가
    // 나중에 느슨해질 수 있으므로 호출 형태 자체를 고정해 둔다.
    const tools = readFileSync(
      path.join(ELECTRON_DIR, "mcp-server/tools.ts"),
      "utf8",
    );
    const calls = tools.match(/boundedGetDocs\(\s*\n\s*"[^"]+",\s*\n/g) ?? [];
    expect(calls.length).toBeGreaterThan(5);
  });
});
