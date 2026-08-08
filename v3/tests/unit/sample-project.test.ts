import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  SAMPLE_DIR_NAME,
  ensureSampleProject,
  isEffectivelyEmpty,
  resolveSampleProjectDir,
  sampleProjectFiles,
  type SampleGitRunner,
} from "../../electron/sample-project";

/** 호출을 기록하고 항상 성공하는 git. 실제 git 없이 순서를 검증한다. */
function fakeGit(fail?: (args: string[]) => boolean): {
  runner: SampleGitRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: SampleGitRunner = async (args) => {
    calls.push(args);
    return fail?.(args) ? { code: 1, stderr: "boom" } : { code: 0, stderr: "" };
  };
  return { runner, calls };
}

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-sample-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("resolveSampleProjectDir", () => {
  it("puts the sample under Documents when we have one", () => {
    expect(
      resolveSampleProjectDir({
        documentsDir: "/Users/t/Documents",
        homeDir: "/Users/t",
      }),
    ).toBe(path.join("/Users/t/Documents", SAMPLE_DIR_NAME));
  });

  it("falls back to home when Documents is unavailable", () => {
    // 존재하지 않는 부모에 mkdir -p 로 파고드는 것보다 홈이 낫다.
    for (const documentsDir of [null, undefined, "", "   "]) {
      expect(
        resolveSampleProjectDir({ documentsDir, homeDir: "/Users/t" }),
      ).toBe(path.join("/Users/t", SAMPLE_DIR_NAME));
    }
  });
});

describe("isEffectivelyEmpty", () => {
  it("treats OS droppings as empty", () => {
    expect(isEffectivelyEmpty([])).toBe(true);
    expect(isEffectivelyEmpty([".DS_Store"])).toBe(true);
    expect(isEffectivelyEmpty([".DS_Store", ".localized"])).toBe(true);
  });

  it("treats any real entry as in-use", () => {
    expect(isEffectivelyEmpty(["README.md"])).toBe(false);
    expect(isEffectivelyEmpty([".DS_Store", "src"])).toBe(false);
    expect(isEffectivelyEmpty([".git"])).toBe(false);
  });
});

describe("ensureSampleProject — seeding", () => {
  it("writes a real mini project and git-inits it", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    const { runner, calls } = fakeGit();

    const result = await ensureSampleProject({ dir, git: runner });

    expect(result).toMatchObject({
      ok: true,
      created: true,
      reused: false,
      gitInitialized: true,
      path: dir,
    });

    // ★"빈 폴더가 아니다"가 이 티켓의 핵심 — 파일이 실제로 있어야 한다.
    for (const file of sampleProjectFiles()) {
      const target = path.join(dir, ...file.path.split("/"));
      expect(fs.existsSync(target), `${file.path} missing`).toBe(true);
      expect(fs.readFileSync(target, "utf8").length).toBeGreaterThan(0);
    }

    // git worktree add 는 커밋 없는 저장소에서 실패한다 → init 만으로는 부족하다.
    expect(calls[0]).toEqual(["init", "-b", "main"]);
    expect(calls.some((c) => c[0] === "add")).toBe(true);
    expect(calls.some((c) => c.includes("commit"))).toBe(true);
  });

  it("falls back to a plain init when `git init -b` is too old", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    const { runner, calls } = fakeGit((args) => args.includes("-b"));

    const result = await ensureSampleProject({ dir, git: runner });

    expect(result.ok).toBe(true);
    expect(result.gitInitialized).toBe(true);
    expect(calls[0]).toEqual(["init", "-b", "main"]);
    expect(calls[1]).toEqual(["init"]);
  });

  it("retries the commit with a fallback identity when git has none", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    // 전역 user.name/user.email 이 없는 새 머신: 아이덴티티 없는 commit 만 실패.
    const { runner, calls } = fakeGit(
      (args) => args.includes("commit") && !args.includes("user.name=Marblo"),
    );

    const result = await ensureSampleProject({ dir, git: runner });

    expect(result.gitInitialized).toBe(true);
    const commits = calls.filter((c) => c.includes("commit"));
    expect(commits).toHaveLength(2);
    // 사용자 설정이 있으면 그대로 쓰고, 없을 때만 우리 이름을 새긴다.
    expect(commits[0]).not.toContain("user.name=Marblo");
    expect(commits[1]).toContain("user.name=Marblo");
  });

  it("still connects the folder when git fails entirely (fail-soft)", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    const { runner } = fakeGit(() => true);

    const result = await ensureSampleProject({ dir, git: runner });

    // 폴더는 쓸 수 있다 — 워크트리 기능만 뒤에서 막히므로 사실만 싣는다.
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.gitInitialized).toBe(false);
    expect(fs.existsSync(path.join(dir, "README.md"))).toBe(true);
  });

  it("seeds into a folder that only holds OS droppings", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, ".DS_Store"), "");
    const { runner } = fakeGit();

    const result = await ensureSampleProject({ dir, git: runner });

    expect(result.created).toBe(true);
    expect(fs.existsSync(path.join(dir, "README.md"))).toBe(true);
  });
});

