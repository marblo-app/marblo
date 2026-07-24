import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_FONT_URL,
  looksLikeFont,
  parseRunnerPayload,
  toErrorOutput,
} from "../src/lib/notebookKernel/protocol";

describe("parseRunnerPayload", () => {
  it("passes through the outputs runner.py produced", () => {
    const payload = JSON.stringify({
      outputs: [
        { kind: "text", text: "hi\n", stream: "stdout" },
        {
          kind: "image",
          mime: "image/png",
          dataUrl: "data:image/png;base64,x",
        },
      ],
      failed: false,
    });
    expect(parseRunnerPayload(payload)).toEqual({
      outputs: [
        { kind: "text", text: "hi\n", stream: "stdout" },
        {
          kind: "image",
          mime: "image/png",
          dataUrl: "data:image/png;base64,x",
        },
      ],
      failed: false,
    });
  });

  it("reports a failed cell", () => {
    const payload = JSON.stringify({
      outputs: [
        { kind: "error", ename: "ValueError", evalue: "bad", traceback: "…" },
      ],
      failed: true,
    });
    expect(parseRunnerPayload(payload).failed).toBe(true);
  });

  it("drops entries that are not renderable outputs", () => {
    const payload = JSON.stringify({
      outputs: [
        { kind: "text", text: "ok", stream: null },
        { kind: "weird" },
        5,
        null,
      ],
      failed: false,
    });
    expect(parseRunnerPayload(payload).outputs).toEqual([
      { kind: "text", text: "ok", stream: null },
    ]);
  });

  it("throws on payloads that are not a runner result", () => {
    expect(() => parseRunnerPayload("not json")).toThrow();
    expect(() => parseRunnerPayload("null")).toThrow();
    expect(() =>
      parseRunnerPayload(JSON.stringify({ failed: true })),
    ).toThrow();
  });

  it("treats a missing failed flag as success", () => {
    expect(parseRunnerPayload(JSON.stringify({ outputs: [] })).failed).toBe(
      false,
    );
  });
});

describe("looksLikeFont", () => {
  const sfnt = (tag: number[]) => new Uint8Array([...tag, 0, 0, 0, 0]);

  it("accepts the sfnt signatures matplotlib can read", () => {
    expect(looksLikeFont(sfnt([0x00, 0x01, 0x00, 0x00]))).toBe(true); // TrueType
    expect(looksLikeFont(sfnt([0x4f, 0x54, 0x54, 0x4f]))).toBe(true); // 'OTTO'
    expect(looksLikeFont(sfnt([0x74, 0x72, 0x75, 0x65]))).toBe(true); // 'true'
    expect(looksLikeFont(sfnt([0x74, 0x74, 0x63, 0x66]))).toBe(true); // 'ttcf'
  });

  it("rejects the index.html the static server serves for a missing path", () => {
    // The trap this guard exists for: an absent font answers 200 with HTML, so
    // only the bytes can tell us whether the asset is really there.
    expect(looksLikeFont(new TextEncoder().encode("<!doctype html>"))).toBe(
      false,
    );
  });

  it("rejects truncated and empty responses", () => {
    expect(looksLikeFont(new Uint8Array([]))).toBe(false);
    expect(looksLikeFont(new Uint8Array([0x4f, 0x54, 0x54]))).toBe(false);
  });

  it("accepts the font actually bundled at NOTEBOOK_FONT_URL", () => {
    // Also guards the asset itself: if the .otf goes missing from src/public or
    // lands corrupted, Hangul charts silently regress to tofu boxes and nothing
    // else in the suite would notice.
    const repo = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const bytes = readFileSync(
      path.join(repo, "src/public", NOTEBOOK_FONT_URL),
    );
    expect(looksLikeFont(new Uint8Array(bytes))).toBe(true);
  });
});

describe("toErrorOutput", () => {
  it("renders a thrown Error as an error output", () => {
    expect(toErrorOutput("KernelError", new Error("worker died"))).toEqual({
      kind: "error",
      ename: "KernelError",
      evalue: "worker died",
      traceback: "",
    });
  });

  it("stringifies non-Error throws", () => {
    expect(toErrorOutput("KernelError", "boom").evalue).toBe("boom");
  });
});
