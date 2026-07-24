import { describe, expect, it } from "vitest";
import {
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
