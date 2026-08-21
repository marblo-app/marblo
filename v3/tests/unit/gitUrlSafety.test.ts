import { describe, expect, it, vi } from "vitest";

// projectService 는 firestore 모듈을 통해 firebase 앱을 초기화한다 —
// 순수 함수(normalizeGitRemoteUrl) 하나를 보려고 그걸 띄울 필요는 없다.
vi.mock("../../src/services/firestore", () => ({
  getDocument: async () => null,
  queryDocuments: async () => [],
  createDocument: async () => "",
  updateDocument: async () => {},
  mergeDocument: async () => {},
  deleteDocument: async () => {},
  toTimestamp: (d: Date) => d,
  convertTimestamps: <T,>(raw: T) => raw,
}));
import {
  hasGitUrlCredentials,
  inspectGitUrlCredentials,
  isAppInjectedCredential,
  sanitizeGitRemoteUrl,
  stripGitUrlCredentials,
} from "../../electron/git-url-safety";
import { normalizeGitRemoteUrl } from "../../src/services/projectService";

/**
 * 티켓 d0d0JkRd1SeGTxVRx4nQ (P0 보안) 회귀.
 *
 * `https://<token>@github.com/...` 가 `.git/config` → IPC → 화면 →
 * **팀 전원이 읽는 Firestore `projects.gitRemoteUrl`** 까지 흘러가던 경로를
 * 못박는다. ★여기 쓰는 토큰은 전부 더미다 — 실제 값은 테스트에도 안 적는다.
 */
const DUMMY = "dummy-token-not-real";

describe("stripGitUrlCredentials", () => {
  it("strips a token carried in the username slot (the reported shape)", () => {
    expect(
      stripGitUrlCredentials(`https://${DUMMY}@github.com/acme/app.git`)
    ).toBe("https://github.com/acme/app.git");
  });

  it("strips user:password userinfo over http(s)", () => {
    expect(
      stripGitUrlCredentials(`https://oauth2:${DUMMY}@github.com/acme/app.git`)
    ).toBe("https://github.com/acme/app.git");
    expect(
      stripGitUrlCredentials(`http://x-access-token:${DUMMY}@git.corp/a/b`)
    ).toBe("http://git.corp/a/b");
  });

  it("keeps the ssh account name — removing git@ would break clone", () => {
    expect(stripGitUrlCredentials("ssh://git@github.com/acme/app.git")).toBe(
      "ssh://git@github.com/acme/app.git"
    );
    expect(stripGitUrlCredentials("git@github.com:acme/app.git")).toBe(
      "git@github.com:acme/app.git"
    );
    // ssh 에 password 가 붙은 경우엔 그것만 뗀다.
    expect(stripGitUrlCredentials(`ssh://git:${DUMMY}@github.com/a/b`)).toBe(
      "ssh://git@github.com/a/b"
    );
  });

  it("leaves clean URLs byte-identical (no re-encoding, no trailing slash)", () => {
    for (const url of [
      "https://github.com/Acme/App.git",
      "https://github.com/acme/app",
      "http://git.corp.local:8080/team/app.git",
      "git://example.com/a/b",
      "ssh://git@host:2222/a/b",
    ]) {
      expect(stripGitUrlCredentials(url)).toBe(url);
    }
  });

  it("preserves port, path case, query and fragment", () => {
    expect(
      stripGitUrlCredentials(`https://${DUMMY}@Git.Corp:8443/Team/App.git`)
    ).toBe("https://Git.Corp:8443/Team/App.git");
  });
});

