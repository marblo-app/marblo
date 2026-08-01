import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  classifyCloneError,
  cloneRepo,
  defaultCloneParentDir,
  deriveRepoDirName,
  validateCloneUrl,
  type GitRunner,
} from "../../electron/repo-clone";

// 팀 멤버 "Clone & 연결" 원클릭 (티켓 r8VggohxLGciDVXV2rf6) — URL 검증·대상
// 경로 조합·에러 분류가 안전 계약의 전부이므로 여기서 전수 검증한다.

const tmpDirs: string[] = [];
function tmpDir(): string {
  const d = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-clone-")),
  );
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("validateCloneUrl", () => {
  it("accepts https / http / ssh:// / scp-like URLs", () => {
    expect(validateCloneUrl("https://github.com/acme/app.git")).toBe(
      "https://github.com/acme/app.git",
    );
    expect(validateCloneUrl("http://git.corp.local/team/app")).toBe(
      "http://git.corp.local/team/app",
    );
    expect(validateCloneUrl("ssh://git@github.com/acme/app.git")).toBe(
      "ssh://git@github.com/acme/app.git",
    );
    expect(validateCloneUrl("git@github.com:acme/app.git")).toBe(
      "git@github.com:acme/app.git",
    );
    expect(validateCloneUrl("  https://github.com/acme/app  ")).toBe(
      "https://github.com/acme/app",
    );
  });

  it("rejects option-injection / local / non-git schemes", () => {
    expect(validateCloneUrl("-upload-pack=touch /tmp/pwn")).toBeNull();
    expect(validateCloneUrl("--mirror")).toBeNull();
    expect(validateCloneUrl("file:///etc/passwd")).toBeNull();
    expect(validateCloneUrl("ext::sh -c 'touch /tmp/pwn'")).toBeNull();
    expect(validateCloneUrl("/local/path/repo")).toBeNull();
    expect(validateCloneUrl("ftp://host/repo")).toBeNull();
    expect(validateCloneUrl("https://host.only/")).toBeNull();
    expect(validateCloneUrl("url with spaces")).toBeNull();
    expect(validateCloneUrl("")).toBeNull();
    expect(validateCloneUrl(null)).toBeNull();
    expect(validateCloneUrl(undefined)).toBeNull();
  });
});

describe("deriveRepoDirName", () => {
  it("derives folder name from URL last segment, dropping .git", () => {
    expect(deriveRepoDirName("https://github.com/acme/app.git")).toBe("app");
    expect(deriveRepoDirName("git@github.com:acme/my-repo.git")).toBe(
      "my-repo",
    );
    expect(deriveRepoDirName("https://github.com/acme/app/")).toBe("app");
  });

  it("sanitizes hostile names (no leading dot/dash, no separators)", () => {
    expect(deriveRepoDirName("https://h/o/..%2f..%2fescape")).not.toContain(
      "/",
    );
    expect(deriveRepoDirName("https://h/o/.hidden").startsWith(".")).toBe(
      false,
    );
    expect(deriveRepoDirName("https://h/o/---rf").startsWith("-")).toBe(false);
    expect(deriveRepoDirName("https://h/o/....git")).toBe("repo");
  });
});

describe("classifyCloneError", () => {
  it("maps stderr to actionable kinds", () => {
    expect(classifyCloneError("fatal: Authentication failed for ...")).toBe(
      "auth",
    );
    expect(
      classifyCloneError(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      ),
    ).toBe("auth");
    expect(
      classifyCloneError("git@github.com: Permission denied (publickey)"),
    ).toBe("auth");
    expect(classifyCloneError("remote: Repository not found.")).toBe(
      "not-found",
    );
    expect(
      classifyCloneError(
        "fatal: unable to access '...': Could not resolve host",
      ),
    ).toBe("network");
    expect(classifyCloneError("fatal: some other failure")).toBe("git");
  });
});

describe("cloneRepo", () => {
  const okRunner: GitRunner = async (args) => {
    // 성공 러너 — git 이 만들 폴더를 흉내낸다.
    const dest = args[args.length - 1];
    fs.mkdirSync(dest, { recursive: true });
    return { code: 0, stderr: "" };
  };

  it("clones into parentDir/<derived-name> and passes -- before the url", async () => {
    const parent = tmpDir();
    let seenArgs: string[] = [];
    const runner: GitRunner = async (args, opts) => {
      seenArgs = args;
      return okRunner(args, opts);
    };
    const r = await cloneRepo(
      { repoUrl: "https://github.com/acme/app.git", parentDir: parent },
      runner,
    );
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(parent, "app"));
    expect(seenArgs.slice(0, 2)).toEqual(["clone", "--"]);
    expect(seenArgs[2]).toBe("https://github.com/acme/app.git");
  });

  it("rejects invalid urls without running git", async () => {
    let ran = false;
    const runner: GitRunner = async () => {
      ran = true;
      return { code: 0, stderr: "" };
    };
    const r = await cloneRepo(
      { repoUrl: "file:///etc/passwd", parentDir: tmpDir() },
      runner,
    );
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("invalid-url");
    expect(ran).toBe(false);
  });

  it("refuses to clone over an existing target (exists)", async () => {
    const parent = tmpDir();
    fs.mkdirSync(path.join(parent, "app"));
    let ran = false;
    const runner: GitRunner = async () => {
      ran = true;
      return { code: 0, stderr: "" };
    };
    const r = await cloneRepo(
      { repoUrl: "https://github.com/acme/app.git", parentDir: parent },
      runner,
    );
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("exists");
    expect(r.path).toBe(path.join(parent, "app"));
    expect(ran).toBe(false);
  });

  it("rejects a relative parentDir", async () => {
    const r = await cloneRepo(
      { repoUrl: "https://github.com/acme/app.git", parentDir: "relative/dir" },
      okRunner,
    );
    expect(r.ok).toBe(false);
  });

  it("classifies git failure stderr and reports a summary", async () => {
    const parent = tmpDir();
    const runner: GitRunner = async () => ({
      code: 128,
      stderr: "fatal: Authentication failed for 'https://github.com/x'",
    });
    const r = await cloneRepo(
      { repoUrl: "https://github.com/acme/app.git", parentDir: parent },
      runner,
    );
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("auth");
    expect(r.message).toContain("Authentication failed");
  });

  it("default clone parent is an absolute path under the home dir", () => {
    // cloneRepo 를 parentDir 없이 실행하면 실제 홈에 ~/Marblo 를 만들므로
    // (테스트 부작용) 여기서는 기본값의 모양만 검증한다.
    const def = defaultCloneParentDir();
    expect(path.isAbsolute(def)).toBe(true);
    expect(def.startsWith(os.homedir() + path.sep)).toBe(true);
    expect(path.basename(def)).toBe("Marblo");
  });
});
