/**
 * ★LoadState 의 "다음 행동" 계약은 문서가 아니라 **타입**이 지킨다 — 그 증거.
 *
 * `tests/fixtures/load-state/bad-*.ts` 는 행동 없이 상태를 구성하려는 시도들이다.
 * TypeScript 컴파일러 API 로 컴파일해서 **하나라도 통과하면 이 테스트가 실패**한다.
 * `good.ts` 는 7상태 전부를 행동과 함께 구성한 것 — 이건 에러 0 이어야 한다.
 *
 * 왜 `npx tsc` 를 spawn 하지 않나: 픽스처는 tsconfig `include` 밖(의도적으로 실패하는
 * 파일을 앱 타입체크에 넣을 수 없다)이고, 프로세스 스폰보다 API 가 빠르고 결과를
 * 파일별로 가를 수 있다.
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const FIXTURE_DIR = resolve(__dirname, "../fixtures/load-state");
const SRC_DIR = resolve(__dirname, "../../src");

const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".ts"));
const bad = files.filter((f) => f.startsWith("bad-"));
const good = files.filter((f) => !f.startsWith("bad-"));

/** 앱 tsconfig 와 같은 엄격도. 픽스처는 unused 체크만 뺀다(`export` 로 대신 막음). */
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  lib: ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  isolatedModules: true,
  allowImportingTsExtensions: true,
  noFallthroughCasesInSwitch: true,
  forceConsistentCasingInFileNames: true,
};

function compile(): Map<string, string[]> {
  const program = ts.createProgram(
    files.map((f) => join(FIXTURE_DIR, f)),
    OPTIONS,
  );
  const byFile = new Map<string, string[]>();
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const file = d.file?.fileName ?? "<global>";
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    const list = byFile.get(file) ?? [];
    list.push(`TS${d.code}: ${msg}`);
    byFile.set(file, list);
  }
  return byFile;
}

const diagnostics = compile();

function errorsFor(fixture: string): string[] {
  return diagnostics.get(join(FIXTURE_DIR, fixture)) ?? [];
}

describe("LoadState — 다음 행동이 없는 상태는 tsc 가 막는다", () => {
  it("픽스처가 기대한 형태로 존재한다", () => {
    expect(good).toEqual(["good.ts"]);
    expect(bad.length).toBeGreaterThanOrEqual(8);
  });

  it("앱 소스(src/) 자체에는 컴파일 에러가 없다 — 설정 오류가 아님을 보증", () => {
    const inSrc = [...diagnostics.entries()].filter(([file]) =>
      file.startsWith(SRC_DIR),
    );
    expect(inSrc).toEqual([]);
  });

  it("good.ts — 7상태 전부 행동과 함께 구성하면 에러 0", () => {
    expect(errorsFor("good.ts")).toEqual([]);
  });

  // 각 bad 픽스처가 막히는 **이유**까지 고정한다 — 다른 이유(오타 등)로 실패하면 안 된다.
  const EXPECTED: Record<string, RegExp> = {
    "bad-failed-no-retry.ts": /'retry' is missing|Property 'retry'/,
    "bad-failed-raw-message.ts":
      /Type 'string' is not assignable to type|reasonCode/,
    "bad-denied-no-whom.ts": /'askWhom' is missing|Property 'askWhom'/,
    "bad-empty-no-create.ts": /'create' is missing|Property 'create'/,
    "bad-empty-no-hint.ts": /'hint' is missing|Property 'hint'/,
    "bad-not-ready-no-when.ts": /availableWhen|enable/,
    "bad-partial-no-more.ts": /'showMore' is missing|Property 'showMore'/,
    "bad-block-no-min-height.ts": /minHeight/,
    "bad-skeleton-no-height.ts": /height/,
  };

  it.each(bad)("%s — 컴파일이 막힌다", (fixture) => {
    const errors = errorsFor(fixture);
    expect(errors.length, `${fixture} 가 컴파일을 통과했다`).toBeGreaterThan(0);
    const want = EXPECTED[fixture];
    expect(want, `${fixture} 의 기대 사유가 EXPECTED 에 없다`).toBeDefined();
    expect(errors.join("\n")).toMatch(want!);
  });

  it("모든 bad 픽스처가 EXPECTED 에 등록돼 있다", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...bad].sort());
  });
});
