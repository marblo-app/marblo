/**
 * §5.6 test 4 — ★독립 2차검증 우회 테스트 (§5.7 F2).
 * 1차를 인위로 무력화(주입식 redactor)해도 verify.ts 가 잡아 발행을
 * 중단하는지, 그리고 2차가 1차보다 실제로 넓게 잡는지 검증한다.
 */
import { describe, it, expect } from "vitest";
import { redact, redactAndVerify } from "../../../src/lib/redact/redact";
import { verifyRedacted } from "../../../src/lib/redact/verify";
import type { RedactOptions, RedactResult } from "../../../src/types/redact";
import { SECRET_CORPUS, MNEMONIC_CORPUS, expectNoTrace } from "./helpers";

/** 1차 무력화: 입력을 그대로 통과시키는 redactor. */
const identityRedactor = (
  input: unknown,
  _opts: RedactOptions,
): RedactResult => ({
  payload: input,
  findings: [],
});

describe("independent second-pass verification (F2)", () => {
  it("aborts publication when the first pass is disabled — every corpus entry", () => {
    for (const { name, value } of [...SECRET_CORPUS, ...MNEMONIC_CORPUS]) {
      const dirty = { title: `deploy note ${value} end`, status: "ok" };
      const result = redactAndVerify(dirty, { level: "L3" }, identityRedactor);
      expect(result.ok, `verify must catch: ${name}`).toBe(false);
      expect(result.serialized).toBeUndefined();
      expect(result.payload).toBeUndefined();
      expect(result.verifyFindings.length).toBeGreaterThan(0);
      // ★F7 — abort 결과 어디에도 원문 시크릿이 실리면 안 된다.
      expectNoTrace(result, value);
    }
  });

  it("aborts when a hole is punched into an otherwise-working first pass", () => {
    const holedRedactor = (
      input: unknown,
      opts: RedactOptions,
    ): RedactResult => {
      const r = redact(input, opts);
      return {
        payload: {
          ...(r.payload as Record<string, unknown>),
          oops: "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
        },
        findings: r.findings,
      };
    };
    const result = redactAndVerify(
      { status: "ok" },
      { level: "L2" },
      holedRedactor,
    );
    expect(result.ok).toBe(false);
    expect(result.serialized).toBeUndefined();
  });

  it("second pass is BROADER: truncated key prefix that pass 1 misses", () => {
    // 1차 R3 는 접두사 뒤 16+ 를 요구한다. 잘린 키는 1차를 빠져나가지만
    // 2차(8+ tail)는 잡는다 — 상관 실패 방지의 실증.
    // 값 하나만 단독으로 둔다 — 문맥 단어가 공백제거 변형에서 tail 에 붙어
    // 1차가 우연히 잡아버리는 것을 배제하고, 순수하게 2차의 넓은 그물만 시험.
    const truncated = "ghp_16C7e42F29";
    const first = redact({ title: truncated, status: "ok" }, { level: "L3" });
    expect(JSON.stringify(first.payload)).toContain(truncated); // 1차는 놓친다
    const result = redactAndVerify(
      { title: truncated, status: "ok" },
      { level: "L3" },
    );
    expect(result.ok).toBe(false); // 2차가 잡는다
  });

  it("second pass is BROADER: mnemonic with one decoy word inserted", () => {
    // 1차 R17 은 엄격한 연속 런(12+)을 본다. 가운데 비사전 단어 하나를
    // 끼우면 연속 런은 6+6 으로 쪼개져 1차를 빠져나가지만, 2차의 슬라이딩
    // 윈도우(12중 11)는 잡는다.
    const words = MNEMONIC_CORPUS[0].value.split(" "); // 12 words
    const withDecoy = [
      ...words.slice(0, 6),
      "xylophonez",
      ...words.slice(6),
    ].join(" ");
    const verdict = verifyRedacted(JSON.stringify({ title: withDecoy }));
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.some((f) => f.detector === "v-mnemonic")).toBe(
      true,
    );
    // 최종 발행 파이프라인도 반드시 막힌다 (1차가 놓쳐도 2차가 중단).
    expect(
      redactAndVerify({ title: withDecoy, status: "ok" }, { level: "L3" }).ok,
    ).toBe(false);
  });

  it("passes a clean payload (placeholders and aliases are not findings)", () => {
    const clean = JSON.stringify({
      apiKey: "<REDACTED>",
      actor: "member-1",
      agent: "agent-2",
      ticket: "T-3",
      workspace: "<workspace>/src/app.ts",
      status: "ok",
      startedAt: "+02:13",
    });
    const verdict = verifyRedacted(clean);
    expect(verdict.findings).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("findings carry only detector/offset/length — never values (F7)", () => {
    const secret = "sk-ant-api03-Nn1Mm2Ll3Kk4Jj5Ii6Hh7Gg8Ff9";
    const verdict = verifyRedacted(JSON.stringify({ x: secret }));
    expect(verdict.ok).toBe(false);
    for (const f of verdict.findings) {
      expect(Object.keys(f).sort()).toEqual(["detector", "length", "offset"]);
    }
    expectNoTrace(verdict, secret);
  });
});
