import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FsManager } from "../../electron/fs-manager";

/**
 * 티켓 d0d0JkRd1SeGTxVRx4nQ (P0 보안) 회귀 — **IPC 경계 실측**.
 *
 * `fs:gitRemoteUrl` 이 이 메서드 하나로 구현돼 있고, 그 반환값이 렌더러 →
 * 화면 → 팀 전원이 읽는 Firestore `projects.gitRemoteUrl` 로 간다. 그래서
 * 진짜 git repo 를 만들어 오염된 origin 을 박아 두고 "무엇이 밖으로
 * 나가는지" 를 본다.
 *
 * ★토큰은 더미다. 실제 값은 테스트에도 적지 않는다.
 */
const DUMMY = "dummy-token-not-real";

const tmpDirs: string[] = [];

function gitRepo(originUrl: string): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-remote-")),
  );
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", originUrl], { cwd: dir });
  return dir;
}

function storedOrigin(dir: string): string {
  return execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("FsManager.getGitRemoteUrl", () => {
  it("★never lets a credential out of the main process", async () => {
    const dir = gitRepo(`https://oauth2:${DUMMY}@github.com/acme/app.git`);
    const url = await new FsManager().getGitRemoteUrl(dir);
    expect(url).toBe("https://github.com/acme/app.git");
    expect(url).not.toContain(DUMMY);
  });

  it("★also strips a token carried in the username slot", async () => {
    const dir = gitRepo(`https://${DUMMY}@github.com/acme/app.git`);
    const url = await new FsManager().getGitRemoteUrl(dir);
    expect(url).toBe("https://github.com/acme/app.git");
  });

  it("★scrubs our own injected credential off disk, not just off the wire", async () => {
    const dir = gitRepo(`https://oauth2:${DUMMY}@github.com/acme/app.git`);
    await new FsManager().getGitRemoteUrl(dir);
    // 구버전이 남긴 평문 토큰이 .git/config 에서 사라져야 한다.
    expect(storedOrigin(dir)).toBe("https://github.com/acme/app.git");
    expect(
      fs.readFileSync(path.join(dir, ".git", "config"), "utf8"),
    ).not.toContain(DUMMY);
  });

  it("leaves a human's own credential on disk (rewriting would break their push)", async () => {
    const dir = gitRepo(`https://alice:${DUMMY}@github.com/acme/app.git`);
    const url = await new FsManager().getGitRemoteUrl(dir);
    // 밖으로는 안 나가지만,
    expect(url).toBe("https://github.com/acme/app.git");
    // 그 사람의 설정은 그대로 둔다.
    expect(storedOrigin(dir)).toContain("alice");
  });

  it("passes clean URLs through untouched", async () => {
    const dir = gitRepo("git@github.com:acme/app.git");
    expect(await new FsManager().getGitRemoteUrl(dir)).toBe(
      "git@github.com:acme/app.git",
    );
    expect(storedOrigin(dir)).toBe("git@github.com:acme/app.git");
  });

  it("returns null when there is no origin", async () => {
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "marblo-remote-")),
    );
    tmpDirs.push(dir);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    expect(await new FsManager().getGitRemoteUrl(dir)).toBeNull();
  });
});
