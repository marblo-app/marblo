/**
 * push 자격증명 분기 + 커밋 귀속 단위검증 (티켓 FYIyUuhJbv2cDVjgkRGf, v2).
 *
 * ★여기서 증명하는 것:
 *   1. **회귀 0** — App 설치가 없으면 push 경로도 서버를 부르지 않는다
 *   2. ★역할 거부는 **device 로 폴백하지 않는다** (게이트를 스스로 뚫지 않는다)
 *   3. 오너 재승인 전에는 device 경로 = v2 이전과 같은 상태
 *   4. ★커밋 귀속이 비공개 이메일 사용자에게도 깨지지 않는다
 *   5. 토큰이 argv·반환값·에러 메시지에 안 실린다
 */
import { describe, expect, it, vi } from "vitest";

import {
  resolveCloneCredential,
  resolvePushCredential,
  type PushCredentialDeps,
  type WriteTokenOutcome,
} from "../../electron/github-clone-credential";
import {
  applyCommitIdentity,
  fetchCommitIdentity,
  githubNoreplyEmail,
  isNoreplyEmail,
  parseCommitIdentity,
} from "../../electron/github-commit-identity";
import {
  classifyPushError,
  normalizeBranchName,
  pushBranch,
  pushErrorMessage,
  summarizePushStderr,
} from "../../electron/repo-push";

const PROJECT = "proj-1";
const REPO_URL = "https://github.com/acme/app.git";
const DEVICE = "gho_device_dummy";
const INSTALL_WRITE = "ghs_write_dummy";

function deps(over: Partial<PushCredentialDeps> = {}): PushCredentialDeps {
  return {
    getInstallationId: async () => "12345678",
    issueWriteToken: async (): Promise<WriteTokenOutcome> => ({
      kind: "granted",
      token: INSTALL_WRITE,
    }),
    getDeviceToken: () => DEVICE,
    ...over,
  };
}

describe("resolvePushCredential — 회귀 0", () => {
  it("★App 설치가 없으면 서버를 부르지 않는다 (오늘의 모든 프로젝트)", async () => {
    const issueWriteToken = vi.fn();
    const got = await resolvePushCredential(
      { projectId: PROJECT, repoUrl: REPO_URL, ref: "feature/x" },
      deps({ getInstallationId: async () => null, issueWriteToken }),
    );
    expect(got).toEqual({ kind: "device", token: DEVICE });
    expect(issueWriteToken).not.toHaveBeenCalled();
  });

  it("★GitHub HTTPS 가 아니면 App 경로를 아예 타지 않는다 (G5)", async () => {
    const getInstallationId = vi.fn();
    const issueWriteToken = vi.fn();
    for (const url of [
      "git@github.com:acme/app.git",
      "ssh://git@github.com/acme/app.git",
      "https://gitlab.com/acme/app.git",
    ]) {
      const got = await resolvePushCredential(
        { projectId: PROJECT, repoUrl: url, ref: "feature/x" },
        deps({ getInstallationId, issueWriteToken }),
      );
      expect(got).toEqual({ kind: "device", token: DEVICE });
    }
    expect(getInstallationId).not.toHaveBeenCalled();
    expect(issueWriteToken).not.toHaveBeenCalled();
  });

  it("projectId 가 없으면(수동 URL) device 그대로", async () => {
    const got = await resolvePushCredential(
      { repoUrl: REPO_URL, ref: "feature/x" },
      deps(),
    );
    expect(got).toEqual({ kind: "device", token: DEVICE });
  });

  it("device 토큰도 없으면 none — 크래시하지 않는다", async () => {
    const got = await resolvePushCredential(
      { repoUrl: REPO_URL, ref: "feature/x" },
      deps({ getDeviceToken: () => null }),
    );
    expect(got).toEqual({ kind: "none" });
  });
});

