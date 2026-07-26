import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as nodeOs from "node:os";
import * as path from "node:path";
import {
  AgentConfigGenerator,
  resolveNodeBinary,
} from "../../electron/agent-config";

interface McpConfig {
  mcpServers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
  untouched?: boolean;
}

function readConfig(filePath: string): McpConfig {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as McpConfig;
}

describe("AgentConfigGenerator — Antigravity MCP config", () => {
  let tmpHome: string;

  // 생성되는 MCP env 는 ambient process.env 파생이다(getMCPServerEnv). 손으로
  // 저장/복구하면 실패한 테스트가 프로세스 env 를 오염시킨 채 끝나 뒤 테스트가
  // 머신마다 다르게 깨진다 — vi.stubEnv/unstubAllEnvs 로 결정론화한다.
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(nodeOs.tmpdir(), "marblo-agy-home-"));
    vi.stubEnv("MARBLO_BRIDGE_PORT", "34567");
    vi.stubEnv("MARBLO_AGY_CONFIG_HOME", tmpHome);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("merges Marblo into shared and legacy agy MCP configs with resolved env", () => {
    const sharedPath = path.join(
      tmpHome,
      ".gemini",
      "config",
      "mcp_config.json",
    );
    const legacyPath = path.join(
      tmpHome,
      ".gemini",
      "antigravity-cli",
      "mcp_config.json",
    );
    fs.mkdirSync(path.dirname(sharedPath), { recursive: true });
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(
      sharedPath,
      JSON.stringify({
        untouched: true,
        mcpServers: { existing: { command: "existing-shared" } },
      }),
      "utf-8",
    );
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        mcpServers: { legacy: { command: "existing-legacy" } },
      }),
      "utf-8",
    );

    const generator = new AgentConfigGenerator();
    const sentinelPath = generator.generateMCPConfig(
      "agent-agy-1",
      "antigravity",
      "/repo",
      "project-1",
      "board",
    );

    const shared = readConfig(sharedPath);
    const legacy = readConfig(legacyPath);
    expect(shared.untouched).toBe(true);
    expect(shared.mcpServers?.existing?.command).toBe("existing-shared");
    expect(legacy.mcpServers?.legacy?.command).toBe("existing-legacy");

    // command 는 더이상 PATH 의존 "node" 가 아니라 resolveNodeBinary() 가 고른
    // **검증된 절대경로**다(PATH 첫 node 가 깨진 바이너리인 사고 이후). 경로 값
    // 자체는 머신마다 다르므로 리터럴로 박지 않고 같은 리졸버로 기대값을 만든다.
    const resolvedNode = resolveNodeBinary();

    for (const cfg of [shared, legacy]) {
      const marblo = cfg.mcpServers?.marblo;
      expect(marblo?.command).toBe(resolvedNode.command);
      expect(path.isAbsolute(marblo?.command ?? "")).toBe(true);
      expect(marblo?.command).not.toBe("node"); // bare PATH 조회로 회귀 금지
      expect(marblo?.args?.[0]).toContain("dist-mcp");
      expect(marblo?.env?.MARBLO_AGENT_ID).toBe("agent-agy-1");
      expect(marblo?.env?.MARBLO_PROJECT).toBe("project-1");
      expect(marblo?.env?.MARBLO_CONTEXT).toBe("board");
      expect(marblo?.env?.MARBLO_BRIDGE_PORT).toBe("34567");
      // 홈 경로·구분자는 플랫폼/머신마다 다르므로 리터럴 대신 조립해서 비교.
      expect(marblo?.env?.PATH).toContain(
        path.join(nodeOs.homedir(), ".local", "bin"),
      );
    }

    const sentinel = JSON.parse(fs.readFileSync(sentinelPath, "utf-8")) as {
      globalConfigPath: string;
      globalConfigPaths: string[];
      mergeFailed: boolean;
    };
    expect(sentinel.globalConfigPath).toBe(sharedPath);
    expect(sentinel.globalConfigPaths).toEqual([sharedPath, legacyPath]);
    expect(sentinel.mergeFailed).toBe(false);
  });
});
