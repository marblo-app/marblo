import { describe, expect, it } from "vitest";
import { normalizeLine, stripAnsi } from "../../src/lib/ansi";

describe("stripAnsi", () => {
  it("removes SGR color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m text")).toBe("red text");
  });

  it("removes nested SGR sequences", () => {
    expect(stripAnsi("\x1b[1;31;42mfancy\x1b[0m")).toBe("fancy");
  });

  it("removes cursor movement", () => {
    expect(stripAnsi("a\x1b[2Cb\x1b[1Ac")).toBe("abc");
  });

  it("removes screen clear (ESC[2J) and home (ESC[H)", () => {
    expect(stripAnsi("\x1b[2J\x1b[Hclean")).toBe("clean");
  });

  it("removes OSC window title sequences terminated by BEL", () => {
    expect(stripAnsi("\x1b]0;my title\x07hello")).toBe("hello");
  });

  it("removes OSC sequences terminated by ESC backslash", () => {
    expect(stripAnsi("\x1b]8;;https://x.com\x1b\\link\x1b]8;;\x1b\\")).toBe(
      "link",
    );
  });

  it("removes DCS sequences", () => {
    expect(stripAnsi("\x1bP1pdata\x1b\\after")).toBe("after");
  });

  it("removes BEL and other non-printing control chars (but keeps \\t, \\n, \\r)", () => {
    expect(stripAnsi("a\x07b\x00c\td\ne\rf")).toBe("abc\td\ne\rf");
  });

  it("removes short ESC sequences like ESC( / ESC=", () => {
    expect(stripAnsi("\x1b(Babc\x1b=def")).toBe("abcdef");
  });

  it("is a no-op on plain text", () => {
    expect(stripAnsi("just text 123")).toBe("just text 123");
  });

  it("returns empty string for empty / null input", () => {
    expect(stripAnsi("")).toBe("");
    expect(stripAnsi(undefined as unknown as string)).toBe("");
  });
});

describe("normalizeLine", () => {
  it("strips ANSI and resolves CR overwrite", () => {
    expect(normalizeLine("\x1b[32mdownloading 50%\rdownloading 75%")).toBe(
      "downloading 75%",
    );
  });

  it("returns text unchanged when no CR present", () => {
    expect(normalizeLine("\x1b[31mplain")).toBe("plain");
  });

  it("handles only CR with no payload", () => {
    expect(normalizeLine("abc\r")).toBe("");
  });

  it("trims to text after the last of multiple CRs", () => {
    expect(normalizeLine("a\rb\rc")).toBe("c");
  });
});
