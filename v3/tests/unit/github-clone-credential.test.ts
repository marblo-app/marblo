import { describe, expect, it, vi } from "vitest";
import {
  isGitHubHttpsUrl,
  resolveCloneCredential,
  type CloneCredentialDeps,
} from "../../electron/github-clone-credential";
import { cloneRepo, githubTokenGitConfigEnv } from "../../electron/repo-clone";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * GitHub App 자동상속 — **회귀 0 증명** (티켓 ddbN2KvxHZ08rakiVfL0).
 * 설계 §6.2 G6 이 요구한 매트릭스: [installation 유/무] × [device 토큰 유/무]
 * × [서버 성공/실패] 8케이스에서 선택된 kind 와 최종 git 인자를 단언한다.
 *
 * ★여기서 못박는 것:
 *   - App 이 없는 사용자·개인 저장소는 **종전 그대로** device 경로다.
 *   - App 경로 장애는 device 로 내려오고, 그 역은 없다.
 *   - installation 이 없으면 **서버를 부르지도 않는다**(G1 — 네트워크 0).
 *   - 토큰은 두 경로 모두 #1097 의 `GIT_CONFIG_*` 로만 들어간다 — argv 에도
 *     `.git/config` 에도 남지 않는다. clone 구현은 한 벌뿐이다.
 */

const DEVICE = "device-token-dummy";
const INSTALLATION = "installation-token-dummy";
const GITHUB_URL = "https://github.com/acme/app.git";
const PROJECT = "proj-1";

interface Scenario {
  installationId: string | null;
  serverToken: string | null;
  deviceToken: string | null;
}

function deps(s: Scenario): CloneCredentialDeps & {
  calls: { installation: number; issue: number };
} {
  const calls = { installation: 0, issue: 0 };
  return {
    calls,
    getInstallationId: async () => {
      calls.installation += 1;
      return s.installationId;
    },
    issueInstallationToken: async () => {
      calls.issue += 1;
      return s.serverToken;
    },
    getDeviceToken: () => s.deviceToken,
  };
}

describe("isGitHubHttpsUrl — App 경로 게이트 (설계 G5)", () => {
  it("github.com HTTPS 만 참", () => {
    expect(isGitHubHttpsUrl("https://github.com/acme/app.git")).toBe(true);
    expect(isGitHubHttpsUrl("https://GitHub.com/acme/app")).toBe(true);
  });

  it("SSH·타 호스트·잘못된 값은 거짓 — 서버를 부를 이유가 없다", () => {
    expect(isGitHubHttpsUrl("git@github.com:acme/app.git")).toBe(false);
    expect(isGitHubHttpsUrl("ssh://git@github.com/acme/app.git")).toBe(false);
    expect(isGitHubHttpsUrl("https://gitlab.com/acme/app.git")).toBe(false);
    expect(isGitHubHttpsUrl("https://github.com.evil.test/acme/app")).toBe(
      false,
    );
    expect(isGitHubHttpsUrl("not a url")).toBe(false);
  });
});

