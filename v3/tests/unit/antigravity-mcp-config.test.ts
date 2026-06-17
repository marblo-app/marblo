import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as nodeOs from "node:os";
import * as path from "node:path";
import { AgentConfigGenerator } from "../../electron/agent-config";

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
  let savedBridgePort: string | undefined;
  let savedAgyConfigHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(
      path.join(nodeOs.tmpdir(), "marblo-agy-home-"),
    );
    savedBridgePort = process.env.MARBLO_BRIDGE_PORT;
    savedAgyConfigHome = process.env.MARBLO_AGY_CONFIG_HOME;
    process.env.MARBLO_BRIDGE_PORT = "34567";
    process.env.MARBLO_AGY_CONFIG_HOME = tmpHome;
  });

  afterEach(() => {
    if (savedBridgePort === undefined) {
      delete process.env.MARBLO_BRIDGE_PORT;
    } else {
      process.env.MARBLO_BRIDGE_PORT = savedBridgePort;
    }
    if (savedAgyConfigHome === undefined) {
      delete process.env.MARBLO_AGY_CONFIG_HOME;
    } else {
      process.env.MARBLO_AGY_CONFIG_HOME = savedAgyConfigHome;
    }
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

    for (const cfg of [shared, legacy]) {
      const marblo = cfg.mcpServers?.marblo;
      expect(marblo?.command).toBe("node");
      expect(marblo?.args?.[0]).toContain("dist-mcp");
      expect(marblo?.env?.MARBLO_AGENT_ID).toBe("agent-agy-1");
      expect(marblo?.env?.MARBLO_PROJECT).toBe("project-1");
      expect(marblo?.env?.MARBLO_CONTEXT).toBe("board");
      expect(marblo?.env?.MARBLO_BRIDGE_PORT).toBe("34567");
      expect(marblo?.env?.PATH).toContain(".local/bin");
    }

    const sentinel = JSON.parse(
      fs.readFileSync(sentinelPath, "utf-8"),
    ) as {
      globalConfigPath: string;
      globalConfigPaths: string[];
      mergeFailed: boolean;
    };
    expect(sentinel.globalConfigPath).toBe(sharedPath);
    expect(sentinel.globalConfigPaths).toEqual([sharedPath, legacyPath]);
    expect(sentinel.mergeFailed).toBe(false);
  });
});
