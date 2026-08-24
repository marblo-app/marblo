import { describe, expect, it } from "vitest";
import type { execFile } from "node:child_process";
import {
  normalizeDispatchScopePaths,
  preflightDispatchScopeInHead,
} from "../../electron/mcp-server/dispatch-scope-preflight";

type ExecFileCallback = Parameters<typeof execFile>[3];

function fakeExecFile(existingHeadPaths: Set<string>): typeof execFile {
  return ((command: string, args: string[], _options: unknown, cb: unknown) => {
    const callback = cb as ExecFileCallback;
    if (command !== "git") {
      callback(new Error("unexpected command"), "", "");
      return null;
    }
    if (args[0] === "rev-parse") {
      callback(null, "/repo\n", "");
      return null;
    }
    if (args[0] === "cat-file" && args[1] === "-e") {
      const spec = args[2] ?? "";
      const file = spec.startsWith("HEAD:") ? spec.slice("HEAD:".length) : spec;
      callback(
        existingHeadPaths.has(file) ? null : new Error("missing"),
        "",
        "",
      );
      return null;
    }
    callback(new Error("unexpected git args"), "", "");
    return null;
  }) as unknown as typeof execFile;
}

describe("dispatch scope HEAD preflight", () => {
  it("정상 파일 경로만 scope 후보로 본다", () => {
    expect(
      normalizeDispatchScopePaths([
        "v3/electron/mcp-server/tools.ts",
        "/abs/path",
        "../escape",
        "https://example.com/x",
        "",
        "-bad",
        "docs\\note.md",
      ]),
    ).toEqual(["v3/electron/mcp-server/tools.ts", "docs/note.md"]);
  });

  it("HEAD 에 없는 scope 파일은 경고하지만 실패로 만들지 않는다", async () => {
    const res = await preflightDispatchScopeInHead({
      cwd: "/repo",
      scope: ["src/existing.ts", "src/new-file.ts"],
      execFileImpl: fakeExecFile(new Set(["src/existing.ts"])),
    });

    expect(res.missing).toEqual(["src/new-file.ts"]);
    expect(res.warning).toContain("HEAD 에 아직 없는 scope 파일");
    expect(res.warning).toContain("디스패치는 계속합니다");
  });

  it("Git 확인 자체가 실패하면 경고 없이 기존 dispatch 흐름을 유지한다", async () => {
    const failingExec = ((_: string, __: string[], ___: unknown, cb: unknown) => {
      (cb as ExecFileCallback)(new Error("not a repo"), "", "");
      return null;
    }) as unknown as typeof execFile;

    const res = await preflightDispatchScopeInHead({
      cwd: "/repo",
      scope: ["src/new-file.ts"],
      execFileImpl: failingExec,
    });

    expect(res).toEqual({ warning: "", missing: [] });
  });
});
