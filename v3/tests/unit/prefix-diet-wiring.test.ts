/**
 * 티켓 x4EGDVAWLuy2sdPb9fEK — 다이어트 **배선** 테스트.
 *
 * `prefix-diet.test.ts` 는 정책 함수가 옳은 답을 내는지 본다. 그것만으로는
 * "정책은 맞는데 아무도 안 부른다"를 못 잡는다 — 이 레포가 여러 번 데인 실패
 * 모드다(선언만 하고 안 쓰는 인자). 그래서 여기서는 **실제로 디스크에 쓰이는
 * MCP config** 와 **실제로 만들어지는 스폰 argv** 를 검사한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as nodeOs from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { AgentConfigGenerator } from "../../electron/agent-config";

interface ClaudeMcpConfig {
  mcpServers?: Record<string, { env?: Record<string, string> }>;
}

function marbloEnv(configPath: string): Record<string, string> {
  const parsed = JSON.parse(
    fs.readFileSync(configPath, "utf-8"),
  ) as ClaudeMcpConfig;
  return parsed.mcpServers?.marblo?.env ?? {};
}

/** `--settings` 값을 argv 에서 뽑아 파싱한다. 여러 번 나오면 마지막이 이긴다. */
function settingsFromArgs(args: string[]): Record<string, unknown> | null {
  const idx = args.lastIndexOf("--settings");
  if (idx === -1) return null;
  return JSON.parse(args[idx + 1]) as Record<string, unknown>;
}

describe("prefix diet — MCP config 배선 (A1)", () => {
  let generator: AgentConfigGenerator;
  let repoRoot: string;
  const agentId = "diet-wire-agent";

  beforeEach(() => {
    generator = new AgentConfigGenerator();
    repoRoot = fs.mkdtempSync(path.join(nodeOs.tmpdir(), "marblo-diet-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: repoRoot });
    vi.stubEnv("MARBLO_BRIDGE_PORT", "34567");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    generator.cleanup(agentId);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("워커 역할이 MCP 서버 env 로 실제 전달된다", () => {
    const configPath = generator.generateMCPConfig(
      agentId,
      "claude",
      repoRoot,
      "proj-1",
      undefined,
      "backend",
    );
    expect(marbloEnv(configPath).MARBLO_AGENT_ROLE).toBe("backend");
  });

  it("역할 미지정이면 키 자체가 없다 (종전 env 와 동등 · fail-open)", () => {
    const configPath = generator.generateMCPConfig(
      agentId,
      "claude",
      repoRoot,
      "proj-1",
    );
    expect(marbloEnv(configPath).MARBLO_AGENT_ROLE).toBeUndefined();
    expect(marbloEnv(configPath).MARBLO_TOOL_SURFACE).toBeUndefined();
  });

  it("전면 롤백이면 MCP 에 full 이 강제된다", () => {
    vi.stubEnv("MARBLO_PREFIX_DIET", "off");
    const configPath = generator.generateMCPConfig(
      agentId,
      "claude",
      repoRoot,
      "proj-1",
      undefined,
      "backend",
    );
    expect(marbloEnv(configPath).MARBLO_TOOL_SURFACE).toBe("full");
  });
});

describe("prefix diet — 스폰 argv 배선 (A2/A3)", () => {
  let generator: AgentConfigGenerator;
  let repoRoot: string;
  const agentId = "diet-argv-agent";

  beforeEach(() => {
    generator = new AgentConfigGenerator();
    repoRoot = fs.mkdtempSync(path.join(nodeOs.tmpdir(), "marblo-diet-argv-"));
    execFileSync("git", ["init", "-q"], { cwd: repoRoot });
    vi.stubEnv("MARBLO_BRIDGE_PORT", "34567");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    generator.cleanup(agentId);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function launch(role: string) {
    return generator.getLaunchConfig(
      { id: agentId, model: "claude", role, command: "claude" },
      repoRoot,
      undefined,
      "proj-1",
    );
  }

  it("워커 --settings 는 텔레그램 차단 + auto-memory 차단을 한 객체로 싣는다", () => {
    const { args } = launch("backend");
    // ★두 번 붙으면 마지막만 살아남아 텔레그램 차단이 조용히 풀린다.
    expect(args.filter((a) => a === "--settings")).toHaveLength(1);
    expect(settingsFromArgs(args)).toEqual({
      enabledPlugins: { "telegram@claude-plugins-official": false },
      autoMemoryEnabled: false,
    });
  });

  it("A3 는 기본으로 붙지 않는다", () => {
    expect(launch("backend").args).not.toContain("--disable-slash-commands");
  });

  it("A3 는 MARBLO_WORKER_SKILLS=off 로만 켜진다", () => {
    vi.stubEnv("MARBLO_WORKER_SKILLS", "off");
    expect(launch("backend").args).toContain("--disable-slash-commands");
  });

  it("전면 롤백이면 --settings 가 다이어트 이전과 바이트 동등하다", () => {
    vi.stubEnv("MARBLO_PREFIX_DIET", "off");
    vi.stubEnv("MARBLO_WORKER_SKILLS", "off"); // 전면 롤백이 opt-in 을 이긴다
    const { args } = launch("backend");
    expect(settingsFromArgs(args)).toEqual({
      enabledPlugins: { "telegram@claude-plugins-official": false },
    });
    expect(args).not.toContain("--disable-slash-commands");
  });

  it("오케스트레이터 스폰은 어떤 노브도 받지 않는다", () => {
    vi.stubEnv("MARBLO_WORKER_SKILLS", "off");
    const { args } = launch("orchestrator");
    // 오케는 애초에 --settings 자체가 안 붙는 경로다(telegram 가드도 워커 전용).
    expect(settingsFromArgs(args)).toBeNull();
    expect(args).not.toContain("--disable-slash-commands");
  });
});