describe("inspectGitUrlCredentials", () => {
  it("treats any http(s) userinfo as secret — tokens ride the username slot", () => {
    expect(inspectGitUrlCredentials(`https://${DUMMY}@github.com/a/b`)).toEqual(
      {
        present: true,
        secret: true,
      }
    );
    expect(hasGitUrlCredentials(`https://user@github.com/a/b`)).toBe(true);
  });

  it("does not call the ssh account name a secret", () => {
    expect(inspectGitUrlCredentials("git@github.com:a/b")).toEqual({
      present: true,
      secret: false,
    });
    expect(hasGitUrlCredentials("ssh://git@github.com/a/b")).toBe(false);
    expect(hasGitUrlCredentials("https://github.com/a/b")).toBe(false);
  });

  it("never echoes the credential back to the caller", () => {
    const info = inspectGitUrlCredentials(`https://${DUMMY}@github.com/a/b`);
    expect(JSON.stringify(info)).not.toContain(DUMMY);
  });

  it("is null-safe", () => {
    expect(hasGitUrlCredentials(null)).toBe(false);
    expect(hasGitUrlCredentials(undefined)).toBe(false);
    expect(hasGitUrlCredentials("")).toBe(false);
    expect(sanitizeGitRemoteUrl("   ")).toBeNull();
  });
});

describe("isAppInjectedCredential", () => {
  it("recognizes only machine-generated usernames (we rewrite .git/config for these)", () => {
    expect(
      isAppInjectedCredential(`https://oauth2:${DUMMY}@github.com/a/b`)
    ).toBe(true);
    expect(
      isAppInjectedCredential(`https://x-access-token:${DUMMY}@github.com/a/b`)
    ).toBe(true);
  });

  it("leaves a human's own credentials alone (rewriting would break their push)", () => {
    expect(
      isAppInjectedCredential(`https://alice:${DUMMY}@github.com/a/b`)
    ).toBe(false);
    expect(isAppInjectedCredential("https://github.com/a/b")).toBe(false);
    expect(isAppInjectedCredential("git@github.com:a/b")).toBe(false);
  });
});

describe("normalizeGitRemoteUrl (comparison key)", () => {
  it("★strips the token instead of folding it into the host", () => {
    // 이전 구현은 `([^/]+)` 로 `<token>@github.com` 전체를 호스트로 잡았고
    // 전체 소문자화까지 겹쳐 항상 mismatch 였다.
    expect(
      normalizeGitRemoteUrl(`https://${DUMMY}@github.com/acme/app.git`)
    ).toBe("github.com/acme/app");
    expect(
      normalizeGitRemoteUrl(`https://oauth2:${DUMMY}@github.com/acme/app.git`)
    ).toBe("github.com/acme/app");
  });

  it("★matches a tokenized URL against the same clean repo", () => {
    expect(
      normalizeGitRemoteUrl(`https://${DUMMY}@github.com/acme/app.git`)
    ).toBe(normalizeGitRemoteUrl("https://github.com/acme/app.git"));
    expect(
      normalizeGitRemoteUrl(`https://${DUMMY}@github.com/acme/app.git`)
    ).toBe(normalizeGitRemoteUrl("git@github.com:acme/app.git"));
  });

  it("never leaks the credential into the key", () => {
    const key = normalizeGitRemoteUrl(`https://${DUMMY}@github.com/acme/app`);
    expect(key).not.toContain(DUMMY);
    expect(key).not.toContain(DUMMY.toLowerCase());
  });

  it("folds case so the same GitHub repo is one project, not two", () => {
    expect(normalizeGitRemoteUrl("https://github.com/Acme/App.git")).toBe(
      normalizeGitRemoteUrl("https://github.com/acme/app")
    );
  });

  it("keeps the existing shapes working", () => {
    expect(normalizeGitRemoteUrl("git@github.com:acme/app.git")).toBe(
      "github.com/acme/app"
    );
    expect(normalizeGitRemoteUrl("ssh://git@github.com/acme/app.git")).toBe(
      "github.com/acme/app"
    );
    expect(normalizeGitRemoteUrl("git://github.com/acme/app.git")).toBe(
      "github.com/acme/app"
    );
    expect(normalizeGitRemoteUrl(null)).toBeNull();
    expect(normalizeGitRemoteUrl("  ")).toBeNull();
  });
});
