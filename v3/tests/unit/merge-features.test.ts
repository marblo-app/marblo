import { describe, it, expect } from "vitest";
import {
  parseDiffNumstat,
  classifyChangeType,
} from "../../electron/merge-features";

describe("parseDiffNumstat", () => {
  it("aggregates added/deleted lines and file count", () => {
    const out = ["10\t2\tsrc/a.ts", "5\t0\tsrc/b.ts", "0\t8\tsrc/c.ts"].join(
      "\n",
    );
    expect(parseDiffNumstat(out)).toEqual({
      filesChanged: 3,
      linesAdded: 15,
      linesDeleted: 10,
      paths: ["src/a.ts", "src/b.ts", "src/c.ts"],
    });
  });

  it("counts binary files ('-') as changed with 0 lines", () => {
    const out = ["-\t-\tassets/logo.png", "3\t1\tsrc/x.ts"].join("\n");
    const stat = parseDiffNumstat(out);
    expect(stat.filesChanged).toBe(2);
    expect(stat.linesAdded).toBe(3);
    expect(stat.linesDeleted).toBe(1);
  });

  it("ignores blank lines and malformed rows", () => {
    const out = ["", "10\t2\tsrc/a.ts", "garbage", "  "].join("\n");
    expect(parseDiffNumstat(out).filesChanged).toBe(1);
  });

  it("resolves rename notation to the destination path", () => {
    const out = ["1\t1\tsrc/{old => new}/x.ts", "2\t0\ta.ts => b.ts"].join(
      "\n",
    );
    expect(parseDiffNumstat(out).paths).toEqual(["src/new/x.ts", "b.ts"]);
  });

  it("returns zeros for empty input", () => {
    expect(parseDiffNumstat("")).toEqual({
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      paths: [],
    });
  });
});

describe("classifyChangeType", () => {
  it("returns 'unknown' for no paths", () => {
    expect(classifyChangeType([])).toBe("unknown");
    expect(classifyChangeType(["  "])).toBe("unknown");
  });

  it("classifies docs-only changes", () => {
    expect(classifyChangeType(["README.md", "docs/spec.mdx"])).toBe("docs");
    expect(classifyChangeType(["CHANGELOG"])).toBe("docs");
  });

  it("classifies test-only changes", () => {
    expect(
      classifyChangeType(["tests/unit/foo.test.ts", "src/__tests__/bar.ts"]),
    ).toBe("test");
    expect(classifyChangeType(["a.spec.tsx"])).toBe("test");
  });

  it("classifies config-only changes", () => {
    expect(
      classifyChangeType(["package.json", "tsconfig.json", ".gitignore"]),
    ).toBe("config");
    expect(classifyChangeType(["vite.config.ts"])).toBe("config");
    expect(classifyChangeType(["Dockerfile"])).toBe("config");
  });

  it("treats any code file (even alongside tests/config) as 'code'", () => {
    expect(classifyChangeType(["src/a.ts"])).toBe("code");
    expect(
      classifyChangeType(["src/a.ts", "src/a.test.ts", "package.json"]),
    ).toBe("code");
  });

  it("returns 'mixed' when spanning docs/test/config without code", () => {
    expect(classifyChangeType(["README.md", "package.json"])).toBe("mixed");
  });
});