describe("resolveCloneCredential — 8케이스 매트릭스 (설계 §6.2 G6)", () => {
  const cases: Array<{
    name: string;
    scenario: Scenario;
    expected: { kind: string; token?: string };
    /** 서버 발급을 시도했어야 하는가. */
    issued: boolean;
  }> = [
    {
      name: "설치O · 서버성공 · device O → installation (1급 경로 A)",
      scenario: {
        installationId: "12345678",
        serverToken: INSTALLATION,
        deviceToken: DEVICE,
      },
      expected: { kind: "installation", token: INSTALLATION },
      issued: true,
    },
    {
      name: "설치O · 서버성공 · device X → installation (초대 없이 clone 된다)",
      scenario: {
        installationId: "12345678",
        serverToken: INSTALLATION,
        deviceToken: null,
      },
      expected: { kind: "installation", token: INSTALLATION },
      issued: true,
    },
    {
      name: "★설치O · 서버실패 · device O → device (G2: App 장애가 기존 경로를 막지 않는다)",
      scenario: {
        installationId: "12345678",
        serverToken: null,
        deviceToken: DEVICE,
      },
      expected: { kind: "device", token: DEVICE },
      issued: true,
    },
    {
      name: "설치O · 서버실패 · device X → none (public repo 로 시도)",
      scenario: {
        installationId: "12345678",
        serverToken: null,
        deviceToken: null,
      },
      expected: { kind: "none" },
      issued: true,
    },
    {
      name: "★설치X · device O → device (G1: 오늘의 모든 프로젝트가 여기다)",
      scenario: {
        installationId: null,
        serverToken: INSTALLATION,
        deviceToken: DEVICE,
      },
      expected: { kind: "device", token: DEVICE },
      issued: false,
    },
    {
      name: "설치X · device X → none (종전 동작 그대로)",
      scenario: {
        installationId: null,
        serverToken: INSTALLATION,
        deviceToken: null,
      },
      expected: { kind: "none" },
      issued: false,
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const d = deps(c.scenario);
      const got = await resolveCloneCredential(
        { projectId: PROJECT, repoUrl: GITHUB_URL },
        d,
      );
      expect(got.kind).toBe(c.expected.kind);
      if (c.expected.token) {
        expect(got.kind !== "none" && got.token).toBe(c.expected.token);
      }
      // ★G1 — 설치가 없으면 서버 호출이 **0회**여야 한다.
      expect(d.calls.issue).toBe(c.issued ? 1 : 0);
    });
  }

  it("★projectId 가 없으면 App 경로를 아예 타지 않는다 (수동 URL clone)", async () => {
    const d = deps({
      installationId: "12345678",
      serverToken: INSTALLATION,
      deviceToken: DEVICE,
    });
    const got = await resolveCloneCredential(
      { projectId: null, repoUrl: GITHUB_URL },
      d,
    );
    expect(got).toEqual({ kind: "device", token: DEVICE });
    expect(d.calls.installation).toBe(0);
    expect(d.calls.issue).toBe(0);
  });

  it("★SSH·타 호스트는 서버를 부르지 않고 종전 경로 (G3/G5)", async () => {
    for (const url of [
      "git@github.com:acme/app.git",
      "ssh://git@github.com/acme/app.git",
      "https://gitlab.com/acme/app.git",
    ]) {
      const d = deps({
        installationId: "12345678",
        serverToken: INSTALLATION,
        deviceToken: DEVICE,
      });
      const got = await resolveCloneCredential(
        { projectId: PROJECT, repoUrl: url },
        d,
      );
      expect(got).toEqual({ kind: "device", token: DEVICE });
      expect(d.calls.installation).toBe(0);
      expect(d.calls.issue).toBe(0);
    }
  });

  it("★조회/발급이 던져도 device 로 내려온다 — 던짐이 새어나가면 회귀다", async () => {
    const throwingLookup: CloneCredentialDeps = {
      getInstallationId: async () => {
        throw new Error("firestore down");
      },
      issueInstallationToken: async () => INSTALLATION,
      getDeviceToken: () => DEVICE,
    };
    await expect(
      resolveCloneCredential(
        { projectId: PROJECT, repoUrl: GITHUB_URL },
        throwingLookup,
      ),
    ).resolves.toEqual({ kind: "device", token: DEVICE });

    const throwingIssue: CloneCredentialDeps = {
      getInstallationId: async () => "12345678",
      issueInstallationToken: async () => {
        throw new Error("callable exploded");
      },
      getDeviceToken: () => DEVICE,
    };
    await expect(
      resolveCloneCredential(
        { projectId: PROJECT, repoUrl: GITHUB_URL },
        throwingIssue,
      ),
    ).resolves.toEqual({ kind: "device", token: DEVICE });
  });
});

describe("★토큰 경계 — 두 경로가 같은 clone 구현(#1097)을 쓴다", () => {
  it("installation 토큰도 device 토큰과 **동일한** GIT_CONFIG_* 헤더로 들어간다", () => {
    const asDevice = githubTokenGitConfigEnv(GITHUB_URL, DEVICE);
    const asInstallation = githubTokenGitConfigEnv(GITHUB_URL, INSTALLATION);
    // 키 모양이 같다 = 경로가 한 벌이다.
    expect(Object.keys(asDevice)).toEqual(Object.keys(asInstallation));
    expect(asInstallation.GIT_CONFIG_KEY_0).toBe(
      "http.https://github.com/.extraHeader",
    );
    // 값은 Authorization 헤더 하나뿐 — URL 에 박히지 않는다.
    expect(asInstallation.GIT_CONFIG_VALUE_0).toBe(
      `Authorization: Basic ${Buffer.from(
        `x-access-token:${INSTALLATION}`,
        "utf8",
      ).toString("base64")}`,
    );
  });

  it("★installation 토큰이 argv 에도 remote URL 에도 실리지 않는다", async () => {
    const parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "marblo-appclone-")),
    );
    try {
      const runner = vi.fn(async () => ({ code: 1, stderr: "boom" }));
      await cloneRepo(
        { repoUrl: GITHUB_URL, parentDir: parent, githubToken: INSTALLATION },
        runner,
      );
      const [args, opts] = runner.mock.calls[0] as unknown as [
        string[],
        { env?: Record<string, string> },
      ];
      // argv 전수 검사 — 어디에도 토큰이 없다(ps 로 안 보인다).
      expect(args.join(" ")).not.toContain(INSTALLATION);
      expect(args).toContain(GITHUB_URL);
      // 토큰은 자식 프로세스 env 에만 있다.
      expect(JSON.stringify(opts.env)).toContain(
        Buffer.from(`x-access-token:${INSTALLATION}`, "utf8").toString(
          "base64",
        ),
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("★clone 실패 메시지에 installation 토큰이 새지 않는다", async () => {
    const parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "marblo-appclone-")),
    );
    try {
      const result = await cloneRepo(
        { repoUrl: GITHUB_URL, parentDir: parent, githubToken: INSTALLATION },
        async () => ({
          code: 128,
          stderr: `fatal: unable to access '${GITHUB_URL}': token ${INSTALLATION} rejected`,
        }),
      );
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(INSTALLATION);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