describe("resolvePushCredential — ★역할 게이트를 스스로 뚫지 않는다", () => {
  it("★역할 거부는 device 로 폴백하지 않는다", async () => {
    const got = await resolvePushCredential(
      { projectId: PROJECT, repoUrl: REPO_URL, ref: "main" },
      deps({
        issueWriteToken: async () => ({
          kind: "role-denied",
          message: "기본 브랜치에 직접 밀 수 없습니다.",
        }),
      }),
    );
    // ★여기서 { kind: "device" } 가 나오면 화면의 Merge 게이트가 뚫린다.
    expect(got).toEqual({
      kind: "denied",
      message: "기본 브랜치에 직접 밀 수 없습니다.",
    });
  });

  it("viewer 거부도 마찬가지로 폴백 없음", async () => {
    const got = await resolvePushCredential(
      { projectId: PROJECT, repoUrl: REPO_URL, ref: "feature/x" },
      deps({
        issueWriteToken: async () => ({
          kind: "role-denied",
          message: "코드를 밀 수 있는 역할이 아닙니다.",
        }),
      }),
    );
    expect(got.kind).toBe("denied");
  });
});

describe("resolvePushCredential — 재승인 대기·장애는 폴백한다", () => {
  it("★오너 재승인 전이면 device 경로 — v2 이전과 같은 상태(회귀 아님)", async () => {
    const got = await resolvePushCredential(
      { projectId: PROJECT, repoUrl: REPO_URL, ref: "feature/x" },
      deps({ issueWriteToken: async () => ({ kind: "needs-owner-approval" }) }),
    );
    expect(got).toEqual({ kind: "device", token: DEVICE });
  });

  it("레이트리밋·네트워크 장애는 device 로 내려간다 (G2)", async () => {
    const got = await resolvePushCredential(
      { projectId: PROJECT, repoUrl: REPO_URL, ref: "feature/x" },
      deps({ issueWriteToken: async () => ({ kind: "unavailable" }) }),
    );
    expect(got).toEqual({ kind: "device", token: DEVICE });
  });

  it("발급 함수가 던져도 흡수한다 — push 경로가 크래시하지 않는다", async () => {
    const got = await resolvePushCredential(
      { projectId: PROJECT, repoUrl: REPO_URL, ref: "feature/x" },
      deps({
        issueWriteToken: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(got).toEqual({ kind: "device", token: DEVICE });
  });

  it("성공하면 App write 토큰을 쓴다", async () => {
    const got = await resolvePushCredential(
      { projectId: PROJECT, repoUrl: REPO_URL, ref: "feature/x" },
      deps(),
    );
    expect(got).toEqual({ kind: "installation", token: INSTALL_WRITE });
  });

  it("밀려는 ref 가 서버로 그대로 전달된다 (기본 브랜치 판정 입력)", async () => {
    const issueWriteToken = vi.fn(
      async (): Promise<WriteTokenOutcome> => ({ kind: "unavailable" }),
    );
    await resolvePushCredential(
      { projectId: PROJECT, repoUrl: REPO_URL, ref: "release/1.2" },
      deps({ issueWriteToken }),
    );
    expect(issueWriteToken).toHaveBeenCalledWith(PROJECT, "release/1.2");
  });
});

describe("★clone 경로는 v2 가 건드리지 않았다", () => {
  it("resolveCloneCredential 의 반환 모양이 v1 그대로다", async () => {
    const got = await resolveCloneCredential(
      { projectId: PROJECT, repoUrl: REPO_URL },
      {
        getInstallationId: async () => "12345678",
        issueInstallationToken: async () => "ghs_read_dummy",
        getDeviceToken: () => DEVICE,
      },
    );
    expect(got).toEqual({ kind: "installation", token: "ghs_read_dummy" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★커밋 귀속 — 조용히 깨지는 자리
// ═════════════════════════════════════════════════════════════════════════════

describe("커밋 귀속 이메일 선택", () => {
  it("★비공개 이메일 사용자는 id 붙은 noreply 로 접힌다 (귀속 유지)", () => {
    const id = parseCommitIdentity({ id: 583231, login: "octocat", email: null });
    expect(id).toEqual({
      name: "octocat",
      email: "583231+octocat@users.noreply.github.com",
      login: "octocat",
      usesNoreply: true,
    });
  });

  it("★구형 noreply(id 없음)를 만들지 않는다 — 2017년 이후 계정에 매칭이 안 된다", () => {
    expect(githubNoreplyEmail(583231, "octocat")).toBe(
      "583231+octocat@users.noreply.github.com",
    );
    expect(githubNoreplyEmail(583231, "octocat")).not.toBe(
      "octocat@users.noreply.github.com",
    );
  });

  it("공개 프로필 이메일이 있으면 그대로 쓴다", () => {
    const id = parseCommitIdentity({
      id: 1,
      login: "alice",
      name: "Alice Kim",
      email: "alice@example.com",
    });
    expect(id?.email).toBe("alice@example.com");
    expect(id?.name).toBe("Alice Kim");
    expect(id?.usesNoreply).toBe(false);
  });

  it("이메일 모양이 이상하면 믿지 않고 noreply 로 간다", () => {
    for (const bad of ["not-an-email", "a@b", "", "   ", 42, null]) {
      const id = parseCommitIdentity({ id: 7, login: "bob", email: bad });
      expect(id?.email).toBe("7+bob@users.noreply.github.com");
    }
  });

  it("name 이 없으면 login 을 쓴다 — 매칭은 이메일로 하므로 표시용일 뿐", () => {
    expect(parseCommitIdentity({ id: 7, login: "bob" })?.name).toBe("bob");
    expect(parseCommitIdentity({ id: 7, login: "bob", name: "  " })?.name).toBe(
      "bob",
    );
  });

  it("★모양이 어긋난 응답은 null — 추측해서 틀린 이메일을 박지 않는다", () => {
    for (const bad of [
      null,
      undefined,
      {},
      { id: 7 },
      { login: "bob" },
      { id: 0, login: "bob" },
      { id: -1, login: "bob" },
      { id: 1.5, login: "bob" },
      { id: "7", login: "bob" },
      { id: 7, login: "" },
      { id: 7, login: "bad login" },
      { id: 7, login: "-leading" },
    ]) {
      expect(parseCommitIdentity(bad as never)).toBeNull();
    }
  });

  it("isNoreplyEmail: 구형·신형 둘 다 잡는다", () => {
    expect(isNoreplyEmail("7+bob@users.noreply.github.com")).toBe(true);
    expect(isNoreplyEmail("bob@users.noreply.github.com")).toBe(true);
    expect(isNoreplyEmail("bob@example.com")).toBe(false);
  });
});

describe("fetchCommitIdentity — fail-soft, 토큰 비노출", () => {
  it("device 토큰이 없으면 네트워크를 타지 않는다", async () => {
    const fetcher = vi.fn();
    expect(await fetchCommitIdentity("", fetcher as never)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("비 200 이면 null — clone/push 를 막지 않는다", async () => {
    const got = await fetchCommitIdentity("gho_x", (async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as never);
    expect(got).toBeNull();
  });

  it("던져도 null 로 흡수한다", async () => {
    const got = await fetchCommitIdentity("gho_x", (() => {
      throw new Error("network");
    }) as never);
    expect(got).toBeNull();
  });

  it("★토큰은 Authorization 헤더로만 가고 URL 에 안 실린다", async () => {
    let seenUrl = "";
    let seenAuth = "";
    await fetchCommitIdentity("gho_secret", (async (
      url: string,
      init: { headers: Record<string, string> },
    ) => {
      seenUrl = url;
      seenAuth = init.headers.authorization;
      return { ok: true, status: 200, json: async () => ({ id: 1, login: "a" }) };
    }) as never);
    expect(seenUrl).toBe("https://api.github.com/user");
    expect(seenUrl).not.toContain("gho_secret");
    expect(seenAuth).toBe("Bearer gho_secret");
  });
});

describe("applyCommitIdentity — repo-local 만 건드린다", () => {
  it("★--local 로만 쓴다 — 사용자의 전역 git 설정에 번지지 않는다", async () => {
    const calls: string[][] = [];
    const ok = await applyCommitIdentity(
      "/repo",
      {
        name: "Alice",
        email: "1+alice@users.noreply.github.com",
        login: "alice",
        usesNoreply: true,
      },
      async (args) => {
        calls.push(args);
        return { code: 0, stderr: "" };
      },
    );
    expect(ok).toBe(true);
    expect(calls).toEqual([
      ["config", "--local", "user.name", "Alice"],
      ["config", "--local", "user.email", "1+alice@users.noreply.github.com"],
    ]);
    expect(calls.flat()).not.toContain("--global");
  });

  it("실패는 false — 조용히 true 를 돌려주지 않는다", async () => {
    const ok = await applyCommitIdentity(
      "/repo",
      { name: "A", email: "a@b.com", login: "a", usesNoreply: false },
      async () => ({ code: 1, stderr: "not a git repository" }),
    );
    expect(ok).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// push 실행
// ═════════════════════════════════════════════════════════════════════════════

describe("pushBranch", () => {
  it("★토큰이 argv 에 안 실리고 GIT_CONFIG_* env 로만 간다 (#1097 재사용)", async () => {
    let seenArgs: string[] = [];
    let seenEnv: Record<string, string> = {};
    await pushBranch(
      {
        repoPath: "/repo",
        remoteUrl: REPO_URL,
        branch: "feature/login",
        githubToken: INSTALL_WRITE,
      },
      async (args, opts) => {
        seenArgs = args;
        seenEnv = opts.env ?? {};
        return { code: 0, stderr: "" };
      },
    );
    expect(seenArgs).toEqual([
      "push",
      "--set-upstream",
      "origin",
      "refs/heads/feature/login:refs/heads/feature/login",
    ]);
    expect(seenArgs.join(" ")).not.toContain(INSTALL_WRITE);
    expect(seenEnv.GIT_CONFIG_KEY_0).toBe(
      "http.https://github.com/.extraHeader",
    );
    // 토큰은 base64 Basic 헤더 안에만 있다 — 평문으로 노출되지 않는다.
    expect(seenEnv.GIT_CONFIG_VALUE_0).toContain("Authorization: Basic ");
    expect(seenEnv.GIT_CONFIG_VALUE_0).not.toContain(INSTALL_WRITE);
  });

  it("refspec 이 완전 형태라 옵션으로 오독될 수 없다", async () => {
    let seenArgs: string[] = [];
    await pushBranch(
      { repoPath: "/repo", remoteUrl: REPO_URL, branch: "refs/heads/x" },
      async (args) => {
        seenArgs = args;
        return { code: 0, stderr: "" };
      },
    );
    expect(seenArgs[3]).toBe("refs/heads/x:refs/heads/x");
    expect(
      seenArgs.some((a) => a.startsWith("-") && a !== "--set-upstream"),
    ).toBe(false);
  });

  it("force 하지 않는다", async () => {
    let seenArgs: string[] = [];
    await pushBranch(
      { repoPath: "/repo", remoteUrl: REPO_URL, branch: "x" },
      async (args) => {
        seenArgs = args;
        return { code: 0, stderr: "" };
      },
    );
    expect(seenArgs.join(" ")).not.toMatch(/--force|-f\b/);
  });

  it("GitHub HTTPS 가 아니면 토큰을 주입하지 않는다", async () => {
    let seenEnv: Record<string, string> = {};
    await pushBranch(
      {
        repoPath: "/repo",
        remoteUrl: "git@github.com:acme/app.git",
        branch: "x",
        githubToken: INSTALL_WRITE,
      },
      async (_a, opts) => {
        seenEnv = opts.env ?? {};
        return { code: 0, stderr: "" };
      },
    );
    expect(seenEnv.GIT_CONFIG_KEY_0).toBeUndefined();
  });

  it("나쁜 브랜치 이름은 git 을 실행조차 하지 않는다", async () => {
    const runner = vi.fn();
    const r = await pushBranch(
      { repoPath: "/repo", remoteUrl: REPO_URL, branch: "--upload-pack=evil" },
      runner as never,
    );
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("invalid-branch");
    expect(runner).not.toHaveBeenCalled();
  });

  it("★실패 메시지에 토큰이 안 남는다", async () => {
    const r = await pushBranch(
      {
        repoPath: "/repo",
        remoteUrl: REPO_URL,
        branch: "x",
        githubToken: INSTALL_WRITE,
      },
      async () => ({
        code: 1,
        stderr: `fatal: something odd happened with ${INSTALL_WRITE}`,
      }),
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(INSTALL_WRITE);
    expect(r.message).toContain("[redacted]");
  });
});

describe("classifyPushError — 겉면만 보고 틀린 안내를 하지 않는다", () => {
  const cases: Array<[string, string]> = [
    [
      "remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)",
      "protected-branch",
    ],
    [
      "remote: error: GH007: Your push would publish a private email address.",
      "private-email",
    ],
    [
      "remote: Permission to acme/app.git denied to marblo[bot].\nfatal: unable to access ...: The requested URL returned error: 403",
      "denied",
    ],
    [
      " ! [rejected] main -> main (non-fast-forward)\nhint: Updates were rejected because the tip of your current branch is behind",
      "rejected",
    ],
    ["error: src refspec x does not match any", "no-commits"],
    ["fatal: could not resolve host: github.com", "network"],
    ["remote: Repository not found.", "denied"],
    [
      "fatal: Authentication failed for 'https://github.com/acme/app.git/'",
      "auth",
    ],
  ];
  for (const [stderr, kind] of cases) {
    it(`${kind}: ${stderr.slice(0, 40)}…`, () => {
      expect(classifyPushError(stderr)).toBe(kind);
    });
  }

  it("★보호 브랜치를 'pull 하세요' 로 오안내하지 않는다", () => {
    // GitHub 은 보호 브랜치 거절도 '[remote rejected]' 로 감싸 보낸다.
    const stderr =
      " ! [remote rejected] main -> main (protected branch hook declined)\nerror: failed to push some refs";
    expect(classifyPushError(stderr)).toBe("protected-branch");
    expect(pushErrorMessage("protected-branch")).toContain("PR");
    expect(pushErrorMessage("protected-branch")).not.toContain("pull");
  });
});

describe("normalizeBranchName — 서버 normalizePushRef 와 같은 규칙(MIRROR)", () => {
  it("옵션 주입·git 이 거부하는 모양을 전부 막는다", () => {
    for (const bad of [
      "",
      "-force",
      "--upload-pack=evil",
      "a b",
      "a..b",
      "a~1",
      "a^",
      "a:b",
      "a?",
      "a*",
      "a[1]",
      "a\\b",
      "a@{0}",
      "a.lock",
      "trailing.",
      "/leading",
      "trailing/",
      "with\nnewline",
      42,
      null,
    ]) {
      expect(normalizeBranchName(bad)).toBeNull();
    }
  });

  it("정상 브랜치·refs/heads 접두사를 흡수한다", () => {
    expect(normalizeBranchName("feature/login")).toBe("feature/login");
    expect(normalizeBranchName("refs/heads/feature/login")).toBe(
      "feature/login",
    );
    expect(normalizeBranchName("  main  ")).toBe("main");
  });
});

describe("summarizePushStderr", () => {
  it("토큰을 지우고 마지막 줄만 남긴다", () => {
    const out = summarizePushStderr(
      `line1\nline2\nline3\nline4 ${INSTALL_WRITE}`,
      INSTALL_WRITE,
    );
    expect(out).not.toContain(INSTALL_WRITE);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("line1");
  });
});
