/**
 * §5.6 test 1 — 시크릿 코퍼스 + ★니모닉 코퍼스 (§5.7 F1).
 *
 * 가짜 키 60여 종을 비트 본문·필드명·URL·에러 메시지·base64 등 여러 위치에
 * 심고, 최종 payload 에 어떤 표현형(원문·URL인코딩·base64)의 조각도 남지
 * 않음을 검증한다. L1(최소 공개)과 L3(최대 공개) 모두에서 — L3 에서도
 * 시크릿은 예외 없이 제거된다(§5.3).
 */
import { describe, it, expect } from "vitest";
import { redact } from "../../../src/lib/redact/redact";
import type { RedactLevel } from "../../../src/types/redact";
import { SECRET_CORPUS, MNEMONIC_CORPUS, b64, expectNoTrace } from "./helpers";

/** 시크릿을 심는 위치들 — 전부 "구조화 필드"다 (F3: 구조화라 안전은 없다). */
function placements(
  secret: string,
): Array<{ pos: string; payload: Record<string, unknown> }> {
  return [
    {
      pos: "bit-body",
      payload: { title: `deploy failed ${secret} retrying now`, status: "ok" },
    },
    {
      pos: "field-name",
      payload: {
        [`error ${secret}`]: "planted in the key itself",
        status: "ok",
      },
    },
    {
      pos: "url",
      payload: {
        label: `https://example.com/cb?next=${encodeURIComponent(secret)}`,
        status: "ok",
      },
    },
    {
      pos: "error-message",
      payload: {
        result: { name: `Error: auth failed for ${secret}` },
        status: "ok",
      },
    },
    {
      pos: "base64",
      payload: { label: `blob ${b64(secret)} attached`, status: "ok" },
    },
  ];
}

const LEVELS: RedactLevel[] = ["L1", "L3"];
const ALL = [...SECRET_CORPUS, ...MNEMONIC_CORPUS];

describe("secret corpus — no fragment survives (미탐 0)", () => {
  for (const level of LEVELS) {
    for (const { name, value } of ALL) {
      it(`${level} / ${name}`, () => {
        for (const { pos, payload } of placements(value)) {
          const { payload: out, findings } = redact(payload, { level });
          expectNoTrace(out, value);
          // ★F7 — findings 에도 원문 값이 실려선 안 된다.
          expectNoTrace(findings, value);
          // 엔진이 "전부 드롭"으로 공허하게 통과하는 것 방지: 무해한 형제
          // 필드는 살아남아야 한다.
          const serialized = JSON.stringify(out);
          expect(serialized, `${pos}: benign sibling must survive`).toContain(
            '"status":"ok"',
          );
        }
      });
    }
  }
});

describe("mnemonic corpus — R17 details (§5.7 F1)", () => {
  it("drops 12/15/18/21/24-word phrases built from the canonical wordlist", async () => {
    const { BIP39_WORDS } = await import("../../../src/lib/redact/patterns");
    const words = [...BIP39_WORDS];
    expect(words.length).toBe(2048);
    for (const n of [12, 15, 18, 21, 24]) {
      const phrase = Array.from(
        { length: n },
        (_, i) => words[(i * 97 + 13) % 2048],
      ).join(" ");
      const { payload: out } = redact(
        { title: `seed: ${phrase}`, status: "ok" },
        { level: "L3" },
      );
      expectNoTrace(out, phrase);
      expect(JSON.stringify(out)).toContain('"status":"ok"');
    }
  });

  it("drops comma/newline-separated and camelCase-joined mnemonics", () => {
    const base = MNEMONIC_CORPUS[0].value;
    const variants = [
      base.split(" ").join(", "),
      base.split(" ").join("\n"),
      base
        .split(" ")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(""),
    ];
    for (const v of variants) {
      const { payload: out } = redact(
        { title: v, status: "ok" },
        { level: "L3" },
      );
      expectNoTrace(out, base);
    }
  });

  it("does not nuke ordinary short English sentences (sanity)", () => {
    const { payload: out } = redact(
      {
        title:
          "the quick brown fox jumps over the lazy dog near the river bank today",
        status: "ok",
      },
      { level: "L3" },
    );
    expect(JSON.stringify(out)).toContain("quick brown fox");
  });
});
