import { describe, expect, it } from "vitest";
import { isNotebookFile } from "../src/lib/notebookFiles";
import {
  NotebookParseError,
  joinSource,
  parseNotebook,
  parseOutput,
  pickMime,
  stripAnsi,
  toFencedMarkdown,
} from "../src/lib/notebook";

describe("isNotebookFile", () => {
  it("recognizes .ipynb (case-insensitive, any separator)", () => {
    for (const p of [
      "analysis.ipynb",
      "notebooks/quant.IPYNB",
      "C:\\proj\\backtest.ipynb",
    ]) {
      expect(isNotebookFile(p)).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const p of [
      "main.py",
      "README.md",
      "ipynb", // no dot
      "chart.ipynb.bak", // final ext wins
      ".ipynb_checkpoints", // dotfile, ext is "ipynb_checkpoints"
    ]) {
      expect(isNotebookFile(p)).toBe(false);
    }
  });
});

describe("joinSource", () => {
  it("accepts both the string and string[] spellings of nbformat text", () => {
    expect(joinSource("a\nb")).toBe("a\nb");
    expect(joinSource(["a\n", "b"])).toBe("a\nb");
    expect(joinSource(undefined)).toBe("");
    expect(joinSource(42)).toBe("");
  });
});

describe("stripAnsi", () => {
  it("removes colour codes but keeps the text", () => {
    expect(stripAnsi("\u001b[0;31mZeroDivisionError\u001b[0m: boom")).toBe(
      "ZeroDivisionError: boom",
    );
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });
});

describe("toFencedMarkdown", () => {
  it("wraps source in a normal fence with the language tag", () => {
    expect(toFencedMarkdown("x = 1", "python")).toBe("```python\nx = 1\n```");
  });

  it("grows the fence past any backtick run so the source cannot break out", () => {
    const src = 'help = """\n```\nfenced\n```\n"""';
    const out = toFencedMarkdown(src, "python");
    expect(out.startsWith("````python\n")).toBe(true);
    expect(out.endsWith("\n````")).toBe(true);
    // The inner ``` stays inside the block rather than closing it.
    expect(out.slice(11, -5)).toBe(src);
  });

  it("handles empty source without collapsing the fence", () => {
    expect(toFencedMarkdown("", "python")).toBe("```python\n\n```");
  });
});

describe("pickMime", () => {
  it("prefers the picture over the repr fallback", () => {
    expect(
      pickMime({ "text/plain": "<Figure size 640x480>", "image/png": "iVBO" }),
    ).toBe("image/png");
  });

  it("prefers rendered html over plain text (pandas DataFrame)", () => {
    expect(pickMime({ "text/plain": "   a  b", "text/html": "<table>" })).toBe(
      "text/html",
    );
  });

  it("returns null for a bundle with nothing renderable", () => {
    expect(pickMime({ "application/vnd.custom+json": {} })).toBeNull();
  });
});

describe("parseOutput", () => {
  it("normalizes stdout and stderr streams", () => {
    expect(
      parseOutput({ output_type: "stream", name: "stdout", text: ["hi\n"] }),
    ).toEqual({ kind: "text", text: "hi\n", stream: "stdout" });
    expect(
      parseOutput({ output_type: "stream", name: "stderr", text: "warn" }),
    ).toEqual({ kind: "text", text: "warn", stream: "stderr" });
  });

  it("drops empty streams", () => {
    expect(
      parseOutput({ output_type: "stream", name: "stdout", text: [] }),
    ).toBeNull();
  });

  it("builds a data URL for a base64 png, squeezing line wrapping", () => {
    const out = parseOutput({
      output_type: "display_data",
      data: { "image/png": ["iVBOR\n", "w0KG\n"] },
    });
    expect(out).toEqual({
      kind: "image",
      mime: "image/png",
      dataUrl: "data:image/png;base64,iVBORw0KG",
    });
  });

  it("keeps html output as html", () => {
    expect(
      parseOutput({
        output_type: "execute_result",
        data: { "text/html": "<table><tr><td>1</td></tr></table>" },
      }),
    ).toEqual({ kind: "html", html: "<table><tr><td>1</td></tr></table>" });
  });

  it("flattens a traceback and strips its colour codes", () => {
    const out = parseOutput({
      output_type: "error",
      ename: "ZeroDivisionError",
      evalue: "division by zero",
      traceback: ["\u001b[0;31mTraceback\u001b[0m", "  line 1"],
    });
    expect(out).toEqual({
      kind: "error",
      ename: "ZeroDivisionError",
      evalue: "division by zero",
      traceback: "Traceback\n  line 1",
    });
  });

  it("understands nbformat v3 pyout with inlined mime keys", () => {
    expect(parseOutput({ output_type: "pyout", text: ["42"] })).toEqual({
      kind: "text",
      text: "42",
      stream: null,
    });
  });

  it("ignores unknown output shapes", () => {
    expect(parseOutput({ output_type: "something_new" })).toBeNull();
    expect(parseOutput("nope")).toBeNull();
  });
});

const NB_V4 = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: {
      display_name: "Python 3",
      name: "python3",
      language: "python",
    },
    language_info: { name: "python" },
  },
  cells: [
    { id: "md1", cell_type: "markdown", source: ["# Title\n", "text"] },
    {
      id: "c1",
      cell_type: "code",
      execution_count: 3,
      source: "print('hi')\n",
      outputs: [
        { output_type: "stream", name: "stdout", text: "hi\n" },
        { output_type: "display_data", data: { "image/png": "iVBORw0KG" } },
      ],
    },
    {
      cell_type: "raw",
      source: "raw text",
      outputs: [{ output_type: "stream", text: "x" }],
    },
  ],
});

describe("parseNotebook", () => {
  it("parses cells, language, kernel and execution counts", () => {
    const nb = parseNotebook(NB_V4);
    expect(nb.language).toBe("python");
    expect(nb.kernelName).toBe("Python 3");
    expect(nb.nbformat).toBe(4);
    expect(nb.cells.map((c) => c.type)).toEqual(["markdown", "code", "raw"]);
    expect(nb.cells[0].source).toBe("# Title\ntext");
    expect(nb.cells[1].executionCount).toBe(3);
    expect(nb.cells[1].outputs).toHaveLength(2);
  });

  it("gives every cell a stable key, synthesizing one when id is absent", () => {
    const ids = parseNotebook(NB_V4).cells.map((c) => c.id);
    expect(ids).toEqual(["md1", "c1", "cell-2"]);
    expect(new Set(ids).size).toBe(3);
  });

  it("never attaches outputs to non-code cells", () => {
    expect(parseNotebook(NB_V4).cells[2].outputs).toEqual([]);
  });

  it("flattens nbformat v3 worksheets", () => {
    const nb = parseNotebook(
      JSON.stringify({
        nbformat: 3,
        worksheets: [
          { cells: [{ cell_type: "code", input: ["1+1"], prompt_number: 1 }] },
        ],
      }),
    );
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].source).toBe("1+1");
    expect(nb.cells[0].executionCount).toBe(1);
  });

  it("defaults the language to python when metadata is missing", () => {
    expect(parseNotebook(JSON.stringify({ cells: [] })).language).toBe(
      "python",
    );
  });

  it("throws NotebookParseError on malformed JSON and on non-notebook JSON", () => {
    expect(() => parseNotebook("{not json")).toThrow(NotebookParseError);
    expect(() => parseNotebook("[]")).toThrow(NotebookParseError);
    expect(() => parseNotebook(JSON.stringify({ hello: 1 }))).toThrow(
      NotebookParseError,
    );
  });
});
