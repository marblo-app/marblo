import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as nodeOs from "node:os";
import * as path from "node:path";
import { AgentConfigGenerator } from "../../electron/agent-config";

/**
 * grok 오케/워커의 격리 GROK_HOME 배선.
 *
 * ★핵심 회귀 대상은 **폴더 신뢰(trusted_folders.toml)** 다. 격리 홈에 신뢰가 없으면
 * grok 은 로컬 stdio MCP 서버를 아예 기동하지 않아, config.toml 에 marblo 가
 * 멀쩡히 들어있어도 오케가 툴 0개인 껍데기로 뜬다(라이브 실측, grok 0.2.112).
 */

function grokHomeFor(agentId: string): string {
  return path.join(
    path.resolve(nodeOs.tmpdir(), "marblo-agent-configs"),
    `grok-home-${agentId}`,
  );
}

function trustedFolders(toml: string): string[] {
  const keys: string[] = [];
  const re = /^\s*\[folders\.(?:"([^"]*)"|'([^']*)')\]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(toml)) !== null) keys.push(m[1] ?? m[2]);
  return keys;
}

describe("AgentConfigGenerator — grok GROK_HOME", () => {
  let generator: AgentConfigGenerator;
  let repoRoot: string;
  const agentId = `grok-cfg-test-${process.pid}`;

  beforeEach(() => {
    generator = new AgentConfigGenerator();
    repoRoot = fs.mkdtempSync(path.join(nodeOs.tmpdir(), "marblo-grok-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  });

  afterEach(() => {
    generator.cleanup(agentId);
    fs.rmSync(grokHomeFor(agentId), { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("writes the Marblo MCP entry into the isolated GROK_HOME config.toml", () => {
    const configPath = generator.generateMCPConfig(
      agentId,
      "grok",
      repoRoot,
      "proj-1",
    );

    expect(path.basename(configPath)).toBe("config.toml");
    expect(path.dirname(configPath)).toBe(grokHomeFor(agentId));

    const toml = fs.readFileSync(configPath, "utf-8");
    expect(toml).toContain("[mcp_servers.marblo]");
    expect(toml).toContain("[mcp_servers.marblo.env]");
    expect(toml).toContain('MARBLO_PROJECT = "proj-1"');
  });

  it("trusts the project folder so grok actually starts the local MCP server", () => {
    const configPath = generator.generateMCPConfig(
      agentId,
      "grok",
      repoRoot,
      "proj-1",
    );
    const trustPath = path.join(
      path.dirname(configPath),
      "trusted_folders.toml",
    );

    expect(fs.existsSync(trustPath)).toBe(true);
    const folders = trustedFolders(fs.readFileSync(trustPath, "utf-8"));
    expect(folders).toContain(repoRoot);
    // macOS 의 /var → /private/var 처럼 realpath 가 갈리면 grok 의 정확일치
    // 신뢰 검사가 빗나가므로 두 표기를 모두 넣는다.
    expect(folders).toContain(fs.realpathSync(repoRoot));
  });

  it("trusts the git MAIN checkout for a linked worktree (grok normalizes worktrees to it)", () => {
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
    const worktree = path.join(repoRoot, "..", `${path.basename(repoRoot)}-wt`);
    execFileSync("git", ["worktree", "add", "-q", worktree, "-b", "wt"], {
      cwd: repoRoot,
    });

    try {
      const configPath = generator.generateMCPConfig(
        agentId,
        "grok",
        worktree,
        "proj-1",
      );
      const folders = trustedFolders(
        fs.readFileSync(
          path.join(path.dirname(configPath), "trusted_folders.toml"),
          "utf-8",
        ),
      );
      expect(folders).toContain(path.resolve(worktree));
      // git 은 `.git` 파일의 gitdir 를 realpath 로 적으므로 main 체크아웃은 그
      // 표기로 나온다(macOS tmpdir 의 /var → /private/var).
      expect(folders).toContain(fs.realpathSync(repoRoot));
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("never emits a duplicate [folders.*] table (duplicate tables break TOML parsing)", () => {
    const configPath = generator.generateMCPConfig(
      agentId,
      "grok",
      repoRoot,
      "proj-1",
    );
    const folders = trustedFolders(
      fs.readFileSync(
        path.join(path.dirname(configPath), "trusted_folders.toml"),
        "utf-8",
      ),
    );
    expect(new Set(folders).size).toBe(folders.length);
  });
});
