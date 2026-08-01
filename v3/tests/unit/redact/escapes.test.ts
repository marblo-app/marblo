/**
 * §5.6 test 2 — 탈출(evasion) 테스트.
 * 줄바꿈 삽입 · URL 인코딩 · 유니코드 유사문자 · 이스케이프 · JSON 이중
 * 인코딩으로 변형된 시크릿이 1차 엔진을 빠져나가지 못함을 검증.
 */
import { describe, it, expect } from "vitest";
import { redact } from "../../../src/lib/redact/redact";
import { percentEncodeAll, fragmentsOf } from "./helpers";

const SECRET = "sk-ant-api03-Xk7Qw9Zr2Lm8Pv3Ty6Ub1Nc4Rf5Vh8";

function expectClean(planted: string, forbidden: string[]): void {
  const { payload } = redact({ title: planted, status: "ok" }, { level: "L3" });
  const serialized = JSON.stringify(payload);
  for (const f of forbidden) {
    for (const frag of fragmentsOf(f)) {
      expect(serialized).not.toContain(frag);
    }
  }
  expect(serialized).toContain('"status":"ok"');
}

describe("escape/evasion hardening", () => {
  it("newline inserted inside the key", () => {
    const planted = `${SECRET.slice(0, 18)}\n${SECRET.slice(18)}`;
    expectClean(planted, [planted, SECRET]);
  });

  it("newline inserted every 6 chars", () => {
    const planted = SECRET.match(/.{1,6}/g)!.join("\n");
    expectClean(planted, [SECRET, planted.replace(/\n/g, "")]);
  });

  it("full per-character URL encoding", () => {
    const planted = percentEncodeAll(SECRET);
    expectClean(planted, [planted, SECRET]);
  });

  it("double URL encoding", () => {
    const planted = encodeURIComponent(percentEncodeAll(SECRET));
    expectClean(planted, [planted, SECRET]);
  });

  it("unicode homoglyphs (cyrillic а, fullwidth letters)", () => {
    const cyr = SECRET.replace(/a/g, "а"); // U+0430
    expectClean(cyr, [SECRET]);
    const fullwidth = SECRET.replace(/k/g, "ｋ").replace(/-/g, "－");
    expectClean(fullwidth, [SECRET]);
  });

  it("zero-width characters injected inside the key", () => {
    const planted = SECRET.split("").join("​");
    expectClean(planted, [SECRET]);
  });

  it("backslash escapes between characters", () => {
    const planted = SECRET.split("-").join("\\-");
    expectClean(planted, [SECRET]);
  });

  it("JSON double-encoding (stringified object as a value)", () => {
    const once = JSON.stringify({ apiKey: SECRET });
    const twice = JSON.stringify(once);
    expectClean(once, [SECRET]);
    expectClean(twice, [SECRET]);
  });

  it("URL-encoded PII cannot be masked in place → item dropped", () => {
    const planted = `contact ${percentEncodeAll("bob.dev@corp-internal.com")} for access`;
    const { payload } = redact(
      { title: planted, status: "ok" },
      { level: "L3" },
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("bob.dev");
    expect(serialized).not.toContain(
      percentEncodeAll("bob.dev@corp-internal.com").slice(0, 12),
    );
  });

  it("URL-encoded absolute path is dropped (R1c via variant)", () => {
    const planted = `see ${percentEncodeAll("/Users/realname/secret-project/notes.md")}`;
    const { payload } = redact(
      { title: planted, status: "ok" },
      { level: "L3" },
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("realname");
  });
});