describe("ensureSampleProject — never clobbers", () => {
  it("reuses a folder that already has content, untouched", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "MY OWN WORK");
    fs.mkdirSync(path.join(dir, "src"));
    const { runner, calls } = fakeGit();

    const result = await ensureSampleProject({ dir, git: runner });

    expect(result).toMatchObject({ ok: true, created: false, reused: true });
    // 한 바이트도 건드리지 않는다 — 사용자가 이 폴더를 실제로 쓰고 있을 수 있다.
    expect(fs.readFileSync(path.join(dir, "README.md"), "utf8")).toBe(
      "MY OWN WORK",
    );
    expect(fs.readdirSync(dir).sort()).toEqual(["README.md", "src"]);
    // 남의 저장소에 대고 init/commit 을 돌리지도 않는다.
    expect(calls).toEqual([]);
  });

  it("reports git presence for a reused folder", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    const { runner } = fakeGit();

    const result = await ensureSampleProject({ dir, git: runner });

    expect(result.reused).toBe(true);
    expect(result.gitInitialized).toBe(true);
  });

  it("refuses when the path is a file, not a folder", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    fs.writeFileSync(dir, "not a folder");
    const { runner } = fakeGit();

    const result = await ensureSampleProject({ dir, git: runner });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a directory/);
  });

  it("refuses a relative path", async () => {
    const { runner } = fakeGit();
    const result = await ensureSampleProject({
      dir: "relative/sample",
      git: runner,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/absolute/);
  });
});

describe("sample content", () => {
  const files = sampleProjectFiles();
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  it("carries no secrets and no external dependencies", () => {
    for (const file of files) {
      expect(
        /BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key\s*[:=]|secret\s*[:=]|password\s*[:=]/i.test(
          file.content,
        ),
        `${file.path} looks like it carries a credential`,
      ).toBe(false);
    }
    const pkg = JSON.parse(byPath.get("package.json")!);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    expect(pkg.license).toBe("MIT");
    expect(byPath.get("LICENSE")).toMatch(/^MIT License/);
  });

  it("gives every beginner example chip something real to bite on", () => {
    // 칩 ①「README 를 읽고 시작 가이드를 정리해 줘」
    expect(byPath.get("README.md")!.length).toBeGreaterThan(200);
    // 칩 ②「테스트가 없는 함수에 테스트를 붙여 줘」 — format.js 는 일부러 무테스트.
    expect(byPath.has("src/format.js")).toBe(true);
    expect(files.some((f) => f.path.startsWith("test/"))).toBe(true);
    expect(files.some((f) => f.path.includes("format.test"))).toBe(false);
    // 칩 ③「이 프로젝트 구조를 설명해 줘」 — 설명할 구조가 있으려면 파일이 여럿.
    expect(files.filter((f) => f.path.endsWith(".js")).length).toBeGreaterThan(
      2,
    );
  });

  it("localizes only the README", () => {
    const ko = new Map(
      sampleProjectFiles("ko").map((f) => [f.path, f.content]),
    );
    const en = new Map(
      sampleProjectFiles("en").map((f) => [f.path, f.content]),
    );
    expect(ko.get("README.md")).not.toBe(en.get("README.md"));
    for (const p of ko.keys()) {
      if (p === "README.md") continue;
      expect(en.get(p), `${p} should not differ by locale`).toBe(ko.get(p));
    }
  });
});

describe("the seeded project actually runs", () => {
  // 이 티켓의 완료 기준은 "폴더가 열린다" 가 아니라 "첫 지시가 진짜 결과를 낸다"
  // 이다. 그러려면 시드된 코드가 **설치 없이** 실제로 돌아야 한다.
  it("passes its own tests with `node --test` and no npm install", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    const { runner } = fakeGit();
    await ensureSampleProject({ dir, git: runner });

    expect(() =>
      execFileSync(process.execPath, ["--test"], {
        cwd: dir,
        stdio: "pipe",
        timeout: 60_000,
      }),
    ).not.toThrow();
  });

  it("runs the demo entrypoint", async () => {
    const dir = path.join(tmp, SAMPLE_DIR_NAME);
    const { runner } = fakeGit();
    await ensureSampleProject({ dir, git: runner });

    const out = execFileSync(process.execPath, ["src/demo.js"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(out).toContain("Read the README");
    expect(out).toMatch(/1\/3 done/);
  });
});
